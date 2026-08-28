import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer /, "");
  if (!supplied) return false;

  const actual = Buffer.from(supplied);
  const expected = Buffer.from(env.HEALTHCHECK_SECRET);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ status: "not found" }, { status: 404 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
