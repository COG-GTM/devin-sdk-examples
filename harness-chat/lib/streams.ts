import { after } from "next/server";
import { createResumableStreamContext, type ResumableStreamContext } from "resumable-stream";

/**
 * Resumable UI message streams, so a turn keeps running on the server when
 * the browser navigates away and any client can pick the stream back up —
 * switch sessions mid-turn and come back, reload, or open a second tab.
 *
 * Backed by the same Upstash Redis (`REDIS_URL`) as the session store, using
 * pub/sub to fan the live stream out. `after()` keeps the function alive on
 * Vercel until the stream has been fully consumed.
 *
 * `resumable-stream` creates and connects the pub/sub pair itself with the
 * `redis` client, which it requires but does not declare; that is why `redis`
 * is in this example's package.json (and why knip is told about it).
 */
let context: ResumableStreamContext | undefined;

export function streamContext(): ResumableStreamContext {
  context ??= createResumableStreamContext({ waitUntil: after });
  return context;
}
