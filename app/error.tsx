"use client";

import { useEffect } from "react";
import {
  MessageScreen,
  messageScreenActionClass,
} from "@/components/message-screen";

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
    <MessageScreen
      title="Something went wrong"
      description="This page couldn't load. It's not something you did — trying again usually fixes it."
      action={
        <button
          type="button"
          onClick={reset}
          className={messageScreenActionClass}
        >
          Try again
        </button>
      }
    />
  );
}
