/**
 * The DFM profile resolver (skills/dfm/scripts/resolve-profile.mjs): the
 * formula language, the cascade (shipped, user, project, part, session; last
 * wins), formulas evaluated after the merge, errors that name the path, and
 * the config folder resolved as board-style's paths.ts resolves it. Every
 * test uses its own fixture profiles in a temp folder, never the shipped
 * profiles/fdm.json, so the data and the resolver can change independently.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PROCESS,
  configDir,
  evaluateFormula,
  explain,
  main,
  parseFormula,
  parseSet,
  resolveProfile,
  userLayerDir,
} from "../skills/dfm/scripts/resolve-profile.mjs";

/** The resolved profile's shape (profile-format.md), for the type checker: the resolver is plain JS. */
interface ResolvedValue {
  value: unknown;
  unit: string | null;
  status: string;
  source: string;
  note: string | null;
  formula?: string;
  dependsOn?: string[];
  layer: string;
  file: string | null;
}
interface Resolved {
  schema: string;
  process: string;
  profile: { id: string; name: string };
  layers: { scope: string; file: string | null; notes?: string[] }[];
  values: Record<string, ResolvedValue>;
  waivers: Record<string, unknown>[];
  errors: { path: string; message: string }[];
  warnings: string[];
  history: Record<string, ResolvedValue[]>;
}
const resolve = (options: Record<string, unknown>): Resolved => resolveProfile(options) as unknown as Resolved;
const explainPath = (r: Resolved, p: string) => explain(r as never, p) as unknown as { setBy: ResolvedValue[] };

