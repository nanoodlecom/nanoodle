#!/bin/sh
# Cron entry point for scripts/sync-nanogpt-model-updates.mjs.
# cron runs with a minimal PATH/env, so this pins what the sync script needs
# (nvm-installed node, git, chromium-browser) and loads NANOGPT_API_KEY from
# .env before running. Logs to scripts/.cron-sync-nanogpt-model-updates.log
# (gitignored-worthy but harmless if committed; rotate/clear by hand if it grows).
#
# The sync runs in its own worktree (../nanoodle-cron-sync), reset to
# origin/main on every run, and pushes straight to main. It must never run in
# the dev checkout: the dev checkout can sit on any branch, and the sync would
# commit there (2026-08: 5 sync commits sat stranded on a side branch for 4
# days while the live site showed nothing). If a previous push failed, the
# reset also discards the stranded commit AND the seen-file update, so the
# next run re-detects the same models and retries cleanly.
set -eu

REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
WT="$(dirname -- "$REPO")/nanoodle-cron-sync"
LOG="$REPO/scripts/.cron-sync-nanogpt-model-updates.log"
export PATH="/home/ntc/.nvm/versions/node/v24.11.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"

{
  echo "===== $(date -Iseconds) ====="
  git -C "$REPO" fetch origin main
  if [ ! -d "$WT" ]; then
    git -C "$REPO" worktree prune
    git -C "$REPO" worktree add -B cron-sync "$WT" origin/main
  fi
  git -C "$WT" reset --hard -q origin/main
  git -C "$WT" checkout -q -B cron-sync origin/main
  if [ -f "$REPO/.env" ]; then
    set -a
    . "$REPO/.env"
    set +a
  fi
  export NOODLE_SYNC_PUSH_BRANCH=main
  node "$WT/scripts/sync-nanogpt-model-updates.mjs" --push
} >> "$LOG" 2>&1
