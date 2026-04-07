#!/bin/bash

set -euo pipefail

display_number="${DISPLAY_NUMBER:-99}"
lock_file="/tmp/.X${display_number}-lock"
socket_file="/tmp/.X11-unix/X${display_number}"
runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
pulse_dir="${runtime_dir}/pulse"
pulse_router_pid=""

mkdir -p /tmp/.X11-unix

if [ -e "$lock_file" ] || [ -S "$socket_file" ]; then
  echo "Cleaning stale Xvfb artifacts for display ${display_number}"
  rm -f "$lock_file" "$socket_file"
fi

if [ -e "${pulse_dir}/native" ] || [ -e "${pulse_dir}/pid" ]; then
  echo "Cleaning stale PulseAudio runtime at ${pulse_dir}"
  rm -rf "$pulse_dir"
fi

cleanup() {
  if [ -n "${pulse_router_pid}" ] && kill -0 "${pulse_router_pid}" 2>/dev/null; then
    kill "${pulse_router_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

(
  while true; do
    if pactl info >/dev/null 2>&1; then
      while read -r input_id _; do
        if [ -n "${input_id:-}" ]; then
          pactl move-sink-input "$input_id" virtual_output >/dev/null 2>&1 || true
        fi
      done < <(pactl list short sink-inputs 2>/dev/null || true)
    fi
    sleep 1
  done
) &
pulse_router_pid="$!"

export PULSE_SERVER="unix:${pulse_dir}/native"
export PULSE_SINK="virtual_output"
export PULSE_SOURCE="virtual_output.monitor"

exec /usr/src/app/xvfb-run-wrapper "$@"
