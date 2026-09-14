import { env, exports } from "cloudflare:workers";
import type { UIMessage } from "ai";

import type { DevinChatState } from "@cognition-ai/cloudflare-agents";
import type { RecordedRequest } from "./fake-devin";

export const STATE = "cf_agent_state";
const CHAT_REQUEST = "cf_agent_use_chat_request";
const CHAT_RESPONSE = "cf_agent_use_chat_response";

export interface Frame {
  type?: string;
  id?: string;
  body?: string;
  done?: boolean;
  state?: unknown;
  [key: string]: unknown;
}

export interface Chunk {
  type: string;
  [key: string]: unknown;
}

/** A WebSocket to an agent that buffers every frame so tests can wait for one. */
export class AgentSocket {
  readonly frames: Frame[] = [];
  readonly #waiters = new Set<() => void>();

  private constructor(
    readonly ws: WebSocket,
    readonly path: string,
  ) {
    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      this.frames.push(JSON.parse(event.data) as Frame);
      for (const wake of this.#waiters) wake();
    });
  }

  static async open(path: string): Promise<AgentSocket> {
    const response = await exports.default.fetch(`http://example.com${path}`, {
      headers: { Upgrade: "websocket" },
    });
    const ws = response.webSocket;
    if (response.status !== 101 || ws === null) {
      throw new Error(`upgrade failed: ${String(response.status)} ${await response.text()}`);
    }
    ws.accept();
    return new AgentSocket(ws, path);
  }

  static workspace(workspace: string): Promise<AgentSocket> {
    return AgentSocket.open(`/agents/workspace/${workspace}`);
  }

  static chat(workspace: string, chatId: string): Promise<AgentSocket> {
    return AgentSocket.open(`/agents/workspace/${workspace}/sub/devin-chat/${chatId}`);
  }

  send(frame: Frame): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** The first frame since connecting that matches `predicate`. */
  waitFor(predicate: (frame: Frame) => boolean, timeoutMs = 8000): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.frames.find(predicate);
        if (found === undefined) return;
        clearTimeout(timer);
        this.#waiters.delete(check);
        resolve(found);
      };
      const timer = setTimeout(() => {
        this.#waiters.delete(check);
        reject(new Error(`timed out; saw ${JSON.stringify(this.frames.map((f) => f.type))}`));
      }, timeoutMs);
      this.#waiters.add(check);
      check();
    });
  }

  async rpc(method: string, args: unknown[] = []): Promise<unknown> {
    const id = crypto.randomUUID();
    this.send({ type: "rpc", id, method, args });
    const reply = await this.waitFor((frame) => frame.type === "rpc" && frame.id === id);
    if (reply.success !== true) throw new Error(String(reply.error));
    return reply.result;
  }

  /** Send a user message the way `useAgentChat` does; returns the request id. */
  prompt(text: string, history: UIMessage[] = []): string {
    const id = crypto.randomUUID();
    const message: UIMessage = { id: `user-${id}`, role: "user", parts: [{ type: "text", text }] };
    this.send({
      type: CHAT_REQUEST,
      id,
      init: {
        method: "POST",
        body: JSON.stringify({ messages: [...history, message], trigger: "submit-message" }),
      },
    });
    return id;
  }

  /** Every UI message chunk streamed for `requestId`, once the response is done. */
  async chunks(requestId: string): Promise<Chunk[]> {
    await this.waitFor(
      (frame) => frame.type === CHAT_RESPONSE && frame.id === requestId && frame.done === true,
      12_000,
    );
    return this.frames
      .filter((frame) => frame.type === CHAT_RESPONSE && frame.id === requestId)
      .flatMap(parseChunks);
  }

  /** The newest state the agent sent. */
  latestState(): DevinChatState | undefined {
    const frame = [...this.frames].reverse().find((f) => f.type === STATE);
    return frame?.state as DevinChatState | undefined;
  }

  /** Wait for a state broadcast matching `predicate`. */
  async waitForState<T = DevinChatState>(
    predicate: (state: T) => boolean = () => true,
  ): Promise<T> {
    const frame = await this.waitFor((f) => f.type === STATE && predicate(f.state as T));
    return frame.state as T;
  }

  /** The persisted messages, as `useAgentChat` loads them on mount. */
  async initialMessages(): Promise<UIMessage[]> {
    const response = await exports.default.fetch(`http://example.com${this.path}/get-messages`);
    if (!response.ok) throw new Error(`get-messages failed: ${String(response.status)}`);
    return response.json();
  }

  close(): void {
    this.ws.close();
  }
}

function parseChunks(frame: Frame): Chunk[] {
  return typeof frame.body === "string" && frame.body.trim() !== ""
    ? [JSON.parse(frame.body) as Chunk]
    : [];
}

export async function fakeRequests(): Promise<{ requests: RecordedRequest[] }> {
  const response = await fetch(`${env.DEVIN_BASE_URL}/__fake/requests`);
  return response.json();
}
