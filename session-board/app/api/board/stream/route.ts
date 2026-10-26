import { authorized } from "@/lib/auth";
import { board } from "@/lib/board";
import { isWindow, WINDOW_MS, type BoardEvent } from "@/lib/card";

export const dynamic = "force-dynamic";

/** Comment frames keep proxies from closing an idle stream. */
const HEARTBEAT_MS = 15_000;
/**
 * Open streams at once, across every tab. Each one holds a listener, a
 * heartbeat timer and a copy of the board; past this the server says come
 * back later instead of growing without bound.
 */
const MAX_STREAMS = 64;
let streams = 0;

/**
 * The board as server-sent events: a `snapshot` on connect, then a `card`
 * per change and a `connection` note whenever the board's own link to Devin
 * changes. Every browser tab shares the server's one connection to the cloud.
 *
 * The middleware already turned away anyone without the board token; this
 * checks again so the stream stays closed even if that is misconfigured.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await authorized(request))) return new Response(null, { status: 401 });
  if (streams >= MAX_STREAMS) {
    return new Response(null, { status: 503, headers: { "Retry-After": "30" } });
  }
  const window = new URL(request.url).searchParams.get("window");
  const windowMs = WINDOW_MS[isWindow(window) ? window : "24h"];
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      streams += 1;
      const write = (frame: string) => {
        if (open) controller.enqueue(encoder.encode(frame));
      };
      const unsubscribe = board().subscribe((event: BoardEvent) => {
        write(`data: ${JSON.stringify(event)}\n\n`);
      }, windowMs);
      const heartbeat = setInterval(() => {
        write(": ping\n\n");
      }, HEARTBEAT_MS);
      stop = () => {
        if (!open) return;
        open = false;
        streams -= 1;
        unsubscribe();
        clearInterval(heartbeat);
        controller.close();
      };
      request.signal.addEventListener("abort", stop);
    },
    cancel() {
      stop?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
