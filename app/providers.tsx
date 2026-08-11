"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { useUser } from "@clerk/nextjs";
import { ThemeProvider } from "next-themes";

// PostHog is initialized in instrumentation-client.ts (Next.js 15.3+ pattern).
// Never combine that approach with a PostHogProvider here.

function IdentifyUser() {
  const { user, isSignedIn } = useUser();
  // Track previous sign-in state so posthog.reset() is only called on sign-out,
  // not on every anonymous page load (which would discard the anonymous distinct_id).
  const prevIsSignedIn = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (isSignedIn && user) {
      // Identify the signed-in user; email stays in person properties (not capture props).
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
      });
    } else if (prevIsSignedIn.current === true && !isSignedIn) {
      // Only reset when transitioning from authenticated → unauthenticated (sign-out).
      posthog.reset();
    }
    prevIsSignedIn.current = isSignedIn ?? false;
  }, [isSignedIn, user]);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <IdentifyUser />
      {children}
    </ThemeProvider>
  );
}
