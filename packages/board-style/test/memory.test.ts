/** The decisions log, promotion, corrections, STYLE.md, examples, the asset registry and the binding surface. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import {
  applyCorrection,
  decisionsMarkdown,
  indexExamples,
  listDecisions,
  loadAssets,
  promoteDecision,
  promotionCandidates,
  readDecisions,
  recordDecision,
  registerAsset,
  resolveStyle,
  searchExamples,
  STYLE_API,
  styleGuide,
  styleMarks,
  stylePlaces,
  TOKENS,
  type TokenValue,
} from "../src/index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "board-style-"));
function project(): { root: string; boardDir: string } {
  const root = tmp();
  writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
  const boardDir = join(root, "board");
  mkdirSync(boardDir, { recursive: true });
  return { root, boardDir };
}

describe("decisions log", () => {
  it("appends, supersedes, writes the layer, and offers promotion when a change is made twice", () => {
    const user = join(tmp(), "pcb-style");
    const a = project();
    const b = project();
    const pa = stylePlaces({ boardDir: a.boardDir, userDir: user });
    const pb = stylePlaces({ boardDir: b.boardDir, userDir: user });
    const d1 = recordDecision(pa, { said: "rounded frames please", tokens: [{ path: "frame.style", to: "round" }], scope: "project", date: "2026-11-01" });
    const d2 = recordDecision(pa, { said: "no, chamfered frames", tokens: [{ path: "frame.style", to: "chamfer45" }], scope: "project", date: "2026-11-02", evidence: ["before.png", "after.png"] });
    expect(d1.decision.id).toBe("D-PCB-0001");
    expect(d2.decision).toMatchObject({ id: "D-PCB-0002", supersedes: ["D-PCB-0001"], tokens: [{ path: "frame.style", from: "round", to: "chamfer45" }] });
    expect(d2.promotion).toEqual([]);
    const listed = listDecisions(pa);
    expect(listed.map((d) => `${d.id}:${d.effective}`)).toEqual(["D-PCB-0001:superseded", "D-PCB-0002:accepted"]);
    expect(JSON.parse(readFileSync(pa.project!.theme, "utf8")).tokens["frame.style"]).toBe("chamfer45");
    // the same change in a second project: offered for promotion
    const d3 = recordDecision(pb, { said: "chamfers, like the other board", tokens: [{ path: "frame.style", to: "chamfer45" }], scope: "project", date: "2026-11-05" });
    expect(d3.promotion).toEqual([{ path: "frame.style", to: "chamfer45", decisions: [expect.stringContaining("#D-PCB-0002"), expect.stringContaining("#D-PCB-0001")].sort() }].map((c) => ({ ...c, decisions: expect.arrayContaining(c.decisions) })));
    const p = promoteDecision(pb, promotionCandidates(pb)[0], { said: "yes, all my boards", date: "2026-11-06" });
    expect(p.decision).toMatchObject({ id: "D-USR-0001", scope: "user" });
    expect(promotionCandidates(pb)).toEqual([]);
    expect(resolveStyle(airnodeC3(), { userDir: user, theme: "neutral" }).tokens["frame.style"]).toMatchObject({ layer: "user", value: "chamfer45", decision: "D-USR-0001" });
    expect(decisionsMarkdown(listed)).toContain("D-PCB-0001 (project, 2026-11-01, superseded by D-PCB-0002)");
    // the log only grows
    expect(readDecisions(pa.project!.decisions).length).toBe(2);
  });
  it("refuses a decision with no words or an unknown token", () => {
    const a = project();
    const p = stylePlaces({ boardDir: a.boardDir, userDir: false });
    expect(() => recordDecision(p, { said: " ", tokens: [{ path: "frame.style", to: "rect" }], scope: "project" })).toThrow(/words/);
    expect(() => recordDecision(p, { said: "x", tokens: [{ path: "frame.colour", to: "rect" }], scope: "project" })).toThrow(/unknown token/);
  });
});

describe("applyCorrection", () => {
  it("refuses electrical tokens changed for looks", () => {
    const r = applyCorrection("make the traces curvy, it looks nicer", [{ path: "copper.corner", to: "arc" }], { doc: airnodeC3(), resolve: { userDir: false } });
    expect(r.status).toBe("refused");
    expect(r.errors[0]).toMatch(/electrical/);
  });
  it("renders before and after, asks the scope, then records the decision with the guard rail that acted", () => {
    const a = project();
    const evidence = join(a.root, "evidence");
    const ctx = { doc: airnodeC3(), resolve: { boardDir: a.boardDir, userDir: false as const, theme: "arcade" }, evidenceDir: evidence, name: "tags", width: 400, date: "2026-11-09", restyle: { nameplate: { rev: "1" } } };
    const changes: { path: string; to: TokenValue }[] = [
      { path: "frame.style", to: "chamfer45" },
      { path: "frame.title", to: "tag" },
      { path: "type.class.groupTitle", to: { height: 0.8, width: 0.8, stroke: 0.15, case: "upper" as const, knockout: true } },
    ];
    const ask = applyCorrection("keep the playful colors but use chamfered frames and small solid tags", changes, ctx);
    expect(ask.status).toBe("needs-scope");
    expect(ask.choices).toEqual(["board", "project", "user"]);
    expect(existsSync(ask.before.top!) && existsSync(ask.after.top!)).toBe(true);
    expect(ask.guards[0]).toMatch(/type.class.groupTitle: height 0.8 mm is under JLCPCB's 1 mm text floor/);
    expect(ask.changeSets.map((c) => c.tool)).toContain("frames");
    const done = applyCorrection("keep the playful colors but use chamfered frames and small solid tags", changes, { ...ctx, scope: "project" });
    expect(done.status).toBe("recorded");
    expect(done.decision!.decision).toMatchObject({ id: "D-PCB-0001", scope: "project", guards: ask.guards });
    expect(done.decision!.decision.evidence).toHaveLength(4);
    const s = done.style!;
    expect(s.tokens["frame.style"]).toMatchObject({ layer: "project", value: "chamfer45", decision: "D-PCB-0001" });
    expect(s.tokens["fab.mask.color.top"]).toMatchObject({ layer: "shipped", value: "purple" });
    expect(s.tokens["type.class.groupTitle"].effective).toMatchObject({ height: 1.0 });
  });
});

describe("STYLE.md, examples and assets", () => {
  it("the guide lists every token with its layer, the procedure, decisions and examples", () => {
    const s = resolveStyle(airnodeC3(), { userDir: false });
    const md = styleGuide(s, { decisions: [], examples: [] });
    for (const t of TOKENS) expect(md, t.path).toContain(`\`${t.path}\``);
    expect(md).toContain("# Board style: Hazard Protocol");
    expect(md).toContain("I'd rather it look like this");
    expect(md).toContain("placeholder-maker");
  });
  it("examples: captions with tags, an index, search by tag and words", () => {
    const dir = join(tmp(), "examples");
    mkdirSync(dir);
    writeFileSync(join(dir, "found-1.png"), Buffer.from([137, 80, 78, 71]));
    writeFileSync(join(dir, "found-1.md"), "---\ntitle: A synth panel\ntags: [stripes, black-mask]\ncopy: stripe spacing\navoid: tiny text\n---\nFound online.\n");
    writeFileSync(join(dir, "other.png"), Buffer.from([1]));
    const list = indexExamples(dir);
    expect(list.map((e) => e.file)).toEqual(["found-1.png", "other.png"]);
    expect(JSON.parse(readFileSync(join(dir, "index.json"), "utf8")).examples[0]).toMatchObject({ title: "A synth panel", tags: ["stripes", "black-mask"], copy: "stripe spacing" });
    expect(searchExamples([{ dir, layer: "project" }], { tags: ["stripes"], text: "synth" }).map((e) => e.file)).toEqual(["found-1.png"]);
  });
  it("assets: shipped placeholders verify; an unknown license is unresolved and never drawn by default", () => {
    const shipped = loadAssets();
    expect([...shipped.keys()].sort()).toEqual(["placeholder-egg", "placeholder-logo", "placeholder-maker", "placeholder-oshw"]);
    expect([...shipped.values()].every((a) => a.verified && a.entry.status === "placeholder")).toBe(true);
    const a = project();
    const places = stylePlaces({ boardDir: a.boardDir, userDir: false });
    const src = join(tmp(), "my-mark.json");
    writeFileSync(src, JSON.stringify({ schema: "protoboard.board-style.asset/v1", id: "my-mark", aspect: 1, polygons: [{ outer: [0, 0, 1, 0, 1, 1, 0, 1] }] }));
    const e = registerAsset(places.project!.assets, { id: "my-mark", kind: "maker", path: src, source: "a vector file from the owner", license: "unknown" });
    expect(e.status).toBe("unresolved");
    const style = resolveStyle({ doc: airnodeC3(), dir: a.boardDir }, { userDir: false, overrides: { "marks.maker": "my-mark" } });
    const cs = styleMarks(airnodeC3(), style);
    expect(cs.report.skipped.find((s) => s.what.startsWith("marks.maker"))?.reason).toMatch(/license is unresolved/);
    expect(styleMarks(airnodeC3(), style, { allowUnresolved: true }).report.skipped.find((s) => s.what.startsWith("marks.maker"))).toBeUndefined();
  });
});

describe("binding surface", () => {
  it("names are unique snake case, and every tool runs on the fixture with an empty input where it allows one", () => {
    const names = STYLE_API.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of STYLE_API) expect(t.name).toMatch(/^style_[a-z_]+$/);
    const ctx = { doc: airnodeC3(), userDir: false as const };
    for (const name of ["style_themes", "style_resolve", "style_check", "style_frames", "style_designators", "style_nameplate", "style_hazard", "style_edge_text", "style_marks", "style_align", "style_remove", "style_assets"]) {
      const t = STYLE_API.find((x) => x.name === name)!;
      expect(() => t.run(t.input.parse({}), ctx), name).not.toThrow();
    }
    const explain = STYLE_API.find((x) => x.name === "style_explain")!;
    expect((explain.run(explain.input.parse({ path: "frame.style" }), ctx) as { text: string }).text).toMatch(/chamfer45/);
  });
});
