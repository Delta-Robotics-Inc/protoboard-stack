import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// No test reaches the hosted Protoboard library (a project without cloud.url uses it by default): the guard
// fails such a request, as a service that does not answer, in the workers and in every Node process they
// start, and the run lists them at its end (scripts/test/no-hosted-service.mjs)
const NO_HOSTED = new URL("./scripts/test/no-hosted-service.mjs", import.meta.url);
const NO_HOSTED_TEARDOWN = fileURLToPath(new URL("./scripts/test/no-hosted-service-teardown.mjs", import.meta.url));
process.env.PB_TEST_HOSTED_LOG ??= join(mkdtempSync(join(tmpdir(), "protoboard-test-hosted-")), "hosted.log");
const NODE_OPTIONS = [process.env.NODE_OPTIONS, `--import=${NO_HOSTED.href}`].filter(Boolean).join(" ");

export default defineConfig({
  plugins: [shellsReactDom()],
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    // the tests that run the real parts service need a protoboard-cloud checkout (PROTOBOARD_CLOUD_DIR, else
    // ../protoboard-cloud); without one they are left out, and the rest runs
    exclude: ["**/node_modules/**", ...(cloudCheckout() ? [] : SERVICE_TESTS)],
    // the tests never read or write the user's own Protoboard config folder (sign-ins, access.json): a suite that
    // needs one makes its own; this is the rest's
    env: { PROTOBOARD_CONFIG_DIR: mkdtempSync(join(tmpdir(), "protoboard-test-config-")), PB_TEST_HOSTED_LOG: process.env.PB_TEST_HOSTED_LOG, NODE_OPTIONS },
    setupFiles: [fileURLToPath(NO_HOSTED)],
    globalSetup: [NO_HOSTED_TEARDOWN],
    testTimeout: 60000,
    hookTimeout: 60000,
    server: { deps: { inline: [/[\\/]node_modules[\\/]@(radix-ui|floating-ui)[\\/]/] } },
  },
});
