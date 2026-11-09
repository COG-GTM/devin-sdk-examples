/**
 * Who may reach the Agents: every request needs a valid Cloudflare Access
 * JWT, and a user only reaches the workspace named after their own id.
 */
import { env, exports } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { describe, expect, it } from "vitest";

import { authenticate } from "../src/auth";
import { AgentSocket, accessToken, signedIn } from "./helpers";

const user = () => `user-${crypto.randomUUID()}`;

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(`http://example.com${path}`, { headers });
}

describe("anonymous callers", () => {
  it("cannot open a workspace", async () => {
    await expect(AgentSocket.open("/agents/workspace/demo")).rejects.toThrow(/401/);
  });

  it("cannot reach a chat or its messages", async () => {
    const owner = user();
    const stub = await getAgentByName(env.Workspace, owner);
    const chat = await stub.createChat({});
    const path = `/agents/workspace/${owner}/sub/devin-chat/${chat.id}`;
    await expect(AgentSocket.open(path)).rejects.toThrow(/401/);
    expect((await get(`${path}/get-messages`)).status).toBe(401);
  });

  it("cannot learn a workspace name", async () => {
    expect((await get("/api/me")).status).toBe(401);
  });
});

describe("invalid sign-ins", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["signed by another key", { forged: true }],
    ["for another application", { aud: ["another-app"] }],
    ["from another issuer", { iss: "https://evil.example.com" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 60 }],
  ];
  it.each(cases)("rejects a token %s", async (_name, claims) => {
    const sub = user();
    const token = await accessToken(sub, claims);
    await expect(
      AgentSocket.open(`/agents/workspace/${sub}`, { "Cf-Access-Jwt-Assertion": token }),
    ).rejects.toThrow(/401/);
  });

  it("rejects an unsigned token", async () => {
    const sub = user();
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/=+$/, "").replaceAll("+", "-").replaceAll("/", "_");
    const [, payload = ""] = (await accessToken(sub)).split(".");
    const token = `${encode({ alg: "none", typ: "JWT" })}.${payload}.`;
    await expect(
      AgentSocket.open(`/agents/workspace/${sub}`, { "Cf-Access-Jwt-Assertion": token }),
    ).rejects.toThrow(/401/);
  });

  it("rejects an identity without a usable user id", async () => {
    const token = await accessToken("");
    expect((await get("/api/me", { "Cf-Access-Jwt-Assertion": token })).status).toBe(403);
  });
});

describe("signed-in users", () => {
  it("are told their own workspace", async () => {
    const sub = user();
    const response = await get("/api/me", await signedIn(sub));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspace: sub, email: `${sub}@example.com` });
  });

  it("can sign in with the Access cookie", async () => {
    const sub = user();
    const cookie = `theme=dark; CF_Authorization=${await accessToken(sub)}`;
    const sidebar = await AgentSocket.open(`/agents/workspace/${sub}`, { Cookie: cookie });
    expect(await sidebar.rpc("recentSessions")).toHaveLength(1);
    sidebar.close();
  });

  it("cannot reach another user's workspace or chats", async () => {
    const alice = user();
    const mallory = user();
    const stub = await getAgentByName(env.Workspace, alice);
    const chat = await stub.createChat({});

    await expect(AgentSocket.workspace(alice, mallory)).rejects.toThrow(/403/);
    await expect(AgentSocket.chat(alice, chat.id, mallory)).rejects.toThrow(/403/);
    const messages = `/agents/workspace/${alice}/sub/devin-chat/${chat.id}/get-messages`;
    expect((await get(messages, await signedIn(mallory))).status).toBe(403);

    // Alice still can.
    const own = await AgentSocket.chat(alice, chat.id);
    expect(await own.initialMessages()).toEqual([]);
    own.close();
  });

  it("are refused from another site's page", async () => {
    const sub = user();
    const headers = { ...(await signedIn(sub)), Origin: "https://evil.example.com" };
    await expect(AgentSocket.open(`/agents/workspace/${sub}`, headers)).rejects.toThrow(/403/);
    const sameSite = { ...(await signedIn(sub)), Origin: "http://example.com" };
    (await AgentSocket.open(`/agents/workspace/${sub}`, sameSite)).close();
  });
});

describe("local development", () => {
  const request = (url: string) => new Request(url);

  it("acts as DEV_USER on a loopback host only", async () => {
    expect(
      await authenticate(request("http://localhost:5173/api/me"), { DEV_USER: "demo" }),
    ).toEqual({ id: "demo", email: null });
    const remote = await authenticate(request("https://app.example.com/api/me"), {
      DEV_USER: "demo",
    });
    expect(remote).toBeInstanceOf(Response);
    expect((remote as Response).status).toBe(401);
  });

  it("rejects every request when nothing is configured", async () => {
    const response = await authenticate(request("http://localhost:5173/api/me"), {});
    expect((response as Response).status).toBe(401);
  });

  it("does not let DEV_USER bypass Cloudflare Access", async () => {
    const response = await authenticate(request("http://localhost:5173/api/me"), {
      TEAM_DOMAIN: env.TEAM_DOMAIN,
      POLICY_AUD: env.POLICY_AUD,
      DEV_USER: "demo",
    });
    expect((response as Response).status).toBe(401);
  });
});
