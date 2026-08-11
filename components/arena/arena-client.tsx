"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { useClerk, useUser } from "@clerk/nextjs";
import { RotateCcw, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogModel } from "@/lib/openrouter";
import {
  castVote,
  completeMessage,
  createTurn,
  failMessage,
  type CreateTurnResult,
} from "@/app/arena/actions";
import { useThreads } from "@/components/app-shell/threads-context";
import { MAX_SELECTED_MODELS, PromptBox } from "./prompt-box";

// "unfinished" only exists on reloaded turns: a row still PENDING in the
// database because its stream never completed. It renders honestly as
// "didn't finish" — never as fake streaming.
type LaneStatus = "streaming" | "done" | "error" | "unfinished";

type Lane = {
  modelId: string;
  modelName: string;
  text: string;
  status: LaneStatus;
  errorMessage?: string;
  ttftMs?: number;
  tokensPerSecond?: number;
  totalTokens?: number;
  // Live approximations while the stream runs, always rendered with a "~" so
  // an estimate never poses as a measurement. Cleared when the stream ends
  // and the exact usage-based numbers take over.
  liveTokensPerSecond?: number;
  liveTokens?: number;
};

type TurnView = {
  key: number;
  turnId: string | null;
  saveFailed: boolean;
  prompt: string;
  lanes: Lane[];
  winnerModelId: string | null;
  voteError?: string;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

// One persisted turn, as the thread page hands it over after a reload.
export type InitialTurn = {
  turnId: string;
  prompt: string;
  winnerModelId: string | null;
  // model id → message row id, so voting and retrying still reach the
  // right database rows after a reload.
  messageIds: Record<string, string>;
  lanes: {
    modelId: string;
    modelName: string;
    text: string;
    status: "done" | "error" | "unfinished";
    errorMessage?: string;
    ttftMs?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  }[];
};

// Shape of one OpenRouter SSE chunk — only the fields the client reads.
type StreamChunk = {
  choices?: { delta?: { content?: string } }[];
  usage?: { completion_tokens?: number };
};

type LanePatch = Partial<Lane> | ((lane: Lane) => Partial<Lane>);

// How long a stream may go without any progress before it's cut off.
const STALL_MS = 60_000;
const STALL_REASON = "stall";
const SUPERSEDED_REASON = "superseded";
// Matches the server's per-message content cap, so a giant answer in the
// history gets trimmed instead of failing the whole follow-up.
const MAX_HISTORY_CONTENT = 32_000;
// Matches the server's message-count cap — a long thread keeps the most
// recent exchanges and drops the oldest instead of failing every lane.
const MAX_HISTORY_MESSAGES = 40;
// Rough characters-per-token for the live streaming readout only — the final
// numbers always come from OpenRouter's real usage block.
const CHARS_PER_TOKEN = 4;

// Metrics tick live while a lane streams — approximations carry a "~" so an
// estimate never poses as a measurement; once the stream ends only the exact
// usage-based numbers remain. A metric that hasn't arrived is simply absent,
// never a dash or an invented value.
function laneMetrics(lane: Lane): string {
  const streaming = lane.status === "streaming";
  const parts = [
    lane.ttftMs !== undefined ? `${lane.ttftMs}ms to first token` : null,
    streaming
      ? lane.liveTokensPerSecond !== undefined
        ? `~${lane.liveTokensPerSecond} tok/s`
        : null
      : lane.tokensPerSecond !== undefined
        ? `${lane.tokensPerSecond} tok/s`
        : null,
    streaming
      ? lane.liveTokens !== undefined
        ? `~${lane.liveTokens} tokens`
        : null
      : lane.totalTokens !== undefined
        ? `${lane.totalTokens} tokens`
        : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return streaming ? "waiting for first token…" : "";
  }
  return parts.join(" · ");
}

export function ArenaClient({
  catalog,
  initialThreadId = null,
  initialTurns = [],
  readOnly = false,
}: {
  catalog: CatalogModel[];
  initialThreadId?: string | null;
  initialTurns?: InitialTurn[];
  // A visitor on someone else's thread: same turns, lanes, and real metrics
  // the owner sees, but no sending, voting, or retrying. The server enforces
  // ownership on every write anyway — this just keeps the view honest.
  readOnly?: boolean;
}) {
  const { isSignedIn } = useUser();
  const clerk = useClerk();
  const { refreshThreads } = useThreads();

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    catalog.slice(0, MAX_SELECTED_MODELS).map((model) => model.id),
  );
  const [prompt, setPrompt] = useState("");
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [turns, setTurns] = useState<TurnView[]>(() =>
    initialTurns.map((turn, index) => ({
      key: index,
      turnId: turn.turnId,
      saveFailed: false,
      prompt: turn.prompt,
      winnerModelId: turn.winnerModelId,
      lanes: turn.lanes.map((lane) => ({ ...lane })),
    })),
  );

  // The pending database write for each turn, so a lane finishing its stream
  // can wait for its message row id without blocking the stream itself.
  // Reloaded turns are seeded as already-resolved writes, so voting on and
  // retrying a restored turn go through the exact same path as a live one.
  const persistenceRef = useRef(
    new Map<number, Promise<CreateTurnResult>>(
      initialThreadId
        ? initialTurns.map((turn, index) => [
            index,
            Promise.resolve({
              threadId: initialThreadId,
              turnId: turn.turnId,
              messageIds: turn.messageIds,
            }),
          ])
        : [],
    ),
  );
  // Live stream controllers, so a new message can stop lanes still running.
  const controllersRef = useRef(new Map<string, AbortController>());
  // Completion/failure writes per turn and model — a lane can show "done" on
  // screen before its SUCCESS row lands, and a vote cast in that gap would be
  // rejected by the server. Each write resolves to whether it actually
  // persisted, so voting can tell "still saving" from "failed to save".
  const outcomeWritesRef = useRef(
    new Map<number, Map<string, Promise<boolean>>>(),
  );

  function trackOutcome(
    turnKey: number,
    modelId: string,
    write: Promise<boolean>,
  ) {
    const writes =
      outcomeWritesRef.current.get(turnKey) ??
      new Map<string, Promise<boolean>>();
    writes.set(modelId, write);
    outcomeWritesRef.current.set(turnKey, writes);
  }

  function patchTurn(turnKey: number, patch: Partial<TurnView>) {
    setTurns((current) =>
      current.map((turn) =>
        turn.key === turnKey ? { ...turn, ...patch } : turn,
      ),
    );
  }

  function patchLane(turnKey: number, modelId: string, patch: LanePatch) {
    setTurns((current) =>
      current.map((turn) =>
        turn.key === turnKey
          ? {
              ...turn,
              lanes: turn.lanes.map((lane) =>
                lane.modelId === modelId
                  ? {
                      ...lane,
                      ...(typeof patch === "function" ? patch(lane) : patch),
                    }
                  : lane,
              ),
            }
          : turn,
      ),
    );
  }

  // Each model only ever sees its own previous answers — never another
  // model's words (docs/scope.md Feature 6: separate conversations).
  function buildHistory(
    modelId: string,
    priorTurns: TurnView[],
    promptText: string,
  ): ChatMessage[] {
    const history: ChatMessage[] = [];
    for (const turn of priorTurns) {
      history.push({
        role: "user",
        content: turn.prompt.slice(0, MAX_HISTORY_CONTENT),
      });
      const lane = turn.lanes.find((l) => l.modelId === modelId);
      if (lane && lane.status === "done" && lane.text.length > 0) {
        history.push({
          role: "assistant",
          content: lane.text.slice(0, MAX_HISTORY_CONTENT),
        });
      }
    }
    history.push({ role: "user", content: promptText });
    // The cap can land mid-exchange, stranding an assistant answer whose
    // question was cut off — drop it so history always opens with a user
    // message and every retained answer keeps its originating question.
    const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
    return trimmed.slice(
      trimmed.findIndex((message) => message.role === "user"),
    );
  }

  // Resolves to whether the outcome actually reached the database — a handled
  // { error } from the server action is a failed write, not a persisted one.
  // Never rejects, so callers can await it without a catch.
  async function persistOutcome(
    turnKey: number,
    modelId: string,
    outcome: { kind: "done"; lane: Lane } | { kind: "failed" },
  ): Promise<boolean> {
    try {
      const pending = persistenceRef.current.get(turnKey);
      if (!pending) return false;
      const result = await pending;
      if ("error" in result) return false;
      const messageId = result.messageIds[modelId];
      if (!messageId) return false;

      const written =
        outcome.kind === "done"
          ? await completeMessage({
              messageId,
              content: outcome.lane.text,
              ttftMs: outcome.lane.ttftMs,
              tokensPerSecond: outcome.lane.tokensPerSecond,
              totalTokens: outcome.lane.totalTokens,
            })
          : await failMessage({ messageId });
      return !("error" in written);
    } catch {
      return false;
    }
  }

  async function streamModel(
    turnKey: number,
    modelId: string,
    messages: ChatMessage[],
  ) {
    const startedAt = performance.now();
    let firstTokenAt: number | undefined;
    let completionTokens: number | undefined;
    let finalText = "";

    const controller = new AbortController();
    controllersRef.current.set(`${turnKey}:${modelId}`, controller);

    // A model that goes quiet — never a first token, or a stream that stops
    // moving — ends with a plain timeout instead of hanging forever.
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(STALL_REASON), STALL_MS);
    };
    resetStallTimer();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, messages }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        let message = "The model didn't respond. Please try again.";
        try {
          const data = (await response.json()) as { error?: string };
          if (typeof data.error === "string") message = data.error;
        } catch {
          // Non-JSON error body — keep the plain default message.
        }
        patchLane(turnKey, modelId, { status: "error", errorMessage: message });
        trackOutcome(
          turnKey,
          modelId,
          persistOutcome(turnKey, modelId, { kind: "failed" }),
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetStallTimer();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "" || payload === "[DONE]") continue;

          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(payload) as StreamChunk;
          } catch {
            continue;
          }

          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            if (firstTokenAt === undefined) {
              firstTokenAt = performance.now();
              patchLane(turnKey, modelId, {
                ttftMs: Math.round(firstTokenAt - startedAt),
              });
            }
            finalText += delta;
            // Live readout: estimated tokens from streamed characters over
            // the measured elapsed window. The rate waits half a second so
            // the first chunks don't flash a wild number.
            const liveTokens = Math.round(finalText.length / CHARS_PER_TOKEN);
            const elapsedSeconds = (performance.now() - firstTokenAt) / 1000;
            patchLane(turnKey, modelId, (lane) => ({
              text: lane.text + delta,
              liveTokens,
              liveTokensPerSecond:
                elapsedSeconds >= 0.5
                  ? Math.round(liveTokens / elapsedSeconds)
                  : lane.liveTokensPerSecond,
            }));
          }

          if (typeof chunk.usage?.completion_tokens === "number") {
            completionTokens = chunk.usage.completion_tokens;
          }
        }
      }

      const endedAt = performance.now();
      const tokensPerSecond =
        completionTokens !== undefined &&
        firstTokenAt !== undefined &&
        endedAt > firstTokenAt
          ? Math.round(completionTokens / ((endedAt - firstTokenAt) / 1000))
          : undefined;

      const finishedLane: Lane = {
        modelId,
        modelName: "",
        text: finalText,
        status: "done",
        ttftMs:
          firstTokenAt !== undefined
            ? Math.round(firstTokenAt - startedAt)
            : undefined,
        tokensPerSecond,
        totalTokens: completionTokens,
      };

      patchLane(turnKey, modelId, {
        status: "done",
        totalTokens: completionTokens,
        tokensPerSecond,
        liveTokens: undefined,
        liveTokensPerSecond: undefined,
      });
      trackOutcome(
        turnKey,
        modelId,
        persistOutcome(turnKey, modelId, { kind: "done", lane: finishedLane }),
      );

      posthog.capture("arena_answer_finished", {
        model: modelId,
        ttft_ms: firstTokenAt ? Math.round(firstTokenAt - startedAt) : null,
        tokens_per_second: tokensPerSecond ?? null,
        total_tokens: completionTokens ?? null,
      });
    } catch {
      const message =
        controller.signal.reason === STALL_REASON
          ? "The model took too long to respond."
          : controller.signal.reason === SUPERSEDED_REASON
            ? "Stopped so your next message could go out."
            : "The connection dropped. Please try again.";
      patchLane(turnKey, modelId, { status: "error", errorMessage: message });
      trackOutcome(
        turnKey,
        modelId,
        persistOutcome(turnKey, modelId, { kind: "failed" }),
      );
    } finally {
      clearTimeout(stallTimer);
      controllersRef.current.delete(`${turnKey}:${modelId}`);
    }
  }

  // A slow lane must never hold the next message hostage — anything still
  // streaming gets stopped cleanly when a new prompt goes out.
  function stopStreamingLanes() {
    for (const controller of controllersRef.current.values()) {
      controller.abort(SUPERSEDED_REASON);
    }
  }

  function handleSend() {
    const promptText = prompt.trim();
    const models = selectedIds
      .map((id) => catalog.find((model) => model.id === id))
      .filter((model): model is CatalogModel => model !== undefined);
    if (promptText.length === 0 || models.length === 0) return;

    // Sending needs an account — a thread has to belong to someone
    // (docs/scope.md Feature 8 decided this split).
    if (!isSignedIn) {
      void clerk.openSignIn();
      return;
    }

    stopStreamingLanes();

    const turnKey = Date.now();
    const priorTurns = turns;

    setPrompt("");
    setTurns((current) => [
      ...current,
      {
        key: turnKey,
        turnId: null,
        saveFailed: false,
        prompt: promptText,
        winnerModelId: null,
        lanes: models.map((model) => ({
          modelId: model.id,
          modelName: model.name,
          text: "",
          status: "streaming",
        })),
      },
    ]);

    // The database write runs alongside the streams, never in front of them —
    // a slow write must not delay the first token.
    const isNewThread = threadId === null;
    const persistence = createTurn({
      threadId,
      prompt: promptText,
      modelIds: models.map((model) => model.id),
    });
    persistenceRef.current.set(turnKey, persistence);
    void persistence.then((result) => {
      if ("error" in result) {
        patchTurn(turnKey, { saveFailed: true });
      } else {
        setThreadId(result.threadId);
        patchTurn(turnKey, { turnId: result.turnId });
        if (isNewThread) {
          // The thread now has a real address. replaceState, not a router
          // navigation — navigating would swap the page tree and kill the
          // streams still running. A later refresh lands on the thread page.
          window.history.replaceState(null, "", `/arena/${result.threadId}`);
          // And it appears in the sidebar right away.
          refreshThreads();
        }
      }
    });

    posthog.capture("arena_prompt_sent", {
      models: models.map((model) => model.id),
      model_count: models.length,
      prompt_length: promptText.length,
      turn_index: priorTurns.length,
    });

    // Each model gets its own independent stream — one failing or stalling
    // never touches the others (docs/scope.md Feature 1).
    for (const model of models) {
      void streamModel(
        turnKey,
        model.id,
        buildHistory(model.id, priorTurns, promptText),
      );
    }
  }

  function handleRetry(turnKey: number, modelId: string) {
    const turnIndex = turns.findIndex((turn) => turn.key === turnKey);
    const turn = turns[turnIndex];
    if (!turn || turn.winnerModelId !== null) return;

    patchLane(turnKey, modelId, {
      status: "streaming",
      text: "",
      errorMessage: undefined,
      ttftMs: undefined,
      tokensPerSecond: undefined,
      totalTokens: undefined,
      liveTokens: undefined,
      liveTokensPerSecond: undefined,
    });
    void streamModel(
      turnKey,
      modelId,
      buildHistory(modelId, turns.slice(0, turnIndex), turn.prompt),
    );
  }

  async function handleVote(turnKey: number, modelId: string) {
    const turn = turns.find((t) => t.key === turnKey);
    const pending = persistenceRef.current.get(turnKey);
    if (!turn || !pending || turn.winnerModelId !== null) return;

    const result = await pending;
    if ("error" in result) {
      patchTurn(turnKey, {
        voteError: "This turn couldn't be saved, so a vote can't be recorded.",
      });
      return;
    }
    const messageId = result.messageIds[modelId];
    if (!messageId) return;

    // A lane can read "done" on screen before its SUCCESS row is written —
    // wait for the turn's writes so the server sees the same finished answers
    // the user just did. A write that failed (handled { error }, not just
    // in-flight) gets one fresh attempt here, since the earlier failure may
    // have been transient; a lane with no tracked write was restored from the
    // database and is already persisted.
    const writes = outcomeWritesRef.current.get(turnKey);
    const doneLanes = turn.lanes.filter((lane) => lane.status === "done");
    const persisted = await Promise.all(
      doneLanes.map(async (lane) => {
        const tracked = writes?.get(lane.modelId);
        if (!tracked || (await tracked)) return true;
        const retry = persistOutcome(turnKey, lane.modelId, {
          kind: "done",
          lane,
        });
        trackOutcome(turnKey, lane.modelId, retry);
        return retry;
      }),
    );
    const pickedSaved =
      persisted[doneLanes.findIndex((lane) => lane.modelId === modelId)];
    if (!pickedSaved || persisted.filter(Boolean).length < 2) {
      patchTurn(turnKey, {
        voteError:
          "The answers didn't finish saving, so this vote can't be recorded. Please try again.",
      });
      return;
    }

    const outcome = await castVote({ turnId: result.turnId, messageId });
    if ("error" in outcome) {
      patchTurn(turnKey, { voteError: outcome.error });
      return;
    }

    patchTurn(turnKey, { winnerModelId: modelId, voteError: undefined });
    posthog.capture("arena_vote_cast", {
      winner_model: modelId,
      models: turn.lanes.map((lane) => lane.modelId),
    });
  }

  function toggleModel(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : current.length < MAX_SELECTED_MODELS
          ? [...current, id]
          : current,
    );
  }

  function replaceModel(oldId: string, newId: string) {
    setSelectedIds((current) =>
      current.includes(newId)
        ? current
        : current.map((id) => (id === oldId ? newId : id)),
    );
  }

  return (
    <div className="flex h-full flex-col">
      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="max-w-2xl font-display text-4xl font-medium text-balance sm:text-5xl">
            Ask three models at once
          </h1>
          <p className="max-w-xl text-base text-balance text-muted-foreground">
            One prompt goes to every model you pick. They answer side by side,
            each with its own real speed and token count, and you decide which
            one was actually worth it.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            {turns.map((turn) => {
              const doneCount = turn.lanes.filter(
                (lane) => lane.status === "done",
              ).length;
              // A vote exists once two or more models have answered — a lane
              // still streaming must never block it. It also needs the turn
              // saved, since a vote is a database row.
              const canVote =
                !readOnly &&
                doneCount >= 2 &&
                turn.winnerModelId === null &&
                turn.turnId !== null;
              const laneGridClass =
                turn.lanes.length === 1
                  ? "grid-cols-1"
                  : turn.lanes.length === 2
                    ? "grid-cols-1 md:grid-cols-2"
                    : "grid-cols-1 md:grid-cols-3";

              return (
                <div key={turn.key} className="flex flex-col gap-4">
                  <div className="flex justify-end">
                    <p className="max-w-xl rounded-lg border border-border bg-secondary px-4 py-2 text-sm whitespace-pre-wrap text-secondary-foreground">
                      {turn.prompt}
                    </p>
                  </div>

                  {turn.saveFailed && (
                    <p className="text-right text-xs text-muted-foreground">
                      This turn couldn&apos;t be saved — answers still work, but
                      voting is off for it.
                    </p>
                  )}
                  {turn.voteError && (
                    <p className="text-right text-xs text-destructive">
                      {turn.voteError}
                    </p>
                  )}

                  <div className={cn("grid gap-4", laneGridClass)}>
                    {turn.lanes.map((lane) => {
                      const isWinner = turn.winnerModelId === lane.modelId;
                      const dimmed = turn.winnerModelId !== null && !isWinner;

                      return (
                        <article
                          key={lane.modelId}
                          className={cn(
                            "flex min-h-48 flex-col rounded-lg border bg-card transition-opacity",
                            isWinner ? "border-win" : "border-border",
                            dimmed && "opacity-70",
                          )}
                        >
                          <header className="flex items-center gap-2 border-b border-border px-4 py-3">
                            <span className="truncate font-mono text-xs">
                              {lane.modelName}
                            </span>
                            {isWinner && (
                              <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-win px-2 py-0.5 text-xs font-medium text-win-foreground">
                                <Trophy className="h-3 w-3" aria-hidden />
                                Winner
                              </span>
                            )}
                          </header>

                          <div className="flex-1 px-4 py-3 text-sm whitespace-pre-wrap">
                            {lane.status === "error" ? (
                              <span className="text-destructive">
                                {lane.errorMessage}
                              </span>
                            ) : lane.status === "unfinished" ? (
                              <span className="text-muted-foreground">
                                This answer didn&apos;t finish.
                              </span>
                            ) : (
                              <>
                                {lane.text}
                                {lane.status === "streaming" && (
                                  <span
                                    className="animate-pulse text-primary"
                                    aria-hidden
                                  >
                                    ▍
                                  </span>
                                )}
                              </>
                            )}
                          </div>

                          <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
                            {lane.status !== "error" &&
                              lane.status !== "unfinished" && (
                                <span className="font-mono text-xs text-muted-foreground">
                                  {laneMetrics(lane)}
                                </span>
                              )}

                            {!readOnly &&
                              lane.status === "error" &&
                              turn.winnerModelId === null && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleRetry(turn.key, lane.modelId)
                                  }
                                  className="ml-auto flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
                                >
                                  <RotateCcw className="h-3 w-3" aria-hidden />
                                  Retry
                                </button>
                              )}

                            {lane.status === "done" && canVote && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleVote(turn.key, lane.modelId)
                                }
                                className="ml-auto rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                              >
                                Pick as winner
                              </button>
                            )}
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {readOnly ? (
        <div className="border-t border-border px-6 py-4 text-center">
          <p className="text-sm text-muted-foreground">
            You&apos;re viewing a shared thread.{" "}
            <Link
              href="/arena"
              className="font-medium text-primary hover:underline"
            >
              Start your own in the arena
            </Link>
          </p>
        </div>
      ) : (
        <PromptBox
          catalog={catalog}
          selectedIds={selectedIds}
          onToggleModel={toggleModel}
          onRemoveModel={(id) =>
            setSelectedIds((current) =>
              current.filter((selectedId) => selectedId !== id),
            )
          }
          onReplaceModel={replaceModel}
          prompt={prompt}
          onPromptChange={setPrompt}
          onSend={handleSend}
          placeholder={
            turns.length > 0
              ? "Ask a follow-up. Each model continues its own conversation."
              : undefined
          }
        />
      )}
    </div>
  );
}
