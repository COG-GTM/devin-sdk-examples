"use client";

import {
  EllipsisIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SessionMeta } from "@/lib/session-store";
import { Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${String(s)}s`;
  if (s < 3600) return `${String(Math.round(s / 60))}m`;
  if (s < 86400) return `${String(Math.round(s / 3600))}h`;
  return `${String(Math.round(s / 86400))}d`;
}

/** Per-row "⋯" menu; the only action today is delete. */
function RowMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => {
      document.removeEventListener("mousedown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="absolute right-1 top-1.5">
      <button
        type="button"
        aria-label="Session actions"
        className={cn(
          "p-1 rounded-sm text-muted-foreground hover:bg-secondary hover:text-primary cursor-pointer",
          open ? "opacity-100 bg-secondary" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <EllipsisIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 min-w-36 rounded-sm border border-primary/18 bg-background shadow-sm py-1 whitespace-nowrap">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground hover:bg-secondary cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2Icon className="w-3.5 h-3.5 text-muted-foreground" />
            Delete session
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionsRail({
  sessions,
  deleting,
  activeId,
  busy,
  onSelect,
  onNew,
  onDelete,
}: {
  /** `null` while the list is loading. */
  sessions: SessionMeta[] | null;
  /** Ids whose delete is in flight; rendered greyed out with a spinner. */
  deleting?: ReadonlySet<string>;
  activeId: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0 font-mono text-xs">
      <div className="p-2 border-b border-primary/18">
        <Button
          variant="outline"
          className="w-full h-7 px-2 text-xs"
          disabled={busy || sessions === null}
          onClick={onNew}
        >
          <PlusIcon className="w-3.5 h-3.5" /> New session
        </Button>
      </div>
      {sessions === null ? (
        <ul className="divide-y divide-primary/10" aria-busy>
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-2.5 py-2 space-y-1.5">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </li>
          ))}
        </ul>
      ) : sessions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground p-4 text-center">
          No sessions yet
        </div>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-primary/10">
          {sessions.map((s) => {
            const active = s.id === activeId;
            const removing = deleting?.has(s.id) === true;
            return (
              <li key={s.id} className={cn("group relative", removing && "opacity-50")}>
                <button
                  type="button"
                  disabled={removing}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-2.5 py-2 pr-8 text-left cursor-pointer hover:bg-secondary/70",
                    active && "bg-secondary border-l-2 border-primary",
                    removing && "cursor-default hover:bg-transparent",
                  )}
                  onClick={() => {
                    onSelect(s.id);
                  }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {removing ? (
                      <LoaderCircleIcon className="w-3 h-3 shrink-0 animate-spin text-muted-foreground" />
                    ) : s.active ? (
                      <span
                        className="w-3 h-3 shrink-0 flex items-center justify-center"
                        title="A turn is running"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      </span>
                    ) : (
                      <MessageSquareIcon className="w-3 h-3 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={cn("truncate", s.title === null && "text-muted-foreground italic")}
                    >
                      {s.title ?? "untitled"}
                    </span>
                  </span>
                  <span className="flex min-w-0 gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground pl-[18px]">
                    <span className="truncate">{s.id}</span>
                    <span className="shrink-0">
                      · {String(s.turns)} turn{s.turns === 1 ? "" : "s"} · {ago(s.updatedAt)} ago
                    </span>
                  </span>
                </button>
                {!removing && (
                  <RowMenu
                    onDelete={() => {
                      onDelete(s.id);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
