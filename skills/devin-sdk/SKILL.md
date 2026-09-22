---
name: devin-sdk
description: Build with the Devin TypeScript SDK (@cognition-ai/sdk) — createDevin, cloud vs local sessions, DEVIN_API_KEY and the other environment variables, session.run with typed structured output, streaming events, attaching to running sessions, permission handling, the devin.api escape hatch, and the production patterns from the official examples. Use when writing, reviewing or debugging code that drives Devin programmatically, or when someone asks how to script Devin from TypeScript or Node.
---

# Devin SDK

`@cognition-ai/sdk` drives [Devin](https://devin.ai) from TypeScript. The same code runs a
session in Devin's cloud or in the Devin CLI on the current machine; the only thing that
changes is one option. Everything below is taken from the shipped source and the official
examples at https://github.com/COG-GTM/devin-sdk-examples — copy from those, not from memory.

Two layers, keep them apart:

| Layer                | Import                          | What it is                                                                                                 |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| SDK (use this first) | `createDevin`, sessions, events | Live interaction over the Agent Client Protocol (ACP): prompts, streaming, structured output, permissions. |
| `devin.api`          | `CloudDevin.api`                | The generated TypeScript client for the Devin platform API (sessions list, playbooks, secrets, PRs, …).    |

Reach for `devin.api` only when the session API has no method for what you need.

## 1. Install

```sh
bun add @cognition-ai/sdk@beta       # or: npm i @cognition-ai/sdk@beta
```

- The packages are beta-only: every release is `0.0.1-beta.N` on the `beta` dist-tag and
  nothing is on `latest`. A plain `npm i @cognition-ai/sdk` fails **on purpose** — that is
  not a registry problem, add `@beta` or pin the exact version.
- In an app, pin the exact version like the examples do (`"@cognition-ai/sdk": "0.0.1-beta.5"`).
- If you also use `@cognition-ai/harness-devin` (the Vercel AI SDK adapter), keep it on the
  **same** version as `@cognition-ai/sdk`.
- Runtime: Node 22+ or Bun. The examples use Bun (`bun install`, `bun run …`).
- Structured output needs a Standard Schema library; the examples use `zod` (v4).

## 2. Authentication and environment variables

Both modes authenticate with a Devin personal access token (`cog_…`, from app.devin.ai →
Settings → API keys).

| Variable         | Used by       | Meaning                                                                                                  |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `DEVIN_API_KEY`  | cloud + local | The token. Overridden by the `apiKey` option. Missing key throws `DevinError("No API key…")` at startup. |
| `DEVIN_ORG_ID`   | cloud         | Default organization for new sessions. Overridden by `orgId`. Only needed if you belong to several orgs. |
| `DEVIN_BASE_URL` | cloud         | API base URL; the ACP WebSocket URL is derived from it. Leave unset for production.                      |

Rules:

- **No variable selects cloud vs local.** The presence of the `cwd` option does (next section).
  Do not invent `DEVIN_MODE`/`DEVIN_LOCAL` switches.
- Never set `WINDSURF_API_KEY` yourself. In local mode the SDK passes your key to the spawned
  CLI internally.
- Local mode never falls back to the CLI's own `devin auth login` credentials; `DEVIN_API_KEY`
  (or `apiKey`) is required there too.
- The key is a server-side secret: read it from the environment on the server, never ship it
  to a browser bundle (`NEXT_PUBLIC_*` etc.), never commit `.env` files.
- Example-specific variables: `WEBHOOK_SECRET` (ticket-enricher, 16+ chars), `PORT`;
  harness-chat pulls `VERCEL_OIDC_TOKEN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `REDIS_URL`
  via `vercel env pull`.

## 3. `createDevin`: cloud vs local

```ts
import { createDevin } from "@cognition-ai/sdk";

await using cloud = await createDevin(); // CloudDevin — key from DEVIN_API_KEY
await using cloud2 = await createDevin({ apiKey, orgId }); // CloudDevin
await using local = await createDevin({ cwd: process.cwd() }); // LocalDevin
```

The implementation is literally `options.cwd !== undefined ? LocalDevin.start(options) : CloudDevin.connect(options)`.
TypeScript narrows the return type from the options you pass.

| Concern                       | Cloud (`CloudDevin`, default)                                                                  | Local (`LocalDevin`, pass `cwd`)                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Where turns run               | A Devin cloud VM; Devin clones repos itself                                                    | The bundled Devin CLI (`devin acp`) as a child process; edits real files and runs real commands in `cwd` |
| Transport                     | ACP over WebSocket                                                                             | ACP over stdio                                                                                           |
| Options                       | `apiKey`, `orgId`, `baseUrl`, `onPermission`, `fetch`, `clientCapabilities`                    | `cwd`, `apiKey`, `stateDir` (default `~/.devin-sdk`), `model`, `onPermission`, `clientCapabilities`      |
| `createSession` options       | `repos: ["owner/repo"]`, `orgId`, `onPermission`                                               | `cwd`, `model`, `onPermission`                                                                           |
| `session.url`                 | The app.devin.ai link                                                                          | `undefined`                                                                                              |
| `status` / `lifecycle` events | Yes (pushed to every attached client)                                                          | No                                                                                                       |
| `turn_state` events           | Yes (ACP v2)                                                                                   | No — the turn ends via the prompt result                                                                 |
| `devin.api`                   | Yes                                                                                            | No                                                                                                       |
| Extra session methods         | `setRepos`, `heartbeat`, `setSpendingLimit`, `respondToPermission`, secrets/net-policy helpers | `setModel`, `end`, `revert`/`forkFromStep`, `export`, `share`, subagent control                          |
| Good for                      | Anything deployed: webhooks, workers, dashboards, bots                                         | Local dev tooling, CI on a checkout, scripting the CLI                                                   |

Guidance:

- Deployed apps use cloud mode. Mention `createDevin({ cwd })` as an alternative in prose or a
  `--local` flag, but do not build either/or abstractions (`instanceof CloudDevin`, mode
  helpers). Write against the shared `DevinClient` / `AcpSession` types when a function must
  accept both.
- Local state (config, session store, cache) lives under `~/.devin-sdk`, isolated from an
  interactive Devin CLI install on the same machine. Pass `stateDir` to ship your own CLI
  config with the app.
- The CLI binary is an `optionalDependencies` per-platform package pinned by your lockfile —
  there is no path override and no "install the CLI first" step.
- Both clients are async-disposable. Prefer `await using devin = …`; otherwise call
  `devin.close()` in a `finally`. Closing ends every turn, stream and observer on that client,
  so keep it alive until they are done.

## 4. The core loop: session → turn → outcome

```ts
await using devin = await createDevin();
const session = await devin.createSession({ repos: ["your-org/your-product"] }); // cloud

const turn = session.run("Explain in one paragraph what this repo does. No tools.");

for await (const event of turn) {
  // optional: live events
  if (event.type === "message_delta") process.stdout.write(event.text);
}

const { text, stopReason, toolCalls } = await turn; // the settled outcome
console.log(stopReason, session.url ?? session.id);
```

- `session.run(input, options?)` returns a `Turn`: it is both an `AsyncIterable<SessionEvent>`
  and a `PromiseLike<SessionOutcome>`. Iterating is optional — the turn settles either way.
  `turn.accepted` resolves once the agent has taken the prompt.
- `SessionOutcome` has `stopReason` (`end_turn`, `max_tokens`, `max_turn_requests`,
  `refusal`, `cancelled`), `text` (accumulated agent text), `events`, `toolCalls` (merged
  snapshots) and `output` (see §5).
- `session.send(input)` is the low-level one-shot that only returns the ACP `PromptResult`
  (`stopReason`, `usage`). Prefer `run()`.
- `devin.launchSession(input, { session, turn })` = `createSession` + `run` in one call. It
  resolves when the turn is **accepted**, not finished; keep the client alive and await
  `turn` yourself. A failure after the id was allocated throws `SessionStartupError`
  (`.sessionId`) so you can inspect the session before retrying.
- A session keeps its own conversation history: call `run()` again on the same session for
  follow-ups (the evaluator-optimizer example feeds feedback back into the generator session
  this way). Use separate sessions when you want isolated contexts (router vs worker).
- `input` can be a string or content blocks (`import { prompt } from "@cognition-ai/sdk"` →
  `prompt.text()`, `prompt.image()`, `prompt.textResource()`, `prompt.resourceLink()`).
- For pure reasoning turns, end the prompt with `No tools.` as the examples do — it keeps
  classification/summarization turns fast and cheap.
- `session.cancel()` stops the current turn. `devin.releaseSession(session.id)` forgets a
  session on this client when you are done with it (the ticket-enricher does this in
  `finally`); the session itself keeps existing in Devin.

## 5. Structured output — Devin as a typed function

```ts
import { z } from "zod";

const Enrichment = z.object({
  kind: z.enum(["bug", "config", "question", "feature"]),
  severity: z.enum(["p0", "p1", "p2", "p3"]),
  summary: z.string().describe("One line for the ticket header"),
  rootCause: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

const { output } = await session.run(prompt, { output: Enrichment });
// output: z.infer<typeof Enrichment> — validated, or the turn rejected
```

- `output` accepts any Standard Schema (zod, valibot, arktype). The SDK appends
  output-format instructions (with a JSON Schema derived from the schema) to the prompt,
  parses the final agent message (whole message or last ```json block) and validates it.
  Validation failure **rejects the turn** — catch it like any other error.
- `.describe()` on fields is forwarded in the JSON Schema; use it to tell Devin what each
  field is for.
- `instructions: false` if your prompt already explains the JSON shape; `jsonSchema` to
  override the derived schema (rare).
- Pattern (ticket-enricher, anthropic-patterns): business object in → `session.run(…, { output })`
  → plain TypeScript `decide(output)` → side effects. Keep thresholds and branching in
  ordinary code that never sees Devin; it is unit-testable and the model only has to fill the
  schema. Never parse prose with regexes when a schema will do.
- Building blocks from the Anthropic patterns example (all `session.run` + zod):
  chaining (validated output of step N feeds step N+1 with a programmatic gate), routing
  (cheap classifier turn → specialized prompt), parallelization (`Promise.all` over
  sessions), orchestrator-workers (planner outputs `subtasks`, one session per subtask,
  planner merges), evaluator-optimizer (generator + grader sessions loop on `pass`).

## 6. Events: turn-scoped vs session-wide

Two different questions, two different streams:

| Need                                                                      | Use                                                | Scope                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Show _my_ prompt's progress                                               | `for await (e of turn)` or `session.stream(input)` | Only the turn this client sent; ends with the turn                                      |
| Watch a session _whoever_ is driving it (web app, Slack, another process) | `session.events(options?)`                         | Every live update until you `break`, pass an aborted `signal`, or the connection closes |
| Raw ACP payloads                                                          | `session.streamUpdates()` / `session.updates()`    | Same scopes, untyped                                                                    |

`SessionEvent` is a discriminated union — `switch (event.type)`:

- `message_delta` (`text`, `messageId`, `overwrite`, `aborted`, `chain: "main" | "side"`) —
  accumulate per `messageId`; `overwrite` replaces, `aborted` discards. Filter
  `chain === "main"` for the user-visible transcript.
- `thought_delta` — reasoning text; a new `messageId` means a new thought.
- `tool_call` (`call`, `settled`) — a merged snapshot; act on `settled` for one line per call.
- `plan` (`entries[] {content,status}`).
- `status` (cloud) — `status` (`working`, `blocked`, `finished`, …), `userActionRequired`,
  `message`, `finishedOutcome`. **This is the "Devin needs you / is done" signal** for
  observers; it reaches every attached client.
- `turn_state` (cloud, ACP v2) — `state: "idle"` + `stopReason` ends _your_ turn; observers
  of sessions driven elsewhere do not get it, use `status` instead.
- `lifecycle` (cloud) — VM `suspended` / `exited` / `stopped`.
- `pull_request` (cloud) — an invalidation with `prUrl`; refetch, it is not the new state.
- `activity`, `typing`, `user_message`, `mode_change`, `commands_change`, `raw` — nothing is
  dropped; unknown kinds arrive as `raw`.

Tool calls are normalized across cloud and local: narrow on `call.detail.tool` —
`exec` (`command`, `exitCode`, `cwd`), `read`/`write`/`edit` (`path`, `files`),
`list_directory`, `file_search` (`query`), `mcp` (`server`, `name`, `args`),
`permission_request` (`permissionType`, `command`, `requestId`), `ask_user_question`
(`questions`), `report_blocker`, `other`. Use `call.title` as the fallback label.

Session-level snapshot without waiting for an event: `session.meta` (status, URL, finished
outcome, what the user must do) is stamped on most cloud updates.

## 7. Permissions — safe by default

The agent asks before gated actions (running a command, deploying, …). **If no handler is
set the SDK rejects**, so unattended scripts are safe by default — but Devin may then be
unable to do the job. Decide explicitly:

```ts
import { createDevin, type PermissionHandler } from "@cognition-ai/sdk";

// Read-only investigation: allow everything except edits/deletes.
const noEdits: PermissionHandler = ({ call }) =>
  call?.kind === "edit" || call?.kind === "delete" || call?.kind === "move" ? "reject" : "allow";

const devin = await createDevin({ onPermission: noEdits }); // client-wide default
const session = await devin.createSession({ onPermission: () => "allow" }); // per session wins
```

- Return `"allow"` / `"reject"` (one-shot) or one of `request.options` / `{ optionId }`.
  `request.call` is the merged tool call (title, kind, `rawInput`, `detail`).
- Allowed shell commands can still change files inside Devin's sandbox; a `kind`-based
  filter is a guard rail, not a sandbox. Say so in read-only prompts too ("Do not modify any
  file").
- **Observers must not set `onPermission`.** An answer from an observer is a real decision
  and the protocol has no "abstain" — `attach()` without a handler when you only watch.
- Permission requests raised while no client was attached show up in the transcript as
  `permission_request` tool calls; answer those with `session.respondToPermission(...)`
  (cloud), not through `onPermission`.

## 8. Resume, attach, and durable workflows

The Devin session id (`devin-…`) is the durable handle. Persist it, not the client.

```ts
const session = await devin.attach(id); // cloud default: replay "none"
const { session: s2, replay } = await devin.loadSession(id); // replay "full" (or "tail")
for await (const event of session.events()) {
  /* … */
}
```

- `attach()` joins the live stream; `loadSession()` also returns the replayed transcript
  (`replay: "tail"` + `tailLimit` for the newest events only, then `session.loadPage()` for
  older history). Replayed history is **not** delivered through `events()`.
- The cloud replays only the latest status, so a client that was offline cannot reconstruct
  what it missed. Seed state from `devin.listSessionsPage({ updatedAfter, cursor })` — each
  `SessionInfo._meta` carries `cognition.ai/statusEnum`, `userActionRequired`,
  `pendingRequest`, `sessionPRs`, … — then stay attached for transitions (the session-board
  example: one server-side `createDevin()`, one `attach()`/`events()` loop per session, a
  slow `listSessionsPage` rescan for anything new).
- One client per process, shared by every request/tab. Do not open a `createDevin()` per HTTP
  request.
- `ConnectionClosedError` means the WebSocket/CLI is gone: in-flight requests reject with it
  and later ones fail immediately. Recover by forgetting the client, reconnecting after a
  short delay and re-attaching everything (session-board's `#lost()`), and surface it as
  "retry or start a new session" in UIs (harness-chat does).
- Long unattended waits on a cloud session: call `session.heartbeat()` periodically so the VM
  does not idle out; `setSpendingLimit(maxCredits)` caps ACU spend.
- Local sessions: `LocalDevin.listSessions({ cwd })`, `loadSession(id)`, `deleteSession(id)`;
  the CLI's session store is under `stateDir`.

## 9. `devin.api` — the escape hatch

`CloudDevin.api` is a `DevinApiClient` pre-authenticated with the same token (and
`baseUrl`/`fetch` if you passed them). It covers platform operations the session API does
not model: listing and searching sessions, session snapshots (`status_detail`,
`structured_output`, `pull_requests`), playbooks, secrets, repositories, organizations,
enterprise administration.

```ts
const devin = await createDevin({ orgId: "org_…" });

const snapshot = await devin.api.sessions.getSession({ org_id: "org_…", devin_id: session.id });
console.log(snapshot.status_detail, snapshot.pull_requests);

const repos = await devin.api.repositories.listRepositories({ org_id: "org_…" });
await devin.api.playbooks.listPlaybooks({ org_id: "org_…" });
```

- Resource clients hang off `devin.api.<resource>.<method>(params)`; most take `org_id`.
  Every method also accepts a trailing `RequestOptions` (`headers`, `maxRetries`,
  `timeoutInSeconds`, `abortSignal`). Errors are `DevinApiError` / `DevinApiTimeoutError`.
- Cloud only. `LocalDevin` has no `api`.
- Prefer the high-level methods when they exist: `devin.listSessionsPage`,
  `devin.mergePullRequest`, `devin.pullRequestMergeStatus`, `devin.createSecret`,
  `session.setRepos`, `session.setSpendingLimit`. Fall back to `devin.api` for the rest.
- Do not describe `devin.api` as "the REST API" in user-facing text — it is the generated
  TypeScript client; the reference lives under "API client › Using devin.api" in the docs.
  Generated JSDoc examples say `client.sessions…`; in your code that is `devin.api.sessions…`.
- The constructor classes (`DevinApiClient`, `DevinApi`) are exported if you need the client
  without an ACP connection, but `createDevin()` + `.api` is the normal path.

## 10. Production patterns (from the examples)

- **Webhook → Devin → decision** (ticket-enricher): validate the payload with the same zod
  schema you type against, check a shared secret with `timingSafeEqual`, respond `202`
  immediately (Devin takes minutes, webhook senders wait seconds), finish in the background,
  track in-flight jobs and drain them on `SIGINT`/`SIGTERM` before `devin.close()`. Deploy as
  a long-lived container (Dockerfile in the example); it is not serverless as written.
- **Live dashboard** (session-board): server owns the one Devin connection; browsers get
  server-sent events with a snapshot then deltas; throttle per-token `message_delta`
  publishing (~200 ms); rescan `listSessionsPage` on a slow interval with overlap so nothing
  falls between scans; bound `attach()` concurrency when catching up.
- **Chat UI with a sandbox** (harness-chat): use `@cognition-ai/harness-devin`'s
  `createDevin({ port })` inside a Vercel AI SDK `HarnessAgent` with a `Sandbox` provider;
  give Devin server-side tools via AI SDK `tool()`; `permissionMode: "allow-edits"` surfaces
  command approvals as chat cards; persist session/resume state (Upstash Redis in the
  example); turn on `debug` + `onLog` and route `devin.*` subsystems to a status line. Known
  limitation: the harness cannot apply ACP text replacements/withdrawals mid-stream (the
  core SDK's reducer can).
- **Multi-step agent workflows** (anthropic-patterns): see §5 — every pattern is
  `session.run` with a zod schema and plain control flow; no framework needed.
- **Scoping the work**: pass `repos: ["owner/repo"]` when creating a cloud session so Devin
  treats them as the relevant repositories (name as returned by
  `devin.api.repositories.listRepositories`); it throws a `DevinError` naming any repo the
  organization cannot access instead of silently dropping it. Say what is off-limits in the
  prompt ("Do not modify any file", "read-only commands only").
- Log `session.url` for every cloud session you start — it is the link a human uses to take
  over or review.

## 11. Pitfalls checklist

- `npm i @cognition-ai/sdk` failed → you forgot `@beta` / the exact version.
- Wrote an env var to pick local vs cloud → replace with `createDevin({ cwd })` vs `createDevin()`.
- Devin "did nothing" / tool calls rejected → no `onPermission`; add one deliberately.
- Turn rejected right after Devin answered → structured-output validation failed; check the
  schema vs what the prompt asked for, or loosen with `.nullable()`/`.optional()`.
- Iterated `session.events()` and never saw the end of _your_ turn → use the `Turn`
  (`turn_state`/outcome); `events()` is session-wide and only ends when you stop it.
- Watched a session and got `turn_state` nothing → you are an observer; watch `status`.
- Dashboard missed transitions after a restart → seed from `listSessionsPage` `_meta`, then attach.
- `ConnectionClosedError` everywhere → the client is dead; reconnect and re-attach, do not
  keep using it.
- `devin.api` is `undefined` → you have a `LocalDevin`; `api` is cloud-only.
- Set `WINDSURF_API_KEY` or asked the user to run `devin auth login` → unnecessary; use `DEVIN_API_KEY`.
- Key in a browser bundle or `.env` committed → move it server-side, rotate the token.

## References

- Docs (SDK tab): https://docs.devin.ai/sdk — quickstart, how it works (local vs cloud),
  guides (cloud/local sessions, structured output, streaming, watching sessions), generated
  SDK reference, and "API client › Using devin.api".
- Examples: https://github.com/COG-GTM/devin-sdk-examples
  - `quickstart/` — `stream.ts` (first turn, `--local` flag) and `events.ts` (every event type, tool-call `detail`)
  - `anthropic-patterns/` — chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer
  - `ticket-enricher/` — webhook → typed enrichment → `decide()` → sink; Dockerfile
  - `session-board/` — one connection, `listSessionsPage` + `attach` + `events()` → SSE board
  - `harness-chat/` — Next.js chat on `@cognition-ai/harness-devin` + Vercel Sandbox + Upstash
- Packages: https://www.npmjs.com/package/@cognition-ai/sdk, https://www.npmjs.com/package/@cognition-ai/harness-devin
- Protocol: https://agentclientprotocol.com/
