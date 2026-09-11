import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  toUIMessageStream,
  type InferUIMessageChunk,
  type UIMessage,
} from "ai";
import type { HarnessAgentSession } from "@ai-sdk/harness/agent";
import { getErrorMessage } from "@ai-sdk/provider-utils";
import { ConnectionClosedError } from "@cognition-ai/sdk";

import { devinAgent, type DevinUIMessage } from "@/lib/agent";
import {
  activeStreamId,
  beginTurn,
  detachAndPersist,
  endTurn,
  resumeOrCreateSession,
  saveMessages,
  touchSession,
} from "@/lib/session-store";
import { SetupTracker } from "@/lib/setup-progress";
import { streamContext } from "@/lib/streams";

export const maxDuration = 300;

/** Demo: show the real error instead of the harness's generic message. */
function errorMessage(error: unknown): string {
  console.error(error);
  if (error instanceof ConnectionClosedError) {
    return "The Devin agent connection closed unexpectedly — retry, or start a new session.";
  }
  return getErrorMessage(error);
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/**
 * The harness owns conversation state (detach/attach, or ACP session/load),
 * so a turn carries only the fresh input: the latest user message — or, when
 * the user just answered an approval, the assistant message that holds the
 * responses, which continues the paused turn.
 */
function turnInput(messages: UIMessage[]): UIMessage[] {
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    const user = [...messages].reverse().find((m) => m.role === "user");
    return user ? [user, last] : [last];
  }
  return last ? [last] : [];
}

/** How long a recovered turn may stay silent before it is considered dead. */
const STUCK_TURN_SILENCE_MS = 15_000;

/** Step framing arrives as soon as the turn reconnects; only content counts as a sign of life. */
const FRAMING_CHUNKS = new Set(["start", "start-step", "finish-step", "finish"]);

/**
 * Finish a turn left over from a previous request. If it pauses on an
 * approval the caller stops here; if it goes silent it is abandoned —
 * aborting the continued turn cancels it in Devin and returns the session to
 * idle, with the sandbox and history intact.
 */
async function finishStuckTurn(
  session: HarnessAgentSession,
  write: (chunk: InferUIMessageChunk<DevinUIMessage>) => void,
): Promise<"finished" | "paused" | "abandoned"> {
  const abort = new AbortController();
  const recovered = await devinAgent.continueStream({ session, abortSignal: abort.signal });
  // The caller owns the message envelope (`start`/`finish`); this stream only
  // contributes parts to it.
  const reader = toUIMessageStream({
    stream: recovered.stream,
    onError: errorMessage,
    sendStart: false,
    sendFinish: false,
  }).getReader();
  // A single pending read is raced against the silence timer each round;
  // a read that loses the race stays pending and is awaited next round, so
  // no chunk is dropped.
  let pending = reader.read();
  let produced = false;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      pending,
      new Promise<"silent">((resolve) => {
        timer = setTimeout(() => {
          resolve("silent");
        }, STUCK_TURN_SILENCE_MS);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
    if (next === "silent") {
      if (produced) continue;
      abort.abort(new Error("Abandoned: the previous turn produced no output."));
      await reader.cancel();
      return "abandoned";
    }
    if (next.done) break;
    const chunk = next.value as InferUIMessageChunk<DevinUIMessage>;
    if (!FRAMING_CHUNKS.has(chunk.type)) produced = true;
    write(chunk);
    pending = reader.read();
  }
  return session.hasUnfinishedTurn() ? "paused" : "finished";
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; messages?: DevinUIMessage[] };
  if (!body.id || !Array.isArray(body.messages)) {
    return new Response("Expected { id, messages }", { status: 400 });
  }
  const { id: chatId, messages: uiMessages } = body;
  const input = turnInput(uiMessages);
  const continuing = input.at(-1)?.role === "assistant";
  const firstUser = uiMessages.find((m) => m.role === "user");
  const messages = await convertToModelMessages(input);

  // The stream id is also the cross-instance turn lock for this chat. If a
  // turn is already streaming, the client should reconnect to it instead.
  const streamId = generateId();
  if (!(await beginTurn(chatId, streamId))) {
    return new Response("A turn is already running for this chat.", { status: 409 });
  }

  let session: Awaited<ReturnType<typeof resumeOrCreateSession>> | undefined;
  // Create the UI stream before acquiring the session so sandbox, bootstrap
  // and bridge startup failures surface as UI error parts, not HTTP 500s.
  const stream = createUIMessageStream<DevinUIMessage>({
    originalMessages: uiMessages,
    execute: async ({ writer }) => {
      // Setup progress for the chat's status card; transient, not part of the message.
      const tracker = new SetupTracker(chatId, (progress) => {
        writer.write({ type: "data-boot", data: progress, transient: true });
      });
      // Record the session and the user's message right away, so a client
      // that switches back mid-turn already sees what was sent.
      await Promise.all([
        touchSession(chatId, { title: firstUser ? textOf(firstUser) : undefined }),
        saveMessages(chatId, uiMessages),
      ]);
      try {
        session = await resumeOrCreateSession(devinAgent, chatId);
      } catch (error) {
        tracker.dispose();
        throw error;
      }
      tracker.sessionAcquired();
      let recovering = false;
      if (session.hasUnfinishedTurn() && !continuing) {
        // The previous turn never finished (server died mid-turn, or an
        // approval was left unanswered). The harness will not take a new
        // prompt until it is done, so try to finish it and show its tail. If
        // it pauses on an approval, stop here: the card is now on screen and
        // the answer continues it. If it produces nothing, abandon it.
        recovering = true;
        writer.write({ type: "start", messageId: generateId() });
        const outcome = await finishStuckTurn(session, (chunk) => {
          tracker.firstOutput();
          writer.write(chunk);
        });
        if (outcome === "paused") {
          writer.write({ type: "finish" });
          return;
        }
      }
      const result = await devinAgent.stream({ session, messages });
      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          onError: errorMessage,
          originalMessages: uiMessages,
          // During recovery the envelope was opened above; the new turn's
          // parts land in that same message.
          sendStart: !recovering,
        }).pipeThrough(
          // The first real chunk ends the setup phase.
          new TransformStream({
            transform(chunk, controller) {
              if (chunk.type !== "start") tracker.firstOutput();
              controller.enqueue(chunk);
            },
            flush() {
              tracker.dispose();
            },
          }),
        ),
      );
    },
    onError: errorMessage,
    // Runs when the whole stream settles — finished, errored or aborted —
    // so the session is always parked, the transcript saved, and the chat
    // unlocked.
    onFinish: async ({ messages: transcript }) => {
      // The lock is gone if the chat was deleted mid-turn: drop the session
      // instead of writing it back.
      if ((await activeStreamId(chatId)) !== streamId) {
        await session?.stop().catch(() => undefined);
        return;
      }
      try {
        await saveMessages(chatId, transcript);
        if (session) {
          await detachAndPersist(chatId, session);
          await touchSession(chatId, { turn: true });
        }
      } finally {
        await endTurn(chatId);
      }
    },
  });

  return createUIMessageStreamResponse({
    stream,
    // The server consumes the stream to completion on its own; the browser's
    // copy can drop and reconnect (GET /api/chat/[id]/stream) at will.
    consumeSseStream: async ({ stream: sse }) => {
      await streamContext().createNewResumableStream(streamId, () => sse);
    },
  });
}
