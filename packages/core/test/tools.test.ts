/**
 * Project tool runtimes (PB-817): extensions declare the runtime a tool comes
 * from, `installRuntimes` creates it under .protoboard/tools/ and records it,
 * and probes, checks and operations find it without environment setup. A
 * variable the user sets still wins.
 *
 * The python runtime here is a real venv with no packages (no network); the
 * node runtime is installed through a stub `exec` that lays out node_modules
 * the way npm would. The real cad runtime (build123d) is exercised by hand:
 * see the README's "Tool runtimes".
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  findOperation,
  installRuntimes,
  loadProject,
  parsePin,
  planRuntimes,
  probeTools,
  projectRuntime,
  readToolsRecord,
  runOperation,
  runtimeStatus,
  toolEnvironment,
  type Exec,
} from "../src/index.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-tools");
const CLI = join(HERE, "..", "..", "cli", "bin", "protoboard.mjs");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function project(name: string, extensions: Record<string, { manifest: unknown; files?: Record<string, string> }>) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write(
    "protoboard.config.ts",
    `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, extensions: ${JSON.stringify(Object.keys(extensions))} });\n`,
  );
  write("src/sys.uhd.ts", `export const SYS = { id: "sys", interfaces: [] };\n`);
  write("package.json", JSON.stringify({ name, type: "module" }));
  for (const [pkg, e] of Object.entries(extensions)) {
    write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version: "0.1.0", type: "module" }));
    write(`node_modules/${pkg}/protoboard-extension.json`, JSON.stringify(e.manifest));
    for (const [rel, content] of Object.entries(e.files ?? {})) write(`node_modules/${pkg}/${rel}`, content);
  }
  return dir;
}

const base = (id: string, extra: object = {}) => ({ schema: "protoboard.extension/v0", id, version: "0.1.0", compatibility: { protoboard: "^0.2.0" }, ...extra });

/** A tool found through a variable, the way the CAD extensions find PROTOBOARD_PYTHON. */
const pyTool = (packages: string[] = []) => ({
  id: "fake-python",
  purpose: "an interpreter from the project runtime",
  probe: ["sh", "-c", `exec "\${FAKE_TOOL_PYTHON:-/nonexistent/python}" -c 'import sys; print(sys.prefix)'`],
  install: "protoboard tools install fake",
  runtime: { id: "fake", kind: "python", packages, env: "FAKE_TOOL_PYTHON" },
});

