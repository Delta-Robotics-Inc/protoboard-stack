#!/usr/bin/env bash
# Registry smoke test (PB-813, PB-818): projects outside the monorepo install
# the whole stack from the local registry, then run `protoboard check` and
# `protoboard build`. See docs/guides/local-registry.md.
#
#   1. copies of the reference projects (their tracked files in this checkout;
#      their package.json names versions, not paths) install from the
#      registry, check and build;
#   2. each project template (`protoboard init --template drone|wearable|iot`,
#      run from the registry's @protoboardai/cli) initialises, installs, checks,
#      builds, type-checks and exports its skills. Templates vendor their
#      catalog parts from the parts service (--cloud or PROTOBOARD_CLOUD_URL);
#      without one this part is skipped.
#
# Every package that resolves from @protoboardai/* or @deltarobotics/* must come
# from the registry (package-lock.json `resolved`), never a file: or link: path.
#
# Usage: scripts/registry/smoke.sh [--registry <url>] [--cloud <url>] [--dir <dir>]
#                                  [--examples <a,b|all|none>] [--templates <a,b|all|none>] [--keep]
#   --registry   default PB_REGISTRY_URL, then http://127.0.0.1:4873/
#   --cloud      the parts service the templates vendor from (read only)
#   --dir        where the scratch projects go (default: a new temporary folder,
#                outside any repository); must not be inside a repository
#   --examples   reference projects to copy (default quadcopter-5in,wearable-watch,smart-bottle)
#   --templates  templates to initialise (default drone,wearable,iot)
#   --keep       keep the scratch folder (always kept with --dir)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PB="$(cd "$HERE/../.." && pwd)"
REGISTRY="${PB_REGISTRY_URL:-http://127.0.0.1:4873/}"
CLOUD="${PROTOBOARD_CLOUD_URL:-}"
DIR=""
KEEP=0
EXAMPLES="quadcopter-5in,wearable-watch,smart-bottle"
TEMPLATES="drone,wearable,iot"
while [ $# -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --cloud) CLOUD="$2"; shift 2 ;;
    --dir) DIR="$2"; KEEP=1; shift 2 ;;
    --examples) EXAMPLES="$2"; shift 2 ;;
    --templates) TEMPLATES="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h | --help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "smoke: unknown argument $1" >&2; exit 2 ;;
  esac
done
case "$REGISTRY" in */) ;; *) REGISTRY="$REGISTRY/" ;; esac
[ "$EXAMPLES" = all ] && EXAMPLES="quadcopter-5in,wearable-watch,smart-bottle"
[ "$EXAMPLES" = none ] && EXAMPLES=""
[ "$TEMPLATES" = all ] && TEMPLATES="drone,wearable,iot"
[ "$TEMPLATES" = none ] && TEMPLATES=""

if ! curl -fs "${REGISTRY}-/ping" >/dev/null; then
  echo "smoke: no registry at $REGISTRY (registry/start.sh, then scripts/registry/publish-stack.mjs)" >&2
  exit 1
fi
if [ -z "$DIR" ]; then DIR="$(mktemp -d "${TMPDIR:-/tmp}/pb-registry-smoke.XXXXXX")"; fi
mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"
if git -C "$DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "smoke: $DIR is inside a git repository ($(git -C "$DIR" rev-parse --show-toplevel)); the test needs a folder outside the repositories" >&2
  exit 2
fi
if [ $KEEP -eq 0 ]; then trap 'rm -rf "$DIR"' EXIT; fi

CLI_VERSION="$(node -p 'require(process.argv[1]).version' "$PB/packages/cli/package.json")"
# every npm call below uses only the local registry; the cache is the user's (tarballs are content-addressed)
printf 'registry=%s\n' "$REGISTRY" >"$DIR/.npmrc"
NPM_FLAGS=(--no-audit --no-fund --prefer-online)
RESULTS=()
FAILED=0
record() { RESULTS+=("$(printf '%-5s %s%s' "$1" "$2" "${3:+  ($3)}")"); [ "$1" = FAIL ] && FAILED=1; return 0; }

