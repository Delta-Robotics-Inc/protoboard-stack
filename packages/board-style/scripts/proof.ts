/**
 * The style system's proof run (local output; nothing here is committed):
 *
 *   npx tsx packages/board-style/scripts/proof.ts [--out <dir>] [--reference <manifest id> [--name <product name>] [--rev <n>]]
 *
 * 1. The synthetic Airnode C3 in each shipped theme: top and bottom renders, the change sets, the style check.
 * 2. A correction on the playful theme in a scratch project under the output folder: before and after renders, the
 *    decision record, the project's STYLE.md and the re-render with the recorded decision.
 * 3. With --reference (an id of the Git-ignored manifest of real boards, never named here): the default theme
 *    resolved against that board, its own board-level silkscreen compared with what the tools draw on its bare
 *    copy, as measured coverage, and renders of both. Printed under a generic label only.
 *
 * Default output: docs/specs/pcb-editor-research/phase4/style/ (excluded from Git).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { footprintToWorld, recordsOfKind, sideLayer, writeBoardDir, type BoardDocument, type FootprintGraphic, type Side } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { flattenContour } from "@protoboardai/board-checks";
import { fillZones } from "@protoboardai/board-fill";
import { applyCorrection, checkStyle, planRestyle, renderPng, resolveStyle, serializeLayer, LAYER_SCHEMA, writeStyleGuide, decisionsMarkdown, listDecisions, madeBy, type ResolvedStyle, type TokenValue } from "../src/index.js";
import { capsuleRing, intersection, polygonArea, ringsOf, textRings, union, type Polygon, type Ring } from "../src/geom.js";
import { grow } from "@protoboardai/board-fill";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..", "..", "..");
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = resolve(arg("--out") ?? join(repo, "docs", "specs", "pcb-editor-research", "phase4", "style"));
mkdirSync(OUT, { recursive: true });
const OPTS = { nameplate: { rev: "1", date: "2026-11-09" } };
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(s);
};

// ---------------------------------------------------------------- 1. three themes on Airnode C3
for (const theme of ["hazard-protocol", "neutral", "arcade"]) {
  const doc = airnodeC3();
  const style = resolveStyle(doc, { userDir: false, theme });
  const t0 = performance.now();
  const plan = planRestyle(doc, style, OPTS);
  if (plan.failed) say(`${theme}: restyle failed at ${plan.failed.tool}: ${JSON.stringify(plan.failed.reply).slice(0, 300)}`);
  const ms = Math.round(performance.now() - t0);
  const fill = fillZones(plan.doc).fill;
  for (const side of ["top", "bottom"] as const) writeFileSync(join(OUT, `airnode-c3-${theme}-${side}.png`), renderPng(plan.doc, style, { side, width: 1000, fill }));
  const check = checkStyle(plan.doc, style, OPTS);
  writeFileSync(join(OUT, `airnode-c3-${theme}-check.json`), `${JSON.stringify({ summary: check.summary, clean: check.clean, findings: check.findings, guards: check.guards }, null, 2)}\n`);
  writeFileSync(join(OUT, `airnode-c3-${theme}-changesets.json`), `${JSON.stringify(plan.steps.map((s) => ({ tool: s.tool, title: s.title, ops: s.ops.length, hostOps: s.hostOps.length, report: s.report })), null, 2)}\n`);
  say(`${theme}: planned in ${ms} ms; ${plan.steps.map((s) => `${s.tool} +${s.report.added}`).join(", ")}; ${check.summary.line}`);
}

// ---------------------------------------------------------------- 2. a correction on the playful theme
{
  const proj = join(OUT, "correction-project");
  rmSync(proj, { recursive: true, force: true });
  mkdirSync(join(proj, "style", "pcb"), { recursive: true });
  writeFileSync(join(proj, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(proj, "style", "pcb", "theme.json"), serializeLayer({ schema: LAYER_SCHEMA, extends: "arcade", tokens: {} }));
  const boardDir = join(proj, "board");
  const doc0 = airnodeC3();
  writeBoardDir(boardDir, doc0);
  const resolveOpts = { boardDir, userDir: false as const };
  const style0 = resolveStyle({ doc: doc0, dir: boardDir }, resolveOpts);
  // the board as it stands: restyled in the project's theme (Arcade)
  const styled = planRestyle(doc0, style0, OPTS).doc;
  const said = "keep the playful colors but use chamfered frames and solid tags";
  const changes: { path: string; to: TokenValue }[] = [
    { path: "frame.style", to: "chamfer45" },
    { path: "frame.title", to: "tag" },
    { path: "type.class.groupTitle", to: { height: 1.0, width: 1.0, stroke: 0.15, case: "upper" as const, knockout: true } },
    { path: "nameplate.style", to: "tag" },
  ];
  const ctx = { doc: styled, resolve: resolveOpts, evidenceDir: join(OUT, "correction"), name: "arcade-tags", width: 1000, date: "2026-11-09", restyle: OPTS };
  const ask = applyCorrection(said, changes, ctx);
  say(`correction: ${ask.status}; question: ${ask.question}; guards: ${ask.guards.join("; ") || "none"}`);
  const done = applyCorrection(said, changes, { ...ctx, scope: "project" });
  say(`correction: ${done.status} as ${done.decision?.decision.id} (scope ${done.decision?.decision.scope}); layer file ${done.decision?.layerFile ? "written" : "not written"}`);
  const style1 = done.style!;
  const after = planRestyle(styled, style1, OPTS);
  if (after.failed) say(`corrected restyle failed at ${after.failed.tool}: ${JSON.stringify(after.failed.reply).slice(0, 300)}`);
  const fill = fillZones(after.doc).fill;
  for (const side of ["top", "bottom"] as const) writeFileSync(join(OUT, `airnode-c3-arcade-corrected-${side}.png`), renderPng(after.doc, style1, { side, width: 1000, fill, caption: `Arcade + ${done.decision?.decision.id}, ${side}` }));
  const check = checkStyle(after.doc, style1, OPTS);
  say(`corrected board: ${check.summary.line}; tools re-run on it: ${planRestyle(after.doc, style1, OPTS).steps.filter((s) => !s.empty).length} with changes`);
  writeStyleGuide(style1);
  writeFileSync(join(proj, "style", "pcb", "DECISIONS.md"), decisionsMarkdown(listDecisions(style1.places)));
  copyFileSync(style1.places.project!.decisions, join(OUT, "correction", "decisions.jsonl"));
  say(`decision record: ${readFileSync(style1.places.project!.decisions, "utf8").trim()}`);
}

// ---------------------------------------------------------------- 3. the reference board (local only)
const refId = arg("--reference") ?? process.env.PB_STYLE_REFERENCE;
const LOCAL = process.env.PB_PCB_REGRESSION_LOCAL ? resolve(process.env.PB_PCB_REGRESSION_LOCAL) : join(repo, "packages", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local");
const MANIFEST = join(LOCAL, "manifest.json");
if (!refId) say("reference board: skipped (no --reference id given)");
else if (!existsSync(MANIFEST)) say("reference board: skipped (no local manifest)");
else {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { boards?: Record<string, { root: string; pcb: string }> };
  const e = m.boards?.[refId];
  if (!e) say("reference board: skipped (the id is not in the local manifest)");
  else {
    const root = isAbsolute(e.root) ? e.root : join(LOCAL, e.root);
    const { importBoard } = (await import(pathToFileURL(join(repo, "packages", "board-import", "src", "index.ts")).href)) as { importBoard: (s: { path: string }) => Promise<{ document: BoardDocument }> };
    const actual = (await importBoard({ path: join(root, e.pcb) })).document;
    await compareReference(actual);
  }
}
writeFileSync(join(OUT, "proof-log.txt"), `${log.join("\n")}\n`);

// ---------------------------------------------------------------- the comparison

/** Silk of a side as rings: strokes as capsules, filled shapes as polygons, text in the stroke font. */
function silkRings(doc: BoardDocument, side: Side, pick: (kind: "board" | "footprint", id: string) => boolean): Ring[] {
  const layer = side === "top" ? "top_silkscreen" : "bottom_silkscreen";
  const out: Ring[] = [];
  const stroke = (pts: number[], w: number, closed: boolean) => {
    const n = pts.length >> 1;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const j = (i + 1) % n;
      out.push(capsuleRing(pts[2 * i], pts[2 * i + 1], pts[2 * j], pts[2 * j + 1], Math.max(w, 50_000) / 2, 3));
    }
  };
  const graphic = (g: FootprintGraphic, map: (x: number, y: number) => [number, number]) => {
    const w = g.stroke_width;
    if ((g.shape === "line" || g.shape === "arc") && g.start && g.end) {
      const pts = g.sweep ? flattenContour([{ ...g.start, sweep: g.sweep }, g.end], map, false) : [...map(g.start.x, g.start.y), ...map(g.end.x, g.end.y)];
      stroke(pts, w, false);
    } else if (g.shape === "circle" && g.center && g.radius) {
      const [cx, cy] = map(g.center.x, g.center.y);
      const pts: number[] = [];
      for (let i = 0; i < 24; i++) pts.push(Math.round(cx + g.radius * Math.cos((Math.PI * i) / 12)), Math.round(cy + g.radius * Math.sin((Math.PI * i) / 12)));
      if (g.filled) out.push(pts);
      else stroke(pts, w, true);
    } else if (g.shape === "rect" && g.center && g.width && g.height) {
      const pts = [...map(g.center.x - g.width / 2, g.center.y - g.height / 2), ...map(g.center.x + g.width / 2, g.center.y - g.height / 2), ...map(g.center.x + g.width / 2, g.center.y + g.height / 2), ...map(g.center.x - g.width / 2, g.center.y + g.height / 2)];
      if (g.filled) out.push(pts);
      else stroke(pts, w, true);
    } else if (g.points && g.points.length >= 2) {
      const closed = g.shape === "polygon";
      const pts = flattenContour(g.points, map, closed).map(Math.round);
      if (closed && g.filled) out.push(pts);
      else stroke(pts, w, closed);
    }
  };
  for (const fp of recordsOfKind(doc, "footprint")) {
    if (!pick("footprint", fp.id)) continue;
    const map = (x: number, y: number): [number, number] => {
      const w = footprintToWorld(fp, { x, y });
      return [Math.round(w.x), Math.round(w.y)];
    };
    for (const g of fp.graphics ?? []) if (sideLayer(g.layer, fp.side) === layer) graphic(g, map);
    for (const t of fp.texts ?? []) {
      if (sideLayer(t.layer, fp.side) !== layer) continue;
      const [x, y] = map(t.x, t.y);
      out.push(...textRings(t.role === "ref" ? fp.ref : t.role === "value" ? (fp.value ?? t.text) : t.text, { x, y, height: t.height, rotation: fp.rotation + (fp.side === "bottom" ? -(t.rotation ?? 0) : t.rotation ?? 0), anchor: t.anchor ?? "center", mirrored: fp.side === "bottom" }, t.stroke_width ?? 150_000));
    }
  }
  const id = (x: number, y: number): [number, number] => [x, y];
  for (const g of recordsOfKind(doc, "graphic")) if (g.layer === layer && pick("board", g.id)) graphic(g, id);
  for (const t of recordsOfKind(doc, "text")) if (t.layer === layer && pick("board", t.id)) out.push(...textRings(t.text, { x: t.x, y: t.y, height: t.height, rotation: t.rotation ?? 0, anchor: t.anchor ?? "center", mirrored: !!t.mirrored }, t.stroke_width ?? 150_000));
  return out;
}

