/**
 * The board itself, server-side: one `createDevin()` connection attached to
 * every session in the window, folding `session/list` rows and live
 * `session.events()` into cards and publishing each change to subscribers.
 *
 * No polling of individual sessions: the cloud pushes each status change,
 * message and pull request update, whoever is driving the session (the web
 * app, Slack, another script). `listSessionsPage()` seeds the board and, on a
 * slow interval, picks up sessions created or updated since.
 */
import {
  ConnectionClosedError,
  createDevin,
  FinishedOutcome,
  SessionStatus,
  type CloudDevin,
  type CloudSession,
  type CognitionAcp,
  type SessionEvent,
  type SessionInfo,
  type ToolCall,
} from "@cognition-ai/sdk";

import type { BoardEvent, Card, PendingRequest, PullRequest } from "./card";
import { firstLine, lastLine } from "./format";

const DISCOVERY_INTERVAL_MS = 30_000;
/** Re-list a little further back than the last scan so nothing falls between scans. */
const SCAN_OVERLAP_MS = 60_000;
const RECONNECT_DELAY_MS = 2_000;
/** Concurrent `attach()` calls while catching up on a fresh scan. */
const ATTACH_CONCURRENCY = 8;
/** Streaming deltas arrive per token; publish each card at most this often. */
const PUBLISH_INTERVAL_MS = 200;

type Listener = (event: BoardEvent) => void;
type Meta = NonNullable<SessionInfo["_meta"]>;

/** What the live stream knows about a card that the wire model does not need. */
interface Live {
  /**
   * Main-chain message text by streaming `messageId`, in the order the
   * messages started — the SDK's `TextAccumulator`, so late chunks for an
   * earlier message land on it instead of displacing a newer one. Cleared on
   * every user message, so it holds one reply's worth of messages.
   */
  messages: Map<string, string>;
  /** Key of the last message a chunk arrived for; id-less chunks continue it. */
  lastMessageId: string | undefined;
  /** When a `pull_request` / `lifecycle` event last touched the card; scans defer to newer ones. */
  pullRequestsAt: number;
  lifecycleAt: number;
}

export class Board {
  readonly cards = new Map<string, Card>();
  connected = false;
  /** What the board wants the user to know about itself: a failed scan, a reconnect. */
  note: string | undefined;

  #client: Promise<CloudDevin> | undefined;
  #current: CloudDevin | undefined;
  /** Sessions with a running watcher on the current connection. */
  readonly #attached = new Set<string>();
  readonly #live = new Map<string, Live>();
  readonly #listeners = new Set<Listener>();
  readonly #dirty = new Set<string>();
  #publish: ReturnType<typeof setTimeout> | undefined;
  #interval: ReturnType<typeof setInterval> | undefined;
  #reconnect: ReturnType<typeof setTimeout> | undefined;
  #windowMs = 0;
  #lastScan: number | undefined;
  #scan: Promise<void> = Promise.resolve();

  /** Receive the current board, then every change. Returns the unsubscribe. */
  subscribe(listener: Listener, windowMs: number): () => void {
    this.#listeners.add(listener);
    listener({
      type: "snapshot",
      cards: [...this.cards.values()],
      connected: this.connected,
      note: this.note,
    });
    this.widen(windowMs);
    if (this.#interval === undefined) {
      this.#interval = setInterval(() => {
        this.discover();
      }, DISCOVERY_INTERVAL_MS);
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Make sure every session updated within `windowMs` is on the board. */
  widen(windowMs: number): void {
    if (windowMs <= this.#windowMs) return;
    this.#windowMs = windowMs;
    this.discover(Date.now() - windowMs);
  }

  /** Queue a scan for sessions updated since `since` (default: since the last scan). */
  discover(since = (this.#lastScan ?? Date.now() - this.#windowMs) - SCAN_OVERLAP_MS): void {
    this.#scan = this.#scan
      .then(() => this.#discover(since))
      .catch((error: unknown) => {
        this.#note(`Discovery failed: ${describe(error)}`);
      });
  }

  /**
   * Seed cards from every updated session page and attach to new ones. Scans
   * also refresh what live events only invalidate (pull requests) or never
   * carry (unread, starred, ACU).
   */
  async #discover(since: number): Promise<void> {
    const devin = await this.#connect();
    const scanStarted = Date.now();
    const sessions: SessionInfo[] = [];
    try {
      let cursor: string | undefined;
      do {
        const page = await devin.listSessionsPage({
          updatedAfter: new Date(since).toISOString(),
          ...(cursor === undefined ? {} : { cursor }),
        });
        sessions.push(...page.sessions);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
    } catch (error) {
      if (this.#lost(devin, error)) return;
      throw error;
    }
    this.#lastScan = Math.max(this.#lastScan ?? 0, scanStarted);
    for (const info of sessions) {
      const card = this.cards.get(info.sessionId);
      if (card === undefined) {
        this.cards.set(info.sessionId, seed(info, scanStarted));
        this.#touch(info.sessionId);
      } else if (refresh(card, info, scanStarted, this.#state(info.sessionId))) {
        this.#touch(info.sessionId);
      }
    }
    if (this.note !== undefined) this.#note(undefined);
    await this.#attachAll(devin);
  }

  #state(id: string): Live {
    let live = this.#live.get(id);
    if (live === undefined) {
      live = { messages: new Map(), lastMessageId: undefined, pullRequestsAt: 0, lifecycleAt: 0 };
      this.#live.set(id, live);
    }
    return live;
  }

  #connect(): Promise<CloudDevin> {
    this.#client ??= createDevin().then(
      (devin) => {
        this.#current = devin;
        this.connected = true;
        this.#note(undefined);
        return devin;
      },
      (error: unknown) => {
        this.#client = undefined;
        throw error;
      },
    );
    return this.#client;
  }

  async #attachAll(devin: CloudDevin): Promise<void> {
    const queue = [...this.cards.keys()].filter((id) => !this.#attached.has(id));
    const workers = Array.from({ length: Math.min(ATTACH_CONCURRENCY, queue.length) }, async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        await this.#attach(devin, id);
      }
    });
    await Promise.all(workers);
  }

