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
      messages: [{ role: "user", content: "Capacity probe" }],
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
    statuses: lanes.map((lane) => lane.status),
    completed: lanes.every((lane) => lane.status < 400),
    deniedStreams: lanes.filter((lane) => lane.status === 429).length,
    internalErrorStreams: lanes.filter((lane) => lane.status >= 500).length,
    durationMs: Math.max(...lanes.map((lane) => lane.durationMs)),
    appHeadersMs: Math.max(...lanes.map((lane) => lane.appHeadersMs)),
    ttftMs: ttfts.length ? Math.max(...ttfts) : null,
    streamCount: lanes.length,
  };
}

function summary(name, concurrency, results) {
  const durations = results.map((result) => result.durationMs);
  const appHeaders = results.flatMap((result) =>
    result.appHeadersMs === undefined ? [] : [result.appHeadersMs],
  );
  const ttfts = results.flatMap((result) =>
    result.ttftMs === null || result.ttftMs === undefined
      ? []
      : [result.ttftMs],
  );
  const streams = results.reduce(
    (total, result) => total + (result.streamCount ?? 0),
    0,
  );
  const denominator = streams || results.length;
  const denied = results.reduce(
    (total, result) =>
      total + (result.deniedStreams ?? (result.status === 429 ? 1 : 0)),
    0,
  );
  const internalErrors = results.reduce(
    (total, result) =>
      total + (result.internalErrorStreams ?? (result.status >= 500 ? 1 : 0)),
    0,
  );
  const statuses = results.flatMap(
    (result) => result.statuses ?? [result.status],
  );
  const statusCounts = Object.fromEntries(
    [...new Set(statuses)]
      .sort((a, b) => a - b)
      .map((status) => [
        status,
        statuses.filter((value) => value === status).length,
      ]),
  );
  const unexpectedClientErrors = statuses.filter(
    (status) => status >= 400 && status < 500 && status !== 429,
  ).length;
  return {
    scenario: name,
    concurrency,
    requests: results.length,
    completedRequests: results.filter(
      (result) => result.completed ?? result.status < 400,
    ).length,
    streams,
    statusCounts,
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
    appHeadersP95Ms: appHeaders.length
      ? Math.round(percentile(appHeaders, 0.95))
      : null,
    ttftP95Ms: ttfts.length ? Math.round(percentile(ttfts, 0.95)) : null,
    denialRate: denied / denominator,
    unexpectedClientErrorRate: unexpectedClientErrors / denominator,
    internalErrorRate: internalErrors / denominator,
  };
}

function capacityFailures(result) {
  return [
    ...(result.scenario === "shared-thread-read" && result.p95Ms > 2_000
      ? [`normal read p95 ${result.p95Ms}ms > 2000ms`]
      : []),
    ...(result.appHeadersP95Ms !== null && result.appHeadersP95Ms > 500
      ? [`application headers p95 ${result.appHeadersP95Ms}ms > 500ms`]
      : []),
    ...(result.internalErrorRate > 0.01
      ? [`internal error rate ${result.internalErrorRate} > 0.01`]
      : []),
  ];
}

function invalidFailures(result) {
  return result.unexpectedClientErrorRate > 0
    ? [`unexpected client error rate ${result.unexpectedClientErrorRate}`]
    : [];
}

const report = [];
for (const concurrency of levels) {
  const reads = await Promise.all(
    Array.from({ length: concurrency }, publicRead),
  );
  const readSummary = summary("shared-thread-read", concurrency, reads);
  readSummary.capacityFailures = capacityFailures(readSummary);
  readSummary.invalidFailures = invalidFailures(readSummary);
  report.push(readSummary);

  const streams = await Promise.all(
    Array.from({ length: concurrency }, (_, index) => arenaTurn(index)),
  );
  const arenaSummary = summary("arena-turn-three-lane", concurrency, streams);
  arenaSummary.capacityFailures = capacityFailures(arenaSummary);
  arenaSummary.invalidFailures = invalidFailures(arenaSummary);
  report.push(arenaSummary);

  if (
    readSummary.capacityFailures.length > 0 ||
    arenaSummary.capacityFailures.length > 0 ||
    readSummary.invalidFailures.length > 0 ||
    arenaSummary.invalidFailures.length > 0
  ) {
    break;
  }
}

process.stdout.write(
  `${JSON.stringify({ at: new Date().toISOString(), baseUrl, report }, null, 2)}\n`,
);
