/**
 * The board's wire model: what the server keeps per session and what the
 * browser renders. Shared by both sides, so nothing here imports the SDK.
 */

export type Column = "needs-you" | "working" | "done";

export const COLUMNS: readonly Column[] = ["needs-you", "working", "done"];

export const COLUMN_LABELS: Record<Column, string> = {
  "needs-you": "Needs you",
  working: "Working",
  done: "Done",
};

export interface PullRequest {
  url: string;
  /** `open`, `merged` or `closed`. */
  state: string;
  draft: boolean;
  title: string | undefined;
  /** GitHub review decision, e.g. `APPROVED`, `CHANGES_REQUESTED`. */
  reviewDecision: string | undefined;
  additions: number | undefined;
  deletions: number | undefined;
  /** A `pull_request` event arrived since the last scan; `state` may be stale. */
  changed: boolean;
}

/** An unresolved permission or network-access request Devin is waiting on. */
export interface PendingRequest {
  kind: string;
  permissionType: string | undefined;
  toolName: string | undefined;
}

export interface Card {
  id: string;
  title: string;
  /** The session in the Devin web app. */
  url: string | undefined;
  column: Column;
  /** Raw cloud status (`working`, `blocked`, `finished`, …). */
  status: string | undefined;
  /** The machine is suspended; the session can still be woken by a message. */
  asleep: boolean;
  /** How a finished session ended (`completed`, `crashed`, `stopped`, …). */
  outcome: string | undefined;
  /** Structured reason behind the status, e.g. `error` or a quota reason. */
  reason: string | undefined;
  /** The one thing you have to do — only when there is one. */
  next: string | undefined;
  pending: PendingRequest | undefined;
  /** What Devin is doing right now, e.g. "executing actions". */
  activity: string | undefined;
  /** The latest tool call, e.g. `$ bun test`. */
  tool: string | undefined;
  typing: boolean;
  /** The last thing Devin said on the main chain. */
  lastMessage: string | undefined;
  /** First line of the prompt that started the session. */
  prompt: string | undefined;
  /** Where the session was started: `webapp`, `api`, `slack`, `github`, … */
  origin: string | undefined;
  repos: string[];
  tags: string[];
  unread: boolean;
  starred: boolean;
  automation: boolean;
  /** Agent Compute Units consumed so far, when the cloud reports them. */
  acu: number | undefined;
  createdAt: string | undefined;
  /** ISO time of the last change we know about; live events refresh it. */
  updatedAt: string;
  pullRequests: PullRequest[];
  /** Why the board cannot follow this session live, when it cannot. */
  error: string | undefined;
  /** When the card last changed, for the flash animation. */
  changedAt: number;
}

export type BoardEvent =
  | { type: "snapshot"; cards: Card[]; connected: boolean; note: string | undefined }
  | { type: "card"; card: Card }
  | { type: "connection"; connected: boolean; note: string | undefined };

export type Window = "6h" | "24h" | "7d";

export const WINDOWS: readonly Window[] = ["6h", "24h", "7d"];

export const WINDOW_MS: Record<Window, number> = {
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function isWindow(value: string | null): value is Window {
  return (WINDOWS as readonly string[]).includes(value ?? "");
}
