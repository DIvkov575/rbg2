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

# ── Preflight: is SSH itself working? ─────────────────────────────────────
# Amazon desktop certs are short-lived (Midway). If the cert is expired, SSH
# fails with a cryptic "Permission denied (publickey)" — catch it here and
# say what to do, instead of a mysterious tunnel that never forwards.
echo "▸ checking SSH to ${HOST}…"
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true 2>/dev/null; then
  echo "error: cannot SSH to $HOST." >&2
  echo "  Most likely your Midway/SSH cert expired — run:  mwinit" >&2
  echo "  (verify with:  ssh $HOST true )" >&2
  exit 1
fi

# ── Open the tunnel (self-healing) ────────────────────────────────────────
# These desktops route SSH through Amazon's SSH-over-WebSocket proxy, which
# can drop an idle `-f -N` port-forward (intermittent EPIPE in the proxy). So
# instead we run the tunnel in the FOREGROUND with a keepalive command and a
# restart loop: ServerAliveInterval pings keep it warm, and if it drops we
# reopen it. The TUI/CLI auto-reconnect, so a brief tunnel blip is invisible.
SSH_OPTS=(
  -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=5
  -o ServerAliveCountMax=3
  -L "${LOCAL_PORT}:127.0.0.1:${PORT}"
)

echo "▸ tunnel: localhost:$LOCAL_PORT → $HOST:127.0.0.1:$PORT"
tunnel_loop() {
  while true; do
    # `sleep infinity` keeps a channel active (unlike -N idle), which the
    # proxy tolerates far better. Reconnect if it ever exits.
    ssh "${SSH_OPTS[@]}" "$HOST" 'sleep infinity' 2>/dev/null || true
    sleep 1
  done
}
tunnel_loop &
TUNNEL_PID=$!
cleanup() {
  kill "$TUNNEL_PID" 2>/dev/null || true
  pkill -f "sleep infinity" 2>/dev/null || true  # any lingering ssh child
}
trap cleanup EXIT INT TERM

# ── Wait until the worker actually answers ────────────────────────────────
# The forwarded channel (and the remote proxy hop) isn't ready the instant ssh
# starts. Poll `rcsm ping` until it succeeds instead of guessing with a sleep.
echo "▸ waiting for worker to answer…"
READY=0
for i in $(seq 1 30); do
  if ( cd "$REPO_ROOT" && bun run cli -- --worker "ws://127.0.0.1:${LOCAL_PORT}" --json ping >/dev/null 2>&1 ); then
    READY=1; break
  fi
  sleep 0.5
done
if [[ "$READY" -ne 1 ]]; then
  echo "error: tunnel opened but worker did not answer on ws://127.0.0.1:${LOCAL_PORT}" >&2
  echo "  Is the worker running on $HOST?  Check:  ssh $HOST 'tail ~/.rcsm/worker.log'" >&2
  echo "  (re)deploy with:  scripts/deploy-remote.sh" >&2
  exit 1
fi
echo "  ✓ worker reachable at ws://127.0.0.1:${LOCAL_PORT}"

if [[ "$LAUNCH_TUI" -eq 1 ]]; then
  echo "▸ launching TUI (q to quit)…"
  ( cd "$REPO_ROOT" && bun run tui -- --worker "ws://127.0.0.1:${LOCAL_PORT}" )
else
  echo "▸ tunnel open (self-healing). Ctrl-C to close."
  wait "$TUNNEL_PID" 2>/dev/null || true
fi
