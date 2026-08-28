import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { LOAD_TEST_MODE: true, LOAD_TEST_SECRET: "load-test-secret" },
}));

vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { POST } from "./route";

function request(secret?: string, prompt = "probe [load:429]") {
  return new NextRequest("https://arena.example/api/load/mock-openrouter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Load-Test-Secret": secret } : {}),
    },
    body: JSON.stringify({
      model: "load/mock",
      messages: [{ role: "user", content: prompt }],
    }),
  });
}

describe("controlled OpenRouter route", () => {
  beforeEach(() => {
    mockEnv.LOAD_TEST_MODE = true;
    mockEnv.LOAD_TEST_SECRET = "load-test-secret";
  });

  it("hides the endpoint when the secret is missing or wrong", async () => {
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request("wrong"))).status).toBe(404);
  });

  it("stays disabled outside load test mode", async () => {
    mockEnv.LOAD_TEST_MODE = false;
    expect((await POST(request("load-test-secret"))).status).toBe(404);
  });

  it("serves controlled upstream responses to an authorized load test", async () => {
    const response = await POST(request("load-test-secret"));
    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toBe("busy");
  });
});
