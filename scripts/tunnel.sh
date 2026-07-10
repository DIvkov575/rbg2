#!/usr/bin/env bash
#
# tunnel.sh — open an SSH tunnel to the remote worker and launch the local TUI
# against it. This is the convenient "test it" command.
#
# The remote worker binds 127.0.0.1 only (never network-exposed); we forward a
# local port to it over SSH, so auth = your existing SSH keys and nothing is
# open on the network.
#
# Config resolution mirrors deploy-remote.sh (flags > env > ~/.rbg.conf > defaults).
#
# Usage:
#   scripts/tunnel.sh                       # tunnel + launch TUI
#   scripts/tunnel.sh --no-tui              # just hold the tunnel open
#   scripts/tunnel.sh --host dev-dsk-xxx --port 7890
#
set -euo pipefail

HOST="${RCSM_HOST:-}"
PORT="${RCSM_PORT:-7890}"
LOCAL_PORT="${RCSM_LOCAL_PORT:-7890}"
LAUNCH_TUI=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOST="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --local-port) LOCAL_PORT="$2"; shift 2 ;;
    --no-tui)     LAUNCH_TUI=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$HOST" && -f "$HOME/.rbg.conf" ]]; then
  HOST="$(sed -n 's/^RBG_HOST=//p' "$HOME/.rbg.conf" | head -1)"
fi
if [[ -z "$HOST" ]]; then
  echo "error: no remote host. Pass --host, set RCSM_HOST, or add RBG_HOST to ~/.rbg.conf" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── Open the tunnel in the background ─────────────────────────────────────
echo "▸ tunnel: localhost:$LOCAL_PORT → $HOST:127.0.0.1:$PORT"
ssh -f -N -L "${LOCAL_PORT}:127.0.0.1:${PORT}" "$HOST"
# Find the ssh tunnel pid so we can clean it up on exit.
TUNNEL_PID="$(pgrep -f "ssh -f -N -L ${LOCAL_PORT}:127.0.0.1:${PORT} ${HOST}" | head -1 || true)"
cleanup() { [[ -n "${TUNNEL_PID:-}" ]] && kill "$TUNNEL_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

sleep 1

if [[ "$LAUNCH_TUI" -eq 1 ]]; then
  echo "▸ launching TUI (q to quit)…"
  ( cd "$REPO_ROOT" && bun run tui -- --worker "ws://127.0.0.1:${LOCAL_PORT}" )
else
  echo "▸ tunnel open (pid $TUNNEL_PID). Ctrl-C to close."
  echo "  worker reachable at ws://127.0.0.1:${LOCAL_PORT}"
  wait "$TUNNEL_PID" 2>/dev/null || true
fi
