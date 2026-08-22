import type { AnswerTarget } from "./answer-row";

// The wall between a hand-crafted request and the model. Pure, and separated
// from the route for that reason: every rule here was put in for a reason, and
// none of them should need a running server to check.

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export const MAX_MESSAGES = 40;
export const MAX_CONTENT_LENGTH = 32_000;

export type ChatRequest = {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly target: AnswerTarget;
  // The latest user message: what goes to the model, what Arcjet scans, and
  // what a new turn is stored as.
  readonly prompt: string;
};

export type ShapeResult =
  | { readonly ok: true; readonly request: ChatRequest }
  | { readonly ok: false; readonly error: string };

export function isValidMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ChatMessage>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.length > 0 &&
    message.content.length <= MAX_CONTENT_LENGTH
  );
}

// Either the turn already exists, or the caller brings the keys its sibling
// lanes are converging on. Anything else cannot name a row.
function isAddressable(target: AnswerTarget): boolean {
  return (
    typeof target.turnId === "string" ||
    (typeof target.clientKey === "string" &&
      (typeof target.threadId === "string" ||
        typeof target.threadKey === "string"))
  );
}

export function readChatRequest(body: unknown): ShapeResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "This request couldn't be read." };
  }
  const { model, messages, turnId, clientKey, threadId, threadKey } =
    body as Record<string, unknown>;

  if (typeof model !== "string" || model.length === 0) {
    return { ok: false, error: "model is required" };
  }

  const target: AnswerTarget = {
    turnId: typeof turnId === "string" ? turnId : undefined,
    clientKey: typeof clientKey === "string" ? clientKey : undefined,
    threadId: typeof threadId === "string" ? threadId : undefined,
    threadKey: typeof threadKey === "string" ? threadKey : undefined,
  };
  if (!isAddressable(target)) {
    return {
      ok: false,
      error: "This answer couldn't be started. Please try again.",
    };
  }

  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > MAX_MESSAGES ||
    !messages.every(isValidMessage)
  ) {
    return {
      ok: false,
      error: "This conversation couldn't be sent. Try a shorter message.",
    };
  }

  const latest = messages[messages.length - 1];
  if (latest.role !== "user") {
    return { ok: false, error: "messages must end with a user message" };
  }

  return {
    ok: true,
    request: { model, messages, target, prompt: latest.content },
  };
}
