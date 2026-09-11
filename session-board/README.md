# Session board

Every cloud session on one screen, grouped by whether Devin is **working**, **needs you**,
or **done** — updated the moment anything changes, with no per-session polling. A Next.js
app: the server holds one connection to Devin, the browser watches the board move.

```
NEEDS YOU (2)                      WORKING (3)                        DONE (14)
┌────────────────────────────┐     ┌────────────────────────────┐     ┌──────────────────────┐
│ ● Fix flaky checkout test  │     │ ● Migrate billing webhooks │     │ ● Add retry to export│
│   webapp · shop            │     │   slack · api              │     │   github · api  2h   │
│   ↳ Should I also update   │     │   executing actions ·      │     │   ⎇ #812 merged      │
│     the fixtures?          │     │   $ bun test               │     └──────────────────────┘
│ ● Add rate limiting        │     │   ⎇ #815 draft +120 −4     │
│   ↳ Answer 2 decisions     │     └────────────────────────────┘
│   ⎇ #812 open ✓            │
└────────────────────────────┘
```

Each card is one session: its title, where it was started and on which repos, the one
thing you have to do (when there is one), what Devin is doing right now, the last thing
it said, and its pull requests. A card lights up when it changes and moves columns as the
session's status does. Clicking it opens the session in the Devin web app.

> This is a single-user demo: there is no login, and anyone who can reach the board sees
> every session `DEVIN_API_KEY` can see — titles, prompts, messages, repositories and pull
> requests. Run it on your own machine, or put it behind your own auth or network before
> sharing a URL.

| File                                                           | Role                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [lib/board.ts](lib/board.ts)                                   | The board, server-side: `createDevin()`, seed from `listSessionsPage()`, `attach()` + `session.events()` per session |
| [lib/card.ts](lib/card.ts)                                     | The wire model both sides share: `Card`, its columns, the `BoardEvent` stream                                        |
| [app/api/board/stream/route.ts](app/api/board/stream/route.ts) | The board as server-sent events: a snapshot on connect, then a `card` per change                                     |
| [lib/use-board.ts](lib/use-board.ts)                           | The browser's copy of the board, fed by `EventSource`                                                                |
| [app/board.tsx](app/board.tsx)                                 | Columns, window / search / automation filters, the live indicator                                                    |
| [components/session-card.tsx](components/session-card.tsx)     | One session as a card                                                                                                |
| [Dockerfile](Dockerfile)                                       | The deployable: one container that talks to Devin's cloud                                                            |

## How it works

```
browser tabs ◄── SSE /api/board/stream ── Next.js server ── one WebSocket ──► Devin cloud
                                          lib/board.ts        attach() × every session
```

- One `createDevin()` connection, on the server, shared by every tab. `listSessionsPage()`
  seeds a card per session from the `_meta` each entry carries (`statusEnum`,
  `userActionRequired`, `pendingRequest`, `currentActivity`, `sessionOrigin`,
  `sessionRepos`, `sessionPRs`, `isUnread`, …), so the board is right before any live
  update arrives.
- `devin.attach(id)` joins each session and `session.events()` yields every update for it
  as typed events — from turns started in the web app, Slack, or another script alike.
  A `status` event moves the card and names the ask; `activity` and `tool_call` say what
  Devin is doing; `message_delta` keeps the last thing Devin said, which becomes the ask
  when the cloud does not name one; `pull_request` marks a PR as changed until the next
  scan refreshes it; a `permission_request` tool call turns into "Approve …" until it is
  answered.
- Every 30 s `listSessionsPage({ updatedAfter })` runs again to attach to sessions created
  or updated since, following pagination until all results have been read. Scans also
  refresh what live events only invalidate (pull requests) or never carry (unread,
  starred, ACU), and repair any transition the board missed while disconnected: a row
  newer than the card's last live update wins.
- Observers leave `onPermission` unset: an observer's answer to a permission request is a
  real decision, and the client driving the session should keep it. Clicking a card takes
  you to the web app, where you answer it.
- The columns follow the sidebar in the Devin app: `blocked` / `paused` / `waiting` is
  **needs you**, `finished` / `stopped` is **done**, everything else is **working**. A
  crashed or quota-limited session says so on its card; a session whose machine is asleep
  shows a moon while something is still expected of it.
- `/api/board/stream` sends the current board as a `snapshot`, then a `card` per change
  (at most every 200 ms per burst — streaming deltas arrive per token) and a `connection`
  note whenever the board's own link to Devin changes. `EventSource` reconnects on its
  own and every connection starts with a fresh snapshot, so the browser keeps no
  bookkeeping. If the WebSocket to Devin drops, the board reconnects, re-scans and
  re-attaches everything.

Attached sessions are cheap: one WebSocket and a few megabytes for hundreds of them; idle
sessions send nothing. So the board stays attached after the last tab closes, and a tab
that opens later gets a current snapshot at once instead of waiting for a scan. The window
picker (6h / 24h / 7d) widens what the server follows; "hide automations" and the filter
box are applied in the browser.

## Setup

```sh
cd session-board
bun install        # @cognition-ai/sdk from npm (the pinned beta)
```

## Run

```sh
export DEVIN_API_KEY=cog_…      # app.devin.ai → Settings → API keys
bun run dev                     # http://localhost:3211
```

Start a turn in one of the listed sessions from the web app and watch its card move.

## Deploy

One long-running process — the WebSocket to Devin lives in it — so it wants a host that
keeps a container up: a VM with `systemd`, ECS, Fly, Railway. Not serverless: a function
instance would have to hold that socket and the board across requests, and every tab
would get its own. The [Dockerfile](Dockerfile) builds it:

```sh
docker build -t session-board .
docker run -p 3211:3211 -e DEVIN_API_KEY session-board
```

Two stages: the first installs and builds with Bun, the second copies only Next's
[standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
onto a plain Node image and runs it as the unprivileged `node` user (about 450 MB, most of
it Node itself).

The only configuration is `DEVIN_API_KEY`. Whoever can reach the board sees every
session that key can see, so put it behind your own auth or network before sharing a URL.
