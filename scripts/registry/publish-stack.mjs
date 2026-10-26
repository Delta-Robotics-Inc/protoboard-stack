#!/usr/bin/env node
/**
 * Publish the whole stack to the local registry (PB-813,
 * docs/guides/local-registry.md): @deltarobotics/uhd, @deltarobotics/uhd-viewer
 * and every @protoboardai/* package of this repository (packages/cloud, the
 * parts service's client, included), from the sibling checkouts of one
 * workspace.
 *
 *   node scripts/registry/publish-stack.mjs [--target local|verdaccio|artifact-registry] [--workspace <dir>] [--stack <dir>]
 *                                           [--registry <url>] [--replace] [--dry-run] [--only <name>[,<name>…]]
 *                                           [--uhd-dev] [--no-templates-note]
 *
 *   --target     where to publish (PB-911):
 *                  local              the loopback Verdaccio (default; http://127.0.0.1:4873/)
 *                  verdaccio          a hosted Verdaccio over https;
 *                                     token from PB_REGISTRY_TOKEN (`npm login --registry <url>`
 *                                     prints where npm keeps it)
 *                  artifact-registry  a Google Artifact Registry npm repository
 *                                     (https://<region>-npm.pkg.dev/<project>/<repo>/); token from
 *                                     PB_REGISTRY_TOKEN, else `gcloud auth print-access-token`
 *   --workspace  directory holding uhd/ and uhd-viewer/ (default: the parent of this repository)
 *   --stack      the stack checkout whose packages are published (default: this repository; with
 *                --workspace and no --stack, <workspace>/protoboard-stack or <workspace>/protoboard-cli)
 *   --registry   the registry URL (default for local: http://127.0.0.1:4873/; required for the
 *                hosted targets; or PB_REGISTRY_URL). The local target accepts only a
 *                loopback URL; no target ever accepts registry.npmjs.org.
 *   --replace    local only: unpublish a version that is already there and publish it again
 *                (local development: the same version with new contents). Without it, a
 *                version already published is skipped. A hosted registry's versions are
 *                immutable: bump the version instead.
 *   --only       publish only these package names
 *   --uhd-dev    publish UHD as a dev build, <next version>-dev.<short sha>, and pin the
 *                packages that depend on it to that exact version (below)
 *   --no-templates-note
 *                leave out the note at the end of a hosted publish that says which init
 *                templates pin part revisions behind the library's recommended ones
 *                (scripts/templates-parts.mjs; a note, never a failure; for a deploy script
 *                that shows it before publishing instead)
 *
 * UHD's version (PB-941, scripts/registry/uhd-version.mjs). UHD is released
 * from its own repository: a tag v<version> marks the release commit and
 * UHD's CI publishes that commit to npmjs. Nobody publishes a release from a
 * branch, and this script only mirrors UHD into a registry of ours:
 *
 *   - A hosted registry gets UHD under its plain version (0.3.0) only when
 *     the uhd checkout's HEAD is exactly the commit tagged v0.3.0 and no
 *     tracked file is changed. Anything else is refused, before anything is
 *     published, with what to do instead.
 *   - --uhd-dev publishes any other build as <next version>-dev.<short sha>
 *     (0.3.0-dev.1a2b3c4 before v0.3.0 is tagged, 0.3.1-dev.1a2b3c4 after it),
 *     a version that cannot be mistaken for a release, under the dist-tag
 *     `dev` (so `latest` stays on a release). The packages that
 *     depend on UHD get that exact version as their @deltarobotics/uhd
 *     dependency (and core's toolchain pin, which `protoboard init` writes
 *     into new projects) in the STAGED copies only; no repository is edited.
 *     A hosted registry's versions are immutable, so a dependant whose
 *     version is already there keeps its old UHD pin: bump its version too.
 *   - The local loopback registry stays permissive (a scratch copy of the
 *     working trees): it takes any build under the plain version and prints
 *     a note when that build is not the tagged one.
 *
 * A hosted registry's token never appears on a command line: it goes in a
 * temporary npm user config (mode 0600) that is deleted afterwards, and is
 * never printed.
 *
 * UHD and the viewer build on pack (their prepack scripts), so both need their
 * dependencies installed. The @protoboardai packages ship their TypeScript
 * sources and run through tsx, as in the monorepo.
 *
 * Private packages stay private: @protoboardai/* and @deltarobotics/uhd-viewer
 * are `"private": true` in their repositories, so a plain `npm publish` refuses
 * them anywhere (npmjs included). This script packs each one (`npm pack`, which
 * runs prepack), unpacks the tarball into a staging folder, drops `private`
 * from the staged package.json only, and publishes that folder to the
 * loopback registry (`--ignore-scripts`: pack already ran them).
 *
 * UHD is public and its package.json names no registry (no publishConfig), so
 * the explicit `--registry` passed here is what sends it to the local registry.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { UHD, pinUhd, uhdGitState, uhdPublishPlan } from "./uhd-version.mjs";
import { runNpm } from "../npm-cli.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    target: { type: "string" },
    workspace: { type: "string" },
    stack: { type: "string" },
    registry: { type: "string" },
    replace: { type: "boolean" },
    "dry-run": { type: "boolean" },
    only: { type: "string" },
    "uhd-dev": { type: "boolean" },
    "no-templates-note": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

const workspace = resolve(values.workspace ?? join(HERE, "..", "..", ".."));
// the stack checkout: --stack, else this repository (or, with --workspace, its protoboard-stack or protoboard-cli)
const stackRoot = values.stack
  ? resolve(values.stack)
  : values.workspace
    ? (["protoboard-stack", "protoboard-cli"].map((n) => join(workspace, n)).find((d) => existsSync(join(d, "packages"))) ?? join(workspace, "protoboard-stack"))
    : resolve(HERE, "..", "..");
const target = values.target ?? "local";
if (!["local", "verdaccio", "artifact-registry"].includes(target)) {
  console.error(`publish-stack: --target is local, verdaccio or artifact-registry, not ${target}`);
  process.exit(2);
}
const given = values.registry ?? process.env.PB_REGISTRY_URL;
if (target !== "local" && !given) {
  console.error(`publish-stack: --target ${target} needs --registry <url>`);
  process.exit(2);
}
const registry = new URL(given ?? "http://127.0.0.1:4873/").href.replace(/\/?$/, "/");
const host = new URL(registry).hostname;
const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(host);
if (/(^|\.)npmjs\.(org|com)$/.test(host) || /(^|\.)yarnpkg\.com$/.test(host)) {
  console.error(`publish-stack: ${registry} is a public registry; the stack's private packages never go there`);
  process.exit(2);
}
if (target === "local" && !loopback) {
  console.error(`publish-stack: ${registry} is not a loopback registry; use --target verdaccio or artifact-registry for a hosted one`);
  process.exit(2);
}
if (target === "artifact-registry" && !/-npm\.pkg\.dev$/.test(host)) {
  console.error(`publish-stack: ${registry} is not an Artifact Registry npm repository (https://<region>-npm.pkg.dev/<project>/<repo>/)`);
  process.exit(2);
}
if (target !== "local" && registry.startsWith("http:") && !loopback) {
  console.error(`publish-stack: ${registry} is not https; a hosted registry's token is never sent in the clear`);
  process.exit(2);
}
if (target !== "local" && values.replace) {
  console.error("publish-stack: --replace is for the local registry only; a hosted registry's versions are immutable (bump the version)");
  process.exit(2);
}
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : undefined;

// What UHD is published as: decided, and refused, before a token is read or the registry is asked anything
const uhdDir = join(workspace, "uhd");
let uhdPlan;
if (existsSync(join(uhdDir, "package.json")) && (!only || only.has(UHD) || values["uhd-dev"])) {
  const { version } = JSON.parse(readFileSync(join(uhdDir, "package.json"), "utf8"));
  uhdPlan = uhdPublishPlan({ version, hosted: !loopback, dev: Boolean(values["uhd-dev"]), git: uhdGitState(uhdDir, version) });
  if (uhdPlan.refuse) {
    console.error(`publish-stack: ${uhdPlan.refuse}`);
    process.exit(2);
  }
  if (uhdPlan.note) console.log(`publish-stack: note: ${uhdPlan.note}`);
  if (uhdPlan.dev) console.log(`publish-stack: UHD is published as ${uhdPlan.publishAs}; the packages that depend on it pin that version in their staged copies`);
}

/** The registry's token: a placeholder for the local Verdaccio (anyone on loopback may publish), else PB_REGISTRY_TOKEN or gcloud's. */
function registryToken() {
  if (target === "local") return "local-registry";
  if (process.env.PB_REGISTRY_TOKEN) return process.env.PB_REGISTRY_TOKEN;
  if (target === "artifact-registry") {
    try {
      return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    } catch {
      console.error("publish-stack: no token: set PB_REGISTRY_TOKEN, or sign in with `gcloud auth login` (Artifact Registry Writer on the repository)");
      process.exit(2);
    }
  }
  console.error("publish-stack: --target verdaccio needs PB_REGISTRY_TOKEN (a publisher's token from `npm login --registry <url>`)");
  process.exit(2);
}
// npm reads the token from a throwaway user config, never from the command line
const npmHome = mkdtempSync(join(tmpdir(), "pb-publish-npmrc-"));
const npmrc = join(npmHome, ".npmrc");
writeFileSync(npmrc, `${registry.replace(/^https?:/, "")}:_authToken=${registryToken()}\n`, { mode: 0o600 });
chmodSync(npmrc, 0o600);
process.on("exit", () => rmSync(npmHome, { recursive: true, force: true }));
const authArgs = ["--userconfig", npmrc];
const authHeader = target === "local" ? {} : { authorization: `Bearer ${readFileSync(npmrc, "utf8").split("_authToken=")[1].split("\n")[0]}` };

