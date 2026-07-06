# @rcsm/worker

The **worker** tier of the Remote Claude Shell Manager. It runs on a desktop,
owns that machine's Claude Code sessions (one Agent SDK `query()` each), and
exposes them over a WebSocket wire protocol (`@rcsm/protocol`).

This is the `worker` component from the [design spec][spec]. The session-owning
logic is adapted from [open-walnut][ow]'s `src/session-server/` (MIT — see the
repo-root `NOTICE`).

## Run

```bash
npm run build            # from repo root (builds protocol + worker)
node packages/worker/dist/cli.js --port 7890 --data-dir ~/.rcsm
# prints: { "port": 7890, "pid": 12345 }
```

## Protocol (summary)

JSON frames over WebSocket. Commands `client → worker`, responses + events
`worker → client`.

| Command | Purpose |
|---|---|
| `session.start` | start (or `resume`) a session; acks with `sessionId` |
| `session.send` | push a follow-up turn (warm streamInput, or resume if idle) |
| `session.interrupt` | interrupt the current turn |
| `session.setMode` | change permission mode |
| `session.stop` | interrupt + close + drop |
| `session.respondToQuestion` / `session.respondToPermission` | answer an interactive request |
| `session.list` | list live sessions |
| `ping` | liveness |

Events are broadcast to all connected clients: `session:init`, `text-delta`,
`tool-use`, `tool-result`, `ask-question`, `permission-request`,
`plan-complete`, `compact`, `result`, `error`, `status`.

## Deltas from the design spec

Kept intentionally small; noted here so the spec stays honest.

- **Transport is WebSocket-over-HTTP, not an SSH-forwarded unix socket.** Kept
  from open-walnut for now; the SSH/unix-socket transport and a `Duplex`
  abstraction are deferred (per decision during the rip).
- **No `attachShell` / event ring buffer yet.** open-walnut broadcasts events to
  all connected clients rather than replaying a per-shell buffer on attach. The
  spec's bounded ring buffer for reconnect scrollback is not implemented here.
- **Naming:** the wire uses `sessionId` + `session.*` methods (open-walnut's
  vocabulary) rather than the spec's `shellId` + `createShell/sendPrompt`. The
  concepts map 1:1.
- **Extra capability inherited for free:** interactive permission / plan / ask
  modes and compaction events, which the spec had scoped out under
  bypass-permissions. `mode: 'bypass'` still gives the spec's behavior.

## Not in this package

The `orchestrator` (multi-desktop aggregation) tier from the spec is not built
yet. The `tui` (Ink client) lives in `packages/tui` and connects to this worker
directly.

[spec]: ../../docs/superpowers/specs/2026-07-04-remote-claude-shell-manager-design.md
[ow]: https://github.com/EvanZhang008/open-walnut
