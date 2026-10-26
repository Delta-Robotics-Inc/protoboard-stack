#!/usr/bin/env bash
# Start the local Protoboard registry (Verdaccio) on 127.0.0.1:4873.
# Docker if available (container "protoboard-registry"), else `npx verdaccio`.
# Storage: registry/storage (gitignored). See docs/guides/local-registry.md.
#
# Usage: registry/start.sh [--npx]
#   PB_REGISTRY_PORT   port (default 4873)
#   PB_REGISTRY_NAME   Docker container name (default protoboard-registry)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PB_REGISTRY_PORT:-4873}"
NAME="${PB_REGISTRY_NAME:-protoboard-registry}"
URL="http://127.0.0.1:$PORT/"
IMAGE="verdaccio/verdaccio:6"
mkdir -p "$HERE/storage"

if curl -fs "${URL}-/ping" >/dev/null 2>&1; then
  echo "registry already running at $URL"
  exit 0
fi

MODE=docker
if [ "${1:-}" = "--npx" ] || ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then MODE=npx; fi

if [ "$MODE" = docker ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # runs as the calling user so the storage stays owned by them; bound to loopback only
  docker run -d --rm --name "$NAME" --user "$(id -u):$(id -g)" \
    -p "127.0.0.1:$PORT:4873" \
    -v "$HERE/config.yaml:/verdaccio/conf/config.yaml:ro" \
    -v "$HERE/storage:/verdaccio/conf/storage" \
    "$IMAGE" >/dev/null
  echo "started Docker container $NAME ($IMAGE)"
else
  # config.yaml's storage (./storage) is relative to the config file: registry/storage
  nohup npx --yes verdaccio@6 --config "$HERE/config.yaml" --listen "127.0.0.1:$PORT" >"$HERE/storage/verdaccio.log" 2>&1 &
  echo $! >"$HERE/storage/verdaccio.pid"
  echo "started npx verdaccio (pid $(cat "$HERE/storage/verdaccio.pid"), log registry/storage/verdaccio.log)"
fi

for _ in $(seq 1 60); do
  if curl -fs "${URL}-/ping" >/dev/null 2>&1; then
    echo "registry ready at $URL"
    exit 0
  fi
  sleep 1
done
echo "registry did not answer at $URL within 60 s" >&2
exit 1
