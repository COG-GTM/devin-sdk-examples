import type { HarnessAgentResumeSessionState, HarnessAgentSession } from "@ai-sdk/harness/agent";
import { Redis } from "@upstash/redis";
import type { UIMessage } from "ai";

/**
 * Everything the app remembers about a chat lives in Redis, so any server
 * instance can pick any chat up:
 *
 * - the harness resume state (`session.detach()` payload: Devin session id +
 *   parked bridge coordinates), keyed by chat id — which doubles as the
 *   harness `sessionId`, and therefore names the chat's sandbox;
 * - a small metadata record per chat for the sessions list.
 *
 * Redis comes from the Upstash integration on Vercel (`KV_REST_API_*`), or
 * `UPSTASH_REDIS_REST_*`; `vercel env pull` brings the same variables locally.
 */
const redis = Redis.fromEnv();
const TTL_SECONDS = 7 * 24 * 60 * 60;

const resumeKey = (chatId: string) => `harness-chat:resume:${chatId}`;
const metaKey = (chatId: string) => `harness-chat:session:${chatId}`;
const messagesKey = (chatId: string) => `harness-chat:messages:${chatId}`;
const INDEX_KEY = "harness-chat:sessions";

export interface SessionMeta {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  turns: number;
  /** A turn is streaming right now (set on the list view only). */
  active?: boolean;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const ids = await redis.zrange<string[]>(INDEX_KEY, 0, -1, { rev: true });
  if (ids.length === 0) return [];
  const [metas, active] = await Promise.all([
    Promise.all(ids.map((id) => redis.get<SessionMeta>(metaKey(id)))),
    activeChatIds(ids),
  ]);
  return metas
    .filter((m): m is SessionMeta => m !== null)
    .map((m) => ({ ...m, active: active.has(m.id) }));
}

export async function getSession(chatId: string): Promise<SessionMeta | null> {
  return redis.get<SessionMeta>(metaKey(chatId));
}

/** Create the record for a chat, or bump it after a turn (with the first prompt as its title). */
export async function touchSession(
  chatId: string,
  update: { title?: string; turn?: boolean } = {},
): Promise<SessionMeta> {
  const now = Date.now();
  const existing = await getSession(chatId);
  const meta: SessionMeta = {
    id: chatId,
    title: existing?.title ?? update.title?.trim().slice(0, 80) ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    turns: (existing?.turns ?? 0) + (update.turn ? 1 : 0),
  };
  await Promise.all([
    redis.set(metaKey(chatId), meta, { ex: TTL_SECONDS }),
    redis.zadd(INDEX_KEY, { score: now, member: chatId }),
  ]);
  return meta;
}

export async function forgetSession(chatId: string): Promise<void> {
  await Promise.all([
    redis.del(metaKey(chatId), resumeKey(chatId), messagesKey(chatId), streamKey(chatId)),
    redis.zrem(INDEX_KEY, chatId),
  ]);
}

/**
 * The UI transcript, so switching back to a chat shows what happened. The
 * harness keeps the real conversation history inside its own session; this
 * is only what the browser rendered.
 */
export async function loadMessages<M extends UIMessage>(chatId: string): Promise<M[]> {
  return (await redis.get<M[]>(messagesKey(chatId))) ?? [];
}

export async function saveMessages(chatId: string, messages: UIMessage[]): Promise<void> {
  await redis.set(messagesKey(chatId), messages, { ex: TTL_SECONDS });
}

interface SessionFactory {
  createSession(options?: {
    sessionId?: string;
    resumeFrom?: HarnessAgentResumeSessionState;
  }): Promise<HarnessAgentSession>;
}

export async function resumeOrCreateSession(
  agent: SessionFactory,
  chatId: string,
): Promise<HarnessAgentSession> {
  const resumeFrom = await redis.get<HarnessAgentResumeSessionState>(resumeKey(chatId));
  return agent.createSession(
    resumeFrom ? { sessionId: chatId, resumeFrom } : { sessionId: chatId },
  );
}

/** Park the session after the turn: bridge and sandbox stay warm for the next request. */
export async function detachAndPersist(
  chatId: string,
  session: HarnessAgentSession,
): Promise<void> {
  try {
    const state = await session.detach();
    await redis.set(resumeKey(chatId), state, { ex: TTL_SECONDS });
  } catch (error) {
    // Non-fatal: the turn already streamed; the next request starts cold.
    console.error(`[harness] failed to detach+persist for ${chatId}:`, error);
  }
}

/**
 * One turn per chat at a time, across all server instances. A harness
 * session owns the live bridge and the Devin CLI's session lock, so a second
 * overlapping request would spawn a second bridge and fail on that lock.
 *
 * The lock is the id of the turn's resumable stream: while it is set, a
 * client that comes back to the chat reconnects to that stream instead of
 * starting a new turn. The TTL bounds a turn whose server died mid-way.
 */
const streamKey = (chatId: string) => `harness-chat:stream:${chatId}`;
const TURN_TTL_SECONDS = 10 * 60;

export async function beginTurn(chatId: string, streamId: string): Promise<boolean> {
  const result = await redis.set(streamKey(chatId), streamId, { nx: true, ex: TURN_TTL_SECONDS });
  return result === "OK";
}

export async function endTurn(chatId: string): Promise<void> {
  await redis.del(streamKey(chatId));
}

/** The resumable stream id of the chat's in-flight turn, if any. */
export async function activeStreamId(chatId: string): Promise<string | null> {
  return redis.get<string>(streamKey(chatId));
}

async function activeChatIds(chatIds: string[]): Promise<Set<string>> {
  if (chatIds.length === 0) return new Set();
  const ids = await redis.mget<(string | null)[]>(...chatIds.map(streamKey));
  return new Set(chatIds.filter((_, i) => ids[i] !== null));
}
