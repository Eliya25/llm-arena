import { randomUUID } from "node:crypto";

const baseUrl = process.env.LOAD_BASE_URL;
const sharedPath = process.env.LOAD_SHARED_PATH;
const models = (process.env.LOAD_MODEL_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const tokens = JSON.parse(process.env.LOAD_SESSION_TOKENS || "[]");
const levels = (process.env.LOAD_CONCURRENCY || "1,5,10,20")
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);

if (
  !baseUrl ||
  !sharedPath ||
  models.length !== 3 ||
  new Set(models).size !== 3 ||
  tokens.length === 0
) {
  throw new Error(
    "Set LOAD_BASE_URL, LOAD_SHARED_PATH, three distinct comma-separated LOAD_MODEL_IDS, and LOAD_SESSION_TOKENS before running capacity tests.",
  );
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    ] ?? 0
  );
};

async function publicRead() {
  const started = performance.now();
  const response = await fetch(new URL(sharedPath, baseUrl));
  await response.arrayBuffer();
  return { status: response.status, durationMs: performance.now() - started };
}

async function arenaStream(index, model, target) {
  const started = performance.now();
  const response = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens[index % tokens.length]}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Capacity probe [load:slow]" }],
      clientKey: target.clientKey,
      threadKey: target.threadKey,
    }),
  });
  const headersAt = performance.now();
  const reader = response.body?.getReader();
  let firstByteAt = null;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && firstByteAt === null) firstByteAt = performance.now();
    }
  }
  return {
    status: response.status,
    durationMs: performance.now() - started,
    appHeadersMs: headersAt - started,
    ttftMs: firstByteAt === null ? null : firstByteAt - headersAt,
  };
}

async function arenaTurn(index) {
  const target = { clientKey: randomUUID(), threadKey: randomUUID() };
  const lanes = await Promise.all(
    models.map((model) => arenaStream(index, model, target)),
  );
  const ttfts = lanes.flatMap((lane) =>
    lane.ttftMs === null ? [] : [lane.ttftMs],
  );
  return {
    status: Math.max(...lanes.map((lane) => lane.status)),
    durationMs: Math.max(...lanes.map((lane) => lane.durationMs)),
    appHeadersMs: Math.max(...lanes.map((lane) => lane.appHeadersMs)),
    ttftMs: ttfts.length ? Math.max(...ttfts) : null,
    streamCount: lanes.length,
  };
}

function summary(name, concurrency, results) {
  const durations = results.map((result) => result.durationMs);
  const ttfts = results.flatMap((result) =>
    result.ttftMs === null || result.ttftMs === undefined
      ? []
      : [result.ttftMs],
  );
  return {
    scenario: name,
    concurrency,
    requests: results.length,
    streams: results.reduce(
      (total, result) => total + (result.streamCount ?? 0),
      0,
    ),
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
    ttftP95Ms: ttfts.length ? Math.round(percentile(ttfts, 0.95)) : null,
    denialRate:
      results.filter((result) => result.status === 429).length / results.length,
    internalErrorRate:
      results.filter((result) => result.status >= 500).length / results.length,
  };
}

const report = [];
for (const concurrency of levels) {
  const reads = await Promise.all(
    Array.from({ length: concurrency }, publicRead),
  );
  report.push(summary("shared-thread-read", concurrency, reads));

  const streams = await Promise.all(
    Array.from({ length: concurrency }, (_, index) => arenaTurn(index)),
  );
  report.push(summary("arena-turn-three-lane", concurrency, streams));
}

process.stdout.write(
  `${JSON.stringify({ at: new Date().toISOString(), baseUrl, report }, null, 2)}\n`,
);
