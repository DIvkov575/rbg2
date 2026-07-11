# Remote Claude Shell Manager

Observe and control many Claude Code sessions across desktops from a single
terminal UI. See the [design spec](docs/superpowers/specs/2026-07-04-remote-claude-shell-manager-design.md).

## Packages

| Package | Role |
|---|---|
| [`@rcsm/protocol`](packages/protocol) | WebSocket wire types (command/response/event frames) |
| [`@rcsm/worker`](packages/worker) | Daemon that owns Claude Agent SDK sessions and streams events |
| [`@rcsm/client`](packages/client) | Shared client: WebSocket RPC/event client + event-folding store |
| [`@rcsm/tui`](packages/tui) | Minimal Ink terminal client: agents view + session view |
| [`@rcsm/cli`](packages/cli) | Plain scriptable CLI (no TTY) — `rcsm ping/list/spawn/send/watch/kill` |

Session-owning logic in `worker` is adapted from [open-walnut][ow] (MIT — see
`NOTICE`).

## Toolchain

[Bun][bun] is the runtime and package manager. TypeScript source runs directly —
**no build step for development.** `tsc` is kept only for type-checking.

```bash
bun install            # install deps
bun run worker &       # start a worker (bun run packages/worker/src/cli.ts)
bun run tui            # start the TUI  (bun run packages/tui/src/cli.tsx)
bun run cli -- list    # or the plain CLI (bun run packages/cli/src/cli.ts)

bun run typecheck      # tsc --noEmit across all packages
bun run compile        # standalone binaries → bin/rcsm-worker, rcsm-tui, rcsm
```

The worker spawns the `claude` CLI and uses its auth. For AWS Bedrock, start it
with `bun run worker -- --bedrock` (see [packages/worker](packages/worker#auth)).
Only the worker needs auth; the TUI just connects to it.

## Running on a remote desktop

Run the worker on a remote desktop (where the code and Bedrock creds live) and
drive it from your laptop's TUI over an SSH tunnel. The worker binds
`127.0.0.1` only — nothing is exposed on the network; auth is your SSH keys.

**One command** — ship the latest code, (re)start the remote worker under a
keep-alive supervisor, tunnel in, and open the TUI:

```bash
bun run dev            # remote desktop (host from ~/.rbg.conf RBG_HOST)
bun run dev:local      # or run everything on THIS machine, no SSH
```

Under the hood `bun run dev` runs `scripts/deploy-remote.sh` then
`scripts/tunnel.sh`; pass `--no-deploy` to skip the rebuild, or `--host` to
target a specific desktop. No Bun/Node needed on the remote — the shipped
binary is self-contained.

Two independent auth layers can block a connection:

- **Can't SSH at all** (`Permission denied (publickey)`) → your **laptop's**
  Midway/SSH cert expired. Run `mwinit` locally.
- **Sessions fail with a credential error** but SSH works → the **desktop's**
  Midway session expired (separate from your laptop's). Run `mwinit` on the
  desktop: `ssh -t "$HOST" mwinit`.

[bun]: https://bun.sh
[ow]: https://github.com/EvanZhang008/open-walnut
