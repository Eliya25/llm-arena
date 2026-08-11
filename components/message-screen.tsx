import type { ReactNode } from "react";

// The one full-page "nothing to show you, here's why" screen: not-found, the
// app error boundary, and the rate-limited thread page all render through it,
// so the layout and the action styling live in one place, not three.
export const messageScreenActionClass =
  "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90";

export function MessageScreen({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-medium">{title}</h1>
      <p className="max-w-md text-sm text-balance text-muted-foreground">
        {description}
      </p>
      {action}
    </div>
  );
}
