/**
 * The style system's resolver (skills/style-system/scripts/resolve-style.mjs): the cascade, core references, themes
 * found by id, DFM floors, whole-value replacement and the config folder. Fixtures are written to a temporary folder;
 * the user layer is always a temporary config folder or left out, never the real one.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  DFM_PATHS,
  checkValue,
  configDir,
  dfmProfile,
  evaluateFormula,
  explainToken,
  formatTable,
  main,
  nextDecisionId,
  parseFormula,
  parseTheme,
  promotionCandidates,
  resolveStyle,
  stylePlaces,
  tokenDefs,
  userStyleDir,
} from "../skills/style-system/scripts/resolve-style.mjs";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), "ext-style-test-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
/** A fresh project (with protoboard.config.ts) and a fresh config folder. */
function fixture() {
  const root = join(TMP, `case-${++n}`);
  const project = join(root, "project");
  const config = join(root, "config");
  mkdirSync(project, { recursive: true });
  mkdirSync(config, { recursive: true });
  writeFileSync(join(project, "protoboard.config.ts"), "export default {};\n");
  return { root, project, config };
}

function put(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

const cadLayer = (tokens: Record<string, unknown>, ext?: string) => ({ schema: "protoboard.cad-style.layer/v1", ...(ext ? { extends: ext } : {}), tokens });
const coreLayer = (tokens: Record<string, unknown>, ext?: string) => ({ schema: "protoboard.style.layer/v1", ...(ext ? { extends: ext } : {}), tokens });

/** A resolved DFM profile as the dfm resolver writes it (values for a 0.4 mm nozzle; test data only). */
function dfm(values: Record<string, number>) {
  return dfmProfile(
    {
      schema: "protoboard.dfm.resolved/v1",
      process: "fdm",
      profile: { id: "test" },
      layers: [],
      values: Object.fromEntries(Object.entries(values).map(([p, v]) => [p, { value: v, unit: p.endsWith("angle") ? "deg" : "mm", status: "assumed", source: "test fixture", note: "", layer: "default", file: "test" }])),
    },
    "test-dfm.json",
  );
}

describe("shipped token lists and themes", () => {
  it("every JSON file in the package parses", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.name === "node_modules" ? [] : d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith(".json") ? [join(dir, d.name)] : []));
    const files = walk(PKG);
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) expect(() => JSON.parse(readFileSync(f, "utf8")), f).not.toThrow();
  });

  it("the CAD branch has 40 to 70 tokens, every class used, every formula over DFM paths only", () => {
    const defs = tokenDefs("cad");
    expect(defs.size).toBeGreaterThanOrEqual(40);
    expect(defs.size).toBeLessThanOrEqual(70);
    const classes = new Set([...defs.values()].map((d: { class: string }) => d.class));
    expect([...classes].sort()).toEqual(["cosmetic", "layout", "process", "structural"]);
    for (const d of defs.values() as Iterable<{ path: string; bounds: { ast: unknown }[] }>) for (const b of d.bounds) expect(DFM_PATHS, d.path).toEqual(expect.arrayContaining(collectPaths(b.ast)));
  });

  it("both CAD themes and both core themes parse, with values of the declared types", () => {
    for (const domain of ["core", "cad"] as const)
      for (const id of ["hazard-protocol", "neutral"]) {
        const file = join(PKG, "themes", domain, `${id}.json`);
        const t = parseTheme(domain, readFileSync(file, "utf8"), file);
        expect(t.id).toBe(id);
      }
  });

  it("the shipped Hazard Protocol resolves with its references substituted and floors not checked", () => {
    const r = resolveStyle({ domain: "cad", user: false });
    expect(r.theme.id).toBe("hazard-protocol");
    expect(r.tokens["form.language"].value).toBe("chamferRoundedCorners");
    expect(r.tokens["pattern.isogrid.node.circle"].effective).toBe(false);
    expect(r.tokens["pattern.isogrid.corner.radius.rule"].effective).toBe("equalsRibWidth");
    expect(r.tokens["proportion.system"].effective).toBe("none");
    expect(r.tokens["color.accent"]).toMatchObject({ value: "{core.palette.accent}", effective: "#FF5C00", ref: "core.palette.accent" });
    expect(r.tokens["text.case"].effective).toBe("upper");
    expect(r.tokens["pattern.isogrid.rib.width"].check).toBe("not-checked");
    expect(r.dfm.checked).toBe(false);
    expect(formatTable(r)).toContain("not checked against a process");
  });
});

