import type { DevinChatMessage, DevinChatState } from "@cognition-ai/cloudflare-agents";
import type { FileUpdate, PlanEntry } from "@cognition-ai/sdk";
import { isToolUIPart } from "ai";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleIcon,
  ExternalLinkIcon,
  FilePenIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  LoaderCircleIcon,
  RotateCwIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";

import type { SessionPullRequest, SessionSnapshot } from "../server";
import { toolDetail } from "../lib/tools";
import { ago, cn, humanize, repoShort } from "../lib/utils";
import { LoadError, Skeleton } from "./ui";

/** A file Devin wrote or edited in this chat. */
interface TouchedFile {
  path: string;
  added: number;
  removed: number;
}

const STATUS_DOT: Record<string, string> = {
  working: "bg-amber-500 animate-pulse",
  blocked: "bg-emerald-600",
  waiting: "bg-accent-foreground",
  paused: "bg-accent-foreground",
  finished: "bg-emerald-600",
  stopped: "bg-muted-foreground",
  crashed: "bg-destructive",
  error: "bg-destructive",
};

/**
 * The cloud's `statusEnum`, in the Devin app's words: `blocked` means Devin
 * is blocked on you, which the app shows as "awaiting instructions".
 */
const STATUS_LABEL: Record<string, string> = {
  blocked: "awaiting instructions",
};

/**
 * Facts about the Devin session behind this chat: id, status, what it is
 * doing, cost. Live events fill `state` while a turn streams; the `snapshot`
 * (polled from the cloud) covers the time in between.
 */
export function SessionDetails({
  chatId,
  state,
  snapshot,
  streaming,
  error,
  loading,
  onRefresh,
}: {
  chatId: string;
  state: DevinChatState | undefined;
  snapshot: SessionSnapshot | null;
  /** A turn is streaming: its live events are fresher than the polled snapshot. */
  streaming: boolean;
  error: Error | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const sessionId = state?.sessionId ?? snapshot?.id ?? null;
  if (error && sessionId !== null) {
    return <LoadError message="Couldn't reach the Devin cloud" onRetry={onRefresh} />;
  }
  // Live events only flow while a turn streams; in between, the cloud snapshot is the truth.
  const status =
    (streaming ? state?.status : snapshot?.status) ?? state?.status ?? snapshot?.status ?? null;
  const activity = humanize(
    streaming ? (state?.activity ?? snapshot?.activity) : (snapshot?.activity ?? null),
  );
  const url = state?.sessionUrl ?? snapshot?.url ?? null;
  const pending = sessionId !== null && snapshot === null && loading;
  const rows: [string, ReactNode][] = [
    ["chat", chatId.slice(0, 8)],
    [
      "session",
      sessionId === null ? (
        "not started yet"
      ) : url === null ? (
        sessionId
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:underline hover:text-primary"
          title="Open in the Devin app"
        >
          {sessionId} <ExternalLinkIcon className="w-3 h-3 shrink-0" />
        </a>
      ),
    ],
    [
      "status",
      status === null ? (
        "—"
      ) : (
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              STATUS_DOT[status] ?? "bg-muted-foreground",
            )}
          />
          {STATUS_LABEL[status] ?? humanize(status)}
          {snapshot?.runtime === "suspended" && (
            <span className="text-muted-foreground">· asleep</span>
          )}
        </span>
      ),
    ],
    ["activity", activity ?? "—"],
    [
      "repos",
      snapshot === null || snapshot.repos.length === 0
        ? "—"
        : snapshot.repos.map(repoShort).join(", "),
    ],
    [
      "usage",
      snapshot?.acu === null || snapshot?.acu === undefined
        ? "—"
        : `${snapshot.acu.toFixed(1)} ACU`,
    ],
    ["updated", snapshot?.updatedAt ? `${ago(Date.now(), snapshot.updatedAt)} ago` : "—"],
  ];
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-2.5 font-mono text-xs" aria-busy={pending}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-muted-foreground">Devin cloud · one session per chat</span>
        <button
          type="button"
          className="p-1 rounded-sm hover:bg-secondary cursor-pointer text-muted-foreground"
          onClick={onRefresh}
          title="Refresh"
        >
          <RotateCwIcon className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{k}</dt>
            <dd className="truncate min-w-0 flex-1">
              {pending && k !== "chat" && k !== "session" ? <Skeleton className="h-3 w-2/3" /> : v}
            </dd>
          </div>
        ))}
      </dl>
      {snapshot?.userActionRequired && (
        <div className="mt-2 pt-2 border-t border-primary/18 text-amber-700">
          ↳ {snapshot.userActionRequired}
        </div>
      )}
    </div>
  );
}

