import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import { activeStreamId } from "@/lib/session-store";
import { streamContext } from "@/lib/streams";

/**
 * Reconnect to a chat's in-flight turn. `useChat({ resume: true })` calls this
 * on mount (and `DefaultChatTransport` uses this path by default), so coming
 * back to a session that is still streaming picks up where it left off.
 * 204 when nothing is running.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const streamId = await activeStreamId(id);
  if (streamId === null) return new Response(null, { status: 204 });
  const stream = await streamContext().resumeExistingStream(streamId);
  if (stream == null) return new Response(null, { status: 204 });
  return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS });
}