/** Package directories in publishing order: dependencies first. */
function packageDirs() {
  const dirs = [join(workspace, "uhd"), join(workspace, "uhd-viewer")];
  const pkgs = readdirSync(join(stackRoot, "packages"))
    .map((d) => join(stackRoot, "packages", d))
    .filter((d) => existsSync(join(d, "package.json")))
    .filter((d) => JSON.parse(readFileSync(join(d, "package.json"), "utf8")).name?.startsWith("@protoboardai/"));
  // the cloud client (core depends on it), then core, then the extensions, the CLI last (its dependencies are all above)
  const rank = (d) => (d.endsWith("/cloud") ? -1 : d.endsWith("/core") ? 0 : d.endsWith("/cli") ? 2 : 1);
  pkgs.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return [...dirs, ...pkgs];
}

async function published(name, version) {
  const res = await fetch(new URL(name.replace("/", "%2f"), registry), { headers: authHeader });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`${name}: registry answered ${res.status}`);
  const doc = await res.json();
  return Boolean(doc.versions?.[version]);
}

// Verdaccio answers /-/ping; Artifact Registry does not, so a package lookup stands in for it there
const ping = await fetch(new URL(target === "artifact-registry" ? "@protoboardai%2fcore" : "-/ping", registry), { headers: authHeader }).catch(() => undefined);
if (!ping || (!ping.ok && ping.status !== 404)) {
  console.error(`publish-stack: no registry at ${registry}${ping ? ` (${ping.status}${ping.status === 401 || ping.status === 403 ? ": the token was refused" : ""})` : ""}${target === "local" ? " (start it: registry/start.sh)" : ""}`);
  process.exit(1);
}

