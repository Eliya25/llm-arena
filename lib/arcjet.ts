import arcjet, {
  shield,
  detectBot,
  detectPromptInjection,
  tokenBucket,
} from "@arcjet/next";
import { env } from "@/lib/env";

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
    tokenBucket({ mode: "LIVE", refillRate: 5, interval: 10, capacity: 10 }),
  ],
});
