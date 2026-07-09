# Remote Claude Shell Manager

Observe and control many Claude Code sessions across desktops from a single
terminal UI. See the [design spec](docs/superpowers/specs/2026-07-04-remote-claude-shell-manager-design.md).

## Packages

| Package | Role |
|---|---|
| [`@rcsm/protocol`](packages/protocol) | WebSocket wire types (command/response/event frames) |
| [`@rcsm/worker`](packages/worker) | Daemon that owns Claude Agent SDK sessions and streams events |
| [`@rcsm/tui`](packages/tui) | Minimal Ink terminal client: agents view + session view |

Session-owning logic in `worker` is adapted from [open-walnut][ow] (MIT — see
`NOTICE`).

## Toolchain

[Bun][bun] is the runtime and package manager. TypeScript source runs directly —
**no build step for development.** `tsc` is kept only for type-checking.

```bash
bun install            # install deps
bun run worker &       # start a worker (bun run packages/worker/src/cli.ts)
bun run tui            # start the TUI  (bun run packages/tui/src/cli.tsx)

bun run typecheck      # tsc --noEmit across all packages
bun run build          # bun build → standalone dist/cli.js bundles (deploy only)
```

The worker spawns the `claude` CLI and uses its auth. For AWS Bedrock, start it
with `bun run worker -- --bedrock` (see [packages/worker](packages/worker#auth)).
Only the worker needs auth; the TUI just connects to it.

[bun]: https://bun.sh
[ow]: https://github.com/EvanZhang008/open-walnut
