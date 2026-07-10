#!/usr/bin/env bash
#
# remote-auth.sh — check (and help refresh) auth on the remote desktop.
#
# The remote `claude` CLI authenticates to Bedrock via a Midway-backed
# credential export (see ~/.claude/settings.json → awsCredentialExport).
# When the Midway session expires, sessions fail. Midway refresh (`mwinit`)
# requires a human security-key touch, so this script can only *check* and
# tell you what to run — it can't touch the key for you.
#
# Usage:
#   scripts/remote-auth.sh           # check status
#   scripts/remote-auth.sh --login   # run `mwinit` interactively on the remote
#
set -euo pipefail

HOST="${RCSM_HOST:-}"
DO_LOGIN=0
[[ "${1:-}" == "--login" ]] && DO_LOGIN=1

if [[ -z "$HOST" && -f "$HOME/.rbg.conf" ]]; then
  HOST="$(sed -n 's/^RBG_HOST=//p' "$HOME/.rbg.conf" | head -1)"
fi
[[ -z "$HOST" ]] && { echo "error: no remote host (RCSM_HOST or ~/.rbg.conf)" >&2; exit 1; }

if [[ "$DO_LOGIN" -eq 1 ]]; then
  echo "▸ running mwinit on $HOST (touch your security key when prompted)…"
  # -t forces a TTY so the interactive prompt + key touch work.
  ssh -t "$HOST" 'mwinit'
  echo "✓ mwinit done. Re-run without --login to verify."
  exit 0
fi

echo "▸ checking remote auth on ${HOST}…"
ssh "$HOST" 'bash -lc "
  # Does the credential export produce a value?
  if claude --print \"ok\" >/dev/null 2>&1; then
    echo \"  ✓ claude auth OK — Bedrock credentials valid\"
  else
    echo \"  ✗ claude auth FAILED — Midway session likely expired\"
    echo \"    fix: scripts/remote-auth.sh --login   (runs mwinit, needs key touch)\"
    exit 1
  fi
"'
