# @rcsm/worker

The **worker** tier of the Remote Claude Shell Manager. It runs on a desktop,
owns that machine's Claude Code sessions (one Agent SDK `query()` each), and
exposes them over a WebSocket wire protocol (`@rcsm/protocol`).

This is the `worker` component from the [design spec][spec]. The session-owning
logic is adapted from [open-walnut][ow]'s `src/session-server/` (MIT — see the
repo-root `NOTICE`).

## Run

Runs straight from TypeScript source with [Bun][bun] — no build step:

```bash
bun run packages/worker/src/cli.ts --port 7890 --data-dir ~/.rcsm
# or, from repo root:  bun run worker -- --port 7890
# prints: { "port": 7890, "pid": 12345 }
```

To produce a standalone bundle for deployment: `bun run build` (emits
`dist/cli.js`, runnable with node or bun).

### Auth

The worker spawns the `claude` CLI, so sessions use whatever auth that CLI is
configured for. Two paths:

- **Subscription / API key** (default) — nothing extra; the CLI uses its own
  login.
- **AWS Bedrock** — pass `--bedrock` (and optionally `--region`, default
  `us-west-2`). Auto-enabled if `CLAUDE_CODE_USE_BEDROCK=1` is already in the
  environment. AWS credentials come from the ambient chain (env / profile /
  SSO), so make sure `aws sts get-caller-identity` succeeds first.

```bash
bun run worker -- --bedrock --region us-west-2
# equivalently:  CLAUDE_CODE_USE_BEDROCK=1 bun run worker
```

Only the **worker** needs auth — the TUI just talks to it over WebSocket.

[bun]: https://bun.sh

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