describe("runtime declarations", () => {
  it("accepts exact pins only", () => {
    expect(parsePin("python", "build123d==0.13.0")).toEqual({ name: "build123d", version: "0.13.0" });
    expect(parsePin("python", "Scikit_Learn==1.7.2")).toEqual({ name: "scikit-learn", version: "1.7.2" });
    expect(parsePin("python", "build123d>=0.13")).toBeUndefined();
    expect(parsePin("node", "@tscircuit/core@0.0.2056")).toEqual({ name: "@tscircuit/core", version: "0.0.2056" });
    expect(parsePin("node", "circuit-json@^0.0.510")).toBeUndefined();
    expect(parsePin("node", "tscircuit")).toBeUndefined();
  });

  it("refuses a manifest whose runtime is not pinned, or names an unusable variable", async () => {
    const dir = project("bad-runtime", {
      "ext-ranges": { manifest: base("ext-ranges", { tools: [{ ...pyTool(["build123d>=0.13"]) }] }) },
      "ext-path": { manifest: base("ext-path", { tools: [{ ...pyTool(), runtime: { id: "x", kind: "node", packages: ["left-pad@^1.3.0"], env: "PATH" } }] }) },
      "ext-all": { manifest: base("ext-all", { tools: [{ ...pyTool(), runtime: { id: "all", kind: "ruby", packages: [] } }] }) },
    });
    const p = await loadProject(dir, { checks: false });
    expect(p.extensions).toHaveLength(0);
    const messages = p.diagnostics.filter((d) => d.code === "PB_EXTENSION_MANIFEST_INVALID").map((d) => d.message);
    expect(messages.some((m) => /"build123d>=0.13" is not an exact python pin/.test(m))).toBe(true);
    expect(messages.some((m) => /"left-pad@\^1.3.0" is not an exact node pin/.test(m))).toBe(true);
    expect(messages.some((m) => /runtime env must be a variable name/.test(m))).toBe(true);
    expect(messages.some((m) => /runtime id must be/.test(m) && /ext-all/.test(m))).toBe(true);
    expect(messages.some((m) => /runtime kind must be one of python, node/.test(m))).toBe(true);
  });

  it("merges the pins of every extension that shares a runtime, and reports disagreements", async () => {
    const tool = (id: string, packages: string[], kind = "python") => ({ id, purpose: id, probe: ["true"], runtime: { id: "cad", kind, packages, env: "PROTOBOARD_PYTHON" } });
    const dir = project("plans", {
      "ext-frame": { manifest: base("ext-frame", { tools: [tool("py", ["build123d==0.13.0"])] }) },
      "ext-harness": { manifest: base("ext-harness", { tools: [tool("py", ["scipy==1.18.1", "build123d==0.13.0", "numpy==2.5.3"])] }) },
      "ext-board": { manifest: base("ext-board", { tools: [{ id: "tsci", purpose: "tsci", probe: ["true"], runtime: { id: "circuit", kind: "node", packages: ["@tscircuit/core@0.0.2056", "circuit-json@0.0.510"] } }] }) },
    });
    const p = await loadProject(dir, { checks: false });
    expect(planRuntimes(p.extensions)).toEqual([
      { id: "cad", kind: "python", packages: ["build123d==0.13.0", "numpy==2.5.3", "scipy==1.18.1"], env: ["PROTOBOARD_PYTHON"], provides: ["ext-frame#py", "ext-harness#py"], problems: [] },
      { id: "circuit", kind: "node", packages: ["@tscircuit/core@0.0.2056", "circuit-json@0.0.510"], env: [], provides: ["ext-board#tsci"], problems: [] },
    ]);

    const clash = project("plans-clash", {
      "ext-frame": { manifest: base("ext-frame", { tools: [tool("py", ["build123d==0.13.0"])] }) },
      "ext-newer": { manifest: base("ext-newer", { tools: [tool("py", ["build123d==0.14.0"])] }) },
      "ext-odd": { manifest: base("ext-odd", { tools: [tool("js", ["x@1.0.0"], "node")] }) },
    });
    const q = await loadProject(clash, { checks: false });
    const [cad] = planRuntimes(q.extensions);
    expect(cad.problems).toEqual(["build123d: ext-frame#py pins 0.13.0, ext-newer#py pins 0.14.0", "ext-odd#js declares runtime cad as node; ext-frame#py declares it as python"]);
    const [r] = await installRuntimes(q.root, q.extensions, ["cad"], { exec: () => Promise.reject(new Error("must not run")) });
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/conflicting declarations/);
    expect(existsSync(join(clash, ".protoboard/tools"))).toBe(false);
  });

  it("refuses a runtime nobody declares", async () => {
    const dir = project("unknown", { "ext-a": { manifest: base("ext-a", { tools: [pyTool()] }) } });
    const p = await loadProject(dir, { checks: false });
    await expect(installRuntimes(p.root, p.extensions, ["circuit"])).rejects.toThrow(/no extension in this project declares a circuit runtime \(declared: fake\)/);
  });
});

