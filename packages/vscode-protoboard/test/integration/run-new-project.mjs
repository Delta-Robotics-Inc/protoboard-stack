// Runs test/integration/suite-new-project.cjs inside a VS Code downloaded to .vscode-test/, on a folder
// that holds NO project when the window opens (PB-931, PB-946): the extension must start anyway, notice the
// projects made there afterwards, and bring them up without a reload. The folder is made inside the stack's
// examples/ so the projects find the stack's own CLI and packages above them (node_modules up the tree), as a
// project finds its installed ones; it is removed afterwards.
// VSCODE_TEST_VERSION picks the VS Code (default: stable); PROTOBOARD_TEST_LOGS keeps its logs, as run.mjs does.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const pkg = fileURLToPath(new URL("../..", import.meta.url));
const examples = join(pkg, "..", "..", "examples");
// not a dot-folder name the extension would take for scratch if a parent folder were opened; unique per run
const workspace = mkdtempSync(join(examples, "new-project-test-"));
const profile = mkdtempSync(join(tmpdir(), "vscode-protoboard-new-"));
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--ozone-platform=headless", "--disable-gpu"] : [];
try {
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? "stable",
    extensionDevelopmentPath: pkg,
    extensionTestsPath: join(pkg, "test", "integration", "suite-new-project.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--user-data-dir", join(profile, "user"), "--extensions-dir", join(profile, "extensions"), ...headless, ...(process.env.VSCODE_TEST_ARGS?.split(" ").filter(Boolean) ?? [])],
    extensionTestsEnv: {
      PROTOBOARD_TEST_WORKSPACE: workspace,
      // nothing here reaches a parts service: the first projects are made without a template, and the last
      // from one, to see what a project whose catalog parts could not be fetched shows
      PROTOBOARD_CLOUD_URL: "http://127.0.0.1:9",
      // never the user's own config folder (sign-ins, access.json): the test's own, empty (signed out)
      PROTOBOARD_CONFIG_DIR: join(profile, "protoboard-config"),
      PROTOBOARD_CREDENTIAL_STORE: "file",
    },
  });
} catch (e) {
  console.error(`new-project integration test failed: ${e.message ?? e}`);
  process.exitCode = 1;
} finally {
  const keep = process.env.PROTOBOARD_TEST_LOGS;
  if (keep && existsSync(join(profile, "user", "logs"))) {
    try {
      mkdirSync(keep, { recursive: true });
      cpSync(join(profile, "user", "logs"), join(keep, `vscode-new-project-${process.env.VSCODE_TEST_VERSION ?? "stable"}`), { recursive: true });
    } catch (e) {
      console.error(`could not keep VS Code's logs: ${e.message}`);
    }
  }
  rmSync(profile, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
}