# fail on errors and on checks that did not run, list warnings
check_json() {
  node -e '
    let j; try { j = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { console.log("check printed no JSON"); process.exit(1); }
    const by = (s) => j.diagnostics.filter((d) => d.severity === s);
    for (const d of by("error")) console.log(`  ERROR    ${d.code}  ${d.message}`);
    for (const d of by("warning")) console.log(`  warning  ${d.code}  ${d.message.slice(0, 160)}`);
    console.log(`  ${by("error").length} error(s), ${by("warning").length} warning(s), ${by("info").length} info`);
    // a check that could not run in an installed project (a missing or mismatched dependency) is a packaging failure
    const notRun = j.diagnostics.filter((d) => / did not run\b/.test(d.message));
    for (const d of notRun) console.log(`  NOT RUN  ${d.code}  ${d.message.slice(0, 160)}`);
    process.exit(by("error").length || notRun.length ? 1 : 0);
  '
}

# every stack package in the lockfile resolved from the registry
from_registry() {
  node -e '
    const [lockFile, registry] = process.argv.slice(1);
    const lock = JSON.parse(require("fs").readFileSync(lockFile, "utf8"));
    const bad = [], ok = [];
    for (const [path, e] of Object.entries(lock.packages ?? {})) {
      const name = path.replace(/^.*node_modules\//, "");
      if (!/^@(protoboard|deltarobotics)\//.test(name) || !path.includes("node_modules/")) continue;
      if (e.link || !e.resolved || !e.resolved.startsWith(registry)) bad.push(`${name}: ${e.link ? "link" : e.resolved ?? "no resolved URL"}`);
      else ok.push(`${name}@${e.version}`);
    }
    console.log(`  ${ok.length} stack package(s) from ${registry}: ${[...new Set(ok)].sort().join(", ")}`);
    if (bad.length) { console.log(`  not from the registry:\n    ${bad.join("\n    ")}`); process.exit(1); }
  ' "$1" "$REGISTRY"
}

# install, check, build one project folder
run_project() { # label dir
  local label="$1" dir="$2" start=$SECONDS
  printf '\n=== %s  (%s)\n' "$label" "$dir"
  # npm reads a project's own .npmrc (not its parent's): everything from the local registry
  printf 'registry=%s\n' "$REGISTRY" >>"$dir/.npmrc"
  (cd "$dir" && npm install "${NPM_FLAGS[@]}" 2>&1 | tail -3) || { record FAIL "$label: npm install"; return 1; }
  (cd "$dir" && from_registry package-lock.json) || { record FAIL "$label: packages from the registry"; return 1; }
  (cd "$dir" && npx --no-install protoboard check --format json | check_json) || { record FAIL "$label: protoboard check"; return 1; }
  (cd "$dir" && npx --no-install protoboard build | tail -2) || { record FAIL "$label: protoboard build"; return 1; }
  record PASS "$label" "$((SECONDS - start)) s"
}

echo "registry: $REGISTRY"
echo "scratch:  $DIR"

IFS=',' read -r -a EX <<<"$EXAMPLES"
for ex in "${EX[@]}"; do
  [ -n "$ex" ] || continue
  if [ ! -f "$PB/examples/$ex/package.json" ]; then record FAIL "example $ex" "not in $PB/examples"; continue; fi
  rm -rf "${DIR:?}/$ex" && mkdir -p "$DIR/$ex"
  # the project's tracked files as they are in this checkout (a clone of the branch, before it is committed)
  (cd "$PB" && git ls-files -z "examples/$ex" | xargs -0 tar -c -f -) | tar -x -C "$DIR/$ex" --strip-components=2
  run_project "example $ex" "$DIR/$ex"
done

IFS=',' read -r -a TP <<<"$TEMPLATES"
CLI_BIN=""
if [ -n "$TEMPLATES" ] && [ -n "$CLOUD" ]; then
  # the CLI from the registry in a folder of its own (npm exec would reuse an earlier copy of the same version)
  printf '\n=== @protoboardai/cli@%s from the registry\n' "$CLI_VERSION"
  rm -rf "$DIR/.cli" && mkdir -p "$DIR/.cli" && printf 'registry=%s\n' "$REGISTRY" >"$DIR/.cli/.npmrc" && echo '{"private":true}' >"$DIR/.cli/package.json"
  if (cd "$DIR/.cli" && npm install "${NPM_FLAGS[@]}" "@protoboardai/cli@$CLI_VERSION" 2>&1 | tail -2); then CLI_BIN="$DIR/.cli/node_modules/.bin/protoboard"; else record FAIL "@protoboardai/cli from the registry"; fi
fi
for t in "${TP[@]}"; do
  [ -n "$t" ] || continue
  if [ -z "$CLOUD" ]; then record SKIP "template $t" "no parts service: --cloud or PROTOBOARD_CLOUD_URL"; continue; fi
  rm -rf "${DIR:?}/my-$t"
  printf '\n=== template %s: init with the registry'"'"'s @protoboardai/cli@%s\n' "$t" "$CLI_VERSION"
  [ -n "$CLI_BIN" ] || { record SKIP "template $t" "no CLI"; continue; }
  if ! (cd "$DIR" && "$CLI_BIN" init "my-$t" --template "$t" --url "$CLOUD" --registry "$REGISTRY" | tail -12) || ! grep -q "^@protoboardai:registry=$REGISTRY" "$DIR/my-$t/.npmrc"; then
    record FAIL "template $t: init"
    continue
  fi
  if run_project "template $t" "$DIR/my-$t"; then
    # the template's TypeScript against the installed packages' types
    if (cd "$DIR/my-$t" && npm run --silent typecheck); then record PASS "template $t: typecheck"; else record FAIL "template $t: typecheck"; fi
    # npm install exported the skills already (the project's postinstall), with no second command
    if (cd "$DIR/my-$t" && test -f .claude/skills/build-a-project/SKILL.md && grep -q "protoboard:skills:begin" AGENTS.md); then
      record PASS "template $t: skills exported by npm install"
    else
      record FAIL "template $t: skills exported by npm install"
    fi
    # the template's skill exports: Claude Code skills folder and the AGENTS.md section
    if (cd "$DIR/my-$t" && npm run --silent skills:export >/dev/null && test -f .claude/skills/build-a-project/SKILL.md && grep -q "protoboard:skills:begin" AGENTS.md); then
      record PASS "template $t: skills:export"
    else
      record FAIL "template $t: skills:export"
    fi
  fi
done

printf '\n=== Summary (registry %s)\n' "$REGISTRY"
printf '%s\n' "${RESULTS[@]}"
if [ $KEEP -eq 1 ]; then echo "scratch projects kept in $DIR"; fi
if [ $FAILED -ne 0 ]; then echo "smoke: FAILED"; exit 1; fi
echo "smoke: passed"