describe("the cascade", () => {
  it("defaults < shipped < user < project < item < overrides, each recorded with its layer and file", () => {
    const f = fixture();
    const item = join(f.project, "src", "enclosures", "case");
    put(join(f.config, "cad-style", "theme.json"), cadLayer({ "layout.margin": 5, "layout.gutter": 3 }));
    put(join(f.project, "style", "cad", "theme.json"), cadLayer({ "layout.margin": 6 }));
    put(join(item, "style.json"), cadLayer({ "layout.margin": 7 }));

    const at = (o: Record<string, unknown>) => resolveStyle({ domain: "cad", user: f.config, project: f.project, ...o }).tokens["layout.margin"];
    expect(resolveStyle({ domain: "cad", user: false }).tokens["layout.margin"]).toMatchObject({ value: 4, layer: "shipped", theme: "hazard-protocol" });
    expect(at({})).toMatchObject({ value: 6, layer: "project", file: join(f.project, "style", "cad", "theme.json") });
    expect(at({ item })).toMatchObject({ value: 7, layer: "item", file: join(item, "style.json") });
    expect(at({ item, overrides: { "layout.margin": 8 } })).toMatchObject({ value: 8, layer: "override" });
    const r = resolveStyle({ domain: "cad", user: f.config, project: f.project, item });
    expect(r.tokens["layout.gutter"]).toMatchObject({ value: 3, layer: "user" });
    expect(r.tokens["layout.margin"].theme).toBeUndefined();
    // the project is found from the item folder
    expect(resolveStyle({ domain: "cad", user: false, item }).tokens["layout.margin"].layer).toBe("item");
  });

  it("a layer replaces a whole value: a list is not merged", () => {
    const f = fixture();
    put(join(f.project, "style", "cad", "theme.json"), cadLayer({ "edge.chamfer.sizes": [1], "corner.radius.set": [3] }));
    const r = resolveStyle({ domain: "cad", user: false, project: f.project });
    expect(r.tokens["edge.chamfer.sizes"].effective).toEqual([1]);
    expect(r.tokens["corner.radius.set"].effective).toEqual([3]);
  });

  it("the nearest layer naming a base theme picks it; otherwise hazard-protocol", () => {
    const f = fixture();
    put(join(f.config, "cad-style", "theme.json"), cadLayer({}, "hazard-protocol"));
    put(join(f.project, "style", "cad", "theme.json"), cadLayer({}, "neutral"));
    const r = resolveStyle({ domain: "cad", user: f.config, project: f.project });
    expect(r.theme).toMatchObject({ id: "neutral", name: "Conventional", chain: ["neutral"] });
    expect(r.tokens["form.language"].effective).toBe("fillet");
    expect(r.tokens["pattern.default"].effective).toBe("none");
    // core is chosen on its own: still the house palette
    expect(r.core.theme.id).toBe("hazard-protocol");
  });

  it("records the decision that set a layer's value, and finds a project change made twice", () => {
    const f = fixture();
    put(join(f.project, "style", "cad", "theme.json"), cadLayer({ "layout.margin": 6 }));
    const line = (id: string, said: string, to: number, supersedes: string[] = []) =>
      JSON.stringify({ schema: "protoboard.style.decision/v1", id, date: "2026-11-12", domain: "cad", scope: "project", said, tokens: [{ path: "layout.margin", from: 4, to }], evidence: [], supersedes, status: "accepted" });
    const log = join(f.project, "style", "cad", "decisions.jsonl");
    put(log, `${line("D-CAD-0001", "a little more room at the edges", 6)}\n`);
    let r = resolveStyle({ domain: "cad", user: f.config, project: f.project });
    expect(r.tokens["layout.margin"].decision).toBe("D-CAD-0001");
    expect(nextDecisionId("cad", [{ id: "D-CAD-0001" }, { id: "D-STYLE-0009" }])).toBe("D-CAD-0002");
    expect(nextDecisionId("core", [])).toBe("D-STYLE-0001");
    expect(promotionCandidates("cad", stylePlaces("cad", { project: f.project, user: f.config }))).toEqual([]);
    put(log, `${line("D-CAD-0001", "a little more room at the edges", 6)}\n${line("D-CAD-0002", "same margin on the lid", 6)}\n`);
    r = resolveStyle({ domain: "cad", user: f.config, project: f.project });
    expect(r.promotion).toHaveLength(1);
    expect(r.promotion[0]).toMatchObject({ path: "layout.margin", to: 6 });
    expect(r.tokens["layout.margin"].decision).toBe("D-CAD-0002");
  });
});

