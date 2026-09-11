# Anthropic agent patterns with the Devin SDK

The five agent workflow patterns from Anthropic's
[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents),
each implemented in ~40 lines on `session.run()` with Devin as the agent:

| Pattern                                             | Run                            | What it shows                                                                    |
| --------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| [Prompt chaining](src/chaining.ts)                  | `bun run chaining`             | Sequential steps in one session, a typed structured-output gate between them     |
| [Routing](src/routing.ts)                           | `bun run routing`              | A classifier turn whose zod-typed result dispatches to specialized handlers      |
| [Parallelization](src/parallelization.ts)           | `bun run parallelization`      | Independent sessions under `Promise.all` — sectioning and majority voting        |
| [Orchestrator-workers](src/orchestrator-workers.ts) | `bun run orchestrator-workers` | An orchestrator plans subtasks, workers run in parallel, the orchestrator merges |
| [Evaluator-optimizer](src/evaluator-optimizer.ts)   | `bun run evaluator-optimizer`  | A generator/evaluator loop driven by a typed pass/feedback verdict               |

The glue in every pattern is structured output: `session.run(prompt, { output: zodSchema })`
instructs the agent to reply with matching JSON, validates the reply, and gives you a
fully typed `outcome.output` to branch on in plain TypeScript.

## Prerequisites

- [Bun](https://bun.com) 1.4+ (runs the TypeScript sources directly)
- A Devin API key — a personal access token or service-user token (`cog_…`) from
  [app.devin.ai → Settings → API keys](https://app.devin.ai/settings/api-keys)

## Setup

```sh
cd anthropic-patterns
bun install        # @cognition-ai/sdk from npm (the pinned beta)
```

## Run

Every pattern works against Devin in the cloud or the bundled Devin CLI on your
machine — the pattern code is identical either way, and both need `DEVIN_API_KEY`.
Each pattern opens with bare `await createDevin()`, which connects to the cloud.

**Cloud** — sessions run in Devin's cloud VMs:

```sh
export DEVIN_API_KEY=cog_…
bun run chaining
```

Point a cloud session at a repository the way `cwd` points a local one at a directory —
the same choice as the repository picker in the web app, by the name it shows there:

```ts
const session = await devin.createSession({ repos: ["your-org/your-repo"] });
```

**Local** — sessions run through the Devin CLI bundled with the SDK, in the
current directory on your machine (the patterns are chat-only, so nothing is
written there). Ask for local explicitly by passing a `cwd`:

```ts
await using devin = await createDevin({ cwd: process.cwd() });
```

Then try the rest: `bun run routing`, `bun run parallelization`,
`bun run orchestrator-workers`, `bun run evaluator-optimizer`.

## What you should see

Model text varies run to run, but the shape is stable. `bun run evaluator-optimizer`,
for example, prints the grading loop converging:

```
round 1: pass=false — The implementation … does not swap lo and hi when lo > hi …
round 2: pass=true — It is a single line and correctly handles lo > hi …

final draft:
const clamp = (n, lo, hi) => Math.max(Math.min(n, Math.max(lo, hi)), Math.min(lo, hi));
```

and `bun run parallelization` prints three independent one-sentence reviews followed by
`votes safe=[false, false, false] -> majority: unsafe`.

## Troubleshooting

- **`No API key`** — set `DEVIN_API_KEY`; both cloud and local mode need it.
- **`Devin CLI not found`** — install without `--no-optional` so the platform CLI
  package is present for local mode.
- **Structured output failed validation** — the agent produced JSON that doesn't match
  the schema; the turn rejects rather than returning bad data. Re-run, or loosen the schema.
- **Transient errors under heavy parallelism** — each pattern script is safe to run
  concurrently _within_ itself; starting many separate local CLI processes at the same
  moment can hit transient auth errors. Run the scripts one at a time.