function countBy(fs: { check: string }[]): string {
  const c: Record<string, number> = {};
  for (const f of fs) c[f.check] = (c[f.check] ?? 0) + 1;
  return Object.entries(c).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
}

function areaOf(ps: Polygon[]): number {
  return ps.reduce((s, p) => s + polygonArea(p), 0);
}

async function compareReference(actual: BoardDocument): Promise<void> {
  const label = "reference board";
  const style: ResolvedStyle = resolveStyle(actual, { userDir: false });
  // the bare copy: the board without its own board-level silkscreen, footprints untouched
  const silkIds = [...recordsOfKind(actual, "graphic"), ...recordsOfKind(actual, "text")].filter((r) => r.layer.endsWith("_silkscreen")).map((r) => r.id);
  const { withChanges } = await import("@protoboardai/board");
  const bare = withChanges(actual, [], silkIds);
  const t0 = performance.now();
  const refOpts = { nameplate: { rev: arg("--rev") ?? "1", ...(arg("--name") ? { name: arg("--name")! } : {}) } };
  const plan = planRestyle(bare, style, refOpts);
  const ms = Math.round(performance.now() - t0);
  const gen = plan.doc;
  say(`${label}: ${recordsOfKind(actual, "footprint").length} parts, ${silkIds.length} board-level silkscreen records; the theme's tools ran in ${ms} ms${plan.failed ? ` (failed at ${plan.failed.tool})` : ""}`);
  for (const s of plan.steps) say(`  ${s.tool}: +${s.report.added} records; skipped ${s.report.skipped.length}${s.report.skipped.length ? ` (${[...new Set(s.report.skipped.map((k) => k.reason.replace(/\d+(\.\d+)?/g, "N")))].slice(0, 3).join("; ")})` : ""}`);
  const near = 300_000;
  for (const side of ["top", "bottom"] as const) {
    const a = union(silkRings(actual, side, (k, id) => k === "board" && silkIds.includes(id)));
    const g = union(silkRings(gen, side, (k, id) => k === "board" && madeBy(gen.records.get(id)!)));
    const aA = areaOf(a);
    const gA = areaOf(g);
    const recall = aA ? areaOf(intersection(ringsOf(a), ringsOf(grow(g, near, 20_000)))) / aA : 1;
    const precision = gA ? areaOf(intersection(ringsOf(g), ringsOf(grow(a, near, 20_000)))) / gA : 1;
    say(`  ${side}: board-level silk ink ${(aA / 1e12).toFixed(1)} mm2 on the board, ${(gA / 1e12).toFixed(1)} mm2 drawn by the tools; within ${near / 1e6} mm, the tools cover ${Math.round(recall * 100)} percent of the board's ink and ${Math.round(precision * 100)} percent of the tools' ink lies on the board's`);
    writeFileSync(join(OUT, `reference-actual-${side}.png`), renderPng(actual, style, { side, width: 1200, caption: `${label}, as made, ${side}` }));
    writeFileSync(join(OUT, `reference-tools-${side}.png`), renderPng(gen, style, { side, width: 1200, caption: `${label}, drawn by the theme's tools, ${side}` }));
  }
  // designators: the board's visible references against the policy's
  const refs = new Set(recordsOfKind(actual, "footprint").map((f) => f.ref.toUpperCase()));
  const visibleActual = new Set<string>();
  for (const f of recordsOfKind(actual, "footprint")) if (f.texts?.some((t) => t.role === "ref" && sideLayer(t.layer, f.side).endsWith("_silkscreen"))) visibleActual.add(f.ref.toUpperCase());
  for (const t of recordsOfKind(actual, "text")) if (t.layer.endsWith("_silkscreen") && refs.has(t.text.toUpperCase())) visibleActual.add(t.text.toUpperCase());
  const shownGen = new Set(((plan.steps.find((s) => s.tool === "designators")?.report.shown as { ref: string }[]) ?? []).map((s) => s.ref.toUpperCase()));
  const both = [...shownGen].filter((r) => visibleActual.has(r)).length;
  say(`  designators: the board shows ${visibleActual.size} of ${refs.size}; the policy shows ${shownGen.size}; ${both} in both`);
  const check = checkStyle(gen, style, refOpts);
  say(`  style check on the tools' result: ${check.summary.line}; by check: ${countBy([...check.findings, ...check.guards].filter((f) => f.severity !== "info"))}`);
  const checkActual = checkStyle(actual, style, refOpts);
  say(`  style check on the board as made: ${checkActual.summary.line}; by check: ${countBy([...checkActual.findings, ...checkActual.guards].filter((f) => f.severity !== "info"))}`);
  const kinds = (d: BoardDocument, ids: string[]) => {
    const c: Record<string, number> = {};
    for (const id of ids) {
      const r = d.records.get(id)!;
      const k = r.kind === "text" ? "text" : r.kind === "graphic" ? `${r.shape}${r.filled ? " filled" : ""}` : r.kind;
      c[k] = (c[k] ?? 0) + 1;
    }
    return Object.entries(c).sort().map(([k, n]) => `${k} ${n}`).join(", ");
  };
  say(`  the board's own board-level silk by kind: ${kinds(actual, silkIds)}`);
  const genIds = [...recordsOfKind(gen, "graphic"), ...recordsOfKind(gen, "text")].filter((r) => madeBy(r)).map((r) => r.id);
  say(`  the tools' silk by kind: ${kinds(gen, genIds)}`);
}