describe("core references", () => {
  it("a CAD token that references a core token follows a change to the core palette", () => {
    const f = fixture();
    put(join(f.project, "style", "theme.json"), coreLayer({ "palette.accent": "#00AA00", "voice.tags.case": "asis" }));
    const r = resolveStyle({ domain: "cad", user: false, project: f.project });
    expect(r.tokens["color.accent"]).toMatchObject({ effective: "#00AA00", ref: "core.palette.accent", refSetBy: { layer: "project" } });
    expect(r.tokens["text.case"].effective).toBe("asis");
    expect(r.core.tokens["palette.accent"]).toMatchObject({ value: "#00AA00", layer: "project" });
    // references inside core resolve too, and a --set on core reaches the branch
    const s = resolveStyle({ domain: "cad", user: false, coreOverrides: { "palette.neutral.200": "#DDDDDD" } });
    expect(s.tokens["color.body"].effective).toBe("#DDDDDD");
    expect(explainToken(s, "color.body").text).toContain("core.palette.body");
  });

  it("refuses a reference to a core token that does not exist, and a resolved value of the wrong type", () => {
    const f = fixture();
    put(join(f.project, "style", "cad", "theme.json"), cadLayer({ "color.accent": "{core.palette.nope}" }));
    expect(() => resolveStyle({ domain: "cad", user: false, project: f.project })).toThrow(/names no core token/);
    expect(() => resolveStyle({ domain: "cad", user: false, overrides: { "color.accent": "{core.type.family.body}" } })).toThrow(/does not fit/);
  });
});

