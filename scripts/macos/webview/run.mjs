// Runs suite.cjs inside a downloaded VS Code (PB-943): node scripts/macos/webview/run.mjs [version ...]
// (default: 1.108.2, the first beta tester's, and stable). It needs only @vscode/test-electron, found from
// PROBE_MODULES (a folder with node_modules) or from packages/vscode-protoboard.
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const from = process.env.PROBE_MODULES ?? join(here, "..", "..", "..", "packages", "vscode-protoboard");
const { runTests } = createRequire(join(from, "package.json"))("@vscode/test-electron");
const versions = process.argv.slice(2).length ? process.argv.slice(2) : ["1.108.2", "stable"];
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--ozone-platform=headless", "--disable-gpu"] : [];
let failed = false;
for (const version of versions) {
  const profile = mkdtempSync(join(tmpdir(), "pb-webview-probe-"));
  console.log(`\n== webview probe on VS Code ${version}`);
  try {
    await runTests({
      version,
      // VS Code is downloaded once, beside the modules (not into the folder the probe is run from)
      cachePath: join(from, ".vscode-test"),
      extensionDevelopmentPath: here,
      extensionTestsPath: join(here, "suite.cjs"),
      launchArgs: ["--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--user-data-dir", join(profile, "user"), "--extensions-dir", join(profile, "extensions"), ...headless],
    });
  } catch (e) {
    failed = true;
    console.error(`webview probe failed on VS Code ${version}: ${e.message ?? e}`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
