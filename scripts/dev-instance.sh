#!/usr/bin/env bash
# A VS Code instance for development builds of the Protoboard extension, beside
# the one you use for real projects (with the Marketplace extension). It has its
# own profile and extensions folder, and its own Protoboard home, so a dev build's
# stack copies, the terminal's `protoboard` command and the projects it links
# never touch ~/.protoboard.
#
# Usage: scripts/dev-instance.sh [--install <file.vsix>] [--no-open] [code args...]
#   --install <vsix>  install that .vsix into the dev instance first (replacing
#                     the Protoboard extension there)
#   --no-open         only install; do not start VS Code
#   code args         passed to VS Code, such as a folder to open
#
# Environment:
#   PB_DEV_PROFILE    the instance's profile folder (default ~/.vscode-pb-dev;
#                     extensions in <profile>/extensions)
#   PB_DEV_HOME       its Protoboard home, PROTOBOARD_HOME (default ~/.protoboard-dev)
#   CODE              the VS Code command (default: code)
#
# An instance already running with this profile keeps the environment it was
# started with: close it before changing PB_DEV_HOME.

set -euo pipefail

PROFILE="${PB_DEV_PROFILE:-$HOME/.vscode-pb-dev}"
DEV_HOME="${PB_DEV_HOME:-$HOME/.protoboard-dev}"
CODE="${CODE:-code}"
VSIX=""
OPEN=1
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --install)
      [ $# -ge 2 ] || { echo "dev-instance: --install needs a .vsix file" >&2; exit 2; }
      VSIX="$2"
      shift 2
      ;;
    --no-open) OPEN=0; shift ;;
    -h | --help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

if [ "$DEV_HOME" = "$HOME/.protoboard" ]; then
  echo "dev-instance: PB_DEV_HOME is ~/.protoboard, the home of your real projects: choose another folder" >&2
  exit 2
fi
command -v "$CODE" >/dev/null 2>&1 || { echo "dev-instance: $CODE not found (set CODE to the VS Code command)" >&2; exit 127; }

PROFILE_ARGS=(--user-data-dir "$PROFILE" --extensions-dir "$PROFILE/extensions")
mkdir -p "$PROFILE/extensions" "$DEV_HOME"

if [ -n "$VSIX" ]; then
  [ -f "$VSIX" ] || { echo "dev-instance: $VSIX not found" >&2; exit 2; }
  "$CODE" "${PROFILE_ARGS[@]}" --install-extension "$VSIX" --force
fi
echo "dev instance: profile $PROFILE, PROTOBOARD_HOME=$DEV_HOME"
"$CODE" "${PROFILE_ARGS[@]}" --list-extensions --show-versions | grep -i protoboard || echo "  (no Protoboard extension installed here yet: --install <file.vsix>)"

if [ $OPEN -eq 1 ]; then
  PROTOBOARD_HOME="$DEV_HOME" exec "$CODE" "${PROFILE_ARGS[@]}" ${ARGS[@]+"${ARGS[@]}"}
fi