describe("bring your own theme", () => {
  it("finds a theme by id in the project's and the user's themes/ folders, nearest first", () => {
    const f = fixture();
    const theme = (id: string, name: string, tokens: Record<string, unknown>, ext?: string) => ({ schema: "protoboard.cad-style.theme/v1", id, name, ...(ext ? { extends: ext } : {}), description: `${name} test theme`, tokens });
    put(join(f.config, "cad-style", "themes", "workshop.json"), theme("workshop", "Workshop (user)", { "layout.margin": 9 }, "neutral"));
    put(join(f.config, "cad-style", "theme.json"), cadLayer({}, "workshop"));
    let r = resolveStyle({ domain: "cad", user: f.config, project: f.project });
    expect(r.theme).toMatchObject({ id: "workshop", chain: ["neutral", "workshop"], where: "user" });
    expect(r.tokens["layout.margin"]).toMatchObject({ value: 9, layer: "shipped", theme: "workshop" });
    expect(r.tokens["form.language"].effective).toBe("fillet");

    // the project's copy of the same id wins over the user's
    put(join(f.project, "style", "cad", "themes", "workshop.json"), theme("workshop", "Workshop (project)", { "layout.margin": 10 }, "hazard-protocol"));
    r = resolveStyle({ domain: "cad", user: f.config, project: f.project });
    expect(r.theme).toMatchObject({ name: "Workshop (project)", chain: ["hazard-protocol", "workshop"], where: "project" });
    expect(r.tokens["layout.margin"].value).toBe(10);

    // core themes are found the same way
    put(join(f.project, "style", "themes", "night.json"), { schema: "protoboard.style.theme/v1", id: "night", name: "Night", extends: "hazard-protocol", description: "test", tokens: { "palette.accent": "#3355FF" } });
    put(join(f.project, "style", "theme.json"), coreLayer({}, "night"));
    r = resolveStyle({ domain: "cad", user: false, project: f.project });
    expect(r.core.theme.chain).toEqual(["hazard-protocol", "night"]);
    expect(r.tokens["color.accent"].effective).toBe("#3355FF");
  });

  it("a full theme file in a layer slot reads as a layer over its own base", () => {
    const f = fixture();
    put(join(f.project, "style", "cad", "theme.json"), { schema: "protoboard.cad-style.theme/v1", id: "studio", name: "Studio", extends: "neutral", description: "test", tokens: { "layout.margin": 11 } });
    const r = resolveStyle({ domain: "cad", user: false, project: f.project });
    expect(r.theme.id).toBe("neutral");
    expect(r.tokens["layout.margin"]).toMatchObject({ value: 11, layer: "project" });
  });

  it("names the missing theme and the shipped ones", () => {
    expect(() => resolveStyle({ domain: "cad", user: false, theme: "nowhere" })).toThrow(/no cad theme nowhere \(shipped: hazard-protocol, neutral/);
  });
});

describe("DFM floors and ceilings", () => {
  const profile = dfm({ "line.width": 0.45, "layer.height": 0.2, "text.min.height": 6, "text.min.stroke": 0.9, "text.emboss.height": 0.6, "text.engrave.depth": 0.8, "chamfer.bed.edge": 0.8, "overhang.max.angle": 50, "bridge.max.span": 5, "wall.min": 0.9, "wall.structural": 1.6, "feature.min.gap": 0.4 });

  it("a preference under a floor keeps its value, takes the floor as effective value, and says why", () => {
    const r = resolveStyle({ domain: "cad", user: false, dfm: profile, overrides: { "pattern.isogrid.rib.width": 0.6 } });
    const t = r.tokens["pattern.isogrid.rib.width"];
    expect(t).toMatchObject({ value: 0.6, effective: 0.9, check: "adjusted" });
    expect(t.reason).toContain("2 * line.width");
    expect(t.bounds[0].inputs["line.width"]).toMatchObject({ value: 0.45, source: "test fixture" });
    expect(r.adjusted.map((a: { path: string }) => a.path)).toEqual(expect.arrayContaining(["pattern.isogrid.rib.width", "text.height.min", "edge.chamfer.bottom", "pattern.pocket.ceiling.span"]));
    // house 5 mm text raised to the profile's 6 mm; 0.6 mm bed chamfer raised to 0.8 mm
    expect(r.tokens["text.height.min"]).toMatchObject({ value: 5, effective: 6 });
    expect(r.tokens["edge.chamfer.bottom"]).toMatchObject({ value: 0.6, effective: 0.8 });
    // a ceiling: the 6 mm pocket ceiling span lowered to the 5 mm bridge
    expect(r.tokens["pattern.pocket.ceiling.span"]).toMatchObject({ value: 6, effective: 5, check: "adjusted" });
    // a floor that is met
    expect(r.tokens["edge.chamfer.bottom.angle"]).toMatchObject({ value: 45, effective: 45, check: "ok" });
    // a list is floored element by element
    expect(resolveStyle({ domain: "cad", user: false, dfm: profile, overrides: { "edge.chamfer.sizes": [0.2, 1.2] } }).tokens["edge.chamfer.sizes"].effective).toEqual([0.45, 1.2]);
    expect(explainToken(r, "pattern.isogrid.rib.width").text).toMatch(/Effective value 0\.9 mm: floor 2 \* line\.width = 0\.9 mm for fdm/);
  });

  it("a path the profile lacks leaves the token unknown, not failed", () => {
    const r = resolveStyle({ domain: "cad", user: false, dfm: dfm({ "line.width": 0.45 }) });
    expect(r.tokens["text.height.min"]).toMatchObject({ effective: 5, check: "unknown" });
    expect(r.tokens["text.height.min"].reason).toContain("text.min.height");
  });

  it("reads a profile from a file on the command line", () => {
    const f = fixture();
    const file = join(f.root, "dfm.json");
    put(file, { schema: "protoboard.dfm.resolved/v1", process: "fdm", profile: {}, layers: [], values: { "line.width": { value: 0.5, unit: "mm", status: "assumed", source: "test", note: "", layer: "default", file: "x" } } });
    let out = "";
    let err = "";
    const code = main(["--domain", "cad", "--no-user", "--project", f.project, "--dfm", file, "--set", "pattern.voronoi.strut=0.5", "--explain", "pattern.voronoi.strut"], { write: (s: string) => (out += s) }, { write: (s: string) => (err += s) });
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ value: 0.5, effective: 1 });
  });
});

