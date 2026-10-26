// Runs test/integration/suite-pcb.cjs inside a VS Code downloaded to .vscode-test/, on the wearable watch
// example: a project with a board the circuit provider built and routed (PB-1018). The board's PCB tab draws the
// routed result, and a component of it says in the Inspector where it sits on the board.
// VSCODE_TEST_VERSION picks the VS Code (default: stable); PROTOBOARD_TEST_LOGS keeps its logs, as run.mjs does.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { trustProjects } from "./trust-fixture.mjs";

const pkg = fileURLToPath(new URL("../..", import.meta.url));
const workspace = join(pkg, "..", "..", "examples", "wearable-watch");
const profile = mkdtempSync(join(tmpdir(), "vscode-protoboard-pcb-"));
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--ozone-platform=headless", "--disable-gpu"] : [];
try {
  // the workspace's project is trusted, as a person answers the extension's question once (PB-1048)
  trustProjects(join(profile, "protoboard-config"), [workspace]);
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? "stable",
    extensionDevelopmentPath: pkg,
    extensionTestsPath: join(pkg, "test", "integration", "suite-pcb.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--user-data-dir", join(profile, "user"), "--extensions-dir", join(profile, "extensions"), ...headless, ...(process.env.VSCODE_TEST_ARGS?.split(" ").filter(Boolean) ?? [])],
    extensionTestsEnv: {
      PROTOBOARD_TEST_WORKSPACE: workspace,
      // the carried stack (when this checkout has built one) is unpacked into the test's own folder
      PROTOBOARD_HOME: join(profile, "protoboard-home"),
      // never the user's own config folder (sign-ins, access.json): the test's own, empty (signed out)
      PROTOBOARD_CONFIG_DIR: join(profile, "protoboard-config"),
      PROTOBOARD_CREDENTIAL_STORE: "file",
    },
  });
} catch (e) {
  console.error(`PCB integration test failed: ${e.message ?? e}`);
  process.exitCode = 1;
} finally {
  const keep = process.env.PROTOBOARD_TEST_LOGS;
  if (keep && existsSync(join(profile, "user", "logs"))) {
    try {
      mkdirSync(keep, { recursive: true });
      cpSync(join(profile, "user", "logs"), join(keep, `vscode-pcb-${process.env.VSCODE_TEST_VERSION ?? "stable"}`), { recursive: true });
    } catch (e) {
      console.error(`could not keep VS Code's logs: ${e.message}`);
    }
  }
  rmSync(profile, { recursive: true, force: true });
}
