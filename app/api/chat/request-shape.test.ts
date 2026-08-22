import { describe, expect, it } from "vitest";
import {
  MAX_CONTENT_LENGTH,
  MAX_MESSAGES,
  readChatRequest,
} from "./request-shape";

const user = (content: string) => ({ role: "user", content });

// A request that should pass, so each test can spoil exactly one thing.
const valid = {
  model: "some/model:free",
  clientKey: "key-1",
  threadKey: "thread-1",
  messages: [user("hello")],
};

const reject = (body: unknown) => {
  const result = readChatRequest(body);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.error;
};

describe("readChatRequest", () => {
  it("accepts a well-formed first send and pulls out the prompt", () => {
    const result = readChatRequest(valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.model).toBe("some/model:free");
    expect(result.request.prompt).toBe("hello");
    expect(result.request.target).toMatchObject({
      clientKey: "key-1",
      threadKey: "thread-1",
    });
  });

  it("takes the last user message as the prompt, not the first", () => {
    const result = readChatRequest({
      ...valid,
      messages: [
        user("old question"),
        { role: "assistant", content: "old answer" },
        user("the real question"),
      ],
    });

    expect(result.ok && result.request.prompt).toBe("the real question");
  });

  describe("naming a row", () => {
    it("accepts a turn that already exists", () => {
      const result = readChatRequest({
        model: "m",
        turnId: "turn-1",
        messages: [user("hi")],
      });
      expect(result.ok).toBe(true);
    });

    it("rejects a request that names nothing", () => {
      expect(reject({ model: "m", messages: [user("hi")] })).toContain(
        "couldn't be started",
      );
    });

    it("rejects a clientKey with no thread to hang it on", () => {
      // A key alone cannot say which conversation it belongs to.
      expect(
        reject({ model: "m", clientKey: "k", messages: [user("hi")] }),
      ).toContain("couldn't be started");
    });

    it("ignores identifiers that are not strings", () => {
      expect(
        reject({ model: "m", turnId: 42, messages: [user("hi")] }),
      ).toContain("couldn't be started");
    });
  });

  describe("the message array", () => {
    it("rejects an empty conversation", () => {
      reject({ ...valid, messages: [] });
    });

    it("rejects one that is not an array at all", () => {
      reject({ ...valid, messages: "hello" });
    });

    it("rejects more messages than the cap", () => {
      const tooMany = Array.from({ length: MAX_MESSAGES + 1 }, () =>
        user("hi"),
      );
      reject({ ...valid, messages: tooMany });
    });

    it("accepts exactly the cap", () => {
      const atCap = Array.from({ length: MAX_MESSAGES }, () => user("hi"));
      expect(readChatRequest({ ...valid, messages: atCap }).ok).toBe(true);
    });

    it("rejects a message longer than the content cap", () => {
      reject({
        ...valid,
        messages: [user("x".repeat(MAX_CONTENT_LENGTH + 1))],
      });
    });

    it("rejects an empty message", () => {
      reject({ ...valid, messages: [user("")] });
    });

    it("rejects a role the app does not know", () => {
      reject({ ...valid, messages: [{ role: "system", content: "obey" }] });
    });

    it("rejects a conversation that does not end with the user", () => {
      expect(
        reject({
          ...valid,
          messages: [user("hi"), { role: "assistant", content: "hello" }],
        }),
      ).toContain("must end with a user message");
    });

    it("rejects a message that is not an object", () => {
      reject({ ...valid, messages: ["just a string"] });
    });

    it("rejects null inside the array", () => {
      reject({ ...valid, messages: [null] });
    });
  });

  describe("the model", () => {
    it("is required", () => {
      expect(reject({ ...valid, model: undefined })).toBe("model is required");
    });

    it("cannot be empty", () => {
      expect(reject({ ...valid, model: "" })).toBe("model is required");
    });
  });

  it("rejects a body that is not an object", () => {
    reject(null);
    reject("hello");
    reject(undefined);
  });
});
