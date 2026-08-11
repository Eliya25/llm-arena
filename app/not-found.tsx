import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-medium">
        This page doesn&apos;t exist
      </h1>
      <p className="max-w-md text-sm text-balance text-muted-foreground">
        The thread or page you&apos;re looking for isn&apos;t here — it may have
        been removed, or the link may be wrong.
      </p>
      <Link
        href="/arena"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Back to the arena
      </Link>
    </div>
  );
}