/** Files Devin wrote or edited, gathered from the transcript's tool calls. */
function touchedFiles(messages: readonly DevinChatMessage[]): TouchedFile[] {
  const files = new Map<string, TouchedFile>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const detail = toolDetail(part);
      if (detail?.tool !== "write" && detail?.tool !== "edit") continue;
      const entries: Partial<FileUpdate>[] =
        detail.files.length > 0 ? detail.files : detail.path ? [{ path: detail.path }] : [];
      for (const entry of entries) {
        if (entry.path === undefined) continue;
        const file = files.get(entry.path) ?? { path: entry.path, added: 0, removed: 0 };
        file.added += entry.linesAdded ?? 0;
        file.removed += entry.linesRemoved ?? 0;
        files.set(entry.path, file);
      }
    }
  }
  return [...files.values()];
}

const PR_ICONS: Record<string, typeof GitPullRequestIcon> = {
  merged: GitMergeIcon,
  closed: GitPullRequestClosedIcon,
};

function PullRequestRow({ pr }: { pr: SessionPullRequest }) {
  const Icon = pr.draft ? GitPullRequestDraftIcon : (PR_ICONS[pr.state] ?? GitPullRequestIcon);
  const number = pr.url.split("/").filter(Boolean).at(-1) ?? "";
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-secondary min-w-0"
      title={pr.title ?? pr.url}
    >
      <Icon
        className={cn(
          "w-3.5 h-3.5 shrink-0",
          pr.state === "merged"
            ? "text-purple-600"
            : pr.state === "closed"
              ? "text-destructive"
              : pr.draft
                ? "text-muted-foreground"
                : "text-emerald-600",
        )}
      />
      <span className="truncate">
        {pr.title ?? pr.url.replace(/^https?:\/\/(www\.)?github\.com\//, "")}
      </span>
      <span className="ml-auto shrink-0 flex items-center gap-1.5 text-muted-foreground">
        {pr.reviewDecision === "APPROVED" && <CheckIcon className="w-3 h-3 text-emerald-600" />}
        {pr.additions !== null && <span className="text-emerald-600">+{String(pr.additions)}</span>}
        {pr.deletions !== null && <span className="text-destructive">−{String(pr.deletions)}</span>}
        <span>
          #{number} {pr.draft ? "draft" : pr.state}
        </span>
      </span>
    </a>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center px-2.5 py-1 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground bg-secondary/60 border-y border-primary/10">
        {title}
        {count !== undefined && <span className="ml-auto opacity-70">{count}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * What the session produced: the plan Devin is following, pull requests it
 * opened, and the files it touched in this chat.
 */
export function WorkspacePanel({
  plan,
  pullRequests,
  messages,
}: {
  plan: PlanEntry[];
  pullRequests: SessionPullRequest[];
  messages: readonly DevinChatMessage[];
}) {
  const files = useMemo(() => touchedFiles(messages), [messages]);
  const empty = plan.length === 0 && pullRequests.length === 0 && files.length === 0;
  if (empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 font-mono text-xs text-muted-foreground p-4 text-center">
        <span>Nothing yet.</span>
        <span>Plans, pull requests and edited files show up here as Devin works.</span>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto font-mono text-xs">
      {plan.length > 0 && (
        <Section title="plan" count={plan.filter((entry) => entry.status === "completed").length}>
          <ol className="px-2.5 py-1.5 space-y-1">
            {plan.map((entry, index) => (
              <li key={index} className="flex items-start gap-2">
                {entry.status === "completed" ? (
                  <CircleCheckIcon className="w-3.5 h-3.5 mt-px shrink-0 text-emerald-600" />
                ) : entry.status === "in_progress" ? (
                  <LoaderCircleIcon className="w-3.5 h-3.5 mt-px shrink-0 animate-spin text-amber-600" />
                ) : (
                  <CircleIcon className="w-3.5 h-3.5 mt-px shrink-0 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    entry.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  {entry.content}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}
      {pullRequests.length > 0 && (
        <Section title="pull requests" count={pullRequests.length}>
          <div className="divide-y divide-primary/10">
            {pullRequests.map((pr) => (
              <PullRequestRow key={pr.url} pr={pr} />
            ))}
          </div>
        </Section>
      )}
      {files.length > 0 && (
        <Section title="files touched" count={files.length}>
          <ul className="divide-y divide-primary/10">
            {files.map((file) => (
              <li key={file.path} className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                <FilePenIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" title={file.path}>
                  {file.path}
                </span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {file.added > 0 && (
                    <span className="text-emerald-600">+{String(file.added)} </span>
                  )}
                  {file.removed > 0 && (
                    <span className="text-destructive">−{String(file.removed)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