describe("formulas", () => {
  const vals: Record<string, number> = { "line.width": 0.45, "layer.height": 0.2, "overhang.max.angle": 45 };
  const look = (p: string) => vals[p];
  it("evaluates numbers, paths, operators, min, max and round without eval", () => {
    expect(evaluateFormula("2 * line.width", look)).toEqual({ value: 0.9 });
    expect(evaluateFormula("90 - overhang.max.angle", look)).toEqual({ value: 45 });
    expect(evaluateFormula("max(line.width, 2 * layer.height)", look)).toEqual({ value: 0.45 });
    expect(evaluateFormula("min(1, 3) + -(2 - 4) / 2", look)).toEqual({ value: 2 });
    expect(evaluateFormula("round(line.width / 3, 2)", look)).toEqual({ value: 0.15 });
    expect(evaluateFormula("wall.min * 2", look)).toEqual({ missing: ["wall.min"] });
    expect(evaluateFormula("1 / (layer.height - 0.2)", look)).toHaveProperty("error");
  });
  it("refuses anything that is not the formula language", () => {
    for (const bad of ["process.exit(1)", "line.width; 1", "constructor", "2 ** 3", "max()", "round(1, 2, 3)", "line['width']", "1 +"]) expect(() => parseFormula(bad) && evaluateFormula(bad, () => 1), bad).toThrow();
  });
});

describe("the config folder", () => {
  it("resolves as board-style does, on win32 and posix", () => {
    expect(configDir({ PROTOBOARD_CONFIG_DIR: "/x/pb" }, "linux")).toBe("/x/pb");
    expect(configDir({ APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, "win32")).toBe("C:\\Users\\u\\AppData\\Roaming\\protoboard");
    expect(configDir({ HOME: "/home/u" }, "linux")).toBe("/home/u/.config/protoboard");
    expect(configDir({ HOME: "/home/u", XDG_CONFIG_HOME: "/xdg" }, "darwin")).toBe("/xdg/protoboard");
    expect(configDir({ HOME: "C:\\Users\\u" }, "win32")).toBe("C:\\Users\\u\\.config\\protoboard");
    expect(userStyleDir("cad", { APPDATA: "C:\\A" }, "win32")).toBe("C:\\A\\protoboard\\cad-style");
    expect(userStyleDir("core", { HOME: "/home/u" }, "linux")).toBe("/home/u/.config/protoboard/style");
  });
  it("places each domain's files where the model says", () => {
    const p = stylePlaces("cad", { project: "/p", item: "/p/src/case", user: "/cfg" });
    expect(p.project.theme).toBe(join(resolve("/p"), "style", "cad", "theme.json"));
    expect(p.project.themes).toBe(join(resolve("/p"), "style", "cad", "themes"));
    expect(p.user.theme).toBe(join(resolve("/cfg"), "cad-style", "theme.json"));
    expect(p.item).toMatchObject({ theme: join(resolve("/p"), "src", "case", "style.json"), key: "src__case" });
    const c = stylePlaces("core", { project: "/p", user: "/cfg" });
    expect(c.project.decisions).toBe(join(resolve("/p"), "style", "decisions.jsonl"));
    expect(c.user.theme).toBe(join(resolve("/cfg"), "style", "theme.json"));
    expect(c.item).toBeUndefined();
  });
});

describe("values", () => {
  it("checks types the way board-style does", () => {
    const def = (kind: { kind: string; [k: string]: unknown }) => ({ path: "x", type: kind });
    expect(checkValue(def({ kind: "length", min: 0, max: 5 }), 6)).toMatch(/above/);
    expect(checkValue(def({ kind: "lengths" }), [1, -1])).toMatch(/positive/);
    expect(checkValue(def({ kind: "color" }), "#FF5C00")).toBeUndefined();
    expect(checkValue(def({ kind: "enum", values: ["a"] }), "b")).toMatch(/one of/);
    expect(checkValue(def({ kind: "asset" }), "protoboard-logo-black")).toBeUndefined();
  });
  it("reports whether a referenced asset is registered and verified", () => {
    const r = resolveStyle({ domain: "cad", user: false });
    expect(r.tokens["marks.logo"]).toMatchObject({ effective: "protoboard-logo-black", ref: "core.marks.logo" });
    expect(r.tokens["marks.logo"].asset).toMatchObject({ id: "protoboard-logo-black", found: true });
  });
});

function collectPaths(ast: unknown): string[] {
  const a = ast as { path?: string; neg?: unknown; op?: string; a?: unknown; b?: unknown; fn?: string; args?: unknown[] };
  if (a.path) return [a.path];
  if (a.neg) return collectPaths(a.neg);
  if (a.op) return [...collectPaths(a.a), ...collectPaths(a.b)];
  if (a.fn) return (a.args ?? []).flatMap(collectPaths);
  return [];
}
