#!/usr/bin/env bash
#
# Canonical deploy helper for the AI NoteTaker stack.
#
# The single most common production mistake is running `docker compose up`
# without the screenapp override. That silently reverts the recording-worker to
# the `stub` executor (no real meeting recording) and drops the control-plane's
# meeting-bot monitoring. This script always uses the correct file set so that
# never happens by accident.
#
# Usage:
#   scripts/deploy.sh                 # build + (re)create the full production stack
#   scripts/deploy.sh up              # same as above
#   scripts/deploy.sh up --no-build   # recreate without rebuilding images
#   scripts/deploy.sh restart         # recreate without rebuilding (quick restart)
#   scripts/deploy.sh down            # stop and remove the stack
#   scripts/deploy.sh logs [service]  # follow logs (all services or one)
#   scripts/deploy.sh ps              # show stack status
#   scripts/deploy.sh smoke           # local smoke stack (stub executor, on purpose)
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Production = base + screenapp (real meeting bot, Azure transcription via .env).
# Deliberately excludes docker-compose.smoke.yml, which forces the stub executor.
PROD_FILES=(-f docker-compose.yml -f docker-compose.screenapp.yml)
SMOKE_FILES=(-f docker-compose.yml -f docker-compose.smoke.yml)

action="${1:-up}"
shift || true

case "$action" in
  up|deploy)
    # Default to --build; allow callers to pass --no-build (or other flags).
    if [[ "$*" == *"--no-build"* ]]; then
      extra="${*/--no-build/}"
      echo "[deploy] Recreating production stack (no build)..."
      exec docker compose "${PROD_FILES[@]}" up -d $extra
    fi
    echo "[deploy] Building and recreating production stack (base + screenapp)..."
    exec docker compose "${PROD_FILES[@]}" up -d --build "$@"
    ;;
  restart)
    echo "[deploy] Recreating production stack without rebuild..."
    exec docker compose "${PROD_FILES[@]}" up -d "$@"
    ;;
  down)
    echo "[deploy] Stopping the stack..."
    exec docker compose "${PROD_FILES[@]}" down "$@"
    ;;
  logs)
    exec docker compose "${PROD_FILES[@]}" logs -f "$@"
    ;;
  ps|status)
    exec docker compose "${PROD_FILES[@]}" ps "$@"
    ;;
  smoke)
    echo "[deploy] Bringing up the LOCAL SMOKE stack (stub recording executor)..."
    exec docker compose "${SMOKE_FILES[@]}" up -d "$@"
    ;;
  *)
    echo "Unknown action: $action" >&2
    echo "Valid actions: up | deploy | restart | down | logs | ps | smoke" >&2
    exit 2
    ;;
esac
