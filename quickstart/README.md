# Quickstart

Two small programs that show the shape of the SDK: start a session, send a prompt, and
read what Devin does — as typed events — the same way whether the session runs in Devin's
cloud or in the Devin CLI on your machine.

| Program                 | Run              | What it shows                                                                 |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------- |
| [stream](src/stream.ts) | `bun run stream` | The minimum: `createDevin()` → `createSession()` → `run()`, print the reply   |
| [events](src/events.ts) | `bun run events` | `switch` on every event type; each tool call with what it did (`call.detail`) |

Add `--local` to either to run in the bundled Devin CLI in the current directory instead of
the cloud. The code is identical; only `createDevin({ cwd })` changes.

## Choose the ACP version

Add `--acp-v1` to either program to pass `acpVersion: 1` to `createDevin`:

```sh
bun run stream --acp-v1
bun run events --local --acp-v1
```

Without this flag, the SDK offers ACP v2 and still accepts a v1 agent. Both versions use the
same `createSession()`, `run()`, and typed events, so no separate v1 program is needed: the
SDK picks the matching session methods and turn-completion signal after negotiation.

The `turn_state` event is v2-only; use the result of `await turn` for completion on either
version. Raw ACP updates keep their version-specific shapes, and the cloud `replay: "tail"`
load option requires v2. `devin.protocolVersion` reports the selected version.

## What the events program prints

```
$ bun run events
Creating the file, reading it back, listing the directory…      ← reasoning, dimmed
completed  write ./hello.txt
completed  read ./hello.txt
completed  $ ls -la  → exit 0
I created hello.txt with a greeting, read it back, and listed the directory.
turn ended: end_turn
--
3 tool calls, stopped: end_turn
```

`event` is a discriminated union (`SessionEvent`), so each `case` narrows it. Tool calls
carry a normalized `detail` — `exec` (command, exit code), `read`/`write`/`edit` (path),
`mcp`, `permission_request`, `ask_user_question`, … — so you never string-match titles, and
the cloud's and the CLI's different wire encodings look the same.

## Setup

```sh
cd quickstart
bun install                  # @cognition-ai/sdk from npm (the pinned beta)
export DEVIN_API_KEY=cog_…   # app.devin.ai → Settings → API keys
bun run stream
```

## Where next

- [anthropic-patterns](../anthropic-patterns) — `run(prompt, { output: zodSchema })` for typed
  structured output, and the agent workflow patterns built on it
- [session-board](../session-board) — `attach()` + `session.events()` to watch sessions
  you did not start
- [ticket-enricher](../ticket-enricher) — a session as the business logic behind a webhook
