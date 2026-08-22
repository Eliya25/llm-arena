"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { useClerk, useUser } from "@clerk/nextjs";
import { RotateCcw, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogModel } from "@/lib/openrouter";
import { castVote } from "@/app/arena/actions";
import { useNewChat } from "@/components/app-shell/new-chat-context";
import { useThreads } from "@/components/app-shell/threads-context";
import { buildHistory, type ChatMessage } from "./build-history";
import { MAX_SELECTED_MODELS, PromptBox } from "./prompt-box";

// "unfinished" only exists on reloaded turns: a row the server never got past
// PENDING or STREAMING, because its generation never completed. It renders
// honestly as "didn't finish" — never as fake streaming.
type LaneStatus = "streaming" | "done" | "error" | "unfinished";

type Lane = {
  modelId: string;
  modelName: string;
  // The row the server claimed for this answer, learned from the response
  // that opened the stream. Voting needs it; nothing is written through it.
  messageId?: string;
  text: string;
  status: LaneStatus;
  errorMessage?: string;
  ttftMs?: number;
  tokensPerSecond?: number;
  outputTokens?: number;
  // Live approximations while the stream runs, always rendered with a "~" so
  // an estimate never poses as a measurement. Cleared when the stream ends
  // and the exact usage-based numbers take over.
  liveTokensPerSecond?: number;
  liveTokens?: number;
  // Whole seconds spent waiting for the first token, ticking while it's still
  // outstanding. A slow model should look slow, not broken.
  waitingSeconds?: number;
};

type TurnView = {
  key: number;
  turnId: string | null;
  prompt: string;
  lanes: Lane[];
  winnerModelId: string | null;
  voteError?: string;
};

// How a stream tells the route which row it belongs to. `turnId` when the turn
// already exists — a retry, or a lane on a reloaded thread. Otherwise the keys
// this prompt's three lanes converge on, so whichever reaches the server first
// creates the thread and the turn and the rest find them.
//
// This is the entire contribution the browser makes to persistence: which row,
// never what goes in it.
type AnswerTarget = {
  turnId?: string;
  clientKey?: string;
  threadId?: string;
  threadKey?: string;
};

// One persisted turn, as the thread page hands it over after a reload.
export type InitialTurn = {
  turnId: string;
  prompt: string;
  winnerModelId: string | null;
  lanes: {
    modelId: string;
    modelName: string;
    messageId: string;
    text: string;
    status: "done" | "error" | "unfinished";
    errorMessage?: string;
    ttftMs?: number;
    tokensPerSecond?: number;
    outputTokens?: number;
  }[];
};

// Shape of one OpenRouter SSE chunk — only the fields the client reads.
// `arena` is the server's own closing frame, not OpenRouter's: the values it
// actually wrote to the row, which replace this lane's live estimates.
type StreamChunk = {
  choices?: { delta?: { content?: string } }[];
  usage?: { completion_tokens?: number };
  arena?: {
    status: "SUCCESS" | "FAILED";
    timeToFirstTokenMs: number | null;
    generationDurationMs: number | null;
    tokensPerSecond: number | null;
    outputTokens: number | null;
  };
};

type LanePatch = Partial<Lane> | ((lane: Lane) => Partial<Lane>);