const TMP = mkdtempSync(join(tmpdir(), "protoboard-dfm-resolve-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/** A fresh folder under TMP. */
const fresh = (name: string) => {
  const dir = join(TMP, `${name}-${n++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const writeJson = (file: string, data: unknown) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

/** A fixture FDM profile shaped like the shipped one. */
const FDM = {
  schema: "protoboard.dfm.profile/v1",
  id: "fdm",
  name: "FDM 3D printing (fixture)",
  process: "fdm",
  description: "fixture for the resolver tests",
  values: {
    "machine.nozzle": { value: 0.4, unit: "mm", status: "house", source: "fixture", note: "house default nozzle" },
    "line.width": { formula: "1.125 * machine.nozzle", unit: "mm", status: "typical", source: "fixture" },
    "wall.min": { formula: "2 * line.width", unit: "mm", status: "typical", source: "fixture" },
    "layer.height": { formula: "round(0.5 * machine.nozzle, 2)", unit: "mm", status: "typical", source: "fixture" },
    "fit.slip.per_side": { value: 0.2, unit: "mm", status: "typical", source: "fixture" },
    "fit.slip.diametral": { formula: "2 * fit.slip.per_side", unit: "mm", status: "derived", source: "fixture" },
    "machine.printer": { value: "generic", unit: null, status: "house", source: "fixture" },
  },
};

/** A profiles folder holding the fixture profiles. */
function profiles(extra: Record<string, unknown> = {}) {
  const dir = fresh("profiles");
  writeJson(join(dir, "fdm.json"), FDM);
  for (const [id, p] of Object.entries(extra)) writeJson(join(dir, `${id}.json`), p);
  return dir;
}

const layer = (values: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ schema: "protoboard.dfm.layer/v1", values, ...more });

describe("the formula language", () => {
  it("evaluates arithmetic with precedence, parentheses, unary minus, min, max and round", () => {
    const v = { a: 2, "b.c": 3 };
    expect(evaluateFormula("1 + 2 * 3", v)).toBe(7);
    expect(evaluateFormula("(1 + 2) * 3", v)).toBe(9);
    expect(evaluateFormula("-a + b.c", v)).toBe(1);
    expect(evaluateFormula("a / 4", v)).toBe(0.5);
    expect(evaluateFormula("min(a, b.c, 10)", v)).toBe(2);
    expect(evaluateFormula("max(a, b.c * 2)", v)).toBe(6);
    expect(evaluateFormula("round(1 / 3, 3)", v)).toBe(0.333);
    expect(evaluateFormula("round(2.5)", v)).toBe(3);
    expect(evaluateFormula("1.5e1 - .5", v)).toBe(14.5);
  });

  it("refuses what is not in the language, with no eval", () => {
    expect(() => parseFormula("a ** 2")).toThrow();
    expect(() => parseFormula("process.exit(1)")).toThrow(/unknown function/);
    expect(() => parseFormula("a; b")).toThrow(/unexpected/);
    expect(() => parseFormula("(1 + 2")).toThrow(/expected "\)"/);
    expect(() => evaluateFormula("missing.path * 2", {})).toThrow(/unknown path "missing.path"/);
    expect(() => evaluateFormula("a / 0", { a: 1 })).toThrow(/division by zero/);
  });

  it("parses --set values: numbers, booleans, JSON, text", () => {
    expect(parseSet("machine.nozzle=0.6")).toEqual(["machine.nozzle", 0.6]);
    expect(parseSet("x=true")).toEqual(["x", true]);
    expect(parseSet("x=[1,2]")).toEqual(["x", [1, 2]]);
    expect(parseSet('x={"formula":"2*a"}')).toEqual(["x", { formula: "2*a" }]);
    expect(parseSet("machine.printer=Bambu Lab P1S")).toEqual(["machine.printer", "Bambu Lab P1S"]);
    expect(() => parseSet("no-equals")).toThrow(/path=value/);
  });
});

describe("resolving a profile", () => {
  it("evaluates the shipped formulas", () => {
    const r = resolve({ profilesDir: profiles(), user: false });
    expect(r.schema).toBe("protoboard.dfm.resolved/v1");
    expect(r.process).toBe(DEFAULT_PROCESS);
    expect(r.profile).toEqual({ id: "fdm", name: "FDM 3D printing (fixture)" });
    expect(r.errors).toEqual([]);
    expect(r.values["line.width"]).toMatchObject({ value: 0.45, unit: "mm", status: "typical", formula: "1.125 * machine.nozzle", dependsOn: ["machine.nozzle"], layer: "shipped" });
    expect(r.values["wall.min"].value).toBe(0.9);
    expect(r.values["layer.height"].value).toBe(0.2);
    expect(r.values["fit.slip.diametral"].value).toBe(0.4);
    expect(r.values["machine.nozzle"].note).toBe("house default nozzle");
  });

  it("recomputes every dependent value after a nozzle override", () => {
    const user = fresh("user");
    writeJson(join(user, "profile.json"), layer({ "machine.nozzle": 0.6 }));
    const r = resolve({ profilesDir: profiles(), user });
    expect(r.values["machine.nozzle"]).toMatchObject({ value: 0.6, unit: "mm", status: "user", source: "layer file", layer: "user" });
    expect(r.values["line.width"].value).toBe(0.675);
    expect(r.values["wall.min"].value).toBe(1.35);
    expect(r.values["layer.height"].value).toBe(0.3);
    // the rule keeps its own status and layer; only its input changed
    expect(r.values["wall.min"]).toMatchObject({ status: "typical", layer: "shipped" });
  });

  it("lets an explicit value in a later layer beat an earlier formula", () => {
    const project = fresh("project");
    writeJson(join(project, "dfm", "profile.json"), layer({ "wall.min": { value: 1.6, status: "proven", source: "wall ladder coupon", note: "coupon 9, PETG" } }));
    const r = resolve({ profilesDir: profiles(), user: false, project, set: ["machine.nozzle=0.6"] });
    expect(r.values["wall.min"]).toMatchObject({ value: 1.6, unit: "mm", status: "proven", layer: "project", note: "coupon 9, PETG" });
    expect(r.values["wall.min"].formula).toBeUndefined();
    expect(r.values["line.width"].value).toBe(0.675); // the formula still follows the session nozzle
  });

  it("applies the layers in order: shipped, user, project, part, session", () => {
    const user = fresh("user");
    const project = fresh("project");
    const part = fresh("part");
    writeJson(join(user, "profile.json"), layer({ "machine.nozzle": 0.6, "fit.slip.per_side": 0.25, "machine.printer": "user printer" }, { notes: ["the user's printer"] }));
    writeJson(join(project, "dfm", "profile.json"), layer({ "fit.slip.per_side": 0.3, "machine.printer": "project printer" }));
    const waiver = { rule: "wall.structural", feature: "bezel lip", value: 0.6, unit: "mm", limit: 0.9, bound: { min: 0.6 }, reason: "cosmetic lip, no load", decidedBy: "user", date: "2026-11-12" };
    writeJson(join(part, "dfm.json"), layer({ "fit.slip.per_side": 0.15 }, { waivers: [waiver] }));
    const r = resolve({ profilesDir: profiles(), user, project, part, set: ["machine.printer=session printer"] });
    expect(r.layers.map((l: { scope: string }) => l.scope)).toEqual(["shipped", "user", "project", "part", "session"]);
    expect(r.layers[1].notes).toEqual(["the user's printer"]);
    expect(r.values["machine.nozzle"].layer).toBe("user");
    expect(r.values["fit.slip.per_side"]).toMatchObject({ value: 0.15, layer: "part" });
    expect(r.values["fit.slip.diametral"].value).toBe(0.3);
    expect(r.values["machine.printer"]).toMatchObject({ value: "session printer", layer: "session", source: "session (--set)", status: "user" });
    expect(r.waivers).toEqual([{ ...waiver, layer: "part", file: join(part, "dfm.json") }]);
    const x = explainPath(r, "fit.slip.per_side");
    expect(x.setBy.map((h: { layer: string }) => h.layer)).toEqual(["shipped", "user", "project", "part"]);
  });

  it("chooses the process: --process, else the nearest layer's extends, else fdm", () => {
    const sla = { ...FDM, id: "sla", name: "Resin (fixture)", process: "sla", values: { "wall.min": { value: 0.6, unit: "mm", status: "typical", source: "fixture" } } };
    const dir = profiles({ sla });
    const project = fresh("project");
    writeJson(join(project, "dfm", "profile.json"), layer({}, { extends: "sla" }));
    expect(resolve({ profilesDir: dir, user: false, project }).process).toBe("sla");
    const forced = resolve({ profilesDir: dir, user: false, project, process: "fdm" });
    expect(forced.process).toBe("fdm");
    expect(forced.warnings[0]).toMatch(/extends "sla"/);
    expect(resolve({ profilesDir: dir, user: false }).process).toBe("fdm");
    expect(() => resolve({ profilesDir: dir, user: false, process: "cnc" })).toThrow(/no shipped profile for process "cnc"/);
  });

  it("reports a formula cycle as an error naming the paths", () => {
    const part = fresh("part");
    writeJson(join(part, "dfm.json"), layer({ "a.x": { formula: "a.y + 1" }, "a.y": { formula: "2 * a.x" } }));
    const r = resolve({ profilesDir: profiles(), user: false, part });
    const paths = r.errors.map((e: { path: string }) => e.path);
    expect(paths).toContain("a.x");
    expect(paths).toContain("a.y");
    expect(r.errors[0].message).toMatch(/formula cycle: a\.x -> a\.y -> a\.x/);
    expect(r.values["a.x"].value).toBeNull();
    expect(r.values["wall.min"].value).toBe(0.9); // the rest still resolves
  });

  it("reports an unknown path, a non-numeric input and an invalid entry, naming each path", () => {
    const part = fresh("part");
    writeJson(
      join(part, "dfm.json"),
      layer({
        "boss.od": { formula: "2 * insert.hole" },
        "boss.label": { formula: "machine.printer * 2" },
        "bad-name": 1,
        "two.kinds": { value: 1, formula: "2" },
        "odd.status": { value: 1, status: "maybe" },
      }),
    );
    const r = resolve({ profilesDir: profiles(), user: false, part });
    const byPath = Object.fromEntries(r.errors.map((e: { path: string; message: string }) => [e.path, e.message]));
    expect(byPath["boss.od"]).toMatch(/unknown path "insert.hole"/);
    expect(byPath["boss.label"]).toMatch(/"machine.printer" is not a number/);
    expect(byPath["bad-name"]).toMatch(/not a valid path/);
    expect(byPath["two.kinds"]).toMatch(/exactly one of "value" and "formula"/);
    expect(byPath["odd.status"]).toMatch(/status "maybe"/);
  });

  it("refuses a file with the wrong schema", () => {
    const project = fresh("project");
    writeJson(join(project, "dfm", "profile.json"), { schema: "something/else", values: {} });
    expect(() => resolve({ profilesDir: profiles(), user: false, project })).toThrow(/protoboard\.dfm\.layer\/v1/);
  });
});

describe("the config folder", () => {
  it("resolves on win32 as board-style does: PROTOBOARD_CONFIG_DIR, else %APPDATA%\\protoboard", () => {
    expect(configDir({ APPDATA: "C:\\Home\\u\\Roaming" }, "win32")).toBe("C:\\Home\\u\\Roaming\\protoboard");
    expect(configDir({ PROTOBOARD_CONFIG_DIR: "D:\\cfg", APPDATA: "C:\\x" }, "win32")).toBe("D:\\cfg");
    expect(configDir({ HOME: "C:\\Home\\u" }, "win32")).toBe("C:\\Home\\u\\.config\\protoboard");
    expect(userLayerDir({ APPDATA: "C:\\Home\\u\\Roaming" }, "win32")).toBe("C:\\Home\\u\\Roaming\\protoboard\\dfm");
  });

  it("resolves on posix: PROTOBOARD_CONFIG_DIR, else $XDG_CONFIG_HOME, else ~/.config, then protoboard", () => {
    expect(configDir({ HOME: "/home/u" }, "linux")).toBe("/home/u/.config/protoboard");
    expect(configDir({ HOME: "/home/u", XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe("/xdg/protoboard");
    expect(configDir({ HOME: "/home/m", APPDATA: "/ignored" }, "darwin")).toBe("/home/m/.config/protoboard");
    expect(configDir({ PROTOBOARD_CONFIG_DIR: "/cfg", HOME: "/home/u" }, "linux")).toBe("/cfg");
    expect(userLayerDir({ HOME: "/home/u" }, "linux")).toBe("/home/u/.config/protoboard/dfm");
  });

  it("reads the user layer from <config>/dfm/profile.json by default", () => {
    const config = fresh("config");
    writeJson(join(config, "dfm", "profile.json"), layer({ "machine.nozzle": 0.2 }));
    const r = resolve({ profilesDir: profiles(), env: { PROTOBOARD_CONFIG_DIR: config } });
    expect(r.values["machine.nozzle"]).toMatchObject({ value: 0.2, layer: "user" });
    expect(r.values["line.width"].value).toBe(0.225);
  });
});

describe("the command line", () => {
  const run = (argv: string[], cwd: string) => {
    let out = "";
    let err = "";
    const code = main(argv, { out: { write: (s: string) => (out += s) }, err: { write: (s: string) => (err += s) }, cwd, env: { PROTOBOARD_CONFIG_DIR: fresh("empty-config") }, platform: process.platform } as never);
    return { code, out, err };
  };

  it("prints the resolved JSON, a table, and an explanation", () => {
    const dir = profiles();
    const cwd = fresh("cwd");
    const json = run(["--profiles", dir, "--set", "machine.nozzle=0.6"], cwd);
    expect(json.code).toBe(0);
    const r = JSON.parse(json.out);
    expect(r.values["wall.min"].value).toBe(1.35);
    expect(r.history).toBeUndefined();
    const table = run(["--profiles", dir, "--format", "table"], cwd);
    expect(table.out).toMatch(/wall\.min\s+0\.9 \(= 2 \* line\.width\)\s+mm\s+typical\s+shipped/);
    const why = run(["--profiles", dir, "--explain", "wall.min", "--format", "table"], cwd);
    expect(why.code).toBe(0);
    expect(why.out).toMatch(/line\.width = 0\.45 mm/);
  });

  it("exits 1 on profile errors and 2 on usage errors", () => {
    const dir = profiles();
    const cwd = fresh("cwd");
    expect(run(["--profiles", dir, "--set", 'x={"formula":"x+1"}'], cwd).code).toBe(1);
    expect(run(["--profiles", dir, "--format", "xml"], cwd).code).toBe(2);
    expect(run(["--profiles", dir, "--bogus"], cwd).code).toBe(2);
    expect(run(["--profiles", dir, "--process", "laser"], cwd).code).toBe(2);
  });
});
