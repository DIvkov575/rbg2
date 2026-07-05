# Remote Claude Shell Manager — Design

**Date:** 2026-07-04
**Status:** Approved (pending spec review)

## Purpose

A custom system for observing and controlling many Claude Code sessions ("shells")
running across several remote desktops, from a single local terminal UI with custom
rendering. Replaces reliance on the built-in `claude` TUI / `claude agents` view.

Motivating goals (from brainstorming):

- Manage **many shells at once** across multiple machines.
- **Custom rendering** of each conversation (not the stock TUI).
- Sessions run on **remote desktops** (where the code, builds, files live).
- **Observe and control** those sessions from a local client.

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Engine under each shell | **Agent SDK, events mode** | Clean structured event stream → enables custom rendering. We accept losing interactive-TUI conveniences (slash-command autosuggest, plan-mode UI, `@`-mention autocomplete). Model capability incl. auto-invoked skills is unaffected. |
| Permissions | **`--dangerously-skip-permissions` / `bypassPermissions`** | These are our own trusted sessions on our own desktops. Removes all approval plumbing; daemon loop is spawn → stream → forward. |
| Remote model | **Persistent remote worker** per desktop | Sessions survive SSH drops and orchestrator restarts. Worth the per-desktop deploy cost. |
| Daemon location | **Local orchestrator** aggregates remote workers | User drives everything from the local machine; workers live where the code is. |
| Binary structure | **Two separate programs** (worker, orchestrator) sharing a protocol lib | Clean separation of concerns; no logic duplication via the shared package. |
| Language/runtime | **All TypeScript / Node** | Agent SDK is Node-native; one toolchain; shared protocol types; Ink for TUI. |
| Transport | **SSH-forwarded unix socket** (for now) | Zero network exposure; auth = existing SSH keys. Swappable to WebSocket later. |

## Architecture

Three tiers. Sessions physically run on remote desktops; the local orchestrator
aggregates them; the TUI talks only to the orchestrator.

```
LOCAL MACHINE                          REMOTE DESKTOP A
┌─────────────────────────┐           ┌───────────────────────────┐
│ TUI client (Ink)        │           │ worker (owns sessions)    │
│    │ local unix socket  │           │  Map<shellId, SDK query()>│
│ orchestrator ───────────┼──ssh──────►  speaks protocol          │
│  aggregates workers     │           │  listens on unix socket   │
│  merged shell registry  │           └───────────────────────────┘
│  serves TUI locally     │           REMOTE DESKTOP B
│              ───────────┼──ssh──────► worker (owns sessions)     │
└─────────────────────────┘           └───────────────────────────┘
```

### Monorepo layout

```
packages/
  protocol/      shared: message types + framing (length-prefixed JSON)
  worker/        runs on each remote desktop; owns sessions
  orchestrator/  runs locally; aggregates workers; serves the TUI
  tui/           runs locally; Ink-based client
```

## Components

### `protocol` (shared library)

The contract every other package imports. No logic, minimal dependencies.

- Defines every message as a TypeScript type (see Protocol Messages below).
- Framing: each frame = **4-byte big-endian length prefix + JSON body**, over any
  Node `Duplex` stream.
- Exposes `encode(msg): Buffer` and a streaming `decoder` that reassembles frames
  across arbitrary chunk boundaries.
- Transport-agnostic: it only needs a byte-stream `Duplex`. This is what makes the
  transport swappable and lets both separate programs share one wire format.

### `worker` (remote, one per desktop)

Owns that machine's Claude sessions.

- Holds `Map<shellId, Shell>`. Each `Shell` = one Agent SDK `query()` in
  **streaming-input mode** (async-iterable prompt, so the session stays open across
  turns), launched with `permissionMode: bypassPermissions`.
