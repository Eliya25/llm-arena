"use client";

import { createContext, useContext, useState } from "react";
import { getOwnThreads, type ThreadListItem } from "@/app/arena/actions";

type ThreadsContextValue = {
  threads: ThreadListItem[];
  // Re-fetches the signed-in user's threads — called by the arena right after
  // a first send creates a new thread, so the sidebar picks it up without a
  // router refresh (which would swap the page tree mid-session).
  refreshThreads: () => void;
};

const ThreadsContext = createContext<ThreadsContextValue>({
  threads: [],
  refreshThreads: () => {},
});

export function ThreadsProvider({
  initialThreads,
  children,
}: {
  initialThreads: ThreadListItem[];
  children: React.ReactNode;
}) {
  const [threads, setThreads] = useState(initialThreads);

  function refreshThreads() {
    void getOwnThreads().then(setThreads);
  }

  return (
    <ThreadsContext.Provider value={{ threads, refreshThreads }}>
      {children}
    </ThreadsContext.Provider>
  );
}

export function useThreads() {
  return useContext(ThreadsContext);
}
