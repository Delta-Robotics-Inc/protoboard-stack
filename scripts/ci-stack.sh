#!/usr/bin/env bash
# Protoboard Stack CI: the clean-clone flow for uhd, uhd-viewer and this
# repository checked out side by side in one workspace directory.
# GitHub Actions runs this; it runs the same way locally. See docs/ci.md.
#
# Usage: scripts/ci-stack.sh [--with-cad] [--registry] [workspace]
#   workspace   directory holding uhd/ and uhd-viewer/ beside this repository
#               (default: the parent of this repository). A protoboard-cloud/
#               checkout there (the hosted parts service) is optional: with it,
#               the tests that run the real service run too, and its own checks
#               run; without it they are skipped and the summary says so.
#   --with-cad  also run the Python CAD steps (frame and harness generator
#               tests, doctor's CAD runtime check). They run only if Python with
#               build123d is found: PROTOBOARD_PYTHON, else the quadcopter example's
#               project runtime (.protoboard/tools/cad), else the older
#               workspace/uhd/.venv-cad, else python3. Without the flag, or without that Python, they are
#               skipped and the summary says so.
#   --registry  also install from the local registry (docs/guides/local-registry.md):
#               start it if it is not running (registry/start.sh; PB_REGISTRY_URL
#               names another loopback registry), publish the workspace's packages to
#               it (scripts/registry/publish-stack.mjs --replace), and run
#               scripts/registry/smoke.sh: the reference projects, copied outside the
#               workspace, install from it, check and build; with
#               PROTOBOARD_CLOUD_URL set, so do the project templates.
#
# Every step runs in its own section. A failed step fails the run (exit 1);
# steps that depend on it are skipped. Check warnings are listed, not failed.

set -uo pipefail

WITH_CAD=0
WITH_REGISTRY=0
WORKSPACE=""
for arg in "$@"; do
  case "$arg" in
    --with-cad) WITH_CAD=1 ;;
    --registry) WITH_REGISTRY=1 ;;
    -h | --help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "ci-stack: unknown option $arg" >&2; exit 2 ;;
    *) WORKSPACE="$arg" ;;
  esac
done
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$(cd "${WORKSPACE:-$HERE/../..}" && pwd)" || { echo "ci-stack: workspace not found" >&2; exit 2; }
UHD="$WORKSPACE/uhd"
PB="$(cd "$HERE/.." && pwd)"
VIEWER="$WORKSPACE/uhd-viewer"
CLOUD="$WORKSPACE/protoboard-cloud"
HAS_CLOUD=0
if [ -f "$CLOUD/src/server/main.ts" ]; then HAS_CLOUD=1; fi
# the tests that run the real parts service find it here (packages/core/test/cloud-checkout.ts); without a
# checkout they are left out
export PROTOBOARD_CLOUD_DIR="$CLOUD"
CLI="$PB/packages/cli/bin/protoboard.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# what this script runs never reads or writes the user's own Protoboard config folder (sign-ins, access.json):
# local work needs no account, and the cloud steps use local parts services that sign no one in
export PROTOBOARD_CONFIG_DIR="${PROTOBOARD_CONFIG_DIR:-$TMP/protoboard-config}"

# ---- output: sections (collapsible groups on GitHub Actions) and a summary
GHA="${GITHUB_ACTIONS:-}"
RESULTS=()
FAILED=0
section() {
  if [ -n "$GHA" ]; then echo "::group::$1"; else printf '\n=== %s\n' "$1"; fi
}
end_section() { if [ -n "$GHA" ]; then echo "::endgroup::"; fi; }
record() { # status label [note]
  RESULTS+=("$(printf '%-5s %s%s' "$1" "$2" "${3:+  ($3)}")")
  if [ "$1" = "FAIL" ]; then
    FAILED=1
    if [ -n "$GHA" ]; then echo "::error title=ci-stack::$2 failed${3:+: $3}"; fi
  fi
}
# step <label> <dir> <command...>: runs the command in dir inside a section
step() {
  local label="$1" dir="$2"
  shift 2
  section "$label"
  local start=$SECONDS
  (cd "$dir" && "$@")
  local status=$?
  end_section
  if [ $status -eq 0 ]; then record PASS "$label" "$((SECONDS - start)) s"; else record FAIL "$label" "exit $status"; fi
  return $status
}
skip() { record SKIP "$1" "$2"; }

