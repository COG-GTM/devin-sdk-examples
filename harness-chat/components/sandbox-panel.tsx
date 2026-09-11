"use client";

import { ExternalLinkIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { PREVIEW_PORTS } from "@/lib/ports";
import type { SandboxInfo } from "@/lib/workspace";
import { LoadError, Loading, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  running: "bg-emerald-600",
  pending: "bg-amber-500 animate-pulse",
  snapshotting: "bg-amber-500 animate-pulse",
  stopping: "bg-amber-500",
  stopped: "bg-muted-foreground",
  failed: "bg-destructive",
  aborted: "bg-destructive",
};

function uptime(createdAt?: number): string {
  if (createdAt === undefined) return "—";
  const s = Math.round((Date.now() - createdAt) / 1000);
  if (s < 60) return `${String(s)}s`;
  if (s < 3600) return `${String(Math.floor(s / 60))}m ${String(s % 60)}s`;
  return `${String(Math.floor(s / 3600))}h ${String(Math.floor((s % 3600) / 60))}m`;
}

export function SandboxDetails({
  chatId,
  info,
  error,
  onRefresh,
}: {
  chatId: string;
  info: SandboxInfo | null;
  error?: Error;
  onRefresh: () => void;
}) {
  if (error) return <LoadError message="Couldn't reach the sandbox" onRetry={onRefresh} />;
  const rows: [string, React.ReactNode][] = [
    ["chat", chatId],
    ["harness", "devin · @cognition-ai/harness-devin"],
    ["sandbox", info?.exists ? (info.name ?? "—") : "not created yet"],
    [
      "status",
      info?.exists ? (
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              STATUS_DOT[info.status ?? ""] ?? "bg-muted-foreground",
            )}
          />
          {info.status ?? "unknown"}
        </span>
      ) : (
        "—"
      ),
    ],
    ["region", info?.region ?? "—"],
    ["age", uptime(info?.createdAt)],
  ];
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-2.5 font-mono text-xs"
      aria-busy={info === null}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-muted-foreground">Vercel Sandbox · microVM</span>
        <button
          type="button"
          className="p-1 rounded-sm hover:bg-secondary cursor-pointer text-muted-foreground"
          onClick={onRefresh}
          title="Refresh"
        >
          <RotateCwIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="truncate min-w-0 flex-1">
              {info === null && k !== "chat" && k !== "harness" ? (
                <Skeleton className="h-3 w-2/3" />
              ) : (
                v
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PreviewPane({ info, error }: { info: SandboxInfo | null; error?: Error }) {
  const previews = info?.previews ?? [];
  const [port, setPort] = useState<number | null>(null);
  // Follow the only/first serving port until the user picks one that still exists.
  const current = previews.find((p) => p.port === port) ?? previews.at(0);
  const [reloadKey, setReloadKey] = useState(0);

  if (error) return <LoadError message="Couldn't reach the sandbox" />;
  if (info === null) return <Loading label="checking preview ports" />;
  if (current === undefined) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground p-4 text-center">
        <span>Nothing is serving on ports {PREVIEW_PORTS.join(", ")}.</span>
        <span>Ask Devin to start an app and it appears here.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-primary/18 font-mono text-[11px] text-muted-foreground">
        {previews.length > 1 &&
          previews.map((p) => (
            <button
              key={p.port}
              type="button"
              className={cn(
                "px-1.5 py-0.5 rounded-sm cursor-pointer hover:text-primary",
                p.port === current.port && "bg-secondary text-primary",
              )}
              onClick={() => {
                setPort(p.port);
              }}
            >
              :{p.port}
            </button>
          ))}
        <span className="truncate ml-1">{current.url}</span>
        <button
          type="button"
          className="ml-auto p-1 rounded-sm hover:bg-secondary hover:text-primary cursor-pointer"
          title="Reload preview"
          onClick={() => {
            setReloadKey((k) => k + 1);
          }}
        >
          <RotateCwIcon className="w-3.5 h-3.5" />
        </button>
        <a
          href={current.url}
          target="_blank"
          rel="noreferrer"
          className="p-1 rounded-sm hover:bg-secondary hover:text-primary"
          title="Open in new tab"
        >
          <ExternalLinkIcon className="w-3.5 h-3.5" />
        </a>
      </div>
      <iframe
        key={`${String(current.port)}-${String(reloadKey)}`}
        title="preview"
        src={current.url}
        className="flex-1 w-full bg-white"
        sandbox="allow-scripts allow-forms allow-same-origin"
      />
    </div>
  );
}
