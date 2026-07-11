#!/usr/bin/env bash
#
# dev.sh — the one command. Ship the latest code to the remote desktop, make
# sure the worker is up, tunnel in, and drop you into the TUI.
#
# After any code change, just run:   scripts/dev.sh
#
# Flags are passed through:
#   scripts/dev.sh --host dev-dsk-xxx.amazon.com
#   scripts/dev.sh --local            # run everything on THIS machine (no SSH)
#   scripts/dev.sh --no-deploy        # skip the redeploy, just tunnel + TUI
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL=0
DEPLOY=1
PASS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)     LOCAL=1; shift ;;
    --no-deploy) DEPLOY=0; shift ;;
    *)           PASS+=("$1"); shift ;;
  esac
done

# ── Local mode: worker + TUI on this machine, no SSH at all ───────────────
if [[ "$LOCAL" -eq 1 ]]; then
  echo "▸ local mode: worker + TUI on this machine"
  ( cd "$REPO_ROOT" && bun run worker -- --bedrock --port 7890 >/tmp/rcsm-local-worker.log 2>&1 & )
  # wait until it answers
  for _ in $(seq 1 20); do
    ( cd "$REPO_ROOT" && bun run cli -- --worker ws://127.0.0.1:7890 --json ping >/dev/null 2>&1 ) && break
    sleep 0.5
  done
  echo "  ✓ worker up (log: /tmp/rcsm-local-worker.log)"
  exec bash -c "cd '$REPO_ROOT' && bun run tui -- --worker ws://127.0.0.1:7890"
fi

# ── Remote mode (default): deploy latest, then tunnel + TUI ───────────────
if [[ "$DEPLOY" -eq 1 ]]; then
  echo "▸ deploying latest code to the remote…"
  "$REPO_ROOT/scripts/deploy-remote.sh" "${PASS[@]}"
  echo
fi

echo "▸ connecting…"
exec "$REPO_ROOT/scripts/tunnel.sh" "${PASS[@]}"
