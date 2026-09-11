import { board } from "@/lib/board";
import { isWindow, WINDOW_MS, type BoardEvent } from "@/lib/card";

export const dynamic = "force-dynamic";

/** Comment frames keep proxies from closing an idle stream. */
const HEARTBEAT_MS = 15_000;

/**
 * The board as server-sent events: a `snapshot` on connect, then a `card`
 * per change and a `connection` note whenever the board's own link to Devin
 * changes. Every browser tab shares the server's one connection to the cloud.
 */
export function GET(request: Request) {
  const window = new URL(request.url).searchParams.get("window");
  const windowMs = WINDOW_MS[isWindow(window) ? window : "24h"];
  const encoder = new TextEncoder();
  let stop: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
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
