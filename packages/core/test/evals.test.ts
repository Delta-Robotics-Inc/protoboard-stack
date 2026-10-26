/**
 * The eval harness (PB-845, release-package-and-evals.md §5):
 *   - graders read paths, facts and file formats the way cases state them;
 *   - steps act inside the project only, and fail loudly;
 *   - the Claude Code adapter runs headless with the case's tools only, no
 *     MCP servers, no user settings, never with bypassed permissions;
 *   - discovery finds every installed extension's evals/ (a demo extension
 *     here, plus the stack's own), and reports cases that do not load;
 *   - the runner copies the fixture per trial outside the checkout, links
 *     node_modules to a mirror without the answer keys (no example project,
 *     no extension's evals/), exports skills for a host that discovers them,
 *     refuses a seeded fault that does not show, skips a case whose tool is
 *     missing, grades, fails a trial that changed anything outside its copy,
 *     and writes the scorecard and summary;
 *   - every case the stack ships passes with its known-good solution (the
 *     scripted host) and fails when the agent does nothing. The CAD, circuit
 *     and document cases need their tools (Python with build123d, the
 *     tscircuit packages, Chrome and poppler) and are skipped, and say so,
 *     without them. Set PROTOBOARD_SKIP_EVAL_CASES=1 to leave them to
 *     `protoboard evals --ci` (scripts/ci-stack.sh does).
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  StepError,
  checkFact,
  checkFormat,
  claudeCodeArgs,
  claudeCodeJudge,
  grade,
  judgeSections,
  loadSuites,
  matchDiagnostics,
  mirrorModules,
  semaphore,
  splitText,
  parseStreamJson,
  readPath,
  runEvals,
  runSteps,
  scriptedHost,
  validateCase,
  type AgentHost,
  type CheckOutput,
  type GraderContext,
  type Judge,
} from "../src/index.js";
import { cadPython } from "./cad-python.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const CLI = join(REPO, "packages/cli/bin/protoboard.mjs");
const DEMO = join(HERE, "fixtures/evals/ext-demo");
const TMP = join(HERE, ".tmp-evals");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const quiet = () => {};
const PYTHON = cadPython();

/** A host whose agent does nothing at all. */
const idleHost: AgentHost = { id: "idle", trusted: true, probe: async () => ({ available: true }), run: async () => ({ status: "completed", answer: "", durationMs: 0, turns: 0 }) };

