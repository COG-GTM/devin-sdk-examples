# Support ticket enricher

A help desk webhook where the business logic is a Devin session. A ticket arrives,
Devin reads your product's source and runs whatever read-only checks settle the
question, and hands back a typed `Enrichment`. Plain TypeScript then decides what
happens to the ticket: reply to the customer, open an engineering issue, or route to a
human, with an internal note either way.

```
POST /webhooks/tickets ──▶ 202 Accepted
        │
        ▼
enrich(session, ticket)      Devin, no file edits, scoped to your product's repo
        │  Enrichment       { kind, severity, affectedCode[], rootCause, customerReply, confidence }
        ▼
decide(ticket, enrichment)   your rules, no model involved
        │  Action[]
        ▼
sink.apply(...)              help desk + issue tracker (console here)
```

What makes this a Devin example rather than a prompt: the answer needs a machine. "Do
you retry webhooks on a 5xx?" is answered by finding the delivery code and reading the
retry policy out of it; "the CSV export is a day off for Sydney" by locating the
formatter, checking which zone it uses, and — if it helps — running the tests or a small
script against it. The reply cites files, and `confidence` is low when the code did not
settle the question, which `decide` turns into "assign a human".

| File                           | Role                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [src/enrich.ts](src/enrich.ts) | `Ticket` in, `Enrichment` out — the zod schema _is_ the contract with Devin; `session.run(prompt, { output: Enrichment })` |
| [src/decide.ts](src/decide.ts) | `Enrichment → Action[]`: auto-reply only for questions/config above a confidence bar, issue for bugs, human for the rest   |
| [src/handle.ts](src/handle.ts) | `createDevin()` plus `REPO`, and the pipeline for one ticket: open a session on the repo, enrich, decide, apply, release   |
| [src/server.ts](src/server.ts) | `Bun.serve` webhook: check the secret, validate, `202`, enrich in the background, drain on `SIGTERM`                       |
| [src/cli.ts](src/cli.ts)       | Same pipeline for one ticket file, no server                                                                               |
| [src/sink.ts](src/sink.ts)     | Where actions land — swap the console for your help desk and issue tracker clients                                         |
| [fixtures/](fixtures)          | Three tickets in the shape a help desk sends: a question, a config problem, a bug                                          |
| [Dockerfile](Dockerfile)       | The deployable: one container that talks to Devin's cloud                                                                  |

## Prerequisites

