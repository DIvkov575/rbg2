#!/usr/bin/env bash
#
# deploy-remote.sh — cross-compile the worker for the remote desktop, ship it,
# install it, and (re)start it under a keep-alive supervisor.
#
# Re-run this any time to auto-update: it rebuilds from your current source,
# replaces the remote binary atomically, and restarts the worker. Idempotent.
#
# Config resolution (first found wins):
#   1. CLI flags:      --host <h>  --port <n>  --region <r>
#   2. Env:            RCSM_HOST / RCSM_PORT / RCSM_REGION
#   3. ~/.rbg.conf:    RBG_HOST=...   (the desktop you already have configured)
#   4. Defaults:       port 7890, region us-west-2
#
# Usage:
#   scripts/deploy-remote.sh
#   scripts/deploy-remote.sh --host dev-dsk-xxx.amazon.com --port 7890
#
set -euo pipefail

# ── Resolve config ────────────────────────────────────────────────────────
HOST="${RCSM_HOST:-}"
PORT="${RCSM_PORT:-7890}"
REGION="${RCSM_REGION:-us-west-2}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)   HOST="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Fall back to ~/.rbg.conf (RBG_HOST=...) if host still unset.
if [[ -z "$HOST" && -f "$HOME/.rbg.conf" ]]; then
  HOST="$(sed -n 's/^RBG_HOST=//p' "$HOME/.rbg.conf" | head -1)"
fi

if [[ -z "$HOST" ]]; then
  echo "error: no remote host. Pass --host, set RCSM_HOST, or add RBG_HOST to ~/.rbg.conf" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_BUILD="$(mktemp -t rcsm-worker-linux.XXXXXX)"
trap 'rm -f "$LOCAL_BUILD"' EXIT

echo "▸ target: $HOST  (port $PORT, region $REGION)"

# Resolve the remote home once — scp paths are literal (no shell expansion),
# so we need real absolute paths, not "$HOME/...".
REMOTE_HOME="$(ssh "$HOST" 'echo $HOME')"
if [[ -z "$REMOTE_HOME" ]]; then
  echo "error: could not resolve remote \$HOME on $HOST" >&2
  exit 1
fi
REMOTE_BIN_DIR="$REMOTE_HOME/.local/bin"
REMOTE_RUN_DIR="$REMOTE_HOME/.rcsm"

# ── 1. Cross-compile the worker for linux-x64 ─────────────────────────────
echo "▸ cross-compiling worker (bun-linux-x64)…"
( cd "$REPO_ROOT" && bun build packages/worker/src/cli.ts \
    --compile --target=bun-linux-x64 --outfile "$LOCAL_BUILD" >/dev/null )
echo "  built $(du -h "$LOCAL_BUILD" | cut -f1)"

# ── 2. Ship it (atomic: upload to .new, then mv) ──────────────────────────
echo "▸ uploading…"
ssh "$HOST" "mkdir -p $REMOTE_BIN_DIR $REMOTE_RUN_DIR"
scp -q "$LOCAL_BUILD" "$HOST:$REMOTE_BIN_DIR/rcsm-worker.new"

# ── 3. Install + restart under keep-alive supervisor ──────────────────────
# The supervisor re-spawns the worker if it dies, and survives SSH logout via
# setsid + nohup. State/logs live in ~/.rcsm. Binding is 127.0.0.1 only.
echo "▸ installing + restarting…"
ssh "$HOST" "bash -s" <<REMOTE
set -euo pipefail
BIN="$REMOTE_BIN_DIR/rcsm-worker"
RUN="$REMOTE_RUN_DIR"

# Stop any running worker + supervisor.
[[ -f "\$RUN/supervisor.pid" ]] && kill "\$(cat "\$RUN/supervisor.pid")" 2>/dev/null || true
[[ -f "\$RUN/worker.pid" ]] && kill "\$(cat "\$RUN/worker.pid")" 2>/dev/null || true
sleep 1

# Atomic swap of the binary.
chmod +x "\$BIN.new"
mv -f "\$BIN.new" "\$BIN"

# Write the supervisor loop.
cat > "\$RUN/supervise.sh" <<'SUP'
#!/usr/bin/env bash
RUN="\$HOME/.rcsm"
BIN="\$HOME/.local/bin/rcsm-worker"
echo \$\$ > "\$RUN/supervisor.pid"
while true; do
  "\$BIN" --host 127.0.0.1 --port ${PORT} --region ${REGION} --bedrock \
    >> "\$RUN/worker.log" 2>&1 &
  echo \$! > "\$RUN/worker.pid"
  wait \$! || true
  echo "{\"msg\":\"worker exited, restarting in 2s\"}" >> "\$RUN/worker.log"
  sleep 2
done
SUP
chmod +x "\$RUN/supervise.sh"

# Launch detached so it survives this SSH session ending.
setsid nohup "\$RUN/supervise.sh" >/dev/null 2>&1 < /dev/null &
sleep 2

# Report.
if [[ -f "\$RUN/worker.pid" ]] && kill -0 "\$(cat "\$RUN/worker.pid")" 2>/dev/null; then
  echo "  worker up (pid \$(cat "\$RUN/worker.pid")) on 127.0.0.1:${PORT}"
  tail -1 "\$RUN/worker.log" 2>/dev/null || true
else
  echo "  WARNING: worker not running — check \$RUN/worker.log" >&2
  tail -5 "\$RUN/worker.log" 2>/dev/null || true
  exit 1
fi
REMOTE

echo "✓ deployed. Connect with:  scripts/tunnel.sh --host $HOST --port $PORT"
