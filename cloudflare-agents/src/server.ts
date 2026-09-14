/**
 * Devin on Cloudflare Agents.
 *
 *     Workspace (demo)                  ◄── top-level Durable Object
 *       ├─ DevinChat (chat-abc) [facet] ◄── one per chat, owns one Devin session
 *       └─ DevinChat (chat-def) [facet]
 *
 * - `Workspace` is the sidebar: it creates, imports and deletes chats, and
 *   only lets clients reach chats it created (`onBeforeSubAgent`).
 * - `DevinChat` is a `DevinChatAgent` from `@cognition-ai/cloudflare-agents`:
 *   an `AIChatAgent` whose turns prompt a Devin cloud session, so
 *   `useAgentChat` works unchanged. It adds the sidebar bookkeeping, a live
 *   view of the session between turns, and permission answers.
 *
 * A real app would authenticate the user and use their id instead of `demo`.
 */
import { connectDevin, DevinChatAgent, parseSessionId } from "@cognition-ai/cloudflare-agents";
import { DevinError, type SessionInfo } from "@cognition-ai/sdk";
import { Agent, callable, routeAgentRequest } from "agents";
import type { UIMessage } from "ai";

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  preview: string | null;
  devinUrl: string | null;
  /** Completed turns. */
  turns: number;
}

export interface WorkspaceState {
  chats: ChatSummary[];
  /** Whether `DEVIN_API_KEY` is configured, so the UI can say so up front. */
  configured: boolean;
}

/** A cloud session the user can continue in a new chat. */
export interface RecentSession {
  id: string;
  title: string;
  status: string | null;
  url: string | null;
  updatedAt: string | null;
}

/** A pull request the session opened, as the cloud reports it between turns. */
export interface SessionPullRequest {
  url: string;
  state: string;
  draft: boolean;
  title: string | null;
  reviewDecision: string | null;
  additions: number | null;
  deletions: number | null;
}

/**
 * What the cloud knows about the chat's session right now. Turns stream
 * their own events; this is how the UI stays current in between, when Devin
 * keeps working, goes to sleep or waits for the user.
 */
