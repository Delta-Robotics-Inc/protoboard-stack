// Runs test/integration/suite.cjs inside a VS Code downloaded to .vscode-test/,
// with the extension under development and the quadcopter example as the
// workspace. On Linux without a display, VS Code runs with Chromium's
// headless platform (no X server or xvfb needed).
// PROTOBOARD_TEST_LOGS=<folder>: VS Code's logs of the run are copied there before the profile is removed (the
// extension's own log is in them: window1/exthost/deltarobotics.vscode-protoboard/Protoboard.log). CI uploads
// the folder when the test fails.
import { fork } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
// VS Code puts its IPC socket in the profile; macOS caps a socket path at 104 bytes and its tmpdir() (/var/folders/…) is long
const profileBase = process.platform === "darwin" ? "/tmp" : tmpdir();
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { trustProjects } from "./trust-fixture.mjs";

const pkg = fileURLToPath(new URL("../..", import.meta.url));
const workspace = join(pkg, "..", "..", "examples", "quadcopter-5in");
const profile = mkdtempSync(join(profileBase, "vscode-protoboard-test-"));
// the Library searches a real library when one is given (the dev catalog, for example), else a stand-in
let library = process.env.PROTOBOARD_TEST_LIBRARY_URL;
let fake;
if (!library) {
  fake = fork(fileURLToPath(new URL("./fake-library.mjs", import.meta.url)), [], { stdio: "inherit" });
  library = await new Promise((ok) => fake.once("message", (m) => ok(m.url)));
}
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--ozone-platform=headless", "--disable-gpu"] : [];
try {
  // the workspace's project is trusted, as a person answers the extension's question once (PB-1048)
  trustProjects(join(profile, "protoboard-config"), [workspace, join(workspace, "..", "smart-bottle")]);
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? "stable",
    extensionDevelopmentPath: pkg,
    extensionTestsPath: join(pkg, "test", "integration", "suite.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--user-data-dir", join(profile, "user"), "--extensions-dir", join(profile, "extensions"), ...headless, ...(process.env.VSCODE_TEST_ARGS?.split(" ").filter(Boolean) ?? [])],
    extensionTestsEnv: {
      PROTOBOARD_TEST_WORKSPACE: workspace,
      PROTOBOARD_FAKE_CLI: join(pkg, "test", "integration", "fake-cli.mjs"),
      PROTOBOARD_FAKE_LOG: join(profile, "requests.log"),
      // the carried stack (when this checkout has built one) is unpacked into the test's own folder, never the user's ~/.protoboard
      PROTOBOARD_HOME: join(profile, "protoboard-home"),
      // never the user's own config folder (sign-ins, access.json): the test's own, empty (signed out)
      PROTOBOARD_CONFIG_DIR: join(profile, "protoboard-config"),
      PROTOBOARD_CREDENTIAL_STORE: "file",
      PROTOBOARD_CLOUD_URL: library,
      PROTOBOARD_TEST_LIBRARY: process.env.PROTOBOARD_TEST_LIBRARY_URL ? "real" : "fake",
    },
  });
} catch (e) {
  console.error(`integration test failed: ${e.message ?? e}`);
  process.exitCode = 1;
} finally {
  fake?.kill();
  const keep = process.env.PROTOBOARD_TEST_LOGS;
  if (keep && existsSync(join(profile, "user", "logs"))) {
    try {
      mkdirSync(keep, { recursive: true });
      cpSync(join(profile, "user", "logs"), join(keep, `vscode-${process.env.VSCODE_TEST_VERSION ?? "stable"}`), { recursive: true });
      if (existsSync(join(profile, "requests.log"))) cpSync(join(profile, "requests.log"), join(keep, `fake-cli-requests-${process.env.VSCODE_TEST_VERSION ?? "stable"}.log`));
    } catch (e) {
      console.error(`could not keep VS Code's logs: ${e.message}`);
    }
  }
  rmSync(profile, { recursive: true, force: true });
}
