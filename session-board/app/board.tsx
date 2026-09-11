"use client";

import { useMemo, useState } from "react";

import { Column } from "@/components/column";
import { Search, Toggle, WindowPicker } from "@/components/controls";
import { DevinDashed } from "@/components/devin-mark";
import { COLUMNS, WINDOW_MS, type Card, type Column as ColumnKey, type Window } from "@/lib/card";
import { ago } from "@/lib/format";
import { useBoard, useNow, type BoardState } from "@/lib/use-board";
import { cn } from "@/lib/utils";

export function Board() {
  const [window, setWindow] = useState<Window>("24h");
  const [hideAutomations, setHideAutomations] = useState(false);
  const [query, setQuery] = useState("");
  const state = useBoard(window);
  const now = useNow(5_000);

  const columns = useMemo(() => {
    const since = now - WINDOW_MS[window];
    const needle = query.trim().toLowerCase();
    const grouped: Record<ColumnKey, Card[]> = { "needs-you": [], working: [], done: [] };
    for (const card of state.cards) {
      if (Date.parse(card.updatedAt) < since) continue;
      if (hideAutomations && card.automation) continue;
      if (needle !== "" && !matches(card, needle)) continue;
      grouped[card.column].push(card);
    }
    return grouped;
  }, [state.cards, now, window, hideAutomations, query]);

  const shown = COLUMNS.reduce((n, column) => n + columns[column].length, 0);
  const loading = state.link === "connecting" && state.cards.length === 0;

  return (
    <div className="flex h-screen max-h-screen flex-col gap-2 overflow-hidden p-2">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        <div className="flex items-center">
          <DevinDashed className="ml-1 mr-1.5 md:ml-2.5" />
          <span className="hidden font-mono text-sm font-bold uppercase tracking-tight md:inline">
            Session Board
          </span>
        </div>
        <Live state={state} shown={shown} now={now} />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <WindowPicker value={window} onChange={setWindow} />
          <Toggle checked={hideAutomations} onChange={setHideAutomations}>
            hide automations
          </Toggle>
          <Search value={query} onChange={setQuery} />
        </div>
      </header>
      {state.note !== undefined && (
        <p
          role="status"
          className="rounded-md border border-needs/60 bg-needs/10 px-3 py-1.5 font-mono text-xs text-needs-foreground"
        >
          {state.note}
        </p>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3">
        {COLUMNS.map((column) => (
          <Column
            key={column}
            column={column}
            cards={columns[column]}
            now={now}
            loading={loading}
          />
        ))}
      </main>
    </div>
  );
}

/** One line of truth about the two links: this tab to the server, the server to Devin. */
function Live({ state, shown, now }: { state: BoardState; shown: number; now: number }) {
  const status =
    state.link === "reconnecting"
      ? { label: "reconnecting", dot: "bg-needs" }
      : state.link === "live" && state.upstream
        ? { label: "live", dot: "bg-working animate-breathe" }
        : state.note !== undefined
          ? { label: "devin offline", dot: "bg-needs" }
          : { label: "connecting", dot: "bg-done" };
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] uppercase text-muted-foreground">
      <span className={cn("size-2 rounded-full", status.dot)} aria-hidden />
      <span className="text-foreground">{status.label}</span>
      {state.link === "live" && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            {String(shown)} session{shown === 1 ? "" : "s"}
          </span>
          {state.lastEventAt !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums normal-case">
                last event {ago(now, state.lastEventAt)} ago
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}

function matches(card: Card, needle: string): boolean {
  return [card.title, card.prompt, card.id, ...card.repos, ...card.tags].some((text) =>
    text?.toLowerCase().includes(needle),
  );
}
