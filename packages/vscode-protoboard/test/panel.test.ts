/**
 * The pieces around the commands: how each artifact opens, which project a
 * command is about, and where the CLI is found. (The viewer tabs' page is in
 * viewer.test.ts.)
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { SYSTEM_OPENS, describeArtifact, describeInstances, openMode, outsideOpen, partChoices, sortArtifacts, type ArtifactEntry } from "../src/artifacts.js";
import { CLI_BIN, FORMER_CLI_BIN, chooseRuntime, cliError, describeCli, describeRuntime, resolveCli, runCli } from "../src/cli.js";
import type { Stack } from "@protoboardai/core/stack";
import { chooseProject, projectOf, projectRoots } from "../src/project.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp", "panel");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const art = (over: Partial<ArtifactEntry>): ArtifactEntry => ({ definition: "motor", id: "a", present: true, instances: ["arm_fl/motor"], ...over });

describe("opening artifacts", () => {
  it("hands only safe file types to the system's application; an SVG is an image preview; anything else is shown in the file manager (PB-1048)", () => {
    for (const f of ["d.pdf", "p.PNG", "p.jpg", "p.jpeg", "b.step", "b.STP", "b.stl", "b.glb", "x.kicad_pcb", "x.kicad_sch", "x.kicad_pro", "x.kicad_sym", "x.kicad_mod", "gerbers.zip", "bom.csv", "notes.md"]) expect([f, outsideOpen(`/p/${f}`)]).toEqual([f, "system"]);
    expect(outsideOpen("/p/drawing.svg")).toBe("image-preview");
    expect(outsideOpen("/p/drawing.SVG")).toBe("image-preview");
    for (const f of ["run.sh", "setup.exe", "x.bat", "x.cmd", "x.ps1", "x.lnk", "x.desktop", "x.app", "x.jar", "x.html", "x.htm", "x.js", "x.vbs", "x.url", "x.webloc", "x.command", "x.terminal", "noext", "x.pdf.exe", "x.dmg", "x.msi", "x.scr", "x.hta", "x.xml"]) expect([f, outsideOpen(`/p/${f}`)]).toEqual([f, "reveal"]);
    expect([...SYSTEM_OPENS].every((e) => /^[a-z_]+$/.test(e))).toBe(true);
  });

  it("opens CAD and PDF in the system's application, sources and data in VS Code, links in the browser", () => {
    expect(openMode(art({ resolved: "/p/cad/body.step", format: "step" }))).toBe("external");
    expect(openMode(art({ resolved: "/p/cad/body.glb", format: "glb" }))).toBe("external");
    expect(openMode(art({ resolved: "/p/docs/datasheet.pdf", format: "pdf" }))).toBe("external");
    expect(openMode(art({ resolved: "/p/out/gerber.zip" }))).toBe("external");
    expect(openMode(art({ resolved: "/p/cad/parts.py", format: "py" }))).toBe("editor");
    expect(openMode(art({ resolved: "/p/cad/body.manifest.json", format: "json" }))).toBe("editor");
    expect(openMode(art({ resolved: "/p/cad/motor.kcl", format: "kcl" }))).toBe("editor");
    expect(openMode(art({ present: "remote", url: "https://example.com/m.html" }))).toBe("url");
    // missing file with a URL: the URL; nothing at all: not offered
    expect(openMode(art({ present: false, resolved: "/p/x.step", url: "https://example.com/x.step" }))).toBe("url");
    expect(openMode(art({ present: false, resolved: "/p/x.step" }))).toBe("none");
    expect(openMode(art({ present: "provenance" }))).toBe("none");
    expect(openMode(art({ present: "remote", url: "javascript:alert(1)" }))).toBe("none");
  });

  it("offers parts with something to open, CAD first", () => {
    const entries = [
      art({ id: "page", present: "remote", url: "https://example.com", name: "MEPS 2207" }),
      art({ id: "src", resolved: "/p/parts.py", name: "MEPS 2207" }),
      art({ id: "step", resolved: "/p/m.step", format: "step", name: "MEPS 2207" }),
      art({ id: "gone", present: false, resolved: "/p/gone.glb", definition: "ghost", instances: ["ghost"] }),
      art({ id: "glb", resolved: "/p/frame.glb", definition: "frame", name: "Frame", instances: ["frame"] }),
    ];
    const parts = partChoices(entries);
    expect(parts.map((p) => p.label)).toEqual(["Frame", "MEPS 2207"]);
    expect(sortArtifacts(parts[1].artifacts).map((a) => a.id)).toEqual(["step", "src", "page"]);
    expect(describeArtifact(entries[2])).toBe("STEP");
    expect(describeArtifact(art({ resolved: "/p/body.glb", role: "geometry" }))).toBe("GLB · geometry");
    expect(describeInstances(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d +2");
  });
});

describe("which project", () => {
  const roots = projectRoots([
    { file: "/ws/examples/quad/protoboard.config.ts", folder: "/ws" },
    { file: "/ws/examples/bench/protoboard.config.ts", folder: "/ws" },
    { file: "/ws/examples/quad/sub/protoboard.config.ts", folder: "/ws" },
    { file: "/ws/node_modules/@protoboardai/core/templates/protoboard.config.ts", folder: "/ws" },
    { file: "/ws/packages/cli/test/.tmp/dev-project/protoboard.config.ts", folder: "/ws" },
  ]);

  it("finds projects outside dependencies and test scratch folders", () => {
    expect(roots).toEqual(["/ws/examples/bench", "/ws/examples/quad", "/ws/examples/quad/sub"]);
    // the workspace's own location does not count against it
    expect(projectRoots([{ file: "/home/me/dist/quad/protoboard.config.ts", folder: "/home/me/dist/quad" }])).toEqual(["/home/me/dist/quad"]);
  });

  it("uses the active file's innermost project, else the only one, else the last used, else asks", () => {
    expect(projectOf("/ws/examples/quad/sub/src/a.uhd.ts", roots)).toBe("/ws/examples/quad/sub");
    expect(projectOf("/ws/examples/quadrant/a.ts", roots)).toBeUndefined();
    expect(chooseProject(roots, "/ws/examples/quad/src/q.uhd.ts")).toBe("/ws/examples/quad");
    expect(chooseProject(["/ws/examples/quad"], "/ws/README.md")).toBe("/ws/examples/quad");
    expect(chooseProject(roots, "/ws/README.md", "/ws/examples/bench")).toBe("/ws/examples/bench");
    expect(chooseProject(roots, undefined, "/gone")).toBeUndefined();
  });
});

describe("finding the CLI", () => {
  const has = (...files: string[]) => (f: string) => files.includes(f);
  const copy = (version: string, source: "vsix" | "registry" = "registry"): Stack => ({ dir: `/home/ada/.protoboard/stack/${version}`, marker: { schema: "protoboard.stack/v1", version, source, packages: {}, installedAt: "" } });
  const carried = { version: "0.1.3", dir: "/home/ada/.protoboard/stack/0.1.3" };
  const carriedCli = join(carried.dir, "node_modules", CLI_BIN);

  it("1: the project's own installed CLI comes first (looked up like Node does), even with the setting set", () => {
    expect(resolveCli("/ws/examples/quad", {}, has(join("/ws/node_modules", CLI_BIN)))).toEqual({ command: "node", args: [join("/ws/node_modules", CLI_BIN)], from: "project" });
    expect(resolveCli("/ws/examples/quad", {}, has(join("/ws/node_modules", CLI_BIN), join("/ws/examples/quad/node_modules", CLI_BIN))).args).toEqual([join("/ws/examples/quad/node_modules", CLI_BIN)]);
    // the order changed with PB-929: the setting no longer overrides a project's own CLI
    expect(resolveCli("/ws/quad", { cliPath: "/opt/pb/bin/protoboard.mjs", carried }, has(join("/ws/quad/node_modules", CLI_BIN)))).toMatchObject({ from: "project", args: [join("/ws/quad/node_modules", CLI_BIN)] });
  });

  it("2: then the protoboard.cliPath setting", () => {
    expect(resolveCli("/ws/quad", { cliPath: "/opt/pb/bin/protoboard.mjs", nodePath: "/usr/bin/node22" }, () => false)).toEqual({ command: "/usr/bin/node22", args: ["/opt/pb/bin/protoboard.mjs"], from: "setting" });
    expect(resolveCli("/ws/quad", { cliPath: "protoboard-dev" }, () => false)).toEqual({ command: "protoboard-dev", args: [], from: "setting" });
    expect(resolveCli("/ws/quad", { cliPath: "tools/pb.mjs" }, () => false)).toEqual({ command: "node", args: ["/ws/quad/tools/pb.mjs"], from: "setting" });
    // and it wins over the carried stack
    expect(resolveCli("/ws/quad", { cliPath: "protoboard-dev", carried }, () => false, () => "^0.1.3").from).toBe("setting");
  });

  it("3: then a stack copy that matches the version the project pins, when the carried stack does not", () => {
    const stacks = [copy("0.2.1"), copy("0.2.0"), copy("0.1.3", "vsix")];
    const pinned = resolveCli("/ws/quad", { carried, stacks }, () => false, () => "^0.2.0");
    expect(pinned).toEqual({ command: "node", args: [join("/home/ada/.protoboard/stack/0.2.1", "node_modules", CLI_BIN)], from: "store", stack: "/home/ada/.protoboard/stack/0.2.1" });
    expect(describeCli(pinned)).toMatch(/^3 of 4, the stack copy that matches the version the project pins/);
    // a project the carried stack satisfies uses the carried stack, whatever else is installed
    expect(resolveCli("/ws/quad", { carried, stacks }, () => false, () => "^0.1.1").from).toBe("carried");
  });

  it("4: then the stack carried in the .vsix, unpacked on first use; PATH is not looked at any more", async () => {
    let prepared = 0;
    const cli = resolveCli("/ws/quad", { carried: { ...carried, prepare: async () => void prepared++ }, stacks: [] }, () => false, () => "^0.1.3");
    expect(cli).toMatchObject({ command: "node", args: [carriedCli], from: "carried", stack: carried.dir });
    expect(cli.unsatisfied).toBeUndefined();
    expect(describeCli(cli)).toBe(`4 of 4, the stack carried by this extension: ${carriedCli}`);
    // no project at all (New Project, signing in first): the carried stack
    expect(resolveCli("/home/ada", { carried }, () => false, () => undefined).from).toBe("carried");
    // a project that pins a version nobody has: the carried one runs, and says so
    const other = resolveCli("/ws/quad", { carried, stacks: [copy("0.1.3", "vsix")] }, () => false, () => "^0.2.0");
    expect(other).toMatchObject({ from: "carried", unsatisfied: "^0.2.0" });
    expect(describeCli(other)).toContain("(the project asks for ^0.2.0, which it is not)");
    // runCli unpacks before it starts the command
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, "ok.mjs"), "console.log(process.env.ELECTRON_RUN_AS_NODE ?? 'unset')");
    const r = await runCli({ command: process.execPath, args: [join(TMP, "ok.mjs")], from: "carried", env: { ELECTRON_RUN_AS_NODE: "1" }, prepare: cli.prepare! }, [], { cwd: TMP });
    expect(prepared).toBe(1);
    expect(r.stdout.trim()).toBe("1");
    // a development build that carries nothing
    const none = resolveCli("/ws/quad", {}, () => false);
    expect(none).toEqual({ command: "protoboard", args: [], from: "none" });
    expect(describeCli(none)).toMatch(/^none found/);
  });

  it("runs the CLI on the system's Node.js 22 or later, else on VS Code's own runtime", () => {
    const own = { execPath: "/usr/share/code/code", version: "v22.20.0", electron: true };
    expect(chooseRuntime({ command: "/opt/n/bin/node", from: "setting" }, own)).toEqual({ command: "/opt/n/bin/node", from: "setting" });
    expect(chooseRuntime({ command: "node", from: "path", path: "/usr/bin/node" }, own, () => "22.11.0")).toEqual({ command: "node", from: "system", version: "22.11.0" });
    const old = chooseRuntime({ command: "node", from: "path", path: "/usr/bin/node" }, own, () => "18.19.1");
    expect(old).toEqual({ command: "/usr/share/code/code", env: { ELECTRON_RUN_AS_NODE: "1" }, from: "vscode", version: "22.20.0", why: "the Node.js on this machine is 18.19.1, older than 22" });
    expect(describeRuntime(old)).toBe("VS Code's own runtime as Node.js 22.20.0 (/usr/share/code/code), because the Node.js on this machine is 18.19.1, older than 22");
    expect(chooseRuntime({ command: "node", from: "missing" }, own)).toMatchObject({ from: "vscode", why: "no Node.js was found on this machine" });
    expect(chooseRuntime({ command: "/opt/homebrew/bin/node", from: "found", path: "/opt/homebrew/bin/node" }, own, () => undefined)).toMatchObject({ from: "vscode", why: "/opt/homebrew/bin/node did not run" });
    // a remote window's extension host is the server's own node: nothing to set
    expect(chooseRuntime({ command: "node", from: "missing" }, { execPath: "/home/ada/.vscode-server/node", version: "v22.21.1" }).env).toBeUndefined();
    // the runtime's environment travels with the command
    expect(resolveCli("/ws/quad", { carried, runtime: old }, () => false)).toMatchObject({ command: "/usr/share/code/code", env: { ELECTRON_RUN_AS_NODE: "1" } });
  });

  it("does not run a CLI installed under the former npm scope, and says the packages were renamed (PB-941)", async () => {
    const former = join("/ws/quad/node_modules", FORMER_CLI_BIN);
    expect(FORMER_CLI_BIN).toBe(join("@protoboard", "cli", "bin", "protoboard.mjs"));
    expect(CLI_BIN).toBe(join("@protoboardai", "cli", "bin", "protoboard.mjs"));
    const cli = resolveCli("/ws/quad", {}, has(former));
    expect(cli).toEqual({ command: "protoboard", args: [], from: "none", formerScope: former });
    // with a carried stack the project still runs, and still hears about the rename
    expect(resolveCli("/ws/quad", { carried }, has(former))).toMatchObject({ from: "carried", formerScope: former });
    // the current scope wins wherever it is installed, and then nothing is said
    expect(resolveCli("/ws/quad", {}, has(former, join("/ws/node_modules", CLI_BIN)))).toEqual({ command: "node", args: [join("/ws/node_modules", CLI_BIN)], from: "project" });
    const missing = Object.assign(new Error("spawn protoboard ENOENT"), { code: "ENOENT" });
    expect(cliError(cli, missing).message).toBe(
      "protoboard CLI not found: this project has @protoboard/cli installed: the Protoboard packages were renamed to @protoboardai/… (stack 0.1.1). " +
        "Replace `@protoboard/` with `@protoboardai/` in package.json, protoboard.config.ts, the capability configs and the project's imports, and set the project up again (Protoboard: Initialize Project; with packages installed by npm, point `@protoboardai:registry` in .npmrc at the registry and install them again)",
    );
    mkdirSync(TMP, { recursive: true });
    await expect(runCli({ command: "protoboard-not-installed-here", args: [], from: "none", formerScope: former }, ["check"], { cwd: TMP })).rejects.toThrow(/renamed to @protoboardai/);
  });

  it("runs it and explains a missing executable", async () => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, "echo.mjs"), `console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() })); process.exitCode = 1;`);
    const r = await runCli({ command: process.execPath, args: [join(TMP, "echo.mjs")], from: "setting" }, ["check", "--format", "json"], { cwd: TMP });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ args: ["check", "--format", "json"], cwd: TMP });
    await expect(runCli({ command: "protoboard-not-installed-here", args: [], from: "none" }, ["check"], { cwd: TMP })).rejects.toThrow(/carries no stack.*Install the Protoboard extension that carries the stack/);
    expect(cliError({ command: "x", args: [], from: "setting" }, new Error("EACCES")).message).toBe("EACCES");
  });
});
