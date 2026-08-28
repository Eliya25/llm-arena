import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

type IncomingBody = {
  model?: string;
  messages?: { role?: string; content?: string }[];
};

function allowed(request: NextRequest): boolean {
  if (!env.LOAD_TEST_MODE || !env.LOAD_TEST_SECRET) return false;
  const supplied = request.headers.get("x-load-test-secret");
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(env.LOAD_TEST_SECRET);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function frame(value: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
}

export async function POST(request: NextRequest) {
  if (!allowed(request)) return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as IncomingBody;
  const prompt = body.messages?.at(-1)?.content ?? "";
  if (prompt.includes("[load:429]"))
    return new Response("busy", { status: 429 });
  if (prompt.includes("[load:500]"))
    return new Response("failed", { status: 500 });

  const isSlow = prompt.includes("[load:slow]");
  const isTruncated = prompt.includes("[load:truncate]");
  const isStalled = prompt.includes("[load:stall]");
  const model = body.model ?? "load/mock";
  const words = [
    "Measured",
    " load",
    " response",
    " from",
    " the",
    " controlled",
    " stream.",
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await sleep(isSlow ? 1_000 : 50);
      for (const [index, word] of words.entries()) {
        controller.enqueue(
          frame({ id: "load", model, choices: [{ delta: { content: word } }] }),
        );
        if (isTruncated && index === 2) {
          controller.error(new Error("controlled truncated stream"));
          return;
        }
        if (isStalled && index === 0) return;
        await sleep(isSlow ? 250 : 20);
      }
      controller.enqueue(
        frame({
          id: "load",
          model,
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: words.length },
        }),
      );
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
