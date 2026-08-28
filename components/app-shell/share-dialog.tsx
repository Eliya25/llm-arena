"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Trash2, Unlink } from "lucide-react";
import { deleteThread, shareThread, unshareThread } from "@/app/arena/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ShareDialog({
  threadId,
  initiallyShared,
}: {
  threadId: string;
  initiallyShared: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isShared, setIsShared] = useState(initiallyShared);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function createLink() {
    setError(null);
    startTransition(async () => {
      const result = await shareThread(threadId);
      if ("error" in result) return setError(result.error);
      const absolute = new URL(result.path, window.location.origin).toString();
      setShareUrl(absolute);
      setIsShared(true);
      setIsCopied(false);
    });
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
    } catch {
      setError(
        "Copying is blocked here. Select the link and copy it manually.",
      );
    }
  }

  function revokeLink() {
    setError(null);
    startTransition(async () => {
      const result = await unshareThread(threadId);
      if ("error" in result) return setError(result.error);
      setIsShared(false);
      setShareUrl(null);
      setIsCopied(false);
    });
  }

  function removeThread() {
    setError(null);
    startTransition(async () => {
      const result = await deleteThread(threadId);
      if ("error" in result) return setError(result.error);
      router.push("/arena");
      router.refresh();
    });
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Link2 aria-hidden />
        Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="font-mono text-[10px] tracking-[0.18em] text-primary uppercase">
            Thread access
          </p>
          <DialogTitle className="font-display text-xl">
            {isConfirmingDelete ? "Delete this thread?" : "Share this thread"}
          </DialogTitle>
          <DialogDescription>
            {isConfirmingDelete
              ? "This permanently removes every turn, answer and vote. It cannot be undone."
              : "Threads stay private until you create a link. Anyone with an active link can read it, never edit it."}
          </DialogDescription>
        </DialogHeader>

        {isConfirmingDelete ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-muted-foreground">
            The shared link will stop working and this thread will disappear
            from your history.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div>
                <p className="text-sm font-medium">
                  {isShared ? "Link is active" : "Private"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {isShared
                    ? "Creating another link replaces the previous one."
                    : "Only you can open this thread."}
                </p>
              </div>
              <span
                className={`h-2 w-2 rounded-full ${isShared ? "bg-primary" : "bg-muted-foreground/40"}`}
                aria-hidden
              />
            </div>

            {shareUrl && (
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="Share link"
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <Button type="button" variant="outline" onClick={copyLink}>
                  {isCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {isCopied ? "Copied" : "Copy"}
                </Button>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={createLink} disabled={isPending}>
                <Link2 aria-hidden />
                {isShared ? "Create a new link" : "Create share link"}
              </Button>
              {isShared && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={revokeLink}
                  disabled={isPending}
                >
                  <Unlink aria-hidden />
                  Unshare
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {isConfirmingDelete ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsConfirmingDelete(false)}
                disabled={isPending}
              >
                Keep thread
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={removeThread}
                disabled={isPending}
              >
                <Trash2 aria-hidden />
                Delete forever
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setIsConfirmingDelete(true)}
              disabled={isPending}
            >
              <Trash2 aria-hidden />
              Delete thread
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