describe("a python runtime (a real venv, no packages)", () => {
  const OP = `export async function whichPython(ctx) {\n  return { status: "succeeded", summary: process.env.FAKE_TOOL_PYTHON ?? "unset" };\n}\n`;
  const dir = project("python", {
    "ext-py": {
      manifest: base("ext-py", {
        tools: [pyTool()],
        operations: [{ id: "which-python", summary: "report the interpreter the operation sees", entry: "./ops.ts#whichPython", effect: "pure", requires: ["fake-python"] }],
      }),
      files: { "ops.ts": OP },
    },
  });
  const saved = process.env.FAKE_TOOL_PYTHON;
  delete process.env.FAKE_TOOL_PYTHON;
  afterAll(() => {
    if (saved === undefined) delete process.env.FAKE_TOOL_PYTHON;
    else process.env.FAKE_TOOL_PYTHON = saved;
  });

  it("is missing until installed, then found without any environment setup", async () => {
    const p = await loadProject(dir, { checks: false });
    const before = probeTools(p.extensions, { root: p.root });
    expect(before[0]).toMatchObject({ id: "fake-python", available: false, runtime: "fake", source: "system", install: "protoboard tools install fake" });
    expect(runtimeStatus(p.root, p.extensions)[0]).toMatchObject({ id: "fake", installed: false });
    const op = findOperation(p.extensions, "which-python")!;
    expect((await runOperation(p, op.ext, op.op, {})).status).toBe("refused");

    const lines: string[] = [];
    const [r] = await installRuntimes(p.root, p.extensions, ["all"], { log: (l) => lines.push(l), now: () => "2026-10-02T00:00:00.000Z" });
    expect(r).toMatchObject({ id: "fake", kind: "python", status: "installed", dir: ".protoboard/tools/fake" });
    expect(r.verified).toEqual([{ tool: "ext-py#fake-python", available: true, detail: join(dir, ".protoboard/tools/fake") }]);
    expect(lines[0]).toMatch(/creating a Python venv/);

    const record = readToolsRecord(p.root).runtimes.fake;
    expect(record).toMatchObject({
      kind: "python",
      dir: ".protoboard/tools/fake",
      packages: [],
      interpreter: { path: ".protoboard/tools/fake/bin/python" },
      env: { FAKE_TOOL_PYTHON: ".protoboard/tools/fake/bin/python" },
      bin: ".protoboard/tools/fake/bin",
      provides: ["ext-py#fake-python"],
      installedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(record.interpreter.version).toMatch(/^3\.\d+\.\d+$/);
    expect(Object.keys(record.installed)).toContain("pip");

    const after = probeTools(p.extensions, { root: p.root });
    expect(after[0]).toMatchObject({ available: true, source: "runtime", detail: join(dir, ".protoboard/tools/fake") });
    expect(runtimeStatus(p.root, p.extensions)[0]).toMatchObject({ installed: true, stale: false });

    // an operation sees the runtime while it runs; the process environment is restored afterwards
    const rec = await runOperation(p, op.ext, op.op, {});
    expect(rec.status).toBe("succeeded");
    expect(rec.summary).toBe(join(dir, ".protoboard/tools/fake/bin/python"));
    expect(rec.tools).toEqual([{ id: "fake-python", available: true, detail: join(dir, ".protoboard/tools/fake"), source: "runtime" }]);
    expect(process.env.FAKE_TOOL_PYTHON).toBeUndefined();
  }, 120000);

  it("a variable the user sets wins over the project runtime", async () => {
    const p = await loadProject(dir, { checks: false });
    process.env.FAKE_TOOL_PYTHON = "/nonexistent/python";
    try {
      expect(toolEnvironment(p.root).vars.FAKE_TOOL_PYTHON).toEqual({ value: "/nonexistent/python", from: "environment", runtime: "fake" });
      expect(probeTools(p.extensions, { root: p.root })[0]).toMatchObject({ available: false, source: "environment" });
      // installing checks the new runtime, not the user's interpreter, and says the variable shadows it
      const [r] = await installRuntimes(p.root, p.extensions, ["fake"]);
      expect(r).toMatchObject({ status: "installed", shadowed: [{ name: "FAKE_TOOL_PYTHON", value: "/nonexistent/python" }] });
      expect(r.verified).toEqual([{ tool: "ext-py#fake-python", available: true, detail: join(dir, ".protoboard/tools/fake") }]);
      expect(process.env.FAKE_TOOL_PYTHON).toBe("/nonexistent/python");
    } finally {
      delete process.env.FAKE_TOOL_PYTHON;
    }
  }, 120000);

  it("doctor shows where the tool was found", () => {
    const env = { ...process.env };
    delete env.FAKE_TOOL_PYTHON;
    const json = JSON.parse(execFileSync(process.execPath, [CLI, "doctor", "--format", "json"], { cwd: dir, encoding: "utf8", env }));
    expect(json.tools[0]).toMatchObject({ id: "fake-python", available: true, source: "runtime", runtime: "fake" });
    expect(json.runtimes[0]).toMatchObject({ id: "fake", installed: true, stale: false, dir: ".protoboard/tools/fake" });
    const text = execFileSync(process.execPath, [CLI, "doctor"], { cwd: dir, encoding: "utf8", env });
    expect(text).toMatch(/✓ fake-python .*\(project runtime fake\)/);
    expect(text).toMatch(/✓ fake +python +installed in \.protoboard\/tools\/fake/);
  }, 60000);

  it("is stale when the extensions' pins change", async () => {
    const p = await loadProject(dir, { checks: false });
    p.extensions[0].manifest.tools![0].runtime!.packages = ["build123d==0.13.0"];
    expect(runtimeStatus(p.root, p.extensions)[0]).toMatchObject({ installed: true, stale: true });
  });
});

describe("a node runtime (the circuit provider's shape)", () => {
  // what @protoboardai/ext-tscircuit will declare: exact Node packages, no global install
  const circuitTool = {
    id: "fake-tsci",
    purpose: "tscircuit packages from the project runtime",
    probe: ["fake-tsci", "--version"],
    runtime: { id: "circuit", kind: "node", packages: ["@tscircuit/core@0.0.2056", "circuit-json@0.0.510"], env: "FAKE_CIRCUIT_MODULES" },
  };
  const dir = project("node", { "ext-board": { manifest: base("ext-board", { tools: [circuitTool] }) } });

  /** Lays out node_modules as npm would, with the versions given (and a bin for the probe). */
  const fakeNpm =
    (versions: Record<string, string>): Exec =>
    async (command, args, options) => {
      if (args[0] === "--version") return "11.11.0\n";
      expect(command).toMatch(/^npm(\.cmd)?$/);
      expect(args[0]).toBe("install");
      const pkg = JSON.parse(readFileSync(join(options.cwd!, "package.json"), "utf8"));
      expect(pkg.dependencies).toEqual({ "@tscircuit/core": "0.0.2056", "circuit-json": "0.0.510" });
      for (const name of Object.keys(pkg.dependencies)) {
        mkdirSync(join(options.cwd!, "node_modules", name), { recursive: true });
        writeFileSync(join(options.cwd!, "node_modules", name, "package.json"), JSON.stringify({ name, version: versions[name] }));
      }
      const bin = join(options.cwd!, "node_modules", ".bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "fake-tsci"), "#!/bin/sh\necho fake-tsci 1.0\n");
      chmodSync(join(bin, "fake-tsci"), 0o755);
      return "";
    };

  it("installs the pinned packages into the project and puts its bin folder on PATH", async () => {
    const p = await loadProject(dir, { checks: false });
    expect(probeTools(p.extensions, { root: p.root })[0]).toMatchObject({ available: false, source: "system" });
    const [r] = await installRuntimes(p.root, p.extensions, ["circuit"], { exec: fakeNpm({ "@tscircuit/core": "0.0.2056", "circuit-json": "0.0.510" }) });
    expect(r).toMatchObject({ status: "installed", installed: { "@tscircuit/core": "0.0.2056", "circuit-json": "0.0.510" }, verified: [{ tool: "ext-board#fake-tsci", available: true, detail: "fake-tsci 1.0" }] });
    expect(readToolsRecord(p.root).runtimes.circuit).toMatchObject({
      kind: "node",
      dir: ".protoboard/tools/circuit",
      interpreter: { path: "node", version: process.versions.node, npm: "11.11.0" },
      env: { FAKE_CIRCUIT_MODULES: ".protoboard/tools/circuit/node_modules" },
      bin: ".protoboard/tools/circuit/node_modules/.bin",
    });
    expect(projectRuntime(p.root, "circuit")).toEqual({
      kind: "node",
      dir: join(dir, ".protoboard/tools/circuit"),
      bin: join(dir, ".protoboard/tools/circuit/node_modules/.bin"),
      nodeModules: join(dir, ".protoboard/tools/circuit/node_modules"),
    });
    expect(probeTools(p.extensions, { root: p.root })[0]).toMatchObject({ available: true, source: "runtime" });
    expect(toolEnvironment(p.root, { PATH: "/usr/bin" }).overrides.PATH).toBe(`${join(dir, ".protoboard/tools/circuit/node_modules/.bin")}:/usr/bin`);
  });

  it("fails, and records nothing new, when npm resolves another version than the pin", async () => {
    const p = await loadProject(dir, { checks: false });
    const before = readFileSync(join(dir, ".protoboard/tools/tools.json"), "utf8");
    const [r] = await installRuntimes(p.root, p.extensions, ["circuit"], { exec: fakeNpm({ "@tscircuit/core": "0.0.2057", "circuit-json": "0.0.510" }) });
    expect(r.status).toBe("failed");
    expect(r.message).toBe("@tscircuit/core@0.0.2056 was requested but the runtime has 0.0.2057");
    expect(readFileSync(join(dir, ".protoboard/tools/tools.json"), "utf8")).toBe(before);
  });
});
