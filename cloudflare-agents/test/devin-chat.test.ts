/**
 * The app around `DevinChatAgent`: the workspace sidebar, chat routing,
 * importing and deleting chats. The Devin turn protocol (stop, permissions,
 * start over, recovery) is tested in `@cognition-ai/cloudflare-agents`.
 */
import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";

import type { WorkspaceState } from "../src/server";
import { REPLAY_SESSION_ID } from "./fake-devin";
import { AgentSocket, STATE, fakeRequests } from "./helpers";

async function newChat(options: { title?: string; sessionId?: string } = {}) {
  const workspace = `ws-${crypto.randomUUID()}`;
  const stub = await getAgentByName(env.Workspace, workspace);
  const chat = await stub.createChat(options);
  const socket = await AgentSocket.chat(workspace, chat.id);
  return { workspace, stub, chat, socket };
}

describe("DevinChat", () => {
  it("streams a Devin turn with its plan, PR and session state", async () => {
    const { socket } = await newChat();
    const chunks = await socket.chunks(socket.prompt("hello"));

    const types = chunks.map((chunk) => chunk.type);
    expect(types).toContain("tool-input-available");
    expect(types).toContain("data-devin-plan");
    expect(types).toContain("data-devin-pull-request");
    expect(types.at(-1)).toBe("finish");
    const text = chunks.flatMap((c) => (c.type === "text-delta" ? [c.delta] : [])).join("");
    expect(text).toBe("Echo: hello Done.");

    const state = await socket.waitForState((s) => s.status === "blocked");
    expect(state.sessionId).toMatch(/^devin-fake\d+$/);
    expect(state.sessionUrl).toBe(
      `https://app.devin.ai/sessions/${(state.sessionId ?? "").slice("devin-".length)}`,
    );
    expect(state.plan.map((entry) => entry.status)).toEqual(["completed", "in_progress"]);
    expect(state.pullRequests).toEqual(["https://github.com/acme/app/pull/7"]);

    const again = socket.prompt("again", await socket.initialMessages());
    await socket.chunks(again);
    const { requests } = await fakeRequests();
    expect(
      requests.filter((r) => r.method === "session/prompt" && r.sessionId === state.sessionId),
    ).toHaveLength(2);
    socket.close();
  });

  it("records the turn in the workspace sidebar", async () => {
    const { stub, workspace, chat, socket } = await newChat();
    await socket.chunks(socket.prompt("rename me please"));
    const sidebar = await AgentSocket.workspace(workspace);
    const frame = await sidebar.waitFor(
      (f) => f.type === STATE && (f.state as WorkspaceState).chats.some((c) => c.preview !== null),
    );
    const entry = (frame.state as WorkspaceState).chats.find((c) => c.id === chat.id);
    expect(entry).toMatchObject({
      title: "rename me please",
      preview: "Echo: rename me please Done.",
    });
    expect(entry?.devinUrl).toContain("/sessions/");
    expect((frame.state as WorkspaceState).configured).toBe(true);
    await stub.deleteChat(chat.id);
    sidebar.close();
    socket.close();
  });
});

