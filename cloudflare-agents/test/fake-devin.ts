/**
 * A stand-in for `api.devin.ai`, run by `vitest.config.ts` in Node so the
 * Workers tests can drive real ACP over a real WebSocket without a key.
 *
 * Every prompt gets a turn with reasoning, a tool call, a plan, a PR and a
 * status. `devin-replay` can be loaded and listed; `devin-missing` can't.
 * The turn protocol itself is covered by `@cognition-ai/cloudflare-agents`'s
 * tests; these fixtures only exercise the app around it.
 *
 * `GET /__fake/requests` returns what the SDK sent.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export interface RecordedRequest {
  method: string;
  sessionId: string | null;
  params: Record<string, unknown>;
}

export interface FakeDevin {
  baseUrl: string;
  apiKey: string;
  close(): Promise<void>;
}

/** An existing session `loadSession` can replay. */
export const REPLAY_SESSION_ID = "devin-replay";

const sessionUrl = (id: string) => `https://app.devin.ai/sessions/${id.replace(/^devin-/, "")}`;

export async function startFakeDevin(port: number, apiKey: string): Promise<FakeDevin> {
  const requests: RecordedRequest[] = [];
  let nextSession = 0;

  const http = createServer((req, res) => {
    if (req.url === "/v3/self") {
      const ok = authorized(req, apiKey);
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { email: "worker@example.com" } : { detail: "bad token" }));
      return;
    }
    if (req.url === "/__fake/requests") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ requests }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    if (req.url !== "/acp/live") {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    if (!authorized(req, apiKey)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      serve(ws, requests, () => `devin-fake${String(++nextSession)}`);
    });
  });

  await new Promise<void>((resolve) => {
    http.listen(port, "127.0.0.1", resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    apiKey,
    close: () => closeAll(http, wss),
  };
}

function authorized(req: IncomingMessage, apiKey: string): boolean {
  return req.headers.authorization === `Bearer ${apiKey}`;
}

function serve(ws: WebSocket, requests: RecordedRequest[], newSessionId: () => string): void {
  const send = (msg: Omit<Rpc, "jsonrpc">): void => {
    ws.send(JSON.stringify({ jsonrpc: "2.0", ...msg }));
  };
  const update = (sessionId: string, body: Record<string, unknown>): void => {
    send({
      method: "session/update",
      params: {
        sessionId,
        update: body,
        _meta: { "cognition.ai/session": { "cognition.ai/url": sessionUrl(sessionId) } },
      },
    });
  };
  const text = (kind: string, content: string) => ({
    sessionUpdate: kind,
    content: { type: "text", text: content },
  });
  const info = (meta: Record<string, unknown>) => ({
    sessionUpdate: "session_info_update",
    _meta: meta,
  });

  const prompt = (id: number | string, sessionId: string, prompt: string): void => {
    update(
      sessionId,
      info({ "cognition.ai/eventType": "status_update", "cognition.ai/statusEnum": "working" }),
    );
    // Tool call ids are unique per conversation; AIChatAgent merges messages that share one.
    const ls = `call-ls-${crypto.randomUUID()}`;
    update(sessionId, text("agent_thought_chunk", "Let me look around."));
    update(sessionId, text("agent_message_chunk", "Echo: "));
    update(sessionId, text("agent_message_chunk", prompt));
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: ls,
      title: "ls",
      kind: "execute",
      status: "in_progress",
      rawInput: { command: "ls" },
    });
    update(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: ls,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "README.md" } }],
    });
    update(sessionId, {
      sessionUpdate: "plan",
      entries: [
        { content: "Read the code", status: "completed", priority: "medium" },
        { content: "Open a PR", status: "in_progress", priority: "medium" },
      ],
    });
    update(
      sessionId,
      info({
        "cognition.ai/eventType": "pr_data_updated",
        "cognition.ai/prDataUpdated": { prUrl: "https://github.com/acme/app/pull/7" },
      }),
    );
    update(sessionId, text("agent_message_chunk", " Done."));
    update(
      sessionId,
      info({
        "cognition.ai/eventType": "status_update",
        "cognition.ai/statusEnum": "blocked",
        "cognition.ai/statusMessage": "Waiting for your response",
      }),
    );
    send({ id, result: { stopReason: "end_turn" } });
  };

  const replay = (sessionId: string): void => {
    update(sessionId, text("user_message_chunk", "Fix the flaky test"));
    update(sessionId, text("agent_message_chunk", "Found it in retry.ts."));
    update(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "call-edit",
      title: "Edit retry.ts",
      kind: "edit",
      status: "completed",
      rawInput: { path: "retry.ts" },
    });
    update(sessionId, text("user_message_chunk", "Thanks, open a PR"));
    update(sessionId, text("agent_message_chunk", "Opened a PR."));
    update(
      sessionId,
      info({
        "cognition.ai/eventType": "pr_data_updated",
        "cognition.ai/prDataUpdated": { prUrl: "https://github.com/acme/app/pull/9" },
      }),
    );
    update(
      sessionId,
      info({ "cognition.ai/eventType": "status_update", "cognition.ai/statusEnum": "finished" }),
    );
  };

  ws.on("message", (data: Buffer | string) => {
    const msg = JSON.parse(String(data)) as Rpc;
    if (msg.method === undefined) return;
    const params = msg.params ?? {};
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    requests.push({ method: msg.method, sessionId, params });
    switch (msg.method) {
      case "initialize":
        send({
          id: msg.id,
          result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
        });
        break;
      case "session/new": {
        const id = newSessionId();
        send({
          id: msg.id,
          result: {
            sessionId: id,
            _meta: { "cognition.ai/session": { "cognition.ai/url": sessionUrl(id) } },
          },
        });
        break;
      }
      case "session/load":
        if (sessionId === "devin-missing") {
          send({ id: msg.id, error: { code: -32002, message: "Session not found" } });
          break;
        }
        if (sessionId === REPLAY_SESSION_ID) replay(sessionId);
        send({ id: msg.id, result: {} });
        break;
      case "session/list":
        send({
          id: msg.id,
          result: {
            sessions: [
              {
                sessionId: REPLAY_SESSION_ID,
                cwd: "/",
                title: "Fix the flaky test",
                updatedAt: "2026-09-01T00:00:00Z",
                _meta: {
                  "cognition.ai/statusEnum": "finished",
                  "cognition.ai/url": sessionUrl(REPLAY_SESSION_ID),
                },
              },
            ],
          },
        });
        break;
      case "session/prompt": {
        const blocks = (params.prompt as { text?: string }[] | undefined) ?? [];
        prompt(msg.id ?? 0, sessionId ?? "", blocks.map((block) => block.text ?? "").join(""));
        break;
      }
      default:
        if (msg.id !== undefined) send({ id: msg.id, result: null });
    }
  });
}

async function closeAll(http: Server, wss: WebSocketServer): Promise<void> {
  for (const client of wss.clients) client.terminate();
  await new Promise<void>((resolve) => {
    wss.close(() => {
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    http.closeAllConnections();
  });
}
