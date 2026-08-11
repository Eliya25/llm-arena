"use client";

import { createContext, useContext, useRef, type RefObject } from "react";

type NewChatContextValue = {
  // Set by the fresh-arena page's ArenaClient while it's mounted, null
  // otherwise. A ref rather than state on purpose: nothing needs to re-render
  // when it changes — the sidebar only reads it at click time.
  resetRef: RefObject<(() => void) | null>;
};

const NewChatContext = createContext<NewChatContextValue>({
  resetRef: { current: null },
});

// Why this exists: /arena rewrites the URL to /arena/<id> with replaceState
// after the first send, so the address bar and the rendered tree disagree —
// the tree is still the /arena page. A <Link href="/arena"> from that state
// may be treated as a same-page navigation and leave the old turns on screen.
// Rather than depend on that, the arena hands the sidebar a way to clear
// itself in place, and the link only navigates when there's nothing mounted
// to reset (a real thread page, or any other route).
export function NewChatProvider({ children }: { children: React.ReactNode }) {
  const resetRef = useRef<(() => void) | null>(null);

  return (
    <NewChatContext.Provider value={{ resetRef }}>
      {children}
    </NewChatContext.Provider>
  );
}

export function useNewChat() {
  return useContext(NewChatContext);
}
