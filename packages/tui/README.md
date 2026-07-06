# @rcsm/tui

A minimal [Ink][ink] terminal client for the Remote Claude Shell Manager. Talks
directly to a single `@rcsm/worker` over WebSocket (no orchestrator tier yet).

## Two views

**Agents view** — every session as a row: status dot (green idle / yellow
running / red error), id, mode, and the last transcript line.

```
↑/↓ move · enter open · n new · x kill · r refresh · q quit
```

**Session view** — a minimal live transcript (assistant text, tool calls +
results, turn result with cost) plus a prompt composer for follow-ups.

```
i prompt · x kill · esc back · (enter send · esc cancel while typing)
```

## Run

```bash
npm run build                              # from repo root
node packages/worker/dist/cli.js &         # start a worker on :7890
node packages/tui/dist/cli.js              # connect the TUI
#   --worker ws://host:7890   point at a specific worker
#   --cwd <path>              working dir for new sessions
```

New sessions are started in `bypass` permission mode (trusted local sessions),
matching the design spec.

## Scope

Intentionally minimal. Not implemented: scrollback paging, resize-aware
layout, multi-worker aggregation (that's the future `orchestrator` tier), and
interactive permission/question prompts (sessions run in `bypass`).

[ink]: https://github.com/vadimdemedes/ink
