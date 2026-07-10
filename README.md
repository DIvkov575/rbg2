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

Three scripts in [`scripts/`](scripts) drive this. The remote host is read from
`RCSM_HOST`, a `--host` flag, or `RBG_HOST=` in `~/.rbg.conf`.

```bash
scripts/deploy-remote.sh          # cross-compile → ship → install → (re)start
                                  # under a keep-alive supervisor. Re-run = update.
scripts/tunnel.sh                 # SSH tunnel + launch the local TUI against it
scripts/remote-auth.sh            # check remote Bedrock/Midway auth
scripts/remote-auth.sh --login    # run `mwinit` on the desktop (needs key touch)
```

Typical loop: `deploy-remote.sh` whenever you change code, then `tunnel.sh` to
test. No Bun/Node needed on the remote — the shipped binary is self-contained.

If sessions fail with a credential error, the **desktop's** Midway session has
expired (separate from your laptop's SSH cert) — run `remote-auth.sh --login`.

[bun]: https://bun.sh
[ow]: https://github.com/EvanZhang008/open-walnut