# ---- preflight
section "Workspace"
echo "workspace: $WORKSPACE"
PREFLIGHT=0
for repo in "$UHD" "$PB" "$VIEWER" "$CLOUD"; do
  if [ "$repo" = "$CLOUD" ] && [ $HAS_CLOUD -eq 0 ]; then
    echo "  (no protoboard-cloud checkout: the parts service's tests and checks are skipped)"
  elif [ -d "$repo" ]; then
    printf '  %-16s %s\n' "$(basename "$repo")" "$(git -C "$repo" log -1 --format='%h %s' 2>/dev/null || echo '(not a git checkout)')"
    printf '  %-16s branch %s\n' "" "$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  else
    echo "  missing: $repo"
    PREFLIGHT=1
  fi
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
echo "node $(node -v 2>/dev/null || echo 'not found'), npm $(npm -v 2>/dev/null || echo 'not found')"
if [ "$NODE_MAJOR" -lt 22 ]; then echo "Node 22 or later is required"; PREFLIGHT=1; fi
end_section
if [ $PREFLIGHT -ne 0 ]; then
  record FAIL "workspace" "uhd and uhd-viewer beside this repository, and Node 22+, are required"
  printf '\n=== Summary\n%s\n' "${RESULTS[@]}"
  exit 1
fi
record PASS "workspace"

# ---- CAD runtime (optional)
CAD=0
CAD_NOTE="not requested (--with-cad)"
if [ $WITH_CAD -eq 1 ]; then
  CAD_PYTHON="${PROTOBOARD_PYTHON:-}"
  QUAD_CAD="$PB/examples/quadcopter-5in/.protoboard/tools/cad/bin/python"
  if [ -z "$CAD_PYTHON" ] && [ -x "$QUAD_CAD" ]; then CAD_PYTHON="$QUAD_CAD"; fi
  # older shared venv beside the UHD checkout (UHD ignores it; kept as a fallback)
  if [ -z "$CAD_PYTHON" ] && [ -x "$UHD/.venv-cad/bin/python" ]; then CAD_PYTHON="$UHD/.venv-cad/bin/python"; fi
  CAD_PYTHON="${CAD_PYTHON:-python3}"
  if "$CAD_PYTHON" -c 'import build123d' >/dev/null 2>&1; then
    CAD=1
    CAD_NOTE="$CAD_PYTHON, build123d $("$CAD_PYTHON" -c 'import build123d; print(build123d.__version__)')"
  else
    CAD_NOTE="--with-cad given, but $CAD_PYTHON has no build123d"
  fi
fi
# The CAD tests run when PROTOBOARD_PYTHON names a Python with build123d, and
# otherwise fall back (packages/core/test/cad-python.ts). An empty value turns
# the fallbacks off, so the CAD steps run only when asked for.
if [ $CAD -eq 1 ]; then export PROTOBOARD_PYTHON="$CAD_PYTHON"; else export PROTOBOARD_PYTHON=""; fi
echo "CAD steps: $([ $CAD -eq 1 ] && echo on || echo off), $CAD_NOTE"

NPM_CI=(npm ci --no-audit --no-fund)

# gated <gate> <label> <dir> <command...>: a step that is skipped while its
# gate (a variable naming the failure that blocks it) is set, and that sets the
# gate when it fails itself
gated() {
  local gate="$1"
  shift
  if [ -n "${!gate}" ]; then skip "$1" "${!gate}"; return 1; fi
  step "$@" || { printf -v "$gate" '%s' "$1 failed"; return 1; }
}

