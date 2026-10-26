/**
 * The parts service's checkout, for the tests that run the real service: PROTOBOARD_CLOUD_DIR, else
 * ../protoboard-cloud beside this repository. The service is not part of this repository (only its
 * client is, packages/cloud), so without a checkout those tests are left out (vitest.config.ts,
 * SERVICE_TESTS) and the rest of the suite runs as usual.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The checkout's root (it has src/server/main.ts and its dependencies), or undefined. */
export function cloudCheckout(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env.PROTOBOARD_CLOUD_DIR ? resolve(env.PROTOBOARD_CLOUD_DIR) : join(ROOT, "..", "protoboard-cloud");
  return existsSync(join(dir, "src", "server", "main.ts")) && existsSync(join(dir, "node_modules")) ? dir : undefined;
}

/** The test files that start the parts service from that checkout. */
export const SERVICE_TESTS = [
  "packages/cli/test/mcp.test.ts",
  "packages/core/test/libraries.test.ts",
  "packages/core/test/library-sort.test.ts",
  "packages/core/test/parts.test.ts",
  "packages/core/test/project-parts.test.ts",
  "packages/core/test/source.test.ts",
  "packages/core/test/vendored-paths.test.ts",
];
