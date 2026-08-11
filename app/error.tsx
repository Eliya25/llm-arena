"use client";

import { useEffect } from "react";

// The app-wide error boundary: whatever actually broke stays in the console
// and server logs — the person only ever sees a plain sentence and a retry.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled app error", error);
  }, [error]);

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-medium">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-balance text-muted-foreground">
        This page couldn&apos;t load. It&apos;s not something you did — trying
        again usually fixes it.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
