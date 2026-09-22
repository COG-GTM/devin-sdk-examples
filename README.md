![Devin SDK](./assets/hero.gif)

# Devin SDK examples

Runnable examples for the [Devin SDK](https://www.npmjs.com/package/@cognition-ai/sdk)
(`@cognition-ai/sdk`) and the [AI SDK harness adapter](https://www.npmjs.com/package/@cognition-ai/harness-devin)
(`@cognition-ai/harness-devin`). Each folder is a standalone project with its own README:
clone, `bun install` inside the example, bring a Devin API key, and run.

```sh
git clone https://github.com/COG-GTM/devin-sdk-examples
cd devin-sdk-examples/<example>
bun install
export DEVIN_API_KEY=cog_…   # from app.devin.ai → Settings → API keys
```

| Example                                  | What it shows                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [quickstart](quickstart)                 | Start here: `createDevin()` → `createSession()` → `run()`, print the reply as it streams; then the same turn with a `switch` over every typed event and each tool call's normalized `detail` (command, exit code, path, …) — identical for cloud and local                                                            |
| [anthropic-patterns](anthropic-patterns) | The five agent workflow patterns from Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer — on `session.run()` with typed structured output                                      |
| [harness-chat](harness-chat)             | A Next.js chat where the AI SDK `HarnessAgent` runs Devin inside a Vercel Sandbox via `@cognition-ai/harness-devin`: `useChat` streaming, session resume across requests (Upstash Redis), a sandbox file browser, and a Deploy-with-Vercel button                                                                     |
| [cloudflare-agents](cloudflare-agents)   | A Cloudflare Agents chat where each conversation is an `AIChatAgent` facet driving a Devin cloud session via `@cognition-ai/cloudflare-agents`: `useAgentChat` streaming of text, reasoning, typed tool calls, plans and pull requests; chats, transcripts and session ids persisted in Durable Object SQLite; continue an existing session; workerd tests |
| [session-board](session-board)           | A Next.js board of every cloud session — needs you / working / done — kept current by `session.events()` over one server-side connection, streamed to the browser as server-sent events: `listSessionsPage()` `_meta` seeds the cards, live `status`, `activity`, `message_delta` and `pull_request` events move them |
| [ticket-enricher](ticket-enricher)       | A help desk webhook whose business logic is a Devin session: ticket in, read-only investigation of your product's repo, typed `Enrichment` out, plain code decides reply / open issue / assign human. Deploys as one container talking to Devin's cloud                                                               |

The packages are beta-only: every release is a `0.0.1-beta.N` prerelease on the `beta`
dist-tag, so install them as `@cognition-ai/<package>@beta` (a plain `npm i @cognition-ai/sdk`
fails on purpose). Every example here pins the beta it was tested against — currently
`0.0.1-beta.6` — and the examples for an earlier beta are the matching tag of this repository
(`v0.0.1-beta.5`, `v0.0.1-beta.4`, `v0.0.1-beta.2`, `v0.0.1-beta.1`, …).

Quickstart and anthropic-patterns support cloud and local sessions. Session-board and
ticket-enricher use the cloud and each ship a Dockerfile; harness-chat runs the CLI inside
Vercel Sandbox; cloudflare-agents runs on Cloudflare Workers and Durable Objects. Each example's
README lists its runtime and credentials.

Requires [Bun](https://bun.com) (see `.bun-version`) and Node.js 22 or newer.

## Agent skill

[`skills/devin-sdk`](skills/devin-sdk/SKILL.md) is an [Agent Skills](https://agentskills.io)
guide to the SDK — install, `createDevin`, cloud vs local, environment variables, structured
output, events, permissions, `devin.api`, and the patterns these examples use — for coding
agents such as Claude Code, Cursor or Devin:

```sh
npx skills add COG-GTM/devin-sdk-examples
```

This repository is a snapshot of the examples maintained alongside the SDK, published here
so they can be cloned and deployed on their own during the beta. Questions and problems:
[open an issue](https://github.com/COG-GTM/devin-sdk-examples/issues).