- Listens on a unix socket (path from config/args).
- Translates protocol commands → SDK actions, and SDK events → protocol events.
- Maintains durable state on local disk (see Persistence).
- Survives SSH drops (it's a separate process) and orchestrator restarts
  (orchestrator re-lists on reconnect).

### `orchestrator` (local)

Aggregator + router + registry. Mostly stateless; reconstructable from workers.

- Reads a local config file listing workers (host, remote socket path, ssh target).
- Connects **out** to each worker over an SSH-forwarded unix socket.
- Keeps a **merged registry**: `globalShellId = workerId + ":" + shellId`.
- Re-serves the protocol on a **local** unix socket for the TUI.
- Handles workers appearing/disappearing; marks a worker's shells `disconnected`
  on drop and reconciles on reconnect.

### `tui` (local)

Ink application. Talks only to the orchestrator's local socket.

- Lists all shells across all desktops (with worker label + state).
- Spawns / kills shells.
- Custom-renders each shell's forwarded event stream (text, tool calls, results,
  usage) however we choose.
- Holds no session state; fully reconstructable on reconnect.

## Protocol messages

Every command carries a `requestId`. Failures return `error{requestId, code, message}`.

**Client → daemon (TUI→orchestrator, orchestrator→worker):**

- `listShells{}` → returns current registry / shell list
- `createShell{ workerId, cwd, model? }` → start a new session on a specific desktop.
  (The TUI includes `workerId` to target a desktop; the orchestrator strips it and
  sends `createShell{ cwd, model? }` down to that worker.)
- `sendPrompt{ shellId, text }` → push a user turn into the live session
- `attachShell{ shellId }` → subscribe to a shell's events (replays recent buffer first)
- `killShell{ shellId }` → interrupt + close the session

**Daemon → client:**

- `shellList{ shells: ShellInfo[] }`
- `shellCreated{ shellId, sdkSessionId }`
- `event{ shellId, sdkEvent }` — a forwarded SDK event
  (`system/init`, assistant text delta, `tool_use`, `tool_result`,
  `result`/usage/cost, `message_stop`, …)
- `shellClosed{ shellId, reason }`
- `error{ requestId, code, message }`

The orchestrator namespaces `shellId` → `globalShellId` when talking to the TUI, and
strips the namespace when routing back down to a worker.

## Data flow

**Create:**
```
TUI: createShell{ workerId, cwd, model? }
 → orchestrator forwards createShell{cwd, model} to that worker
   → worker starts query(), generates shellId, stores Shell
   → worker → orchestrator: shellCreated{ shellId, sdkSessionId }
     → orchestrator registers globalShellId, forwards up → TUI shows it
```

**Prompt (warm follow-up):**
```
TUI: sendPrompt{ globalShellId, text }
 → orchestrator routes to worker
   → worker pushes a user message into that query()'s input stream
     → session stays open, full context retained, no restart
```

**Events (push, no polling):**
```
worker's `for await (const evt of query)` fires per SDK event
 → worker wraps event{ shellId, sdkEvent }
   → orchestrator stamps globalShellId, forwards
     → TUI renders
```

**Kill:**
```
killShell{ globalShellId }
 → worker: query.interrupt() then query.close()
   → emits shellClosed, drops from map
     → orchestrator removes from registry
```

## Shell lifecycle / state model

Registry tracks per shell: `starting → live → (busy | idle) → closing → closed`,
plus `disconnected` (worker unreachable).

- `busy` vs `idle` derived from the event stream: `busy` between a user turn and its
  `message_stop`, else `idle`. Lets the TUI show which shells are actively working.
- One shell = one isolated `query()`. A shell crash never affects siblings or the worker.

## Persistence & reconnection

Three independent failure points:

### 1. TUI disconnects/restarts (common)
TUI holds no state. On reconnect: `listShells` → full merged registry, then
`attachShell` on any it wants. Worker keeps a **bounded in-memory ring buffer** of
recent events per shell; `attachShell` replays it before live events resume, so
reconnect shows recent scrollback, not a blank pane.