  async #attach(devin: CloudDevin, id: string): Promise<void> {
    const card = this.cards.get(id);
    if (card === undefined || this.#current !== devin) return;
    try {
      // Observers leave `onPermission` unset. The cloud only sends live
      // permission prompts to clients that opt in (`cognition.ai/permissionPrompts`),
      // which the SDK does not; a request reaches the board as a
      // `permission_request` tool call, which it displays and never answers.
      const session = await devin.attach(id);
      // Replaced while attaching: the new connection attaches everything itself.
      if (this.#current !== devin) return;
      this.#attached.add(id);
      card.url ??= session.url;
      if (card.error !== undefined) {
        card.error = undefined;
        this.#touch(id);
      }
      void this.#watch(devin, session, card);
    } catch (error) {
      if (this.#lost(devin, error)) return;
      // Not recorded as attached, so the next scan tries again.
      card.error = `Could not attach: ${describe(error)}`;
      this.#touch(id);
    }
  }

  async #watch(devin: CloudDevin, session: CloudSession, card: Card): Promise<void> {
    const live = this.#state(card.id);
    try {
      for await (const event of session.events()) {
        if (apply(card, live, event)) this.#touch(card.id);
      }
    } catch (error) {
      if (this.#lost(devin, error)) return;
      card.error = `Disconnected: ${describe(error)}`;
      this.#touch(card.id);
    } finally {
      // Only the connection that owns this watcher may forget it; a stale one
      // must not undo the re-attach the replacement connection made.
      if (this.#current === devin) this.#attached.delete(card.id);
    }
  }

  /**
   * The connection dropped: every watcher fails at once with
   * `ConnectionClosedError`. Forget the client so the next scan reconnects
   * and re-attaches everything, and report it once. A late error from an
   * already-replaced connection changes nothing.
   */
  #lost(devin: CloudDevin, error: unknown): boolean {
    if (!(error instanceof ConnectionClosedError)) return false;
    if (this.#current === devin) {
      this.#current = undefined;
      this.#client = undefined;
      this.#attached.clear();
      this.connected = false;
      this.#note("Connection lost, reconnecting");
      if (this.#reconnect === undefined) {
        this.#reconnect = setTimeout(() => {
          this.#reconnect = undefined;
          this.discover();
        }, RECONNECT_DELAY_MS);
      }
    }
    return true;
  }

  #note(message: string | undefined): void {
    this.note = message;
    this.#emit({ type: "connection", connected: this.connected, note: message });
  }

  #touch(id: string): void {
    const card = this.cards.get(id);
    if (card === undefined) return;
    card.changedAt = Date.now();
    this.#dirty.add(id);
    if (this.#publish !== undefined) return;
    this.#publish = setTimeout(() => {
      this.#publish = undefined;
      const ids = [...this.#dirty];
      this.#dirty.clear();
      for (const dirty of ids) {
        const changed = this.cards.get(dirty);
        if (changed !== undefined) this.#emit({ type: "card", card: changed });
      }
    }, PUBLISH_INTERVAL_MS);
  }

  #emit(event: BoardEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

/**
 * One board per server process. Kept on `globalThis` so the connection
 * survives Next.js re-evaluating this module in development.
 */
