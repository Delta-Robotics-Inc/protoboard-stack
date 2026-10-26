import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import { SERVICE_TESTS, cloudCheckout } from "./packages/core/test/cloud-checkout.ts";

// The shells bundle React 19 (web-viewer's copy); the root's react-dom is 18 for the circuit tools. Radix's
// primitives the views use (the themed select) would load the root's in tests: give them the shells' copy, as
// the bundles do (resolve.dedupe in web-viewer's Vite configs).
const shell = createRequire(new URL("./packages/web-viewer/package.json", import.meta.url));
const shellsReactDom = (): Plugin => ({
  name: "shells-react-dom",
  enforce: "pre",
  resolveId(source, importer) {
    if (!importer || !/[\\/]node_modules[\\/]@(radix-ui|floating-ui)[\\/]/.test(importer)) return null;
    if (source === "react-dom") return shell.resolve("react-dom");
    if (source.startsWith("react-dom/")) return shell.resolve(source);
    return null;
  },
});

export default defineConfig({
  plugins: [shellsReactDom()],
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // the tests that run the real parts service need a protoboard-cloud checkout (PROTOBOARD_CLOUD_DIR, else
    // ../protoboard-cloud); without one they are left out, and the rest runs
    exclude: ["**/node_modules/**", ...(cloudCheckout() ? [] : SERVICE_TESTS)],
    // the tests never read or write the user's own Protoboard config folder (sign-ins, access.json): a suite that
    // needs one makes its own; this is the rest's
    env: { PROTOBOARD_CONFIG_DIR: mkdtempSync(join(tmpdir(), "protoboard-test-config-")) },
    testTimeout: 60000,
    hookTimeout: 60000,
    server: { deps: { inline: [/[\\/]node_modules[\\/]@(radix-ui|floating-ui)[\\/]/] } },
  },
});