describe("continuing an existing session", () => {
  it("imports the session into a new chat named after it", async () => {
    const { chat, socket } = await newChat({ sessionId: `https://app.devin.ai/sessions/replay` });
    expect(chat).toMatchObject({
      title: "Fix the flaky test",
      devinUrl: "https://app.devin.ai/sessions/replay",
    });

    const messages = await socket.initialMessages();
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const state = await socket.waitForState((s) => s.sessionId !== null);
    expect(state).toMatchObject({ sessionId: REPLAY_SESSION_ID, status: "finished" });
    socket.close();
  });

  it("does not create a chat when the session can't be loaded", async () => {
    const sidebar = await AgentSocket.workspace(`ws-${crypto.randomUUID()}`);
    await expect(sidebar.rpc("createChat", [{ sessionId: "devin-missing" }])).rejects.toThrow(
      /devin-missing/,
    );
    const frame = await sidebar.waitFor((f) => f.type === STATE);
    expect((frame.state as WorkspaceState).chats).toEqual([]);
    sidebar.close();
  });

  it("snapshots the session and adopts its cloud title once", async () => {
    const { workspace, chat, socket } = await newChat({
      title: "My chat",
      sessionId: REPLAY_SESSION_ID,
    });
    expect(chat.title).toBe("My chat");
    const sidebar = await AgentSocket.workspace(workspace);
    await sidebar.waitFor((f) => f.type === STATE);

    expect(await socket.rpc("sessionSnapshot")).toMatchObject({
      id: REPLAY_SESSION_ID,
      title: "Fix the flaky test",
      status: "finished",
      url: "https://app.devin.ai/sessions/replay",
    });
    await sidebar.waitFor(
      (f) =>
        f.type === STATE &&
        (f.state as WorkspaceState).chats.some((c) => c.title === "Fix the flaky test"),
    );

    const broadcasts = () => sidebar.frames.filter((f) => f.type === STATE).length;
    const before = broadcasts();
    await socket.rpc("sessionSnapshot");
    // Anything the second snapshot broadcast reaches the socket before this reply.
    await sidebar.rpc("recentSessions");
    expect(broadcasts()).toBe(before);
    sidebar.close();
    socket.close();
  });

  it("answers a permission request on the session", async () => {
    const { socket } = await newChat({ sessionId: REPLAY_SESSION_ID });
    await socket.waitForState((s) => s.sessionId !== null);
    await expect(socket.rpc("respondToPermission", ["perm-1"])).rejects.toThrow(/boolean/);
    await socket.rpc("respondToPermission", ["perm-1", true]);
    const { requests } = await fakeRequests();
    const answers = requests.filter((r) => r.method === "_cognition.ai/permission/respond");
    expect(answers.map((r) => [r.sessionId, r.params])).toContainEqual([
      REPLAY_SESSION_ID,
      { sessionId: REPLAY_SESSION_ID, permissionRequestId: "perm-1", approved: true },
    ]);
    socket.close();
  });

  it("lists recent sessions", async () => {
    const stub = await getAgentByName(env.Workspace, `ws-${crypto.randomUUID()}`);
    expect(await stub.recentSessions()).toEqual([
      {
        id: REPLAY_SESSION_ID,
        title: "Fix the flaky test",
        status: "finished",
        url: "https://app.devin.ai/sessions/replay",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    ]);
  });
});

describe("workspace", () => {
  it("only routes to chats it created", async () => {
    const workspace = `ws-${crypto.randomUUID()}`;
    await getAgentByName(env.Workspace, workspace);
    await expect(AgentSocket.chat(workspace, "made-up")).rejects.toThrow(/404/);
  });

  it("rejects invalid callable input", async () => {
    const sidebar = await AgentSocket.workspace(`ws-${crypto.randomUUID()}`);
    await expect(sidebar.rpc("createChat", [{ title: 7 }])).rejects.toThrow(/title/);
    await expect(sidebar.rpc("createChat", [{ sessionId: "not a session!" }])).rejects.toThrow(
      /Not a Devin session/,
    );
    await expect(sidebar.rpc("deleteChat", ["nope"])).rejects.toThrow(/Unknown chat/);
    sidebar.close();
  });

  it("deletes a chat and its facet", async () => {
    const { stub, workspace, chat, socket } = await newChat();
    await stub.deleteChat(chat.id);
    socket.close();
    const sidebar = await AgentSocket.workspace(workspace);
    const frame = await sidebar.waitFor((f) => f.type === STATE);
    expect((frame.state as WorkspaceState).chats).toEqual([]);
    await expect(AgentSocket.chat(workspace, chat.id)).rejects.toThrow(/404/);
    sidebar.close();
  });

  it("never sends the API key to clients", async () => {
    const { workspace, socket } = await newChat();
    await socket.chunks(socket.prompt("hello"));
    const sidebar = await AgentSocket.workspace(workspace);
    await sidebar.waitFor((f) => f.type === STATE);
    const everything = JSON.stringify([socket.frames, sidebar.frames]);
    expect(everything).not.toContain(env.DEVIN_API_KEY);
    socket.close();
    sidebar.close();
  });
});