### 2. Orchestrator restarts
Reconnects to each configured worker, rebuilds registry from each worker's
`listShells`. Nothing lost — orchestrator is reconstructable. Worker config lives in a
local file read on startup.

### 3. Worker restarts / SSH drops (hard case)
- **SSH drop, worker survives:** orchestrator marks that worker's shells
  `disconnected` (TUI greys them out), retries the forwarded socket with backoff,
  re-lists on reconnect. No session loss.
- **Worker process restarts:** live `query()` objects are gone, but each session's
  **transcript JSONL persists on the remote disk**. On startup the worker reads its own
  `shells.json` (`shellId → sdkSessionId` + metadata) and rehydrates each shell via
  `query({ resume: sdkSessionId })`, reopening a warm session with full history.
  Mid-turn shells resume cleanly on the next prompt.

### Persistence layers (both on the worker)
- **Durable:** SDK transcript JSONL (context/history) + a small `shells.json`
  mapping our `shellId` → SDK `sessionId` + metadata (cwd, title, createdAt).
- **Ephemeral:** recent-events ring buffer for fast reconnect scrollback.

## Error handling conventions

- Every command carries a `requestId`; failures return `error{requestId, code, message}`
  rather than being silently dropped.
- A crashing shell (SDK query throws) emits `shellClosed{reason}`; never takes down the
  worker or sibling shells.
- Malformed/unknown protocol messages are rejected with an `error`, never crash the
  receiver.

## Logging (cross-cutting)

- **Structured JSON-line logs** in every program. Each line stamped with `program`
  (worker/orchestrator/tui), `workerId`, `shellId`, `requestId`, `level`, `msg`,
  monotonic timestamp — so a shell's whole life is greppable across all three tiers by id.
- **Levels** via `LOG_LEVEL=debug|info|warn|error` (default `info`); `--verbose` =
  shortcut for `debug`.
- **At debug:** every protocol message in/out (with `requestId`; prompt/response
  *content* truncated/redacted by default), every state transition, every SSH
  connect/drop/retry with backoff timing, every forwarded SDK event type (type +
  shellId, not full payload), worker rehydration steps, every error with stack.
- **Sinks:** worker → `~/.<appname>/worker.log` on its remote desktop + stderr
  (`<appname>` = TBD final project name, chosen at implementation start);
  orchestrator + TUI → local files. Rotated/bounded so they don't grow unbounded.

## Testing

- **`protocol`:** unit tests — encode/decode round-trips, framing across chunk
  boundaries (message split across reads must reassemble), malformed-frame rejection.
  Tested hardest; it's the contract.
- **`worker`:** command→SDK and SDK-event→protocol translation with the **Agent SDK
  mocked** (fake `query()` emitting scripted events) — fast, offline. Covers
  create/prompt/kill lifecycle, one shell crashing without affecting siblings,
  rehydration reading `shells.json` and calling `resume`.
- **`orchestrator`:** registry merging, id namespacing, reconnection/backoff against a
  **fake worker** (in-memory duplex speaking the protocol), including
  worker-drop → `disconnected` → reconnect → re-list.
- **E2E smoke** (thin, manual/scripted): real worker on localhost over a real unix
  socket, real Claude session, spawn → prompt → observe events → kill. One happy path.
- Transport is behind an interface; all tests run over in-memory duplex streams — no
  sockets/SSH except the one E2E smoke.

## Explicitly out of scope (YAGNI)

- Appearing in the built-in `claude agents` view (would require reverse-engineering the
  daemon's private roster/socket/PTY protocol; brittle and version-fragile).
- Interactive-TUI parity: slash-command autosuggestion, `@`-mention autocomplete,
  plan-mode UI, in-TUI help. (Auto-invoked skills still work; only the human-typed
  `/command` affordance is absent unless later rebuilt.)
- Per-shell permission approval routing (we run bypass-permissions).
- WebSocket/TCP transport (interface leaves room; not built now).