# check one example: fail on errors, list warnings by code
check_example() {
  local out="$TMP/check-$(basename "$PWD").json"
  node "$CLI" check --format json --cwd . >"$out"
  local status=$?
  node -e '
    const fs = require("node:fs");
    let j;
    try { j = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { console.log("check printed no JSON result"); process.exit(1); }
    const by = (s) => j.diagnostics.filter((d) => d.severity === s);
    for (const c of j.checks) console.log(`  ${c.status === "ran" ? "ran " : c.status}  ${c.validator}${c.reason ? `  (${c.reason})` : ""}`);
    for (const d of by("error")) console.log(`ERROR    ${d.code}  ${d.message}${d.source?.file ? `\n         at ${d.source.file}${d.source.line ? `:${d.source.line}` : ""}` : ""}`);
    for (const d of by("warning")) console.log(`warning  ${d.code}  ${d.message}`);
    console.log(`${by("error").length} error(s), ${by("warning").length} warning(s), ${by("info").length} info`);
    process.exit(by("error").length ? 1 : 0);
  ' "$out" || return 1
  return $status
}

# doctor finds the CAD runtime for every CAD extension; other tools (Chrome and
# poppler for ext-docs) are listed, not required
doctor_tools() {
  # its account check asks the project's library: the example sets no cloud.url (the hosted library), so a port
  # that refuses connections instead
  PROTOBOARD_CLOUD_URL=http://127.0.0.1:9 node "$CLI" doctor --format json --cwd . >"$TMP/doctor.json" || return 1
  node -e '
    const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const cad = (t) => t.id === "python-build123d";
    for (const t of j.tools) console.log(`${t.available ? "ok     " : cad(t) ? "MISSING" : "absent "}  ${t.extension}  ${t.id}  ${t.detail ?? ""}`);
    process.exit(j.tools.filter(cad).every((t) => t.available) ? 0 : 1);
  ' "$TMP/doctor.json"
}

# the eval cases every extension ships, replayed with their known-good steps
# (docs/guides/evals.md): fails on a broken case or a failed trial; cases whose
# tools are missing (CAD without --with-cad, Chrome) are listed as skipped
evals_ci() {
  # the summary goes to the job summary whether the run passed or not (a failed run is when it matters)
  local status=0 stamp
  stamp=$(mktemp)
  node "$CLI" evals --ci --cwd . || status=$?
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ .protoboard/evals/latest.md -nt "$stamp" ]; then cat .protoboard/evals/latest.md >>"$GITHUB_STEP_SUMMARY"; fi
  rm -f "$stamp"
  return "$status"
}

# ---- uhd: the stack and the viewer build against this checkout
UHD_GATE=""
gated UHD_GATE "uhd: npm ci" "$UHD" "${NPM_CI[@]}"
gated UHD_GATE "uhd: build" "$UHD" npm run build
gated UHD_GATE "uhd: build:library" "$UHD" npm run build:library

# ---- uhd-viewer: built against the same UHD sources, and before the stack, whose
# views, web viewer and VS Code extension build on its components
VIEWER_GATE="$UHD_GATE"
gated VIEWER_GATE "uhd-viewer: npm ci" "$VIEWER" "${NPM_CI[@]}"
gated VIEWER_GATE "uhd-viewer: type-check" "$VIEWER" npm run type-check
gated VIEWER_GATE "uhd-viewer: build" "$VIEWER" npm run build

# ---- protoboard-cloud (optional): the parts tests start its server, which needs its own dependencies.
# The client is this repository's packages/cloud; protoboard-cloud keeps a vendored copy (client/), checked below.
CLOUD_GATE=""
if [ $HAS_CLOUD -eq 1 ]; then
  gated CLOUD_GATE "protoboard-cloud: npm ci" "$CLOUD" "${NPM_CI[@]}"
else
  skip "protoboard-cloud: npm ci" "no protoboard-cloud checkout"
fi

