import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/env", () => ({
  env: { HEALTHCHECK_SECRET: "health-test-secret" },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: queryRaw } }));

import { GET } from "./route";

function request(secret?: string) {
  return new NextRequest("https://arena.example/api/health", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("health route", () => {
  beforeEach(() => queryRaw.mockReset());

  it("hides the endpoint when the bearer secret is missing or wrong", async () => {
    expect((await GET(request())).status).toBe(404);
    expect((await GET(request("wrong"))).status).toBe(404);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reports a healthy database", async () => {
    queryRaw.mockResolvedValueOnce([1]);
    const response = await GET(request("health-test-secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports database failure without exposing its cause", async () => {
    queryRaw.mockRejectedValueOnce(new Error("private database detail"));
    const response = await GET(request("health-test-secret"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unavailable" });
  });
});
