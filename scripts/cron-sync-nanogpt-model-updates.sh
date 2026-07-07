#!/bin/sh
# Cron entry point for scripts/sync-nanogpt-model-updates.mjs.
# cron runs with a minimal PATH/env, so this pins what the sync script needs
# (nvm-installed node, git, chromium-browser) and loads NANOGPT_API_KEY from
# .env before running. Logs to scripts/.cron-sync-nanogpt-model-updates.log
# (gitignored-worthy but harmless if committed; rotate/clear by hand if it grows).
set -eu

REPO="/home/ntc/dev/nanoodle"
LOG="$REPO/scripts/.cron-sync-nanogpt-model-updates.log"
export PATH="/home/ntc/.nvm/versions/node/v24.11.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

cd "$REPO"

{
  echo "===== $(date -Iseconds) ====="
  if [ -f "$REPO/.env" ]; then
    set -a
    . "$REPO/.env"
    set +a
  fi
  node "$REPO/scripts/sync-nanogpt-model-updates.mjs" --push
} >> "$LOG" 2>&1
