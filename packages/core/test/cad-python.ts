/**
 * The Python the CAD tests run on (build123d, and numpy/scipy where a test
 * needs them), found the same way in every package:
 *
 * 1. `PROTOBOARD_PYTHON`, when it is set. An empty value means "no CAD
 *    Python": the CAD tests skip even when a venv below exists
 *    (scripts/ci-stack.sh sets it so without --with-cad).
 * 2. The quadcopter example's project runtime,
 *    examples/quadcopter-5in/.protoboard/tools/cad (`protoboard tools install
 *    cad` there).
 * 3. The older shared venv next to the UHD checkout, `<workspace>/uhd/.venv-cad`,
 *    kept as a fallback so existing machines keep running their CAD tests. UHD
 *    neither needs nor tracks it (its .gitignore ignores it); new machines use
 *    1 or 2.
 *
 * Undefined when none applies; the caller then skips its CAD tests and says so.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The protoboard-stack repository root. */
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

export const CAD_PYTHON_FALLBACKS = [
  join(REPO, "examples/quadcopter-5in/.protoboard/tools/cad/bin/python"),
  join(REPO, "../uhd/.venv-cad/bin/python"),
];

export function cadPython(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.PROTOBOARD_PYTHON !== undefined) return env.PROTOBOARD_PYTHON || undefined;
  return CAD_PYTHON_FALLBACKS.find((p) => existsSync(p));
}
