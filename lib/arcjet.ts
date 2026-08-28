import arcjet, {
  shield,
  detectBot,
  detectPromptInjection,
  sensitiveInfo,
  tokenBucket,
} from "@arcjet/next";
import { env } from "@/lib/env";

// Three clients, one per protected surface (docs/scope.md Feature 10). They're
// deliberately separate rather than one shared client: the surfaces need
// different keys (person vs. IP) and different budgets, and a shared token
// bucket would make a prompt's own persistence writes eat the streaming quota.
// Each bucket's configuration is distinct, so Arcjet counts them separately.

// Applied in app/api/chat/route.ts (docs/scope.md Feature 6). The token
// bucket is keyed per-user so the limit holds across all three parallel
// model streams a single prompt fans out to, not just per HTTP request.
export const aj = arcjet({
  key: env.ARCJET_KEY,
  characteristics: ["userId"],
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({ mode: "LIVE", allow: [] }),
    detectPromptInjection({ mode: "LIVE" }),
    // A thread may later be shared by its owner, so a card number typed into a
    // prompt could be exposed through that capability URL. Card numbers only —
    // denying emails and phone numbers would reject legitimate prompts
    // (docs/scope.md Feature 10). Detected locally by the bundled WASM engine.
    sensitiveInfo({ mode: "LIVE", deny: ["CREDIT_CARD_NUMBER"] }),
    tokenBucket({ mode: "LIVE", refillRate: 5, interval: 10, capacity: 10 }),
  ],
});

// Applied in app/arena/actions.ts. The write path was always owner-enforced,
// but it had no rate limit — a scripted client could flood threads, turns, and
// messages entirely bypassing /api/chat's bucket. Keyed per-user like the chat
// client, and costs are weighted at each call site via `requested`.
export const ajActions = arcjet({
  key: env.ARCJET_KEY,
  characteristics: ["userId"],
  rules: [
    shield({ mode: "LIVE" }),
    tokenBucket({ mode: "LIVE", refillRate: 15, interval: 10, capacity: 45 }),
  ],
});

// Applied in app/share/[token]/page.tsx. Public thread sharing creates an
// unauthenticated database read that anyone holding an active link can hammer.
// No `userId` characteristic — visitors are anonymous, so this keys by IP, and
// the budget is deliberately generous because a whole office behind one NAT
// shares a key. No detectBot here on purpose: `allow: []` would block the
// crawlers and link unfurlers that make a shared link worth sharing.
export const ajPublicRead = arcjet({
  key: env.ARCJET_KEY,
  rules: [
    shield({ mode: "LIVE" }),
    tokenBucket({ mode: "LIVE", refillRate: 20, interval: 10, capacity: 60 }),
  ],
});