export interface SessionSnapshot {
  id: string;
  title: string | null;
  url: string | null;
  status: string | null;
  /** The one thing the user has to do, when the cloud names it. */
  userActionRequired: string | null;
  activity: string | null;
  /** `awake` or `suspended`. */
  runtime: string | null;
  finishedOutcome: string | null;
  statusReason: string | null;
  acu: number | null;
  repos: string[];
  pullRequests: SessionPullRequest[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** `createChat` input. Callable arguments come from the client, so fields are checked at runtime. */
interface CreateChatOptions {
  title?: unknown;
  sessionId?: unknown;
}

const DEFAULT_TITLE = "New chat";
const TITLE_MAX = 80;

export class Workspace extends Agent<Env, WorkspaceState> {
  initialState: WorkspaceState = { chats: [], configured: false };

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS chat_meta (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      preview TEXT,
      devin_url TEXT,
      turns INTEGER NOT NULL DEFAULT 0
    )`;
    // Workspaces created before `turns` existed.
    const columns = this.sql<{ name: string }>`PRAGMA table_info(chat_meta)`;
    if (!columns.some((column) => column.name === "turns")) {
      this.sql`ALTER TABLE chat_meta ADD COLUMN turns INTEGER NOT NULL DEFAULT 0`;
    }
    this.#refresh();
  }

  /**
   * Only route to chats this workspace created, so a URL can't conjure up a new facet.
   * `chat_meta` is the registry: a socket that outlives `deleteChat` can re-register
   * the facet with the framework, but it can't bring the chat back.
   */
  override onBeforeSubAgent(
    _request: Request,
    { className, name }: { className: string; name: string },
  ): Promise<Response | undefined> {
    if (className === DevinChat.name && this.#hasChat(name)) return Promise.resolve(undefined);
    return Promise.resolve(new Response(`${className} "${name}" not found`, { status: 404 }));
  }

  /** Start a chat. Pass `sessionId` (an id or app URL) to continue an existing Devin session. */
  @callable()
  async createChat(options: CreateChatOptions | null = {}): Promise<ChatSummary> {
    if (typeof options !== "object" || options === null) {
      throw new DevinError("createChat expects an options object.");
    }
    const { title: rawTitle, sessionId: rawSessionId } = options;
    if (rawTitle !== undefined && typeof rawTitle !== "string") {
      throw new DevinError("title must be a string.");
    }
    const sessionId = rawSessionId === undefined ? null : parseSessionId(rawSessionId);
    const id = crypto.randomUUID();
    const now = Date.now();
    let title = clipTitle(rawTitle ?? "");
    if (title === "") title = DEFAULT_TITLE;
    let devinUrl: string | null = null;

    const chat = await this.subAgent(DevinChat, id);
    if (sessionId !== null) {
      try {
        const imported = await chat.importSession(sessionId);
        if (title === DEFAULT_TITLE && imported.title) title = clipTitle(imported.title);
        devinUrl = imported.sessionUrl;
      } catch (error) {
        // A session that can't be loaded leaves no chat behind.
        await this.deleteSubAgent(DevinChat, id);
        throw error;
      }
    }
    this.sql`INSERT INTO chat_meta (id, title, created_at, updated_at, devin_url)
      VALUES (${id}, ${title}, ${now}, ${now}, ${devinUrl})`;
    this.#refresh();
    return { id, title, createdAt: now, updatedAt: now, preview: null, devinUrl, turns: 0 };
  }

  /** Delete a chat. The Devin session itself keeps running in the cloud. */
  @callable()
  async deleteChat(id: unknown): Promise<void> {
    if (typeof id !== "string" || !this.#hasChat(id)) {
      throw new DevinError("Unknown chat.");
    }
    this.sql`DELETE FROM chat_meta WHERE id = ${id}`;
    await this.deleteSubAgent(DevinChat, id);
    this.#refresh();
  }

  /** The user's most recent cloud sessions, for "continue a session". */
  @callable()
  async recentSessions(): Promise<RecentSession[]> {
    await using devin = await connectDevin(this.env);
    const sessions = await devin.listSessions();
    return sessions.slice(0, 20).map((info) => {
      const meta = info._meta ?? {};
      return {
        id: info.sessionId,
        title: info.title ?? info.sessionId,
        status: text(meta["cognition.ai/statusEnum"]),
        url: text(meta["cognition.ai/url"]),
        updatedAt: info.updatedAt ?? null,
      };
    });
  }

  /** Called by a chat after each turn to update its sidebar entry. */
  recordTurn(id: string, turn: { title: string; preview: string; devinUrl: string | null }): void {
    this.sql`
      UPDATE chat_meta SET
        title = CASE WHEN title = ${DEFAULT_TITLE} THEN ${turn.title} ELSE title END,
        updated_at = ${Date.now()},
        preview = ${turn.preview},
        devin_url = COALESCE(${turn.devinUrl}, devin_url),
        turns = turns + 1
      WHERE id = ${id}
    `;
    this.#refresh();
  }

  /** Called by a chat when the cloud reports a title for its session. */
  recordTitle(id: string, title: string): void {
    const clipped = clipTitle(title);
    if (clipped === "") return;
    const changed = this.sql<{ id: string }>`UPDATE chat_meta SET title = ${clipped}
      WHERE id = ${id} AND title <> ${clipped} RETURNING id`;
    if (changed.length > 0) this.#refresh();
  }

  #hasChat(id: string): boolean {
    return this.sql<{ id: string }>`SELECT id FROM chat_meta WHERE id = ${id}`.length > 0;
  }

  #refresh() {
    const chats = this.sql<{
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      preview: string | null;
      devin_url: string | null;
      turns: number;
    }>`SELECT id, title, created_at, updated_at, preview, devin_url, turns FROM chat_meta
      ORDER BY updated_at DESC`.map((row): ChatSummary => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      preview: row.preview,
      devinUrl: row.devin_url,
      turns: row.turns,
    }));
    this.setState({ chats, configured: Boolean(this.env.DEVIN_API_KEY) });
  }
}

/**
 * One chat. `DevinChatAgent` does the Devin part: session create/attach, one
 * turn per message, stop, `startOver`, `importSession` and recovery. This
 * adds the sidebar bookkeeping, a snapshot of the session for the panel, and
 * answers to the cloud's permission requests.
 */
export class DevinChat extends DevinChatAgent<Env> {
  /** After each turn, update this chat's entry in the sidebar. Best-effort. */
  protected override async onChatResponse(): Promise<void> {
    const last = this.messages.at(-1);
    if (last?.role !== "assistant") return;
    const preview = last.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    try {
      const workspace = await this.parentAgent(Workspace);
      await workspace.recordTurn(this.name, {
        title: clipTitle(lastUserText(this.messages)) || DEFAULT_TITLE,
        preview,
        devinUrl: this.state.sessionUrl,
      });
    } catch (error) {
      console.warn("[DevinChat] failed to update the workspace:", error);
    }
  }

  /**
   * The session as the cloud sees it right now. The client polls this between
   * turns; while a turn streams, its events carry the same information live.
   * Also adopts the title the cloud gave the session.
   */
  @callable()
  async sessionSnapshot(): Promise<SessionSnapshot | null> {
    const id = this.state.sessionId;
    if (id === null) return null;
    await using devin = await connectDevin(this.env);
    const { sessions } = await devin.listSessionsPage({ sessionIds: [id] });
    const info = sessions.find((candidate) => candidate.sessionId === id);
    if (info === undefined) return null;
    const snapshot = toSnapshot(info);
    if (snapshot.title !== null) {
      try {
        const workspace = await this.parentAgent(Workspace);
        await workspace.recordTitle(this.name, snapshot.title);
      } catch (error) {
        console.warn("[DevinChat] failed to record the title:", error);
      }
    }
    return snapshot;
  }

  /**
   * Answer a `permission_request` the session raised. The cloud surfaces
   * these as tool calls in the transcript; the answer goes back through
   * `session.respondToPermission`, and Devin carries on in the cloud.
   */
  @callable()
  async respondToPermission(requestId: unknown, approved: unknown): Promise<void> {
    if (typeof requestId !== "string" || requestId === "" || typeof approved !== "boolean") {
      throw new DevinError("respondToPermission expects a request id and a boolean.");
    }
    const id = this.state.sessionId;
    if (id === null) throw new DevinError("This chat has no Devin session.");
    await using devin = await connectDevin(this.env);
    const session = await devin.attach(id);
    try {
      await session.respondToPermission({ permissionRequestId: requestId, approved });
    } finally {
      devin.releaseSession(session.id);
    }
  }
}

function toSnapshot(info: SessionInfo): SessionSnapshot {
  const meta = info._meta ?? {};
  return {
    id: info.sessionId,
    title: info.title ?? null,
    url: text(meta["cognition.ai/url"]),
    status: text(meta["cognition.ai/statusEnum"]),
    userActionRequired: text(meta["cognition.ai/userActionRequired"]),
    activity: text(meta["cognition.ai/currentActivity"]),
    runtime: text(meta["cognition.ai/sessionStatus"]),
    finishedOutcome: text(meta["cognition.ai/finishedOutcome"]),
    statusReason: text(meta["cognition.ai/statusReason"]),
    acu: typeof meta["cognition.ai/acuUsed"] === "number" ? meta["cognition.ai/acuUsed"] : null,
    repos: (meta["cognition.ai/sessionRepos"] ?? []).map((repo) => repo.name),
    pullRequests: (meta["cognition.ai/sessionPRs"] ?? []).map((pr) => ({
      url: pr.url,
      state: pr.state,
      draft: pr.draft ?? false,
      title: pr.title ?? null,
      reviewDecision: text(pr.reviewDecision),
      additions: pr.additions ?? null,
      deletions: pr.deletions ?? null,
    })),
    createdAt: text(meta["cognition.ai/createdAt"]),
    updatedAt: info.updatedAt ?? null,
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function clipTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (title.length <= TITLE_MAX) return title;
  const cut = title.slice(0, TITLE_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), TITLE_MAX - 20))}…`;
}

function lastUserText(messages: readonly UIMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  }
  return "";
}

export default {
  async fetch(request: Request, env: Env) {
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
