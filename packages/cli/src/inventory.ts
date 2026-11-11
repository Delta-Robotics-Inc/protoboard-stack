/**
 * `protoboard inventory [--json]` (PB-1168): what is installed, offline.
 *
 * The stack the project uses (its @protoboardai and @deltarobotics packages),
 * the stack's npm dependency set, the managed runtimes in
 * `.protoboard/tools/tools.json` (every Python package of the CAD runtime),
 * Node and Python versions, and the VS Code extension's version when its
 * folder is found. Schema `protoboard.inventory/v0`
 * (docs/reference/update-check.md). Nothing is sent anywhere, and nothing is
 * installed: this command reads files only (and runs `PROTOBOARD_PYTHON
 * --version` when that variable is set).
 *
 * The `case "inventory"` line in cli/src/index.ts belongs to W4-D (shared
 * files); see phase-1/handoffs.md, 2026-11-01, W4-A.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
// TODO(W4-D handoff): `@protoboardai/core/update` once core/package.json exports it; the relative path
// works in the checkout and in an installed stack (node_modules/@protoboardai/{cli,core}) alike
import { formatInventory, readInventory, type Inventory } from "../../core/src/update/inventory.js";

type Out = (data: unknown, text: () => string) => void;

/** The project holding `from` (a folder with protoboard.config.ts), walking up. */
export function projectRootFrom(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "protoboard.config.ts"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Reads the inventory for the project at (or above) `cwd`; outside a project, the stack running this. */
export function inventoryFor(cwd: string, options: { env?: NodeJS.ProcessEnv; extensionVersion?: string; home?: string; noExec?: boolean } = {}): Inventory {
  const root = projectRootFrom(cwd);
  return readInventory({ ...(root ? { root } : {}), ...options });
}

/** Runs `protoboard inventory`; returns the exit code. */
export async function inventoryCommand(cwd: string, _args: string[], out: Out): Promise<number> {
  const inv = inventoryFor(cwd);
  out(inv, () => formatInventory(inv));
  return 0;
}
