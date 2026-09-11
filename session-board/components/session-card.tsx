"use client";

import {
  CheckIcon,
  CircleDotIcon,
  CornerDownRightIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  GlobeIcon,
  MessageSquareIcon,
  MoonIcon,
  StarIcon,
  TerminalIcon,
  TriangleAlertIcon,
  ZapIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import type { Card, PullRequest } from "@/lib/card";
import { ago, lastLine, prNumber, repoShort, statusBadge } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A change younger than this replays the flash when the card renders. */
const FLASH_WINDOW_MS = 2_500;
/** Pull request chips shown before folding the rest into "+N more". */
const MAX_PRS = 4;

const ORIGIN_ICONS: Partial<Record<string, typeof GlobeIcon>> = {
  webapp: GlobeIcon,
  web: GlobeIcon,
  api: TerminalIcon,
  slack: MessageSquareIcon,
  teams: MessageSquareIcon,
  github: GitBranchIcon,
};

export function SessionCard({ card, now }: { card: Card; now: number }) {
  const badge = statusBadge(card);
  const Origin = ORIGIN_ICONS[card.origin ?? ""] ?? CircleDotIcon;
  const working = card.column === "working";
  const doing = working ? [card.activity, card.tool].filter((s) => s !== undefined) : [];
  // On a needs-you card the ask may already be Devin's last line; don't say it twice.
  const lastSaid = card.column === "done" ? undefined : lastLine(card.lastMessage);
  const said = lastSaid === card.next ? undefined : lastSaid;
  const prs = [...card.pullRequests].sort((a, b) => prRank(a) - prRank(b));
  const hiddenPrs = prs.splice(MAX_PRS);
  // Done sessions are asleep as a rule; it is only news while something is expected of them.
  const asleep = card.asleep && card.column !== "done";

  return (
    <article
      // Remount on change so the flash animation replays.
      key={card.changedAt}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-md border border-primary/18 bg-background p-2.5 shadow-sm transition-colors hover:border-primary/45",
        card.column === "needs-you" && "border-l-2 border-l-needs",
        Date.now() - card.changedAt < FLASH_WINDOW_MS && "animate-flash",
      )}
    >
      <div className="flex items-start gap-2">
        <Dot card={card} />
        <h3
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-snug line-clamp-2",
            card.unread ? "font-semibold" : "font-medium",
          )}
        >
          {card.url === undefined ? (
            card.title
          ) : (
            <a
              href={card.url}
              target="_blank"
              rel="noreferrer"
              // Stretched link: the whole card opens the session; PR chips sit above it.
              className="after:absolute after:inset-0 after:content-[''] focus-visible:underline focus-visible:outline-none"
            >
              {card.title}
            </a>
          )}
        </h3>
        <time
          dateTime={card.updatedAt}
          className="shrink-0 pt-px font-mono text-[10px] tabular-nums text-muted-foreground"
        >
          {ago(now, card.updatedAt)}
        </time>
      </div>

      <Meta>
        <span className="inline-flex items-center gap-1">
          <Origin className="size-3" />
          {card.origin ?? "session"}
        </span>
        {card.repos.length > 0 && (
          <span className="truncate" title={card.repos.join(", ")}>
            {repoShort(card.repos[0])}
            {card.repos.length > 1 && ` +${String(card.repos.length - 1)}`}
          </span>
        )}
        {card.acu !== undefined && <span>{card.acu.toFixed(1)} ACU</span>}
      </Meta>

      {card.next !== undefined && (
        <p
          className={cn(
            "flex items-start gap-1.5 pl-[18px] text-xs font-medium",
            card.column === "done" ? "text-destructive" : "text-needs-foreground",
          )}
        >
          <CornerDownRightIcon className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 line-clamp-2">{card.next}</span>
        </p>
      )}

      {doing.length > 0 && (
        <p className="truncate pl-[18px] font-mono text-[10.5px] text-muted-foreground">
          {doing.join(" · ")}
          {card.typing && <span className="text-foreground/70"> · typing…</span>}
        </p>
      )}

      {said !== undefined && (
        <blockquote className="pl-[18px] text-xs leading-snug text-muted-foreground line-clamp-2">
          <span className="border-l-2 border-primary/18 pl-2 italic">{said}</span>
        </blockquote>
      )}

      {prs.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1 pl-[18px]">
          {prs.map((pr) => (
            <li key={pr.url}>
              <PrChip pr={pr} />
            </li>
          ))}
          {hiddenPrs.length > 0 && (
            <li
              className="font-mono text-[10px] text-muted-foreground"
              title={hiddenPrs.map((pr) => `#${prNumber(pr.url)} ${pr.state}`).join("\n")}
            >
              +{String(hiddenPrs.length)} more
            </li>
          )}
        </ul>
      )}

      {(badge !== undefined ||
        asleep ||
        card.starred ||
        card.automation ||
        card.error !== undefined) && (
        <Meta>
          {badge !== undefined && (
            <Tag className={badge.tone === "danger" ? "text-destructive" : undefined}>
              {badge.tone === "danger" && <TriangleAlertIcon className="size-3" />}
              {badge.label}
            </Tag>
          )}
          {asleep && (
            <Tag>
              <MoonIcon className="size-3" />
              asleep
            </Tag>
          )}
          {card.starred && (
            <Tag>
              <StarIcon className="size-3" />
              starred
            </Tag>
          )}
          {card.automation && (
            <Tag>
              <ZapIcon className="size-3" />
              automation
            </Tag>
          )}
          {card.error !== undefined && (
            <Tag className="text-destructive" title={card.error}>
              <TriangleAlertIcon className="size-3" />
              not live
            </Tag>
          )}
        </Meta>
      )}
    </article>
  );
}

