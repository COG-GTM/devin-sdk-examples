"use client";

import { COLUMN_LABELS, type Card, type Column as ColumnKey } from "@/lib/card";
import { SessionCard } from "@/components/session-card";
import { cn } from "@/lib/utils";

const TONE: Record<ColumnKey, string> = {
  "needs-you": "bg-needs",
  working: "bg-working",
  done: "bg-done",
};

export function Column({
  column,
  cards,
  now,
  loading,
}: {
  column: ColumnKey;
  cards: Card[];
  now: number;
  /** No snapshot yet: show placeholders instead of an empty column. */
  loading: boolean;
}) {
  return (
    <section
      aria-label={COLUMN_LABELS[column]}
      className="flex min-h-0 flex-col rounded-md border border-primary/18 bg-background shadow-sm"
    >
      <header className="flex items-center gap-2 border-b border-primary/18 bg-secondary px-2.5 py-1.5 font-mono text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
        <span className={cn("size-2 rounded-full", TONE[column])} aria-hidden />
        {COLUMN_LABELS[column]}
        <span className="ml-auto tabular-nums opacity-60">
          {loading ? "" : String(cards.length)}
        </span>
      </header>
      <div className={cn("h-px shrink-0", TONE[column])} aria-hidden />
      {loading ? (
        <ul className="flex flex-col gap-2 p-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="space-y-2 rounded-md border border-primary/18 p-2.5"
              style={{ opacity: 1 - i * 0.3 }}
            >
              <div className="h-3 w-4/5 animate-pulse rounded-sm bg-muted" />
              <div className="h-2.5 w-2/5 animate-pulse rounded-sm bg-muted" />
            </li>
          ))}
        </ul>
      ) : cards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <span className="rounded-md border border-dashed border-primary/25 px-4 py-2 font-mono text-xs text-muted-foreground">
            Nothing here
          </span>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {cards.map((card) => (
            <li key={card.id}>
              <SessionCard card={card} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