describe("graders", () => {
  const doc = {
    offers: [
      { supplier: "Distributor A", stock: 4210, price_breaks: [{ quantity: 100, unit_price: 0.35 }] },
      { supplier: "Marketplace C", authorized: false },
    ],
    interfaces: [{ id: "vout", pin: 5, geometry: { frame: { origin: [-50, 0, 5] } } }],
    values: [{ q: "derived:mass.all_up", text: "580 g" }],
  };

  it("read paths with indices and [key=value] selectors, including keys with dots and colons", () => {
    expect(readPath(doc, "offers[supplier=Distributor A].price_breaks[quantity=100].unit_price")).toBe(0.35);
    expect(readPath(doc, "offers.1.authorized")).toBe(false);
    expect(readPath(doc, "interfaces[pin=5].geometry.frame.origin")).toEqual([-50, 0, 5]);
    expect(readPath(doc, "values[q=derived:mass.all_up].text")).toBe("580 g");
    expect(readPath(doc, "offers[supplier=Nobody].stock")).toBeUndefined();
    // [key~=pattern]: a case-insensitive regular expression, for names an agent may write its own way
    expect(readPath([{ supplier: "Marketplace C (independent seller)", authorized: false }], "[supplier~=^marketplace c\\b].authorized")).toBe(false);
    expect(readPath([{ supplier: "Distributor A" }], "[supplier~=^marketplace].supplier")).toBeUndefined();
    expect(readPath([{ url: "https://a.example/x.pdf", type: "datasheet" }], "[url=https://a.example/x.pdf].type")).toBe("datasheet");
  });

  it("check facts: equality, tolerance, ranges, patterns, membership, length, absence", () => {
    expect(checkFact(doc, { path: "offers[supplier=Distributor A].stock", equals: 4210 })).toEqual([]);
    expect(checkFact(doc, { path: "interfaces[pin=5].geometry.frame.origin", approx: [-50.0004, 0, 5], tolerance: 0.001 })).toEqual([]);
    expect(checkFact(doc, { path: "interfaces[pin=5].geometry.frame.origin", approx: [-45, 0, 5] })).toEqual([expect.stringMatching(/expected \[-45,0,5\] ± 0.000001/)]);
    expect(checkFact(doc, { path: "offers[supplier=Distributor A].stock", min: 440, max: 5000 })).toEqual([]);
    expect(checkFact(doc, { path: "values[q=derived:mass.all_up].text", matches: "^580\\s*g$" })).toEqual([]);
    expect(checkFact(doc, { path: "offers", length: 2 })).toEqual([]);
    expect(checkFact(doc, { path: "offers[supplier=Marketplace C].authorized", includes: true })).toHaveLength(1);
    expect(checkFact(doc, { path: "risks[code=single-source]", exists: false })).toEqual([]);
    expect(checkFact(doc, { path: "offers[supplier=Distributor A]", exists: false })).toEqual([expect.stringMatching(/should not exist/)]);
    expect(checkFact(doc, { path: "lifecycle.status", equals: "active" })).toEqual(["lifecycle.status is missing"]);
  });

  it("check file formats with core's standard-output validators, plus JSON and PDF", () => {
    expect(checkFormat(Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP214'));\nENDSEC;\nDATA;\n#1=X();\nENDSEC;\nEND-ISO-10303-21;\n"), "step")).toEqual([]);
    expect(checkFormat(Buffer.from("solid x\nendsolid x\n"), "step").length).toBeGreaterThan(0);
    expect(checkFormat(Buffer.from('{"a":1}'), "json")).toEqual([]);
    expect(checkFormat(Buffer.from("{a:1}"), "json")).toEqual([expect.stringMatching(/^not JSON/)]);
    expect(checkFormat(Buffer.from("%PDF-1.7\n…\n%%EOF\n"), "pdf")).toEqual([]);
    expect(checkFormat(Buffer.from("%PDF-1.7\n… truncated"), "pdf")).toHaveLength(1);
  });
});

describe("graders on diagnostics, scripts and long files", () => {
  const diagnostics = [
    { code: "UHD_LINK_STATE", severity: "error", entity: { kind: "link", id: "video_power" }, message: "O4 VCC: incompatible — voltage: 18–25.2 V vs 3.7–13.2 V", validator: "uhd/checkSystem" },
    { code: "UHD_LINK_STATE", severity: "error", entity: { kind: "link", id: "gnss_pads+gnss_socket~uart1~uart_gnss" }, message: "UART1 ↔ GNSS UART: incompatible", validator: "uhd/checkSystem" },
    { code: "HARNESS_ROUTE_STALE", severity: "warning", entity: { kind: "module", id: "battery_leads" }, message: "the route was generated for a different ends", validator: "ext:x" },
  ] as CheckOutput["diagnostics"];
  const dir = join(TMP, "graders");
  mkdirSync(dir, { recursive: true });
  const ctx = (o: Partial<GraderContext> = {}): GraderContext => ({ dir, cli: [process.execPath, CLI], env: process.env, answer: "", before: new Map(), check: async () => ({ checks: [{ validator: "uhd/checkSystem", status: "ran" }], diagnostics }) as CheckOutput, ...o });

  it("pick diagnostics by code, severity, subject (the entity, with or without its kind) and message", () => {
    expect(matchDiagnostics(diagnostics, { code: "UHD_LINK_STATE" })).toHaveLength(2);
    expect(matchDiagnostics(diagnostics, { subject: "^video_power$" }).map((d) => d.entity.id)).toEqual(["video_power"]);
    expect(matchDiagnostics(diagnostics, { subject: "^link:gnss" })).toHaveLength(1);
    expect(matchDiagnostics(diagnostics, { message: "uart1", severity: "error" })).toHaveLength(1);
    expect(matchDiagnostics(diagnostics, { code: "HARNESS_ROUTE_STALE", severity: "error" })).toEqual([]);
  });

  it("a check grader holds diagnostics present or absent by subject or message; a fault grader narrows its code to one", async () => {
    const pass = await grade({ kind: "check", maxErrors: 2, diagnostics: [{ code: "UHD_LINK_STATE", subject: "gnss" }, { message: "short", present: false }] }, 0, ctx());
    expect(pass).toMatchObject({ status: "pass", detail: "2 error(s), 1 warning(s); 2 diagnostic match(es) hold" });
    const fail = await grade({ kind: "check", maxErrors: 2, diagnostics: [{ code: "HARNESS_ROUTE_STALE", subject: "battery", present: false }, { code: "UHD_BUS_ADDRESS" }] }, 0, ctx());
    expect(fail.status).toBe("fail");
    expect(fail.detail).toMatch(/^HARNESS_ROUTE_STALE on \/battery\/ still reported: HARNESS_ROUTE_STALE battery_leads: the route.*; no UHD_BUS_ADDRESS reported$/);
    // two faults with one code: each grader sees only its own
    const answer = "the O4 was on the pack";
    expect(await grade({ kind: "fault", code: "UHD_LINK_STATE", subject: "nothing_here", caught: "pack" }, 0, ctx({ answer }))).toMatchObject({ status: "pass" });
    expect(await grade({ kind: "fault", code: "UHD_LINK_STATE", subject: "video_power" }, 0, ctx())).toMatchObject({ status: "fail", detail: expect.stringMatching(/^UHD_LINK_STATE still reported on video_power: O4 VCC/) });
  });

  it("a script grader runs an extension's script in the project and checks its exit, output and JSON facts", async () => {
    const pkg = join(dir, "node_modules/@protoboard-test/ext-script");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@protoboard-test/ext-script", type: "module" }));
    writeFileSync(join(pkg, "scripts/report.ts"), 'const n: number = Number(process.argv[2] ?? 0);\nconsole.log(JSON.stringify([{ id: "nominal", ok: true, cwd: process.cwd() }, { id: "fault", ok: n > 1 }]));\nprocess.exitCode = n > 1 ? 0 : 1;\n');
    const g = { kind: "script" as const, extension: "@protoboard-test/ext-script", script: "scripts/report.ts", facts: [{ path: "[id=nominal].ok", equals: true }, { path: "[id=nominal].cwd", equals: realpathSync(dir) }] };
    expect(await grade({ ...g, args: ["2"], exit: 0, matches: ["nominal"] }, 0, ctx())).toMatchObject({ status: "pass", detail: "@protoboard-test/ext-script/scripts/report.ts exit 0, 2 fact(s) hold" });
    const failed = await grade({ ...g, args: ["1"], exit: 0, notMatches: ["fault"], facts: [{ path: "[id=fault].ok", equals: true }] }, 0, ctx());
    expect(failed.detail).toMatch(/^exit 1, expected 0.*; output matches \/fault\/i; \[id=fault\]\.ok = false: expected true$/);
    // the case's own extension by default; a path out of the package is refused; a missing script fails
    expect(await grade({ kind: "script", script: "scripts/report.ts" }, 0, ctx({ extension: "@protoboard-test/ext-script" }))).toMatchObject({ status: "pass" });
    expect(await grade({ kind: "script", extension: "@protoboard-test/ext-script", script: "../../x.ts" }, 0, ctx())).toMatchObject({ status: "error", detail: expect.stringMatching(/outside/) });
    expect(await grade({ kind: "script", extension: "@protoboard-test/ext-script", script: "scripts/none.ts" }, 0, ctx())).toMatchObject({ status: "fail", detail: "@protoboard-test/ext-script has no scripts/none.ts" });
    expect(validateCase({ title: "t", instruction: "i", fixture: { from: "x" }, budget: { turns: 1, seconds: 1 }, graders: [{ kind: "script", script: "../up.ts" }], solution: [] } as never)).toEqual(["grader 1: script needs a path inside its package (no .. or leading /)"]);
  });

  it("a rubric grader gives the judge whole files (not cut at 60 000 characters) and keeps the judge's reasons whole", async () => {
    const long = "x".repeat(150_000) + "\nTHE END\n";
    writeFileSync(join(dir, "values.json"), long);
    mkdirSync(join(dir, "pkg/sub"), { recursive: true });
    writeFileSync(join(dir, "pkg/a.txt"), "a");
    writeFileSync(join(dir, "pkg/sub/b.bin"), Buffer.from([0, 1, 2, 3]));
    let seen: { path: string; content: string }[] = [];
    const reasons = "r".repeat(5000);
    const judge: Judge = { id: "stub", grade: async ({ files }) => ((seen = files), { score: 0.8, reasons }) };
    const r = await grade({ kind: "rubric", rubric: "Complete.", files: ["values.json", "pkg"] }, 0, ctx({ judge }));
    expect(seen.map((f) => f.path)).toEqual(["values.json", "pkg/a.txt", "pkg/sub/b.bin"]);
    expect(seen[0].content).toBe(long);
    expect(seen[2].content).toBe("(binary file, 4 bytes: not shown)");
    expect(r).toMatchObject({ status: "pass", detail: `stub: 0.80 — ${reasons}` });
  });

  it("the claude-code judge reads material past its limit in parts: notes on each, then the verdict on the notes", async () => {
    expect(splitText("aaaa\nbbbb\ncccc\n", 10)).toEqual(["aaaa\nbbbb\n", "cccc\n"]);
    expect(splitText("", 10)).toEqual([""]);
    const sections = judgeSections([{ path: "a.json", content: "1\n".repeat(300) }, { path: "b.txt", content: "short" }], 400);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((x) => x.length <= 400)).toBe(true);
    expect(sections.join("")).toMatch(/## File: a\.json \(part 1 of \d+\)/);
    // a stand-in `claude` that logs each call and answers by the schema it is asked for
    const fake = join(dir, "fake-claude.mjs");
    const calls = join(dir, "calls.jsonl");
    rmSync(calls, { force: true });
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
let input = ""; process.stdin.on("data", (d) => (input += d)); process.stdin.on("end", () => {
  const schema = process.argv[process.argv.indexOf("--json-schema") + 1];
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ schema: schema.includes("notes") ? "notes" : "verdict", chars: input.length, input }) + "\\n");
  const out = schema.includes("notes") ? { notes: "part seen: " + (input.match(/part \\d+ of \\d+/) || ["?"])[0] } : { score: 0.75, reasons: "from the notes" };
  process.stdout.write(JSON.stringify({ type: "result", structured_output: out }));
});
`,
    );
    spawnSync("chmod", ["+x", fake]);
    const judge = claudeCodeJudge({ command: fake, maxChars: 2000 });
    const v = await judge.grade({ rubric: "Every line is 1.", files: [{ path: "a.json", content: "1\n".repeat(3000) }], answer: "done" });
    expect(v).toEqual({ score: 0.75, reasons: "from the notes" });
    const log = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.length).toBeGreaterThan(3);
    expect(log.slice(0, -1).every((c) => c.schema === "notes" && c.chars < 2000 + 1000)).toBe(true);
    expect(log.at(-1)).toMatchObject({ schema: "verdict" });
    expect(log.at(-1).input).toMatch(/read in \d+ parts/);
    expect(log.at(-1).input).toContain("### Notes on part 1 of");
    expect(log.at(-1).input).toContain("## The agent's final answer\ndone");
    // a long answer is read in parts too, so the verdict call stays within the limit
    rmSync(calls);
    const longAnswer = "x\n".repeat(2500);
    await judge.grade({ rubric: "r", files: [{ path: "s.txt", content: "small" }], answer: longAnswer });
    const log2 = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log2.slice(0, -1).some((c) => c.input.includes("## The agent's final answer (part 1 of"))).toBe(true);
    expect(log2.slice(0, -1).every((c) => c.schema === "notes" && c.chars < 2000 + 1000)).toBe(true);
    expect(log2.at(-1).schema).toBe("verdict");
    expect(log2.at(-1).input).not.toContain(longAnswer);
    expect(log2.at(-1).input.length).toBeLessThan(2000 + 1000 + log2.length * 200);
    // within the limit: one call with the files whole
    rmSync(calls);
    await judge.grade({ rubric: "r", files: [{ path: "s.txt", content: "small" }] });
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("steps", () => {
  const dir = join(TMP, "steps");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ctx = { dir, caseDir: DEMO, cli: [process.execPath, CLI], env: process.env, log: quiet };

  it("edit files in the project, set JSON values by path, and stop at the first failure with every result so far", async () => {
    writeFileSync(join(dir, "a.txt"), "one two two");
    writeFileSync(join(dir, "d.json"), JSON.stringify({ spatial: { placements: { cap: { matrix: [1, 0, 0, -26] } } } }, null, 2));
    const r = await runSteps([{ replace: { file: "a.txt", find: "one", with: "1" } }, { json: { file: "d.json", set: { "spatial.placements.cap.matrix.3": -24 } } }, { say: "done" }], ctx);
    expect(r.said).toEqual(["done"]);
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("1 two two");
    expect(JSON.parse(readFileSync(join(dir, "d.json"), "utf8")).spatial.placements.cap.matrix).toEqual([1, 0, 0, -24]);
    const failing = runSteps([{ write: { file: "b.txt", content: "x" } }, { replace: { file: "a.txt", find: "two", with: "2", count: 1 } }, { remove: "a.txt" }], ctx);
    await expect(failing).rejects.toThrow(/found 2 occurrence\(s\) of the text, expected 1/);
    const e = await failing.catch((x: StepError) => x);
    expect(e.results.map((s) => [s.step, s.ok])).toEqual([
      ["write b.txt", true],
      ["replace in a.txt", false],
    ]);
    expect(existsSync(join(dir, "a.txt"))).toBe(true);
  });

  it("refuse paths outside the project", async () => {
    await expect(runSteps([{ remove: "../outside" }], ctx)).rejects.toThrow(/outside the project/);
    await expect(runSteps([{ write: { file: "/etc/x", content: "" } }], ctx)).rejects.toThrow(/outside the project/);
  });

  it("run the protoboard CLI and check its exit code and record status", async () => {
    await expect(runSteps([{ protoboard: ["check"] }], ctx)).rejects.toThrow(/exit 2, expected 0.*no protoboard\.config\.ts/);
    // a failed record's summary says why (not the last lines of its JSON)
    const record = JSON.stringify({ status: "failed", summary: "Cannot find module zod", outputs: [], finishedAt: "2026-10-04T00:00:00.000Z" }, null, 2);
    const printsRecord = { ...ctx, cli: [process.execPath, "-e", `console.log(${JSON.stringify(record)})`] };
    await expect(runSteps([{ protoboard: ["run", "circuit:generate"], expect: { status: "succeeded" } }], printsRecord)).rejects.toThrow(/^protoboard run circuit:generate: status failed, expected succeeded: Cannot find module zod$/);
  });

  it("share one deadline: the scripted host stops the sequence when the case's time budget runs out, not per step", async () => {
    const sleep = { command: ["{node}", "-e", "setTimeout(() => {}, 700)"] };
    const transcript = join(dir, "transcript.jsonl");
    const task = { caseKey: "t", dir, instruction: "", tools: { read: true, edit: true, commands: [] }, budget: { turns: 5, seconds: 1 }, solution: [sleep, sleep, sleep, { say: "done" }], steps: ctx, transcript, log: quiet };
    const t0 = Date.now();
    const r = await scriptedHost.run(task);
    expect(Date.now() - t0).toBeLessThan(1900);
    expect(r).toMatchObject({ status: "timeout", detail: expect.stringMatching(/^stopped after 1 s/) });
    expect(r.steps!.map((x) => x.ok)).toEqual([true, false]);
  });
});

describe("the module mirror", () => {
  const dir = join(TMP, "mirror");
  const put = (path: string, content: string) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  };

  it("keeps installed packages whole when node_modules links its entries into another install; a linked package's `files` patterns at the top keep the top", () => {
    rmSync(dir, { recursive: true, force: true });
    // the checkout's install: a package whose `files` start with patterns (zod's "**/*.js"), and a scoped one
    const install = join(dir, "checkout/node_modules");
    put(join(install, "globby-dep/package.json"), JSON.stringify({ name: "globby-dep", files: ["src", "**/*.js"] }));
    put(join(install, "globby-dep/index.js"), "export {};");
    put(join(install, "globby-dep/v4/core.js"), "export {};");
    put(join(install, "@scope/thing/package.json"), JSON.stringify({ name: "@scope/thing", files: ["dist"] }));
    put(join(install, "@scope/thing/dist/index.js"), "export {};");
    put(join(install, "@scope/thing/extra.js"), "export {};");
    // a workspace member with a pattern at the top of its `files`, and its tests and cases
    const member = join(dir, "checkout/packages/member");
    put(join(member, "package.json"), JSON.stringify({ name: "member", files: ["*.js", "lib"] }));
    put(join(member, "index.js"), "export {};");
    put(join(member, "lib/a.js"), "export {};");
    put(join(member, "evals/case/case.ts"), "answer");
    put(join(member, "test/a.test.ts"), "test");
    // a worktree whose node_modules links every entry into the checkout's install (and one scope folder whole)
    const worktree = join(dir, "worktree/node_modules");
    mkdirSync(worktree, { recursive: true });
    symlinkSync(join(install, "globby-dep"), join(worktree, "globby-dep"));
    symlinkSync(join(install, "@scope"), join(worktree, "@scope"));
    symlinkSync(member, join(worktree, "member"));

    const m = mirrorModules(worktree, join(dir, "mirror"));
    const has = (p: string) => existsSync(join(m.modules, p));
    expect(["globby-dep/index.js", "globby-dep/v4/core.js", "@scope/thing/dist/index.js", "@scope/thing/extra.js"].filter((p) => !has(p))).toEqual([]);
    expect(lstatSync(join(m.modules, "@scope")).isSymbolicLink()).toBe(false);
    expect(m.linked).toEqual([realpathSync(member)]);
    expect(["member/index.js", "member/lib/a.js"].filter((p) => !has(p))).toEqual([]);
    expect(["member/evals", "member/test"].filter(has)).toEqual([]);
  });
});

describe("the claude-code host", () => {
  const task = { instruction: "Fix it.", tools: { read: true, edit: true, commands: ["npx protoboard *"] }, budget: { turns: 12, seconds: 60, usd: 1.5 } };

  it("runs headless with the case's tools only, no MCP servers and no user settings, never bypassing permissions", () => {
    const args = claudeCodeArgs({ ...task, modules: "/tmp/run/modules/1/node_modules" }, { model: "sonnet" });
    const flag = (f: string) => args[args.indexOf(f) + 1];
    expect(args.slice(0, 2)).toEqual(["-p", "Fix it."]);
    expect(flag("--output-format")).toBe("stream-json");
    expect(flag("--max-turns")).toBe("12");
    expect(flag("--max-budget-usd")).toBe("1.5");
    expect(flag("--tools")).toBe("Skill,Read,Glob,Grep,Edit,Write,Bash");
    expect(flag("--permission-mode")).toBe("dontAsk");
    // reads and edits scoped to the copy (Read rules cover Glob and Grep); the module mirror readable, never writable
    expect(flag("--allowedTools").split(",")).toEqual(["Skill", "Read(./**)", "Edit(./**)", "Write(./**)", "Bash(npx protoboard *)"]);
    expect(flag("--disallowedTools").split(",")).toEqual([
      "Edit(./node_modules/**)",
      "Write(./node_modules/**)",
      "Edit(//tmp/run/modules/1/node_modules/**)",
      "Write(//tmp/run/modules/1/node_modules/**)",
      "Bash(*--cwd*)",
      "Bash(*..*)",
    ]);
    // with the trial's directory (as the runner gives it), the rules name its absolute path: a `cd` into the mirror
    // moves `./`, never the trial
    const abs = claudeCodeArgs({ ...task, dir: "/tmp/run/trials/x/1/project", modules: "/tmp/run/modules/1/node_modules" });
    const absFlag = (f: string) => abs[abs.indexOf(f) + 1];
    expect(absFlag("--allowedTools").split(",")).toEqual([
      "Skill",
      "Read(//tmp/run/trials/x/1/project/**)",
      "Edit(//tmp/run/trials/x/1/project/**)",
      "Write(//tmp/run/trials/x/1/project/**)",
      "Bash(npx protoboard *)",
    ]);
    expect(absFlag("--disallowedTools").split(",").slice(0, 4)).toEqual([
      "Edit(//tmp/run/trials/x/1/project/node_modules/**)",
      "Write(//tmp/run/trials/x/1/project/node_modules/**)",
      "Edit(//tmp/run/modules/1/node_modules/**)",
      "Write(//tmp/run/modules/1/node_modules/**)",
    ]);
    expect(abs.join(" ")).not.toContain("(./");
    // the ablation arm: no Skill tool at all
    const bare = claudeCodeArgs({ ...task, skills: false });
    expect(bare[bare.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Edit,Write,Bash");
    expect(bare[bare.indexOf("--allowedTools") + 1]).not.toMatch(/Skill/);
    expect(flag("--add-dir")).toBe("/tmp/run/modules/1/node_modules");
    expect(flag("--mcp-config")).toBe('{"mcpServers":{}}');
    expect(args).toContain("--strict-mcp-config");
    expect(flag("--setting-sources")).toBe("project");
    expect(args).toContain("--no-session-persistence");
    expect(flag("--model")).toBe("sonnet");
    expect(args.join(" ")).not.toMatch(/dangerously|bypassPermissions/);
    // read-only, no shell
    const ro = claudeCodeArgs({ ...task, tools: { read: true, edit: false, commands: [] } });
    expect(ro[ro.indexOf("--tools") + 1]).toBe("Skill,Read,Glob,Grep");
  });

  it("reads the result and the model from a stream-json transcript, ignoring a cut-off line", () => {
    const text = [
      JSON.stringify({ type: "system", subtype: "init", model: "claude-test" }),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
      JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 12, total_cost_usd: 0.4, result: "" }),
      '{"type":"assis',
    ].join("\n");
    expect(parseStreamJson(text)).toEqual({ model: "claude-test", result: expect.objectContaining({ subtype: "error_max_turns", num_turns: 12, total_cost_usd: 0.4 }) });
  });
});

describe("cases", () => {
  it("are validated: what is missing is named", () => {
    expect(validateCase({ title: "", instruction: " ", fixture: {}, budget: { turns: 0, seconds: 1 }, graders: [{ kind: "vibes" }], solution: undefined } as never)).toEqual([
      "needs a title",
      "needs an instruction",
      "fixture needs `from` (a folder) or `recipe`",
      "budget needs turns and seconds",
      "grader 1: unknown kind vibes (known: check, operation, files, outputs, format, digest, facts, fault, text, rubric, script)",
      "needs a solution (the steps the scripted host replays)",
    ]);
  });

  it("are discovered in every installed extension's evals/ folder; one that does not load is reported", async () => {
    const suites = await loadSuites(REPO, { extra: [DEMO] });
    const keys = suites.flatMap((s) => s.cases.map((c) => c.key));
    expect(keys).toEqual(expect.arrayContaining(["@protoboard-test/ext-demo/fix-typo", "@protoboard-test/ext-demo/needs-tool"]));
    expect(suites.find((s) => s.extension === "@protoboard-test/ext-demo")!.problems).toEqual([{ dir: "evals/broken", message: expect.stringMatching(/^needs an instruction; grader 1: unknown kind vibes/) }]);
    // the stack's own suites: at least one case per extension, and every one loads
    const own = suites.filter((s) => s.extension.startsWith("@protoboardai/"));
    expect(own.map((s) => s.extension).sort()).toEqual([
      "@protoboardai/ext-docs",
      "@protoboardai/ext-drone",
      "@protoboardai/ext-enclosure-cad",
      "@protoboardai/ext-esp-idf",
      "@protoboardai/ext-frame-cad",
      "@protoboardai/ext-hardware",
      "@protoboardai/ext-harness-cad",
      "@protoboardai/ext-parts",
      "@protoboardai/ext-release",
      "@protoboardai/ext-sourcing",
      "@protoboardai/ext-tscircuit",
      "@protoboardai/ext-zephyr",
    ]);
    for (const s of own) {
      expect(s.problems, s.extension).toEqual([]);
      expect(s.cases.length, s.extension).toBeGreaterThan(0);
      for (const c of s.cases) expect(c.graders.some((g) => g.kind !== "rubric"), c.key).toBe(true);
    }
    // filters: extension by id, short name or bare name; cases by pattern
    expect((await loadSuites(REPO, { extension: "parts" })).map((s) => s.extension)).toEqual(["@protoboardai/ext-parts"]);
    expect((await loadSuites(REPO, { extra: [DEMO], extension: "ext-demo", case: "fix-*" })).flatMap((s) => s.cases.map((c) => c.id))).toEqual(["fix-typo"]);
    expect((await loadSuites(REPO, { case: "fix-gnss-uart-swap, record-*" })).flatMap((s) => s.cases.map((c) => c.id))).toEqual(["fix-gnss-uart-swap", "record-ldo-offers"]);
  });
});

describe("the runner on a demo extension", () => {
  const run = (name: string, o: Partial<Parameters<typeof runEvals>[0]> & { host: AgentHost }) =>
    runEvals({ from: REPO, extra: [DEMO], extension: "ext-demo", outDir: join(TMP, name, "out"), workDir: join(TMP, name, "work"), log: quiet, runId: "run", ...o });

  it("the scripted host passes the case, a missing tool skips one, and the scorecard and summary are written; the scratch copies are removed", async () => {
    const { scorecard, file } = await run("scripted", { host: scriptedHost });
    expect(file).toBe(join(TMP, "scripted/out/run/scorecard.json"));
    const [fix, needs] = scorecard.cases;
    expect(fix).toMatchObject({ key: "@protoboard-test/ext-demo/fix-typo", status: "ran", passRate: 1, meanScore: 1, fixture: { seeded: ["PB_UNRESOLVED_DEFINITION"] } });
    expect(fix.trials[0].graders.map((g) => [g.id, g.status])).toEqual([
      ["fixed", "pass"],
      ["clean", "pass"],
      ["sensor-kept", "pass"],
      ["edited", "pass"],
      ["config-kept", "pass"],
      ["judged", "skipped"],
    ]);
    expect(fix.trials[0].host).toMatchObject({ status: "completed", turns: 4, answer: expect.stringMatching(/typo/) });
    expect(needs).toMatchObject({ status: "skipped", reason: expect.stringMatching(/^missing tool\(s\): never-there \(.*; it cannot be installed\)$/) });
    expect(scorecard.problems).toEqual([{ extension: "@protoboard-test/ext-demo", dir: "evals/broken", message: expect.any(String) }]);
    expect(scorecard.totals).toMatchObject({ cases: 2, ran: 1, skipped: 1, errors: 0, trials: 1, passed: 1, passRate: 1 });
    expect(JSON.parse(readFileSync(join(TMP, "scripted/out/latest.json"), "utf8")).runId).toBe("run");
    const md = readFileSync(join(TMP, "scripted/out/run/summary.md"), "utf8");
    expect(md).toMatch(/\*\*1\/1 trials passed \(100%\), mean score 1\.00\.\*\*/);
    expect(md).toContain("| `@protoboard-test/ext-demo/fix-typo` | ran | 100% | 1.00 |");
    expect(md).toMatch(/needs-tool` skipped: missing tool/);
    // the replayed steps are the transcript
    expect(readFileSync(join(TMP, "scripted/out/run", fix.trials[0].transcript), "utf8").trim().split("\n").map((l) => JSON.parse(l).step)).toEqual(["protoboard check", "replace in src/rig.uhd.ts", "protoboard check", "say"]);
    expect(existsSync(join(TMP, "scripted/work"))).toBe(false);
  });

  it("an agent that does nothing fails every trial; a host with a judge scores the rubric", async () => {
    const judge: Judge = { id: "stub", grade: async ({ rubric, files }) => ({ score: files[0]?.path === "src/rig.uhd.ts" && /renames nothing/.test(rubric) ? 0.9 : 0, reasons: "stub" }) };
    const { scorecard } = await run("idle", { host: idleHost, trials: 2, judge, case: "fix-typo" });
    const c = scorecard.cases[0];
    expect(c).toMatchObject({ passRate: 0, trials: [{ passed: false }, { passed: false }] });
    const g = Object.fromEntries(c.trials[0].graders.map((x) => [x.id, x]));
    expect(g.fixed).toMatchObject({ status: "fail", detail: expect.stringMatching(/PB_UNRESOLVED_DEFINITION still reported.*; the answer does not identify the fault/) });
    expect(g.clean.status).toBe("fail");
    expect(g.edited).toMatchObject({ status: "fail", detail: "src/rig.uhd.ts is unchanged from the fixture" });
    expect(g["config-kept"].status).toBe("pass");
    expect(g.judged).toMatchObject({ status: "pass", score: 0.9, detail: "stub: 0.90 — stub" });
    expect(scorecard.judge).toBe("stub");
    // score: weighted mean of the graded (2 of 6 pass, the rubric at 0.9)
    expect(c.trials[0].score).toBeCloseTo((0 + 0 + 0 + 0 + 1 + 0.9) / 6, 3);
  });

  it("each trial works on its own copy outside the checkout, with node_modules linked and the skills exported for its host", async () => {
    const seen: { dir: string; skill: boolean; linked: boolean; seeded: boolean; modules?: string; real: string; present: string[]; up: string }[] = [];
    const agent: AgentHost = {
      id: "fake-agent",
      skillHost: "claude-code",
      probe: async () => ({ available: true, version: "test" }),
      async run(task) {
        seen.push({
          dir: task.dir,
          skill: existsSync(join(task.dir, ".claude/skills/system-compose/SKILL.md")),
          linked: lstatSync(join(task.dir, "node_modules")).isSymbolicLink(),
          seeded: readFileSync(join(task.dir, "src/rig.uhd.ts"), "utf8").includes("demo-snesor"),
          modules: task.modules,
          real: realpathSync(join(task.dir, "node_modules")),
          // the answer keys are not in the trial's tree: no example project, no extension's evals/ or tests
          present: ["quadcopter-5in", "@protoboardai/ext-hardware/skills", "@protoboardai/ext-hardware/evals", "@protoboardai/ext-parts/evals/author-ldo-regulator/solution", "@protoboardai/ext-tscircuit/test"].filter((p) => existsSync(join(task.dir, "node_modules", p))),
          // and nothing in it links back into the workspace, so no `..` reaches it
          up: realpathSync(join(task.dir, "node_modules/@protoboardai/ext-hardware/skills/../../..")),
        });
        // what an agent would do: edit, check, answer
        const r = await runSteps(task.solution, task.steps);
        return { status: "completed", answer: r.said.join(" "), durationMs: 1, turns: 3, costUsd: 0.01 };
      },
    };
    // (the guard is off here: other test files write into the workspace while this one runs; the next test covers it)
    const { scorecard } = await run("agent", { host: agent, trials: 2, case: "fix-typo", keep: true, guard: false });
    expect(seen.map((s) => s.dir)).toEqual([join(TMP, "agent/work/trials/ext-demo--fix-typo/1/project"), join(TMP, "agent/work/trials/ext-demo--fix-typo/2/project")]);
    const mirror = join(TMP, "agent/work/modules/1/node_modules");
    expect(seen.map((s) => [s.modules, s.real, s.up])).toEqual([[mirror, mirror, mirror], [mirror, mirror, mirror]]);
    expect(seen[0].present).toEqual(["@protoboardai/ext-hardware/skills"]);
    expect(seen.every((s) => s.skill && s.linked && s.seeded)).toBe(true);
    // the first trial's fix did not leak into the second's copy, nor into the case's fixture folder
    expect(readFileSync(join(DEMO, "evals/fix-typo/fixture/src/rig.uhd.ts"), "utf8")).toContain('moduleDefId: "demo-sensor"');
    expect(scorecard.host).toEqual({ id: "fake-agent", version: "test" });
    expect(scorecard.cases[0]).toMatchObject({ passRate: 1, meanTurns: 3, costUsd: 0.02, trials: [{ dir: seen[0].dir }, { dir: seen[1].dir }] });
    expect(scorecard.totals.costUsd).toBe(0.02);
    // --keep leaves the fixture and the trials
    expect(existsSync(join(TMP, "agent/work/fixtures/ext-demo--fix-typo/project/src/rig.uhd.ts"))).toBe(true);
  });

  it("a trial that changes anything outside its copy fails, whatever the graders say", async () => {
    const victim = join(TMP, "guard-victim.txt");
    writeFileSync(victim, "before");
    const agent: AgentHost = {
      id: "escaping-agent",
      probe: async () => ({ available: true }),
      async run(task) {
        const r = await runSteps(task.solution, task.steps);
        writeFileSync(victim, "after, a little longer"); // a write outside the copy, as through an allowed command with an absolute path
        writeFileSync(join(task.modules!, "@protoboardai/ext-hardware/planted.ts"), "");
        return { status: "completed", answer: r.said.join(" "), durationMs: 1 };
      },
    };
    const { scorecard, summary } = await run("guard", { host: agent, case: "fix-typo" });
    const [t] = scorecard.cases[0].trials;
    expect(t.graders.every((g) => g.status === "pass" || g.status === "skipped")).toBe(true);
    expect(t.passed).toBe(false);
    expect(t.outside).toEqual(expect.arrayContaining([`${victim} (changed)`, `${join(TMP, "guard/work/modules/1/node_modules/@protoboardai/ext-hardware/planted.ts")} (added)`]));
    expect(summary).toMatch(/trial 1 changed files outside its copy: /);
  });

  it("--jobs runs trials at once into one scorecard, in the cases' order; the ablation arm exports no skills and leaves their documents out of the mirror", async () => {
    let running = 0;
    let most = 0;
    const seen: { skills?: boolean; exported: boolean; skillDoc: boolean; script: boolean }[] = [];
    const agent: AgentHost = {
      id: "slow-agent",
      skillHost: "claude-code",
      probe: async () => ({ available: true }),
      async run(task) {
        running++;
        most = Math.max(most, running);
        seen.push({
          skills: task.skills,
          exported: existsSync(join(task.dir, ".claude/skills")),
          skillDoc: existsSync(join(task.modules!, "@protoboardai/ext-hardware/skills/system-compose/SKILL.md")),
          script: existsSync(join(task.modules!, "@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts")),
        });
        await new Promise((ok) => setTimeout(ok, 300));
        const r = await runSteps(task.solution, task.steps);
        running--;
        return { status: "completed", answer: r.said.join(" "), durationMs: 300 };
      },
    };
    const { scorecard, summary } = await run("jobs", { host: agent, trials: 3, jobs: 3, skills: false, case: "fix-typo", guard: false });
    expect(most).toBe(3);
    expect(scorecard.cases[0]).toMatchObject({ passRate: 1, trials: [{ trial: 1 }, { trial: 2 }, { trial: 3 }] });
    expect(scorecard).toMatchObject({ skills: "none", jobs: 3 });
    expect(seen).toEqual(Array(3).fill({ skills: false, exported: false, skillDoc: false, script: true }));
    expect(summary).toMatch(/without the stack's skills\*\* \(ablation\), 3 jobs/);
    expect(semaphore).toBeTypeOf("function");
  });

  it("a semaphore runs at most n tasks at a time, in the order they ask", async () => {
    const slots = semaphore(2);
    const order: string[] = [];
    let now = 0;
    let peak = 0;
    const task = (id: string, ms: number) => slots(async () => {
      now++;
      peak = Math.max(peak, now);
      order.push(id);
      await new Promise((ok) => setTimeout(ok, ms));
      now--;
      return id;
    });
    expect(await Promise.all([task("a", 30), task("b", 10), task("c", 10), task("d", 10)])).toEqual(["a", "b", "c", "d"]);
    expect(peak).toBe(2);
    expect(order).toEqual(["a", "b", "c", "d"]);
  });

  it("a fixture leaves out operations/ unless the case asks for it with fixture.operations", async () => {
    const ext = join(TMP, "ext-operations");
    rmSync(ext, { recursive: true, force: true });
    cpSync(DEMO, ext, { recursive: true });
    mkdirSync(join(ext, "evals/fix-typo/fixture/operations"), { recursive: true });
    writeFileSync(join(ext, "evals/fix-typo/fixture/operations/2026-01-01T00-00-00-000Z-demo.json"), "{}");
    const file = join(ext, "evals/fix-typo/case.json");
    const c = JSON.parse(readFileSync(file, "utf8"));
    const records: boolean[] = [];
    const agent: AgentHost = { ...idleHost, run: async (task) => (records.push(existsSync(join(task.dir, "operations/2026-01-01T00-00-00-000Z-demo.json"))), idleHost.run(task)) };
    const go = (name: string) => runEvals({ from: REPO, extra: [ext], extension: "ext-demo", case: "fix-typo", host: agent, outDir: join(TMP, name, "out"), workDir: join(TMP, name, "work"), log: quiet });
    await go("ops-default");
    writeFileSync(file, JSON.stringify({ ...c, fixture: { ...c.fixture, operations: true } }));
    await go("ops-on");
    expect(records).toEqual([false, true]);
    expect(validateCase({ ...c, fixture: { ...c.fixture, operations: "yes" } })).toEqual(["fixture.operations is true or false"]);
  });

  it("a seeded fault that does not show stops the case before any trial", async () => {
    const ext = join(TMP, "ext-unseeded");
    rmSync(ext, { recursive: true, force: true });
    cpSync(DEMO, ext, { recursive: true });
    const file = join(ext, "evals/fix-typo/case.json");
    const c = JSON.parse(readFileSync(file, "utf8"));
    c.fixture.steps = [];
    writeFileSync(file, JSON.stringify(c));
    let ran = 0;
    const { scorecard } = await runEvals({ from: REPO, extra: [ext], extension: "ext-demo", case: "fix-typo", host: { ...idleHost, run: async () => (ran++, idleHost.run(undefined as never)) }, outDir: join(TMP, "unseeded/out"), workDir: join(TMP, "unseeded/work"), log: quiet });
    expect(scorecard.cases[0]).toMatchObject({ status: "error", reason: "fixture: the seeded fault does not show: protoboard check on the fixture reports no PB_UNRESOLVED_DEFINITION", trials: [] });
    expect(ran).toBe(0);
    expect(scorecard.totals.errors).toBe(1);
  });
});