const shared = globalThis as typeof globalThis & { __sessionBoard?: Board };

export function board(): Board {
  shared.__sessionBoard ??= new Board();
  return shared.__sessionBoard;
}

function seed(info: SessionInfo, scanStarted: number): Card {
  const meta: Meta = info._meta ?? {};
  const prompt = promptLine(meta);
  const card: Card = {
    id: info.sessionId,
    title: info.title ?? prompt ?? info.sessionId,
    url: undefined,
    column: "working",
    status: undefined,
    asleep: false,
    outcome: undefined,
    reason: undefined,
    next: undefined,
    pending: undefined,
    activity: undefined,
    tool: undefined,
    typing: false,
    lastMessage: undefined,
    prompt,
    origin: text(meta["cognition.ai/sessionOrigin"]),
    repos: [],
    tags: [],
    unread: false,
    starred: false,
    automation: false,
    acu: undefined,
    createdAt: text(meta["cognition.ai/createdAt"]),
    updatedAt: info.updatedAt ?? new Date(0).toISOString(),
    pullRequests: [],
    error: undefined,
    changedAt: Date.now(),
  };
  refresh(card, info, scanStarted);
  return card;
}

/**
 * Fold a `session/list` row into a card. The row is a snapshot from when the
 * scan began, so where the live stream also writes, the newer source wins:
 * status is taken from the row only when the row is at least as new as the
 * card's last live update, and pull requests / sleep state only when no live
 * event has touched them since the scan started. A scan thus never undoes a
 * transition the stream already showed, but does repair one the board missed
 * while it was disconnected.
 */
function refresh(
  card: Card,
  info: SessionInfo,
  scanStarted: number,
  live: Pick<Live, "pullRequestsAt" | "lifecycleAt"> = { pullRequestsAt: 0, lifecycleAt: 0 },
): boolean {
  const meta: Meta = info._meta ?? {};
  let changed = false;
  const set = <K extends keyof Card>(key: K, value: Card[K]): void => {
    if (same(card[key], value)) return;
    card[key] = value;
    changed = true;
  };
  set("title", info.title ?? card.title);
  set("url", text(meta["cognition.ai/url"]) ?? card.url);
  set(
    "repos",
    (meta["cognition.ai/sessionRepos"] ?? []).map((repo) => repo.name),
  );
  set("tags", meta["cognition.ai/sessionTags"] ?? []);
  set("unread", meta["cognition.ai/isUnread"] ?? false);
  set("starred", meta["cognition.ai/isStarred"] ?? false);
  set(
    "automation",
    (meta["cognition.ai/isAutomation"] ?? false) || meta["cognition.ai/automationId"] != null,
  );
  set("acu", meta["cognition.ai/acuUsed"] ?? card.acu);
  if (live.lifecycleAt <= scanStarted) {
    set("asleep", meta["cognition.ai/sessionStatus"] === "suspended");
  }
  if (live.pullRequestsAt <= scanStarted) {
    set("pullRequests", (meta["cognition.ai/sessionPRs"] ?? []).map(pullRequest));
  }

  const rowTime = info.updatedAt === undefined ? 0 : Date.parse(info.updatedAt);
  if (rowTime >= Date.parse(card.updatedAt)) {
    const before = { column: card.column, next: card.next, status: card.status };
    set("updatedAt", info.updatedAt ?? card.updatedAt);
    set("reason", text(meta["cognition.ai/statusReason"]));
    // Rows name only coarse activities (`waiting_for_ci`); keep the live one otherwise.
    const activity = humanize(meta["cognition.ai/currentActivity"]);
    if (activity !== undefined) set("activity", activity);
    set("pending", pendingRequest(meta["cognition.ai/pendingRequest"]));
    const outcome = text(meta["cognition.ai/finishedOutcome"]);
    if (outcome !== undefined) set("outcome", outcome);
    place(card, text(meta["cognition.ai/statusEnum"]), meta["cognition.ai/userActionRequired"]);
    changed ||=
      before.column !== card.column || before.next !== card.next || before.status !== card.status;
  }
  return changed;
}

