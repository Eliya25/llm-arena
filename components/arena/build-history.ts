// Rebuilding one model's side of a conversation, pulled out of ArenaClient so
// the rules can be read — and checked — without a component around them. It is
// pure: the same turns and prompt always produce the same history.

export type ChatMessage = { role: "user" | "assistant"; content: string };

// The shape build-history needs from a turn on screen. Deliberately narrower
// than the component's own TurnView: nothing here depends on how a lane looks,
// only on what it said.
export type HistoryTurn = {
  readonly prompt: string;
  readonly lanes: readonly {
    readonly modelId: string;
    readonly status: string;
    readonly text: string;
  }[];
};

// Matches the server's per-message content cap, so a giant answer in the
// history gets trimmed instead of failing the whole follow-up.
export const MAX_HISTORY_CONTENT = 32_000;
// Matches the server's message-count cap — a long thread keeps the most
// recent exchanges and drops the oldest instead of failing every lane.
export const MAX_HISTORY_MESSAGES = 40;

// Each model only ever sees its own previous answers — never another model's
// words (docs/scope.md Feature 6: separate conversations). A turn where this
// model failed contributes its question and no answer, which is honest: that
// model genuinely never said anything there.
export function buildHistory(
  modelId: string,
  priorTurns: readonly HistoryTurn[],
  promptText: string,
): ChatMessage[] {
  const exchanges = priorTurns.flatMap((turn): ChatMessage[] => {
    const question: ChatMessage = {
      role: "user",
      content: turn.prompt.slice(0, MAX_HISTORY_CONTENT),
    };
    const lane = turn.lanes.find((l) => l.modelId === modelId);
    return lane && lane.status === "done" && lane.text.length > 0
      ? [
          question,
          {
            role: "assistant",
            content: lane.text.slice(0, MAX_HISTORY_CONTENT),
          },
        ]
      : [question];
  });

  const history = [
    ...exchanges,
    { role: "user" as const, content: promptText },
  ];

  // The cap can land mid-exchange, stranding an assistant answer whose
  // question was cut off — drop it so history always opens with a user message
  // and every retained answer keeps its originating question. This is a real
  // V1 bug, not a hypothetical: the server rejects a history that starts with
  // an assistant message, which failed the whole turn.
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
  return trimmed.slice(trimmed.findIndex((message) => message.role === "user"));
}
