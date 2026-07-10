# @rcsm/tui

A minimal [Ink][ink] terminal client for the Remote Claude Shell Manager. Talks
directly to a single `@rcsm/worker` over WebSocket (no orchestrator tier yet).

## Two views

**Agents view** — every session as a row: status dot (green idle / yellow
running / red error), id, mode, and the last transcript line.

```
↑/↓ move · enter open · n new · x kill · r refresh · ? help · q quit
```

**Session view** — a minimal live transcript (assistant text, tool calls +
results, turn result with cost) plus a prompt composer for follow-ups.

```
i prompt · x kill · esc back · ? help · (enter send · esc cancel while typing)
```

Press `?` in either view for a full keybinding overlay (any key closes it).

## Connection

The TUI connects on launch and **auto-reconnects** with backoff if the worker
drops — important for a remote worker reached over an SSH tunnel, which can
blip. The header shows `connecting` / `open` / `closed`; the footer shows retry
progress while reconnecting. Quitting (`q` / ctrl-c) stops reconnection.

## Run

Runs straight from source with [Bun][bun] — no build step:

```bash
bun run packages/worker/src/cli.ts &       # start a worker on :7890
bun run packages/tui/src/cli.tsx           # connect the TUI
# or from repo root:  bun run worker  /  bun run tui
#   --worker ws://host:7890   point at a specific worker
#   --cwd <path>              working dir for new sessions
```

[bun]: https://bun.sh

New sessions are started in `bypass` permission mode (trusted local sessions),
matching the design spec.

## Scope

Intentionally minimal. Not implemented: scrollback paging, resize-aware
layout, multi-worker aggregation (that's the future `orchestrator` tier), and
interactive permission/question prompts (sessions run in `bypass`).

[ink]: https://github.com/vadimdemedes/ink