- [Bun](https://bun.com) 1.4+
- A Devin API key (`cog_…`) from
  [app.devin.ai → Settings → API keys](https://app.devin.ai/settings/api-keys)
- A repository the tickets are about, that Devin can see — your product, or any repo
  you have connected to Devin

## Setup

```sh
cd ticket-enricher
bun install        # @cognition-ai/sdk from npm (the pinned beta)
export DEVIN_API_KEY=cog_…
```

Then open [src/handle.ts](src/handle.ts) and change one line:

```ts
const REPO = "your-org/your-product";
```

## Run

**One ticket, no server:**

```sh
bun run enrich fixtures/question-webhook-retries.json
```

**As a webhook** — start the server, then POST a ticket the way Pylon, Intercom or
Zendesk would:

```sh
export WEBHOOK_SECRET=$(openssl rand -hex 16)
bun run serve &
curl -X POST localhost:8787/webhooks/tickets \
     -H 'content-type: application/json' -H "x-webhook-secret: $WEBHOOK_SECRET" \
     --data @fixtures/config-sso-login-loop.json
# → {"accepted":"T-1042"}  immediately; the enrichment lands in the server log a few minutes later
```

The fixtures are deliberately generic — a webhook retry question, an SSO login loop, a
timezone bug — so the first thing to try is a ticket about _your_ product. Point a
fixture at something your repo actually does and watch Devin find it; leave one pointed
at something it doesn't do and watch it say so with low confidence.

## Where Devin runs

In Devin's cloud. `createDevin()` opens a connection to it, and
`createSession({ repos: [REPO] })` starts a session with that repository checked out on
Devin's machine. Every file read, search and shell command happens there; this process
never sees the code. The permission handler rejects requests identified as edits,
deletes, or moves. It is not a read-only sandbox: shell commands can change files,
and tools that do not request permission bypass this handler. The instruction to
investigate without making changes is a prompt constraint. A session can run tests and
reproduction commands in that sandbox.

The SDK can also run Devin's tools locally — `createDevin({ cwd: "/path/to/checkout" })`
starts the Devin CLI as a subprocess against a directory on your machine. This example
does not use it: a webhook you deploy has no checkout to point at, and the point of the
example is that it doesn't need one.

## Deploying

The deployable is one long-lived process: it answers `202` in milliseconds and keeps
working on the ticket for the next few minutes, then goes back to waiting. That shape
fits any host that runs a container and keeps it up — Fly, Railway, Render, Cloud Run
with a minimum instance count, ECS, a VM with `systemd`. The [Dockerfile](Dockerfile)
builds it:

```sh
docker build -t ticket-enricher .
docker run -p 8787:8787 -e DEVIN_API_KEY -e WEBHOOK_SECRET ticket-enricher
```

Three things it needs from the platform:

- **Two secrets**: `DEVIN_API_KEY` and `WEBHOOK_SECRET`. Nothing else is configured;
  there is no database.
- **A graceful stop.** On `SIGTERM` the server stops accepting tickets, finishes the ones
  it already acknowledged, and exits. Set the platform's shutdown grace period to at
  least a few minutes, or an in-flight ticket is lost on every deploy (see
  "Adapting it" for the fix if that matters).
- **Nothing to do with Devin's runtime.** The image installs with `--omit=optional`, so
  the CLI binaries are not in it. Devin does the cloning, running and reading in its own
  sandbox; this container is a thin client.

**Serverless.** This example does not run as written on Vercel, Lambda or Cloud
Functions: the handler returns before the work is done, and a function is frozen or
killed once it responds. The fix is a queue — the route enqueues the ticket, a worker
(a container like this one, or a queue-triggered function with a long timeout) runs
`handle()`. If you want Devin _inside_ a Vercel deployment, [harness-chat](../harness-chat)
shows that shape.

## Adapting it

- **Your help desk.** Map its webhook payload onto `Ticket` (or widen the schema) in
  [src/enrich.ts](src/enrich.ts) and implement `Sink` for its API and your issue tracker.
  Replace the shared-secret check in [src/server.ts](src/server.ts) with the help desk's
  signature scheme (Pylon, Intercom and Zendesk each sign differently).
- **Your product.** `REPO` is the only thing that says which one. Tune the first
  paragraph of `prompt()` if your repo needs orientation (a monorepo, say).
- **Your rules.** `decide` is ordinary code: change the confidence bar, add a plan-based
  SLA, require a human for `p0`. None of that touches the model.
- **Restarts and bursts.** Each ticket gets its own session and tickets enrich in
  parallel. Put a queue in front (BullMQ, SQS, your framework's job runner) if the help
  desk can burst faster than you want to spend, and persist `session.id` on the job so a
  restart can `devin.attach(id)` instead of starting over.

## Troubleshooting

- **`Authentication … failed`** — set `DEVIN_API_KEY`.
- **Devin can't find the repo, or explores the wrong one** — `REPO` must name a repository
  connected to your Devin organization; what is on Devin's machine is decided there, not
  by this code.
- **`401` from the webhook** — the `x-webhook-secret` header does not match
  `WEBHOOK_SECRET`.
- **Structured output failed validation** — Devin's reply didn't match `Enrichment`; the
  turn rejects rather than returning bad data. The server logs `[id] failed:` and the
  ticket is untouched, so the help desk's own SLA timers still apply.
