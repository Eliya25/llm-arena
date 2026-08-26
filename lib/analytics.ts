import { after } from "next/server";
import { getPostHogClient } from "@/lib/posthog-server";

// Recording that something happened, in a way that cannot affect whether it
// happened (docs/scope-v2.md Feature 3).
//
// The route used to `await posthog.flush()` on the success path, immediately
// before handing the stream to the browser, outside any try. Two problems in
// one line: PostHog throwing turned a perfectly good generation into a 500,
// and PostHog merely being slow made every prompt wait for an analytics round
// trip before its first token could move.
//
// Now the flush is handed to after(), so it runs once the response is done —
// off the critical path but still kept alive by the platform, which matters
// because a route handler is short-lived and a fire-and-forget flush would
// often simply be dropped.

type AnalyticsEvent = {
  readonly distinctId: string;
  readonly event: string;
  readonly properties?: Record<string, unknown>;
};

function flushLater(flush: () => Promise<unknown>) {
  const report = (cause: unknown) =>
    console.error("Flushing analytics failed", cause);
  try {
    after(() => flush().catch(report));
  } catch {
    // No request scope to attach to — a background task, or a test. Falling
    // back to fire-and-forget is right here: there is no response to finish.
    void flush().catch(report);
  }
}

// Never throws, and never returns anything worth checking. A caller that had
// to handle an analytics failure would be a caller whose real work depends on
// analytics, which is the thing being prevented.
//
// For work that is *already* running after the response — a recorder handed to
// after() — use trackAndWait instead. See the note on it.
export function track({ distinctId, event, properties }: AnalyticsEvent): void {
  try {
    const posthog = getPostHogClient();
    if (!posthog) return;
    posthog.capture({ distinctId, event, properties });
    flushLater(() => posthog.flush());
  } catch (cause) {
    console.error("Capturing an analytics event failed", { event, cause });
  }
}

// The same event, flushed inline rather than handed to after().
//
// For a caller that is itself running inside after(), scheduling another
// after() callback is not equivalent: only the first callback registered gets
// the platform's waitUntil, and by this point the route's own events have
// already claimed it. A late callback lands on a queue nothing is waiting for,
// and on a serverless host the instance can freeze before the event leaves.
// Awaiting here keeps the flush inside the work that waitUntil is already
// holding open.
//
// Like track(), it cannot throw and reports nothing back — the awaiting is for
// the platform's benefit, not the caller's.
export async function trackAndWait({
  distinctId,
  event,
  properties,
}: AnalyticsEvent): Promise<void> {
  try {
    const posthog = getPostHogClient();
    if (!posthog) return;
    posthog.capture({ distinctId, event, properties });
    await posthog.flush();
  } catch (cause) {
    console.error("Capturing an analytics event failed", { event, cause });
  }
}