describe("protoboard evals (CLI)", () => {
  const pb = (args: string[]) => spawnSync(process.execPath, [CLI, "evals", ...args, "--format", "json", "--cwd", REPO], { encoding: "utf8" });

  it("--list shows the installed cases with their budgets, graders and tools", () => {
    const r = pb(["--list"]);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.problems).toEqual([]);
    expect(j.cases.find((c: { key: string }) => c.key === "@protoboardai/ext-frame-cad/regenerate-after-vtx-move")).toMatchObject({ requires: ["python-build123d"], budget: { turns: 25 }, graders: expect.arrayContaining(["fault", "outputs", "digest"]) });
  });

  it("--ci runs the scripted host only", () => {
    for (const extra of [["--host", "claude-code"], ["--judge", "claude-code"]]) {
      const r = pb(["--ci", ...extra]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).error).toMatch(/^--ci runs the scripted host only/);
    }
  });

  // An async child, awaited: a synchronous spawn of a whole run blocks the
  // vitest worker's event loop and starves its RPC ("Timeout calling onTaskUpdate").
  const pbAsync = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, "evals", ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
    });

  it("runs one extension's cases and exits 0 when every trial passes; --jobs keeps the cases' order; --out-dir takes the scorecards", async () => {
    const out = join(TMP, "cli");
    // two fast Node-only cases of one extension; the whole suite runs in `protoboard evals --ci`
    const r = await pbAsync(["--extension", "hardware", "--case", "fix-two-wiring-faults,fix-gnss-uart-swap", "--ci", "--jobs", "2", "--format", "json", "--cwd", REPO, "--work-dir", join(out, "work"), "--out-dir", join(out, "scorecards")]);
    expect(r.status, r.stderr).toBe(0);
    const s = JSON.parse(r.stdout);
    expect(s).toMatchObject({ schema: "protoboard.eval-scorecard/v0", host: { id: "scripted" }, totals: { ran: 2, passed: 2 } });
    expect(s.cases.map((c: { id: string; status: string }) => [c.id, c.status])).toEqual([
      ["fix-gnss-uart-swap", "ran"],
      ["fix-two-wiring-faults", "ran"],
    ]);
    expect(existsSync(join(out, "scorecards", s.runId, "summary.md"))).toBe(true);
    expect(existsSync(join(out, "scorecards/latest.md"))).toBe(true);
    expect(existsSync(join(REPO, ".protoboard/evals", s.runId))).toBe(false);
  }, 180_000);
});