const results = [];
for (const dir of packageDirs()) {
  if (!existsSync(join(dir, "package.json"))) {
    console.error(`publish-stack: missing ${dir}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const name = manifest.name;
  const version = name === UHD && uhdPlan ? uhdPlan.publishAs : manifest.version;
  if (only && !only.has(name)) continue;
  if (await published(name, version)) {
    if (!values.replace) {
      // an immutable copy keeps the UHD pin it was published with
      const stale = uhdPlan?.dev && name !== UHD && pinUhd(structuredClone(manifest), uhdPlan.publishAs).length;
      results.push(`skip     ${name}@${version} (already published${stale ? `, with its earlier UHD pin: bump its version to ship ${UHD}@${uhdPlan.publishAs}` : target === "local" ? "; --replace to publish it again" : ""})`);
      continue;
    }
    if (!values["dry-run"]) runNpm(["unpublish", `${name}@${version}`, "--force", "--registry", registry, ...authArgs], { stdio: "inherit" });
  }
  console.log(`\n=== ${name}@${version}  (${dir})`);
  // pack (prepack builds), stage, un-private the staged copy only, publish it
  const stage = mkdtempSync(join(tmpdir(), "pb-publish-"));
  try {
    runNpm(["pack", "--pack-destination", stage], { cwd: dir, stdio: "inherit" });
    const tarball = readdirSync(stage).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new Error(`${name}: npm pack wrote no tarball`);
    execFileSync("tar", ["-xzf", join(stage, tarball), "-C", stage]);
    const staged = join(stage, "package");
    const pkg = JSON.parse(readFileSync(join(staged, "package.json"), "utf8"));
    delete pkg.private;
    // a dev build of UHD: its own version, and the exact pin of the packages that depend on it (staged copies only)
    if (uhdPlan?.dev) {
      if (name === UHD) pkg.version = version;
      else {
        const pinned = pinUhd(pkg, uhdPlan.publishAs);
        if (pinned.length) console.log(`${name}: ${UHD} pinned to ${uhdPlan.publishAs} (${pinned.join(", ")})`);
      }
    }
    writeFileSync(join(staged, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    // a package's publishConfig names the local registry: a hosted copy leaves it out
    if (target !== "local") {
      delete pkg.publishConfig;
      writeFileSync(join(staged, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    }
    // npm wants a dist-tag for a prerelease version, and `latest` stays on releases
    const distTag = /-dev\./.test(version) ? ["--tag", "dev"] : version.includes("-") ? ["--tag", "next"] : [];
    const args = ["publish", staged, "--ignore-scripts", "--registry", registry, ...authArgs, ...distTag, ...(values["dry-run"] ? ["--dry-run"] : [])];
    runNpm(args, { stdio: "inherit" });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  results.push(`${values["dry-run"] ? "dry-run " : "publish "} ${name}@${version}`);
}
console.log(`\n=== published to ${registry}\n${results.join("\n")}`);

// A release note, not a gate (PB-944): templates ship inside @protoboardai/core, so what they pin is what
// this publish hands to new projects. Hosted targets only; the local registry is published to all day.
if (target !== "local" && !values["no-templates-note"]) {
  console.log("\n=== note: the init templates' part revisions");
  spawnSync(process.execPath, [join(HERE, "..", "templates-parts.mjs")], { stdio: "inherit" });
}