function apply(card: Card, live: Live, event: SessionEvent): boolean {
  switch (event.type) {
    case "status":
      card.reason = event.reason;
      if (event.finishedOutcome !== undefined) card.outcome = event.finishedOutcome;
      place(card, event.status, event.userActionRequired);
      if (event.message !== undefined) card.activity = event.message;
      break;
    case "lifecycle":
      live.lifecycleAt = Date.now();
      card.asleep = event.lifecycle === "suspended";
      if (event.finishedOutcome !== undefined) card.outcome = event.finishedOutcome;
      if (event.status !== undefined) place(card, event.status, undefined);
      break;
    case "activity":
      card.activity = humanize(event.activity);
      break;
    case "typing":
      card.typing = event.typing;
      break;
    case "tool_call":
      toolCall(card, event.call, event.settled);
      break;
    case "message_delta": {
      if (event.chain !== "main") return false;
      const key = event.messageId ?? live.lastMessageId ?? "";
      live.lastMessageId = key;
      if (event.aborted) {
        live.messages.delete(key);
      } else if (event.overwrite) {
        live.messages.set(key, event.text);
      } else {
        live.messages.set(key, (live.messages.get(key) ?? "") + event.text);
      }
      card.lastMessage = lastMessage(live);
      break;
    }
    case "user_message":
      // Someone replied from elsewhere; Devin's last question is no longer the ask.
      card.lastMessage = undefined;
      card.pending = undefined;
      live.messages.clear();
      live.lastMessageId = undefined;
      break;
    case "pull_request": {
      // An invalidation, not the new state: the next scan tells whether it is
      // open, merged or closed.
      live.pullRequestsAt = Date.now();
      const pr = card.pullRequests.find((candidate) => candidate.url === event.prUrl);
      if (pr === undefined) {
        card.pullRequests.push({
          url: event.prUrl,
          state: "open",
          draft: false,
          title: undefined,
          reviewDecision: undefined,
          additions: undefined,
          deletions: undefined,
          changed: true,
        });
      } else {
        pr.changed = true;
      }
      break;
    }
    default:
      return false;
  }
  card.updatedAt = new Date().toISOString();
  return true;
}

function toolCall(card: Card, call: ToolCall, settled: boolean): void {
  if (call.detail.tool === "permission_request") {
    card.pending = settled
      ? undefined
      : { kind: "permission", permissionType: call.detail.permissionType, toolName: undefined };
    if (card.column === "needs-you") card.next = pendingLabel(card.pending) ?? card.next;
    return;
  }
  card.tool = call.title ?? humanize(call.detail.tool);
}

function place(
  card: Card,
  status: string | undefined,
  userActionRequired: string | null | undefined,
): void {
  card.status = status;
  switch (status) {
    case SessionStatus.Blocked:
    case SessionStatus.Paused:
    case "waiting":
      card.column = "needs-you";
      // Blocked with no action named means Devin finished its turn and is
      // simply waiting for whatever you say next: the last thing it said is the ask.
      card.next =
        pendingLabel(card.pending) ??
        text(userActionRequired) ??
        lastLine(card.lastMessage) ??
        "Reply in the session";
      break;
    case SessionStatus.Finished:
    case SessionStatus.Stopped:
      card.column = "done";
      card.next =
        card.outcome === FinishedOutcome.Crashed ? "Crashed: check the session" : undefined;
      break;
    default:
      card.column = "working";
      card.next = undefined;
  }
}

/** The newest message with any text, by the order messages started. */
function lastMessage(live: Live): string | undefined {
  let last: string | undefined;
  for (const text of live.messages.values()) if (text !== "") last = text;
  return last;
}

function pendingLabel(pending: PendingRequest | undefined): string | undefined {
  if (pending === undefined) return undefined;
  if (pending.kind === "network") return "Network access requested";
  switch (pending.permissionType) {
    case "deploy":
      return "Approve deployment";
    case "command":
      return "Approve a command";
    default:
      return pending.toolName?.includes("session") ? "Approve a session" : "Approval required";
  }
}

function pendingRequest(
  value: CognitionAcp.SessionPendingRequest | null | undefined,
): PendingRequest | undefined {
  return value == null
    ? undefined
    : {
        kind: value.kind,
        permissionType: text(value.permissionType),
        toolName: text(value.toolName),
      };
}

function pullRequest(pr: CognitionAcp.SessionPr): PullRequest {
  return {
    url: pr.url,
    state: pr.state,
    draft: pr.draft ?? false,
    title: text(pr.title),
    reviewDecision: text(pr.reviewDecision),
    additions: pr.additions ?? undefined,
    deletions: pr.deletions ?? undefined,
    changed: false,
  };
}

function promptLine(meta: Meta): string | undefined {
  const contents = meta["cognition.ai/initialUserMessageContents"];
  if (typeof contents !== "object" || contents === null || !("message" in contents))
    return undefined;
  const { message } = contents;
  return typeof message === "string" ? firstLine(message) : undefined;
}

function humanize(value: string | null | undefined): string | undefined {
  return value == null ? undefined : value.replaceAll("_", " ");
}

function text(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function same(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || (typeof a === "object" && JSON.stringify(a) === JSON.stringify(b));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
