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
#   scripts/deploy.sh config --quiet  # render/validate production Compose safely
#   scripts/deploy.sh smoke           # local smoke stack (stub executor, on purpose)
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Production = base + screenapp (real meeting bot, Azure transcription via .env).
# Deliberately excludes docker-compose.smoke.yml, which forces the stub executor.
PROD_FILES=(-f docker-compose.yml -f docker-compose.screenapp.yml)
SMOKE_FILES=(-f docker-compose.yml -f docker-compose.smoke.yml)

reuse_live_value_when_env_file_is_blank() {
  local key="$1"
  local container="$2"
  local env_file_value=""
  local live_value=""

  if [[ -f .env ]]; then
    env_file_value="$(sed -n "s/^${key}=//p" .env | tail -n 1)"
  fi
  if [[ -n "${!key:-}" || -n "$env_file_value" ]]; then
    return
  fi

  live_value="$(
    docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | sed -n "s/^${key}=//p" \
      | tail -n 1
  )"
  if [[ -n "$live_value" ]]; then
    export "${key}=${live_value}"
  fi
}

prepare_existing_host_secrets() {
  # Existing installations may intentionally leave database/object-store credentials
  # out of .env. Reuse the running containers' values without printing or persisting them.
  # A new host still fails closed until these values are supplied explicitly.
  reuse_live_value_when_env_file_is_blank POSTGRES_PASSWORD ai_notetacker-postgres-1
  reuse_live_value_when_env_file_is_blank MINIO_ROOT_USER ai_notetacker-minio-1
  reuse_live_value_when_env_file_is_blank MINIO_ROOT_PASSWORD ai_notetacker-minio-1
}

action="${1:-up}"
shift || true

case "$action" in
  up|deploy)
    prepare_existing_host_secrets
    # Default to --build; allow callers to pass --no-build (or other flags).
    if [[ "$*" == *"--no-build"* ]]; then
      extra="${*/--no-build/}"
      echo "[deploy] Recreating production stack (no build)..."
      exec docker compose "${PROD_FILES[@]}" up -d --remove-orphans $extra
    fi
    echo "[deploy] Building and recreating production stack (base + screenapp)..."
    exec docker compose "${PROD_FILES[@]}" up -d --build --remove-orphans "$@"
    ;;
  restart)
    prepare_existing_host_secrets
    echo "[deploy] Recreating production stack without rebuild..."
    exec docker compose "${PROD_FILES[@]}" up -d --remove-orphans "$@"
    ;;
  down)
    prepare_existing_host_secrets
    echo "[deploy] Stopping the stack..."
    exec docker compose "${PROD_FILES[@]}" down "$@"
    ;;
  logs)
    prepare_existing_host_secrets
    exec docker compose "${PROD_FILES[@]}" logs -f "$@"
    ;;
  ps|status)
    prepare_existing_host_secrets
    exec docker compose "${PROD_FILES[@]}" ps "$@"
    ;;
  config)
    prepare_existing_host_secrets
    exec docker compose "${PROD_FILES[@]}" config "$@"
    ;;
  smoke)
    prepare_existing_host_secrets
    echo "[deploy] Bringing up the LOCAL SMOKE stack (stub recording executor)..."
    exec docker compose "${SMOKE_FILES[@]}" up -d --remove-orphans "$@"
    ;;
  *)
    echo "Unknown action: $action" >&2
    echo "Valid actions: up | deploy | restart | down | logs | ps | config | smoke" >&2
    exit 2
    ;;
esac
