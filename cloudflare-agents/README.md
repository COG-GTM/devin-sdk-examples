# Devin on Cloudflare Agents

A chat app where every conversation is a [Cloudflare Agent](https://developers.cloudflare.com/agents/)
that drives a Devin cloud session through `@cognition-ai/sdk`. `useAgentChat` streams Devin's
typed events — text, reasoning, tool calls, plans, permission prompts, pull requests — into the
browser, and the chat, its transcript and its Devin session survive refreshes, hibernation and
deploys in Durable Object storage.

The console is laid out like [harness-chat](../harness-chat): chats on the left, the transcript in
the middle, and on the right a **Session** panel (status, activity, cost, link to the Devin app)
and a **Workspace** panel (Devin's plan, its pull requests, and the files it touched).

> This is a single-user demo: there is no login, and anyone who can reach the Worker can use
> your Devin key through it. Put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
> in front of it or add your own auth before sharing a URL (see [Adding auth](#adding-auth)).

## How it fits together

```
browser                        Worker (routeAgentRequest)
┌──────────────────┐   ws    ┌──────────────────────────────────────────┐
│ useAgent         │◄───────►│ Workspace (Durable Object, per user)     │
│  Workspace       │         │  chat list in SQLite, @callable methods  │
│ useAgentChat     │         │   ├─ DevinChat facet (per chat)          │    ACP ws
│  DevinChat facet │◄───────►│   │   DevinChatAgent (AIChatAgent)       │◄─────────► Devin cloud
└──────────────────┘         │   └─ DevinChat facet …                   │            session
                             └──────────────────────────────────────────┘
```

- `src/server.ts`
  - **`Workspace extends Agent`** is the sidebar. `createChat`, `deleteChat` and
    `recentSessions` are `@callable()` methods, the chat list lives in SQLite and is broadcast as
    Agent state, and `onBeforeSubAgent` only lets clients reach chats this workspace created.
  - **`DevinChat extends DevinChatAgent`** is one chat, a facet of the workspace.
    [`@cognition-ai/cloudflare-agents`](https://www.npmjs.com/package/@cognition-ai/cloudflare-agents) does all of the Devin
    work: session create/attach, one turn per message, stop, permissions as tool approvals, start
    over, importing a session and recovery. The example adds `onChatResponse` (the chat's sidebar
    entry), `sessionSnapshot` (what the cloud says about the session between turns) and
    `respondToPermission`.
- `src/console.tsx` and `src/components/` are the React app: Tailwind, Streamdown for Devin's
  Markdown, one chronological `message.parts.map()` per message, and a card per tool call
  rendered from the SDK's normalized `ToolCallDetail` (command and exit code, file paths with
  `+/−`, MCP server and tool, …).

The `DEVIN_API_KEY` secret only exists in the Worker. The browser talks to your Agents, never to
Devin.

## Run locally

```sh
cd cloudflare-agents
bun install                                       # @cognition-ai/* from npm (the pinned betas)
echo 'DEVIN_API_KEY=cog_…' > .env                 # app.devin.ai → Settings → API keys
bun run start                                     # http://localhost:5173
```

Local development talks to the real Devin cloud, so turns use ACUs. Optional variables, in `.env`
or `wrangler.jsonc` `vars`:

| Variable         | Default                        | Use                                     |
| ---------------- | ------------------------------ | --------------------------------------- |
| `DEVIN_API_KEY`  | required                       | Devin personal access token (`cog_…`)   |
| `DEVIN_ORG_ID`   | the key's default organization | Pick an organization for multi-org keys |
| `DEVIN_BASE_URL` | `https://api.devin.ai`         | Point at another Devin deployment       |

Deploy with:

```sh
bunx wrangler secret put DEVIN_API_KEY
bun run deploy
```

The example pins the published `@cognition-ai/cloudflare-agents` and `@cognition-ai/sdk` betas;
`bun install` fetches them from npm. The packages are beta-only, so a `-beta.N` pin (or the `@beta`
dist-tag) is required.

## The key pattern

The server is a `DevinChatAgent` and whatever your app needs around it:

```ts
import { DevinChatAgent } from "@cognition-ai/cloudflare-agents";

export class DevinChat extends DevinChatAgent<Env> {
  protected override async onChatResponse() {
    const workspace = await this.parentAgent(Workspace);
    await workspace.recordTurn(this.name, {/* title, preview, devinUrl */});
  }
}
```

The client is the stock Agents hooks, typed with the package's state and message types:

```tsx
import type { DevinChatMessage, DevinChatState } from "@cognition-ai/cloudflare-agents";

const agent = useAgent<DevinChatState>({
  agent: "Workspace",
  name: userId,
  sub: [{ agent: "DevinChat", name: chat.id }],
});
const { messages, sendMessage, stop, clearHistory, addToolApprovalResponse } = useAgentChat<
  DevinChatState,
  DevinChatMessage
>({ agent, sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses });
// agent.state.sessionUrl links to the session in the Devin app
```

## What maps to what

| Devin                                           | In the app                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| assistant text                                  | text parts, rendered with Streamdown; `<ref_file>` citations become inline code                                                                            |
| thoughts                                        | a collapsible **Reasoning** block, open while it streams                                                                                                   |
| tool calls                                      | `dynamic-tool` parts whose `input` is the SDK's `ToolCallDetail`: `bash` shows the command, cwd, exit code and output; `edit`/`write` the files with `+/−` |
| `permission_request` tool calls                 | Allow / Deny, answered through `DevinChat.respondToPermission` → `session.respondToPermission`                                                             |
| `ask_user_question` tool calls                  | the questions, with their options as chips that prefill the composer                                                                                       |
| plans                                           | `data-devin-plan` parts as a checklist, and `agent.state.plan` in the Workspace panel                                                                      |
| pull requests                                   | `data-devin-pull-request` cards; the Workspace panel lists them with state, review and `+/−` from the session snapshot                                     |
| files Devin edited                              | the Workspace panel lists them with `+/−`, from the `files` of `edit` / `write` tool calls                                                                 |
| `computer_use` tool calls (Devin's browser)     | a card with the actions Devin took (`key ctrl+l · type · screenshot`)                                                                                      |
| `status`, `activity`, `turn_state`, `lifecycle` | `agent.state` while a turn streams; between turns the Session panel polls `sessionSnapshot` (`listSessionsPage` `_meta`) so it stays current               |

Internal bookkeeping the cloud reports as tool calls ("ACU usage reset", rule injections) is
hidden, as in the Devin app. The full event mapping is in
[`@cognition-ai/ai-sdk`](https://www.npmjs.com/package/@cognition-ai/ai-sdk).

## Lifecycle

| Action                          | Local chat                                                                                                                  | Devin session                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Send while a turn runs          | the composer keeps the draft until the turn ends (a message sent mid-stream would detach the client from the running reply) | —                                                                                                                 |
| Stop                            | turn ends, streamed parts are kept                                                                                          | `session/cancel`; a command already running finishes in the VM, and its late output is dropped from the next turn |
| New session (`startOver`)       | transcript and session state cleared                                                                                        | detached, keeps running in the cloud; next message starts a new one                                               |
| Delete chat                     | facet and its storage deleted                                                                                               | detached, keeps running in the cloud                                                                              |
| Continue a session              | new chat rebuilt from the session's replay                                                                                  | attached (`importSession`)                                                                                        |
| Refresh / reconnect             | messages and state reload from SQLite                                                                                       | unaffected                                                                                                        |
| Durable Object restart mid-turn | streamed parts are kept, prompt is not resent                                                                               | keeps working; the next message attaches to it                                                                    |

Nothing here stops a Devin session remotely. Archive or end sessions in the Devin app, or with
`devin.api` (the REST client). Permission prompts wait in memory: a Durable Object restart or Stop
answers them as cancelled.

## Adding auth

The demo uses one workspace named `demo`. In a real app:

1. Authenticate the request in the Worker's `fetch`, or with the `onBeforeConnect` /
   `onBeforeRequest` options of `routeAgentRequest`, and reject unknown users.
2. Use the user's id as the workspace name instead of `DEMO_USER` in `src/client.tsx`.
3. For per-user Devin keys, override `connectDevin()` in `DevinChat` instead of reading
   `env.DEVIN_API_KEY`.

`onBeforeSubAgent` already keeps a workspace's chats private to that workspace.

## Tests

```sh
bun run test
```

The tests run the Worker in workerd with `@cloudflare/vitest-pool-workers` against a fake Devin
ACP server (`test/fake-devin.ts`) and drive it over the same Agent WebSocket the browser uses. They
cover what the example adds on the server: the sidebar, routing only to known chats, continuing a
session, recent sessions, deleting chats, bad callable input and keeping the API key out of client
frames. The UI is checked by hand against a real session; `bun run typecheck` covers both.
The Devin turn protocol (stop, queueing, permissions, start over, recovery) is tested in
`@cognition-ai/cloudflare-agents`. The fake server is test code only and is not part of the Worker
bundle.

## Related

- [harness-chat](../harness-chat): the same idea on Vercel, with Devin running inside a Vercel Sandbox.
- [session-board](../session-board): every cloud session on one board, from `session.events()`.
- Cloudflare's [`ai-chat`](https://github.com/cloudflare/agents/tree/main/examples/ai-chat) and
  [`assistant`](https://github.com/cloudflare/agents/tree/main/examples/assistant) examples.
