import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_CONTENT,
  MAX_HISTORY_MESSAGES,
  buildHistory,
  type HistoryTurn,
} from "./build-history";

const turn = (
  prompt: string,
  lanes: { modelId: string; status: string; text: string }[],
): HistoryTurn => ({ prompt, lanes });

const answered = (modelId: string, text: string) => ({
  modelId,
  status: "done",
  text,
});

describe("buildHistory", () => {
  it("gives a model its own answers and nobody else's", () => {
    const history = buildHistory(
      "model-a",
      [
        turn("first question", [
          answered("model-a", "A's answer"),
          answered("model-b", "B's answer"),
        ]),
      ],
      "second question",
    );

    expect(history).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "A's answer" },
      { role: "user", content: "second question" },
    ]);
  });

  it("keeps the question of a turn this model failed, but invents no answer", () => {
    const history = buildHistory(
      "model-a",
      [
        turn("asked", [
          { modelId: "model-a", status: "error", text: "" },
          answered("model-b", "B managed"),
        ]),
      ],
      "next",
    );

    expect(history).toEqual([
      { role: "user", content: "asked" },
      { role: "user", content: "next" },
    ]);
  });

  it("skips a lane that finished with nothing to say", () => {
    const history = buildHistory(
      "model-a",
      [turn("asked", [{ modelId: "model-a", status: "done", text: "" }])],
      "next",
    );
    expect(history.every((message) => message.role === "user")).toBe(true);
  });

  it("never opens with an assistant message once the cap bites", () => {
    // The V1 bug this rule exists for: trimming to the newest N can strand an
    // answer whose question was cut off, and the server rejects a history
    // starting with an assistant message — failing the whole turn.
    const many = Array.from({ length: MAX_HISTORY_MESSAGES }, (_, i) =>
      turn(`question ${i}`, [answered("model-a", `answer ${i}`)]),
    );

    const history = buildHistory("model-a", many, "latest");

    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_MESSAGES);
    expect(history[0].role).toBe("user");
    // Every retained answer still has the question that produced it.
    history.forEach((message, index) => {
      if (message.role === "assistant") {
        expect(history[index - 1]?.role).toBe("user");
      }
    });
  });

  it("ends with the new prompt, always", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      turn(`q${i}`, [answered("model-a", `a${i}`)]),
    );
    const history = buildHistory("model-a", many, "the actual question");

    const last = history[history.length - 1];
    expect(last).toEqual({ role: "user", content: "the actual question" });
  });

  it("trims an oversized answer instead of letting it fail the turn", () => {
    const huge = "x".repeat(MAX_HISTORY_CONTENT + 5_000);
    const history = buildHistory(
      "model-a",
      [turn(huge, [answered("model-a", huge)])],
      "next",
    );

    for (const message of history) {
      expect(message.content.length).toBeLessThanOrEqual(MAX_HISTORY_CONTENT);
    }
  });

  it("is just the prompt on a first send", () => {
    expect(buildHistory("model-a", [], "hello")).toEqual([
      { role: "user", content: "hello" },
    ]);
  });
});