/** The column's colour, breathing while Devin is actually doing something. */
function Dot({ card }: { card: Card }) {
  const tone = { "needs-you": "bg-needs", working: "bg-working", done: "bg-done" }[card.column];
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center pt-px" aria-hidden>
      <span
        className={cn(
          "size-2 rounded-full",
          tone,
          card.column === "working" && !card.asleep && "animate-breathe",
          card.asleep && "opacity-40",
        )}
      />
    </span>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-[18px] font-mono text-[10px] text-muted-foreground">
      {children}
    </div>
  );
}

function Tag({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} title={title}>
      {children}
    </span>
  );
}

function PrChip({ pr }: { pr: PullRequest }) {
  const Icon =
    pr.state === "merged"
      ? GitMergeIcon
      : pr.state === "closed"
        ? GitPullRequestClosedIcon
        : pr.draft
          ? GitPullRequestDraftIcon
          : GitPullRequestIcon;
  const label = pr.state === "open" && pr.draft ? "draft" : pr.state;
  const review =
    pr.state !== "open"
      ? undefined
      : pr.reviewDecision === "CHANGES_REQUESTED"
        ? "changes requested"
        : pr.reviewDecision === "REVIEW_REQUIRED"
          ? "review required"
          : undefined;
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      title={pr.title ?? pr.url}
      className={cn(
        "relative z-10 inline-flex items-center gap-1 rounded-sm border border-primary/18 bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-secondary-foreground hover:border-primary/45 hover:text-foreground",
        pr.state !== "open" && "opacity-70 hover:opacity-100",
      )}
    >
      <Icon className="size-3" />#{prNumber(pr.url)}
      <span className="opacity-70">{label}</span>
      {pr.state === "open" && pr.reviewDecision === "APPROVED" && (
        <CheckIcon className="size-3" aria-label="approved" />
      )}
      {review !== undefined && <span className="opacity-70">· {review}</span>}
      {pr.additions !== undefined && pr.deletions !== undefined && (
        <span className="opacity-70 tabular-nums">
          +{String(pr.additions)} −{String(pr.deletions)}
        </span>
      )}
      {pr.changed && (
        <span
          className="size-1.5 rounded-full bg-foreground"
          title="Changed since the last refresh"
        />
      )}
    </a>
  );
}

/** What deserves a chip first: anything still open, then whatever just changed. */
function prRank(pr: PullRequest): number {
  if (pr.changed) return 0;
  if (pr.state === "open") return pr.draft ? 2 : 1;
  return pr.state === "merged" ? 3 : 4;
}
