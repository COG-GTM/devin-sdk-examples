import {
  ArrowRightIcon,
  EllipsisIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ChatSummary, RecentSession } from "../server";
import { ago, cn } from "../lib/utils";
import { Button, Loading, Skeleton } from "./ui";

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
        aria-label="Chat actions"
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
            Delete chat
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionsRail({
  chats,
  activeId,
  deleting,
  busy,
  onSelect,
  onNew,
  onContinue,
  loadRecent,
  onDelete,
}: {
  /** `null` while the workspace state has not arrived. */
  chats: ChatSummary[] | null;
  activeId: string | null;
  deleting: ReadonlySet<string>;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** Start a chat from an existing cloud session (id or app URL). */
  onContinue: (sessionId: string) => Promise<void>;
  loadRecent: () => Promise<RecentSession[]>;
  onDelete: (id: string) => void;
}) {
  const [continuing, setContinuing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0 font-mono text-xs">
      <div className="p-2 border-b border-primary/18 flex gap-1">
        <Button
          variant="outline"
          className="flex-1 h-7 px-2 text-xs"
          disabled={busy || chats === null}
          onClick={onNew}
        >
          <PlusIcon className="w-3.5 h-3.5" /> New chat
        </Button>
        <Button
          variant={continuing ? "default" : "outline"}
          className="h-7 px-2 text-xs"
          disabled={busy || chats === null}
          title="Continue a session from the Devin app"
          onClick={() => {
            setContinuing((open) => !open);
          }}
        >
          <RotateCcwIcon className="w-3.5 h-3.5" /> Continue
        </Button>
      </div>
      {continuing && (
        <ContinueSession
          loadRecent={loadRecent}
          onContinue={async (sessionId) => {
            await onContinue(sessionId);
            setContinuing(false);
          }}
        />
      )}
      {chats === null ? (
        <ul className="divide-y divide-primary/10" aria-busy>
          {[0, 1, 2].map((i) => (
            <li key={i} className="px-2.5 py-2 space-y-1.5">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-2.5 w-3/5" />
            </li>
          ))}
        </ul>
      ) : chats.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground p-4 text-center">
          No chats yet
        </div>
      ) : (
        <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-primary/10">
          {chats.map((chat) => {
            const active = chat.id === activeId;
            const removing = deleting.has(chat.id);
            return (
              <li key={chat.id} className={cn("group relative", removing && "opacity-50")}>
                <button
                  type="button"
                  disabled={removing}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-2.5 py-2 pr-8 text-left cursor-pointer hover:bg-secondary/70",
                    active && "bg-secondary border-l-2 border-primary",
                    removing && "cursor-default hover:bg-transparent",
                  )}
                  onClick={() => {
                    onSelect(chat.id);
                  }}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    {removing ? (
                      <LoaderCircleIcon className="w-3 h-3 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <MessageSquareIcon className="w-3 h-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate">{chat.title}</span>
                  </span>
                  <span className="flex min-w-0 gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground pl-[18px]">
                    <span className="truncate">
                      {chat.preview !== null && chat.preview !== ""
                        ? chat.preview
                        : chat.id.slice(0, 8)}
                    </span>
                    <span className="shrink-0">
                      · {String(chat.turns)} turn{chat.turns === 1 ? "" : "s"} ·{" "}
                      {ago(now, chat.updatedAt)} ago
                    </span>
                  </span>
                </button>
                {!removing && (
                  <RowMenu
                    onDelete={() => {
                      onDelete(chat.id);
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

/** Paste a session id / URL, or pick one of the account's recent sessions. */
function ContinueSession({
  onContinue,
  loadRecent,
}: {
  onContinue: (sessionId: string) => Promise<void>;
  loadRecent: () => Promise<RecentSession[]>;
}) {
  const [value, setValue] = useState("");
  const [recent, setRecent] = useState<RecentSession[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    loadRecent().then(
      (sessions) => {
        if (!cancelled) setRecent(sessions);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadRecent]);

  const submit = async (sessionId: string) => {
    setPending(sessionId);
    setError(null);
    try {
      await onContinue(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="border-b border-primary/18 bg-secondary/40">
      <form
        className="flex gap-1 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) void submit(value.trim());
        }}
      >
        <input
          aria-label="Devin session id or URL"
          className="min-w-0 flex-1 h-7 rounded-sm border border-primary/18 bg-background px-2 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="devin-… or session URL"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button
          className="h-7 px-2 text-xs"
          type="submit"
          disabled={pending !== null || !value.trim()}
          title="Open"
        >
          <ArrowRightIcon className="w-3.5 h-3.5" />
        </Button>
      </form>
      {error !== null && <div className="px-2.5 pb-2 text-destructive break-words">{error}</div>}
      <div className="px-2.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Recent sessions
      </div>
      {recent === null && error === null ? (
        <Loading label="loading" className="py-3" />
      ) : (
        <ul className="max-h-56 overflow-y-auto divide-y divide-primary/10 border-t border-primary/10">
          {recent?.map((info) => (
            <li key={info.id}>
              <button
                type="button"
                disabled={pending !== null}
                className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left cursor-pointer hover:bg-secondary disabled:opacity-50"
                onClick={() => void submit(info.id)}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {pending === info.id ? (
                    <LoaderCircleIcon className="w-3 h-3 shrink-0 animate-spin" />
                  ) : (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        info.status === "working"
                          ? "bg-amber-500"
                          : info.status === "blocked"
                            ? "bg-accent-foreground"
                            : "bg-muted-foreground/50",
                      )}
                    />
                  )}
                  <span className="truncate">{info.title}</span>
                </span>
                <span className="pl-3 text-[10px] text-muted-foreground truncate">
                  {info.status ?? "unknown"} · {ago(now, info.updatedAt)} ago
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
