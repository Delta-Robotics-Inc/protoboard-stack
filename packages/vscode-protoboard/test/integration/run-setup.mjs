// Runs test/integration/suite-setup.cjs inside a VS Code downloaded to .vscode-test/, on a folder OUTSIDE the
// stack's repository that holds a Protoboard project which is not set up: no node_modules, as after a git clone
// (first builds review, D1, D2, D5 and items 23 and 24). Nobody is signed in, the service does not answer, and
// the sign-in requirement is ON. The extension must start, show the project as not set up and the user as signed
// out, set the project up with Initialize (no npm, no registry), open its viewer tab signed out, and unlock by
// itself when a sign-in is made elsewhere.
//
// The Protoboard "installed for the user" is a stand-in copy in the test's own PROTOBOARD_HOME whose packages lead
// to this repository's (so the project really loads): the user's ~/.protoboard and sign-in are never touched.
// VSCODE_TEST_VERSION picks the VS Code (default: stable); PROTOBOARD_TEST_LOGS keeps its logs, as run.mjs does.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
// VS Code puts its IPC socket in the profile; macOS caps a socket path at 104 bytes and its tmpdir() (/var/folders/…) is long
const profileBase = process.platform === "darwin" ? "/tmp" : tmpdir();
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { trustProjects } from "./trust-fixture.mjs";

const pkg = fileURLToPath(new URL("../..", import.meta.url));
const repo = join(pkg, "..", "..");
const profile = realpathSync(mkdtempSync(join(profileBase, "vscode-protoboard-setup-")));
const workspace = join(profile, "work", "cloned");
const home = join(profile, "protoboard-home");
const config = join(profile, "config");
const version = JSON.parse(readFileSync(join(repo, "packages", "core", "package.json"), "utf8")).version;
const cli = join(repo, "packages", "cli", "bin", "protoboard.mjs");
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY ? ["--ozone-platform=headless", "--disable-gpu"] : [];
try {
  // the stand-in copy: <home>/stack/<version>/node_modules/<scope>/<name> → this repository's package
  const stack = join(home, "stack", version);
  const packages = {};
  for (const scope of ["@protoboardai", "@deltarobotics"]) {
    mkdirSync(join(stack, "node_modules", scope), { recursive: true });
    for (const name of readdirSync(join(repo, "node_modules", scope))) {
      symlinkSync(realpathSync(join(repo, "node_modules", scope, name)), join(stack, "node_modules", scope, name), "dir");
      packages[`${scope}/${name}`] = version;
    }
  }
  writeFileSync(join(stack, "protoboard-stack.json"), JSON.stringify({ schema: "protoboard.stack/v1", version, source: "registry", packages, installedAt: new Date().toISOString() }));
  // the project, as `protoboard init --stack project` leaves it before any install: files, and no node_modules
  mkdirSync(join(profile, "work"), { recursive: true });
  const made = spawnSync(process.execPath, [cli, "init", workspace, "--stack", "project", "--no-parts", "--url", "http://127.0.0.1:9"], { encoding: "utf8", env: { ...process.env, PROTOBOARD_HOME: home } });
  if (made.status !== 0) throw new Error(`protoboard init failed: ${made.stderr || made.stdout}`);
  if (existsSync(join(workspace, "node_modules"))) throw new Error("the project was made with packages: it is not the project this test is about");
  mkdirSync(config, { recursive: true });
  // the workspace's project is trusted, as a person answers the extension's question once (PB-1048)
  trustProjects(config, [workspace]);
  await runTests({
    version: process.env.VSCODE_TEST_VERSION ?? "stable",
    extensionDevelopmentPath: pkg,
    extensionTestsPath: join(pkg, "test", "integration", "suite-setup.cjs"),
    launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--user-data-dir", join(profile, "user"), "--extensions-dir", join(profile, "extensions"), ...headless, ...(process.env.VSCODE_TEST_ARGS?.split(" ").filter(Boolean) ?? [])],
    extensionTestsEnv: {
      PROTOBOARD_TEST_WORKSPACE: workspace,
      PROTOBOARD_HOME: home,
      // signed out for real: an empty credentials folder, a service that refuses connections
      PROTOBOARD_CONFIG_DIR: config,
      PROTOBOARD_CREDENTIAL_STORE: "file",
      PROTOBOARD_CLOUD_URL: "",
      PROTOBOARD_CLOUD_TOKEN: "",
    },
  });
} catch (e) {
  console.error(`set-up integration test failed: ${e.message ?? e}`);
  process.exitCode = 1;
} finally {
  const keep = process.env.PROTOBOARD_TEST_LOGS;
  if (keep && existsSync(join(profile, "user", "logs"))) {
    try {
      mkdirSync(keep, { recursive: true });
      cpSync(join(profile, "user", "logs"), join(keep, `vscode-setup-${process.env.VSCODE_TEST_VERSION ?? "stable"}`), { recursive: true });
    } catch (e) {
      console.error(`could not keep VS Code's logs: ${e.message}`);
    }
  }
  rmSync(profile, { recursive: true, force: true });
}