# ---- the stack (its npm ci links ../uhd and ../uhd-viewer, so both are built first)
PB_GATE="${UHD_GATE:-$VIEWER_GATE}"
gated PB_GATE "stack: npm ci" "$PB" "${NPM_CI[@]}"
# from here on nothing reaches the hosted Protoboard library (a project without cloud.url uses it by default):
# every Node process fails such a request, as a service that does not answer, and the requests are listed at
# the end (scripts/test/no-hosted-service.mjs; the tests' own vitest.config.ts does the same)
export PB_TEST_HOSTED_LOG="$TMP/hosted-requests.log"
NODE_OPTIONS_BEFORE="${NODE_OPTIONS:-}"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=$(node -e 'console.log(require("node:url").pathToFileURL(process.argv[1]).href)' "$PB/scripts/test/no-hosted-service.mjs")"
for config in "$PB"/examples/*/protoboard.config.ts; do
  [ -e "$config" ] || continue
  ex="$(dirname "$config")"
  name="$(basename "$ex")"
  g="$PB_GATE"; gated g "example $name: protoboard check" "$ex" check_example
  g="$PB_GATE"; gated g "example $name: protoboard build" "$ex" node "$CLI" build --cwd .
done
g="$PB_GATE"; gated g "stack: typecheck" "$PB" npm run typecheck
# the shipped eval cases run once, in the evals step below, not inside npm test as well
g="$PB_GATE"; gated g "stack: tests$([ $CAD -eq 1 ] && echo ' (with the CAD generator tests)')$([ $HAS_CLOUD -eq 0 ] && echo ' (no protoboard-cloud: the parts service tests are left out)')" "$PB" env PROTOBOARD_SKIP_EVAL_CASES=1 npm test
g="$PB_GATE"; gated g "stack: evals (scripted host)" "$PB" evals_ci
no_hosted_requests() {
  if [ -s "$PB_TEST_HOSTED_LOG" ]; then
    echo "requests to the hosted Protoboard library, blocked (answered as a service that does not answer):"
    cat "$PB_TEST_HOSTED_LOG"
  else
    echo "no request went to the hosted Protoboard library"
  fi
}
step "stack: requests to the hosted library (blocked)" "$PB" no_hosted_requests
export NODE_OPTIONS="$NODE_OPTIONS_BEFORE"
[ -n "$NODE_OPTIONS" ] || unset NODE_OPTIONS
# brand spelling (PB-913): "Protoboard" with a lowercase b, in every repository of the stack
for repo in "$UHD" "$VIEWER" "$CLOUD" "$PB"; do
  [ -d "$repo/.git" ] || [ -f "$repo/.git" ] || continue
  step "brand spelling: $(basename "$repo")" "$repo" node "$PB/scripts/check-brand-spelling.mjs" --root .
done
# npm scope (PB-941): the packages are @protoboardai/…; the old scope, @protoboard, is someone else's on npmjs
for repo in "$UHD" "$VIEWER" "$CLOUD" "$PB"; do
  [ -d "$repo/.git" ] || [ -f "$repo/.git" ] || continue
  step "npm scope: $(basename "$repo")" "$repo" node "$PB/scripts/check-npm-scope.mjs" --root .
done
# licence files (2026-10-21): the stack is Apache-2.0; every package it ships carries LICENSE and NOTICE
for repo in "$VIEWER" "$PB"; do
  [ -d "$repo/.git" ] || [ -f "$repo/.git" ] || continue
  step "licence files: $(basename "$repo")" "$repo" node "$PB/scripts/check-licence-files.mjs" --root .
done
# protoboard-cloud (optional): its vendored copy of the client (client/) carries the client's licence files,
# its root ships nothing, and the copy matches packages/cloud
if [ $HAS_CLOUD -eq 1 ]; then
  step "licence files: protoboard-cloud client" "$CLOUD" node "$PB/scripts/check-licence-files.mjs" --root . --package client
  if [ -f "$CLOUD/scripts/sync-client.mjs" ]; then
    step "protoboard-cloud: its client is packages/cloud" "$CLOUD" node scripts/sync-client.mjs --check --stack "$PB"
  fi
fi
# alpha superseded (2026-10-08): what is delivered to users or their agents does not present the older web app as part of the process
step "alpha superseded: $(basename "$PB")" "$PB" node "$PB/scripts/check-alpha-superseded.mjs" --root .
if [ $CAD -eq 1 ]; then
  g="$PB_GATE"; gated g "cad: doctor finds the CAD runtime (quadcopter-5in)" "$PB/examples/quadcopter-5in" doctor_tools
else
  skip "cad: Python CAD steps" "$CAD_NOTE"
fi


# ---- the local registry: the stack published and installed outside the workspace (PB-813, PB-818)
if [ $WITH_REGISTRY -eq 1 ]; then
  REG_GATE="${PB_GATE:-$VIEWER_GATE}"
  REGISTRY_URL="${PB_REGISTRY_URL:-http://127.0.0.1:4873/}"
  if ! curl -fs "${REGISTRY_URL%/}/-/ping" >/dev/null 2>&1; then
    gated REG_GATE "registry: start" "$PB" registry/start.sh
  fi
  gated REG_GATE "registry: publish the stack" "$PB" node scripts/registry/publish-stack.mjs --workspace "$WORKSPACE" --registry "$REGISTRY_URL" --replace
  gated REG_GATE "registry: projects outside the workspace install, check and build$([ -n "${PROTOBOARD_CLOUD_URL:-}" ] && echo ' (and the templates)')" "$PB" scripts/registry/smoke.sh --registry "$REGISTRY_URL"
else
  skip "registry: publish and install" "not requested (--registry)"
fi

printf '\n=== Summary (%s)\n' "$WORKSPACE"
printf '%s\n' "${RESULTS[@]}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo '### ci-stack'; echo '```'; printf '%s\n' "${RESULTS[@]}"; echo '```'; } >>"$GITHUB_STEP_SUMMARY"
fi
if [ $FAILED -ne 0 ]; then
  echo "ci-stack: FAILED"
  exit 1
fi
echo "ci-stack: passed"
