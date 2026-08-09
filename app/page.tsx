export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-12 px-6 py-24">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
          llm-arena
        </p>
        <h1 className="font-display text-4xl font-medium text-balance sm:text-5xl">
          One prompt. Three models. A real vote.
        </h1>
        <p className="max-w-md text-base text-balance text-muted-foreground">
          Send a prompt, watch up to three models answer at once, and vote for
          the best one. Every number on the board is real.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-8 py-6">
        <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          Won
        </span>
        <span className="font-display text-5xl leading-none font-semibold text-primary">
          4 of 5
        </span>
        <div className="flex gap-1.5" role="img" aria-label="Won 4 of 5 votes">
          {[true, true, true, true, false].map((won, i) => (
            <span
              key={i}
              className={
                won
                  ? "h-2 w-2 rounded-full bg-primary"
                  : "h-2 w-2 rounded-full border border-border"
              }
            />
          ))}
        </div>
      </div>

      <button
        type="button"
        className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Start a prompt
      </button>
    </div>
  );
}