describe.skipIf(process.env.PROTOBOARD_SKIP_EVAL_CASES === "1")("every shipped case, with its known-good solution and with an idle agent", () => {
  it("fails when the agent does nothing and passes with the scripted solution", async () => {
    // trial 1: the idle agent; trial 2: the case's known-good steps
    const count = new Map<string, number>();
    const alternate: AgentHost = {
      id: "idle-then-scripted",
      trusted: true,
      probe: async () => ({ available: true }),
      run: (task) => {
        const n = (count.get(task.caseKey) ?? 0) + 1;
        count.set(task.caseKey, n);
        return n === 1 ? idleHost.run(task) : scriptedHost.run(task);
      },
    };
    const { scorecard } = await runEvals({
      from: REPO,
      trials: 2,
      host: alternate,
      outDir: join(TMP, "shipped/out"),
      workDir: join(TMP, "shipped/work"),
      env: PYTHON ? { PROTOBOARD_PYTHON: PYTHON } : {},
      log: (line) => (/skipped|error|FAIL|PASS/.test(line) ? console.log(line) : undefined),
    });
    const skipped = scorecard.cases.filter((c) => c.status === "skipped");
    if (skipped.length) console.warn(`skipped (tools missing here): ${skipped.map((c) => `${c.key}: ${c.reason}`).join("; ")}`);
    expect(scorecard.cases.filter((c) => c.status === "error").map((c) => `${c.key}: ${c.reason}`)).toEqual([]);
    // the cases that need nothing beyond Node always run
    expect(scorecard.cases.filter((c) => c.status === "ran").map((c) => c.key)).toEqual(
      expect.arrayContaining(["@protoboardai/ext-hardware/fix-gnss-uart-swap", "@protoboardai/ext-hardware/fix-two-wiring-faults", "@protoboardai/ext-hardware/find-reversed-cell-leads", "@protoboardai/ext-parts/author-ldo-regulator", "@protoboardai/ext-sourcing/record-ldo-offers", "@protoboardai/ext-drone/gps-moved-to-uart3"]),
    );
    for (const c of scorecard.cases.filter((x) => x.status === "ran")) {
      const [idle, solved] = c.trials;
      expect(idle.passed, `${c.key}: an idle agent passed`).toBe(false);
      expect(
        solved.graders.filter((g) => g.status === "fail" || g.status === "error").map((g) => `${g.id}: ${g.detail}`),
        `${c.key}: host ${solved.host.status} ${solved.host.detail ?? ""}`,
      ).toEqual([]);
      expect(solved.passed, c.key).toBe(true);
    }
  }, 2_400_000);
});
