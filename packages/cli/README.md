# @rcsm/cli

A plain, scriptable command-line client for a `@rcsm/worker` — the non-TUI
frontend. No TTY needed, so it's ideal for testing, automation, and piping.
Speaks the same wire protocol via the shared [`@rcsm/client`](../client).

## Run

```bash
bun run packages/cli/src/cli.ts <command>      # from repo root: bun run cli -- <command>
# or the compiled binary after `bun run compile`:
./bin/rcsm <command>
```

## Commands

| Command | Description |
|---|---|
| `ping` | liveness check |
| `list` / `ls` | list sessions |
| `spawn <message> [--watch]` | start a session; `--watch` streams until the first turn completes |
| `send <id> <message> [--watch]` | push a follow-up turn |
| `watch [<id>]` | stream events (all sessions, or one) until ^C |
| `kill <id>` | stop a session |

## Flags

| Flag | Meaning |
|---|---|
| `--worker <url>` | worker URL (default `ws://127.0.0.1:7890`, or `$RCSM_WORKER`) |
| `--json` | machine-readable JSON output (one JSON value/event per line) |
| `--cwd <path>` | working dir for a spawned session |
| `--mode <mode>` | permission mode: `bypass` \| `accept` \| `plan` \| `default` |

## Examples

```bash
# spawn and watch a full turn
rcsm spawn "Reply with exactly: hi" --watch

# scriptable: capture the session id, follow up, then kill
sid=$(rcsm --json spawn "count to 3" | tail -1 | jq -r .sessionId)
rcsm send "$sid" "now to 5" --watch
rcsm kill "$sid"

# tail every session's event stream
rcsm watch --json | jq .

# point at a remote worker over an SSH tunnel
rcsm --worker ws://127.0.0.1:7890 list
```

Like the TUI, the client auto-reconnects if the worker drops.