// Two different kinds of waiting, so they get two different budgets. A free
// model can genuinely take a long time to start — measured answers in this
// database include first tokens at 43s and 51s — so cutting the wait at the
// same 60s used for a mid-stream gap kills answers that were on their way.
// Once tokens are flowing, though, a full minute of silence really is broken.
const FIRST_TOKEN_MS = 120_000;
const STALL_MS = 60_000;
const FIRST_TOKEN_REASON = "no-first-token";
const STALL_REASON = "stall";
const SUPERSEDED_REASON = "superseded";
// How often the "still waiting" readout ticks before the first token.
const WAITING_TICK_MS = 1000;
// Rough characters-per-token for the live streaming readout only — the final
// numbers always come from OpenRouter's real usage block.
const CHARS_PER_TOKEN = 4;
// A vote lands against rows the route writes when each stream ends, so a click
// the instant the last lane finishes can arrive first. These cover that gap.
const VOTE_RETRIES = 4;
const VOTE_RETRY_MS = 400;

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
      : lane.outputTokens !== undefined
        ? `${lane.outputTokens} tokens`
        : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) {
    if (!streaming) return "";
    // The count only appears once there's something worth reporting, so a
    // normal fast start doesn't flash "0s" on its way past.
    return lane.waitingSeconds !== undefined && lane.waitingSeconds > 0
      ? `waiting for first token… ${lane.waitingSeconds}s`
      : "waiting for first token…";
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
  const { resetRef } = useNewChat();

  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    catalog.slice(0, MAX_SELECTED_MODELS).map((model) => model.id),
  );
  const [prompt, setPrompt] = useState("");
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [turns, setTurns] = useState<TurnView[]>(() =>
    initialTurns.map((turn, index) => ({
      key: index,
      turnId: turn.turnId,
      prompt: turn.prompt,
      winnerModelId: turn.winnerModelId,
      lanes: turn.lanes.map((lane) => ({ ...lane })),
    })),
  );

  // Live stream controllers, so a new message can stop lanes still running.
  const controllersRef = useRef(new Map<string, AbortController>());
  // Turns whose ids have already been taken from a lane's response. All three
  // lanes of a prompt carry the same ids, and the thread only needs adopting —
  // address bar, sidebar — once.
  const adoptedRef = useRef(new Set<number>());
  // The key a not-yet-created thread is being opened under. Held across sends,
  // because the prompt box is deliberately never disabled: a second prompt sent
  // before the first response comes back would otherwise carry a second key and
  // open a second thread for what is plainly one conversation.
  const threadKeyRef = useRef<string | null>(null);

  // Bumped every time "New chat" clears the arena. A stream still opening when
  // that happens belongs to the conversation the user just walked away from,
  // so the ids it comes back with must not be adopted as the current thread.
  const sessionRef = useRef(0);

  // Hands the sidebar's "New chat" a way to clear this arena in place, since a
  // link to /arena can't be trusted to remount it once the first send has
  // rewritten the URL (see components/app-shell/new-chat-context.tsx). Only the
  // fresh-arena page registers — from a real thread page, New chat is an
  // ordinary navigation to a different route, which needs no help.
  //
  // Streams still running are deliberately left alone rather than aborted: that
  // is exactly what navigating away already does, so an abandoned turn saves
  // honestly either way instead of landing as a misleading "stopped" row.
  // Patches from those streams no-op once their turn is gone from state.
  //
  // Their controllers are dropped from the map, though — stopStreamingLanes()
  // aborts everything it can still see, so the first prompt of the new chat
  // would otherwise reach back and kill the abandoned conversation's lanes,
  // persisting them as FAILED: answers recorded as never arriving when they
  // were streaming fine. Dropping them only stops this arena from managing
  // those streams; each one keeps its own controller, so its stall watchdog
  // still fires and a genuine failure is still recorded as one.
  useEffect(() => {
    if (initialThreadId !== null) return;
    const ref = resetRef;
    ref.current = () => {
      sessionRef.current += 1;
      controllersRef.current.clear();
      threadKeyRef.current = null;
      setTurns([]);
      setThreadId(null);
      setPrompt("");
    };
    return () => {
      ref.current = null;
    };
  }, [initialThreadId, resetRef]);

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

  // The response that opens a stream carries the ids of the rows the server
  // just claimed for it. That is how a turn learns its own id now — no
  // separate write running alongside the streams for it to race.
  function adoptAnswer(
    turnKey: number,
    modelId: string,
    response: Response,
    session: number,
    isNewThread: boolean,
  ) {
    const answerThreadId = response.headers.get("X-Arena-Thread-Id");
    const answerTurnId = response.headers.get("X-Arena-Turn-Id");
    const messageId = response.headers.get("X-Arena-Message-Id");
    if (messageId) patchLane(turnKey, modelId, { messageId });
    if (!answerThreadId || !answerTurnId) return;

    // "New chat" was pressed while this stream was opening, so the turn on
    // screen is gone. The thread is real and still belongs in the sidebar —
    // but adopting it here would silently make the next prompt a follow-up in
    // the conversation the user just walked away from, and would point the
    // address bar back at it.
    const superseded = sessionRef.current !== session;
    if (adoptedRef.current.has(turnKey)) return;
    adoptedRef.current.add(turnKey);

    if (superseded) {
      if (isNewThread) refreshThreads();
      return;
    }

    patchTurn(turnKey, { turnId: answerTurnId });
    setThreadId(answerThreadId);
    if (isNewThread) {
      // The thread now has a real address. replaceState, not a router
      // navigation — navigating would swap the page tree and kill the streams
      // still running. A later refresh lands on the thread page.
      window.history.replaceState(null, "", `/arena/${answerThreadId}`);
      // And it appears in the sidebar right away.
      refreshThreads();
    }
  }

  async function streamModel(
    turnKey: number,
    modelId: string,
    messages: ChatMessage[],
    // Tells the route which row this answer belongs to. Nothing about the
    // answer itself travels from here — the route claims the row before it
    // calls the model, and writes what the model said from its own copy of the
    // stream (docs/scope-v2.md Feature 1).
    target: AnswerTarget,
    session: number,
    isNewThread = false,
  ) {
    const startedAt = performance.now();
    let firstTokenAt: number | undefined;
    let completionTokens: number | undefined;
    let finalText = "";
    // What the server says it stored. Present on every stream that reached the
    // route, and it wins over anything measured here.
    let stored: StreamChunk["arena"];

    const controller = new AbortController();
    controllersRef.current.set(`${turnKey}:${modelId}`, controller);

    // A model that goes quiet ends with a plain timeout instead of hanging
    // forever. Before the first token that budget is generous; after it, a
    // gap this long means the stream really has died.
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      const started = firstTokenAt !== undefined;
      stallTimer = setTimeout(
        () => controller.abort(started ? STALL_REASON : FIRST_TOKEN_REASON),
        started ? STALL_MS : FIRST_TOKEN_MS,
      );
    };
    resetStallTimer();

    // Counts the wait out loud so a slow model reads as slow rather than
    // stuck. Stops the moment the first token lands.
    const waitingTicker = setInterval(() => {
      if (firstTokenAt !== undefined) return;
      patchLane(turnKey, modelId, {
        waitingSeconds: Math.round((performance.now() - startedAt) / 1000),
      });
    }, WAITING_TICK_MS);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, messages, ...target }),
        signal: controller.signal,
      });

      // Before the ok check: a lane the model refused still has a real row and
      // a real turn behind it, and a retry needs to reach them.
      adoptAnswer(turnKey, modelId, response, session, isNewThread);

      if (!response.ok || !response.body) {
        let message = "The model didn't respond. Please try again.";
        try {
          const data = (await response.json()) as { error?: string };
          if (typeof data.error === "string") message = data.error;
        } catch {
          // Non-JSON error body — keep the plain default message.
        }
        patchLane(turnKey, modelId, {
          status: "error",
          errorMessage: message,
          waitingSeconds: undefined,
        });
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
                // The wait is over; the real measurement replaces the count.
                waitingSeconds: undefined,
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
          if (chunk.arena) stored = chunk.arena;
        }
      }

      const endedAt = performance.now();
      // Only a fallback, for a stream that ended without the server's closing
      // frame. Everything below prefers what the server says it stored, so the
      // numbers resting on screen are the same numbers a reload would show.
      const measuredHere = {
        ttftMs:
          firstTokenAt !== undefined
            ? Math.round(firstTokenAt - startedAt)
            : undefined,
        tokensPerSecond:
          completionTokens !== undefined &&
          firstTokenAt !== undefined &&
          endedAt > firstTokenAt
            ? Math.round(completionTokens / ((endedAt - firstTokenAt) / 1000))
            : undefined,
        outputTokens: completionTokens,
      };
      const shown = stored
        ? {
            ttftMs: stored.timeToFirstTokenMs ?? undefined,
            tokensPerSecond:
              stored.tokensPerSecond !== null
                ? Math.round(stored.tokensPerSecond)
                : undefined,
            outputTokens: stored.outputTokens ?? undefined,
          }
        : measuredHere;
      // A generation the server stored as failed says so — with the text it
      // did produce still on screen, because the model really did say that
      // much. No text at all is a different story and gets a different line.
      const failed = stored?.status === "FAILED";

      patchLane(turnKey, modelId, {
        ...shown,
        status: failed ? "error" : "done",
        errorMessage: !failed
          ? undefined
          : finalText.length > 0
            ? "This answer stopped partway through."
            : "This model didn't answer.",
        liveTokens: undefined,
        liveTokensPerSecond: undefined,
        waitingSeconds: undefined,
      });

      posthog.capture("arena_answer_finished", {
        model: modelId,
        ttft_ms: shown.ttftMs ?? null,
        tokens_per_second: shown.tokensPerSecond ?? null,
        total_tokens: shown.outputTokens ?? null,
        stored_status: stored?.status ?? null,
      });
    } catch {
      const message =
        controller.signal.reason === FIRST_TOKEN_REASON
          ? "This model never started answering. Try again, or pick a different one."
          : controller.signal.reason === STALL_REASON
            ? "The model stopped partway through its answer."
            : controller.signal.reason === SUPERSEDED_REASON
              ? "Stopped so your next message could go out."
              : "The connection dropped. Please try again.";
      // Nothing is written from here. Losing this end of the stream doesn't
      // stop the answer being saved: the server keeps reading its own copy and
      // writes the outcome either way, which is why walking away from a live
      // answer no longer costs it.
      patchLane(turnKey, modelId, {
        status: "error",
        errorMessage: message,
        waitingSeconds: undefined,
      });
    } finally {
      clearTimeout(stallTimer);
      clearInterval(waitingTicker);
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

    const isNewThread = threadId === null;
    const session = sessionRef.current;
    if (isNewThread && threadKeyRef.current === null) {
      threadKeyRef.current = crypto.randomUUID();
    }
    // Two keys the three lanes share, so whichever of them reaches the server
    // first creates the thread and the turn and the others find what it made.
    // Nothing is written here — the client only names the rows.
    const target: AnswerTarget = {
      clientKey: crypto.randomUUID(),
      threadId: threadId ?? undefined,
      threadKey: isNewThread ? (threadKeyRef.current ?? undefined) : undefined,
    };

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
        target,
        session,
        isNewThread,
      );
    }
  }

  function handleRetry(turnKey: number, modelId: string) {
    const turnIndex = turns.findIndex((turn) => turn.key === turnKey);
    const turn = turns[turnIndex];
    if (!turn || turn.winnerModelId !== null) return;

    // The turn already exists by now — live or restored — so naming it is
    // enough: the route reuses this model's row rather than adding a second
    // answer, and clears it before the new attempt streams into it.
    if (turn.turnId === null) {
      patchTurn(turnKey, {
        voteError: "This turn couldn't be saved, so it can't be retried.",
      });
      return;
    }

    patchLane(turnKey, modelId, {
      status: "streaming",
      text: "",
      errorMessage: undefined,
      ttftMs: undefined,
      tokensPerSecond: undefined,
      outputTokens: undefined,
      liveTokens: undefined,
      liveTokensPerSecond: undefined,
    });
    void streamModel(
      turnKey,
      modelId,
      buildHistory(modelId, turns.slice(0, turnIndex), turn.prompt),
      { turnId: turn.turnId },
      sessionRef.current,
    );
  }

  async function handleVote(turnKey: number, modelId: string) {
    const turn = turns.find((t) => t.key === turnKey);
    if (!turn || turn.turnId === null || turn.winnerModelId !== null) return;
    // Bound out here: the narrowing above doesn't survive into the closure.
    const turnId = turn.turnId;
    const messageId = turn.lanes.find(
      (lane) => lane.modelId === modelId,
    )?.messageId;
    if (!messageId) return;

    // A lane now only reads "done" after the server has closed the stream with
    // what it stored, so the row a vote is checked against is already written.
    // The retry stays as a narrow safety net for the one case that skips that
    // frame — a database write slow enough that the route stopped waiting to
    // describe it. Only "not finished yet" is worth retrying; any other
    // refusal is final and gets shown as-is.
    const outcome = await (async () => {
      for (let attempt = 0; ; attempt += 1) {
        const attempted = await castVote({ turnId, messageId });
        const stillSaving =
          "error" in attempted &&
          attempted.error === "A vote needs at least two finished answers.";
        if (!stillSaving || attempt >= VOTE_RETRIES) return attempted;
        await new Promise((resolve) => setTimeout(resolve, VOTE_RETRY_MS));
      }
    })();

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
        <div className="relative flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-28 text-center">
          <div className="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Live model
            arena
          </div>
          <h1 className="max-w-3xl font-display text-5xl leading-[0.98] font-semibold tracking-[-0.04em] text-balance sm:text-7xl">
            One prompt. Three minds.
            <span className="block font-normal text-primary italic">
              Your verdict.
            </span>
          </h1>
          <p className="max-w-xl text-[15px] leading-6 text-balance text-muted-foreground">
            Compare answers side by side, inspect real speed and token data,
            then crown the model that earned it.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
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
                    <p className="max-w-xl rounded-2xl rounded-br-md border border-primary/15 bg-secondary px-4 py-2.5 text-sm whitespace-pre-wrap text-secondary-foreground shadow-sm">
                      {turn.prompt}
                    </p>
                  </div>

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
                            "soft-shadow flex min-h-56 flex-col overflow-hidden rounded-xl border bg-card/95 transition-[opacity,border-color,transform] hover:-translate-y-0.5",
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
                            {lane.status === "error" ||
                            lane.status === "unfinished" ? (
                              <>
                                {/* Whatever the answer managed to say stays
                                    on screen — cut off partway, or still
                                    being written server-side. The model
                                    really said that much. */}
                                {lane.text}
                                <span
                                  className={cn(
                                    lane.status === "error"
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                    lane.text.length > 0 && "mt-3 block",
                                  )}
                                >
                                  {lane.errorMessage ??
                                    "This answer didn't finish."}
                                </span>
                              </>
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
                            {/* A lane that stopped partway still measured
                                what it managed, so metrics aren't tied to
                                success — only to there being any. */}
                            {lane.status !== "unfinished" &&
                              laneMetrics(lane) !== "" && (
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
