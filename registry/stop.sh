#!/usr/bin/env bash
# Stop the local Protoboard registry started by registry/start.sh. The storage
# (registry/storage) is kept: published packages are there on the next start.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${PB_REGISTRY_NAME:-protoboard-registry}"
stopped=0
if command -v docker >/dev/null 2>&1 && docker ps -q --filter "name=^${NAME}$" 2>/dev/null | grep -q .; then
  docker stop "$NAME" >/dev/null && echo "stopped Docker container $NAME" && stopped=1
fi
if [ -f "$HERE/storage/verdaccio.pid" ]; then
  pid="$(cat "$HERE/storage/verdaccio.pid")"
  if kill "$pid" 2>/dev/null; then echo "stopped verdaccio (pid $pid)"; stopped=1; fi
  rm -f "$HERE/storage/verdaccio.pid"
fi
[ $stopped -eq 1 ] || echo "no registry was running"
