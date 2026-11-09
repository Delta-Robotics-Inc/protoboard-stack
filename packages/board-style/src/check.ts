/**
 * The style check: how far a board has drifted from its resolved theme, as findings in the board core's `Finding`
 * shape. Style findings (check ids `style.*`) are warnings and information only and never block. Fab guard rails
 * (check ids `style.fab.*`) are separate: they are errors where they are real fab limits (text under the fab's floor,
 * a mask web the fab cannot hold, a color or finish the fab does not offer) and warnings or information otherwise.
 *
 * What is measured:
 * - drift per drawing tool: re-running the tool would add, edit or remove records (frames, hazard zones, nameplate,
 *   marks, edge ring, designators all follow the theme), with counts;
 * - frames: every group the theme frames has a frame on each side;
 * - designators: every designator the policy shows is visible on the silkscreen;
 * - silkscreen on pads: board silk (style's or hand-drawn) over pads is a warning; a library footprint's own silk
 *   over its pads is information (fabs clip it; fix it in the footprint);
 * - text sizes: silk text under the fab floor is a fab error; designators off their class size are warnings;
 * - copper: odd-angle segments beyond `copper.oddAngle.maxShare`, widths off the ladder (information);
 * - the board's fab record (mask, silk, finish, given by the caller) against the theme.
 */
import { findingId, FindingSchema, recordsOfKind, sideLayer, toMm, type BoardDocument, type Finding } from "@protoboardai/board";
import { runBoardChecks } from "@protoboardai/board-checks";
import { HIDDEN_MARK, madeBy, RESTYLE_ORDER, type StyleTool } from "./changeset.js";
import type { GuardResult } from "./guards.js";
import { tok, tokNum, tokText, type ResolvedStyle } from "./resolve.js";
import { runStyleTool, type RestyleOptions } from "./restyle.js";
import { courtyardRing, groupsOf, ringBox } from "./tools/common.js";
import { wantedDesignators } from "./tools/designators.js";

export interface FabRecord {
  maskTop?: string;
  maskBottom?: string;
  silkTop?: string;
  silkBottom?: string;
  finish?: string;
}

export interface StyleCheckOptions extends RestyleOptions {
  /** The board's fab settings as ordered or exported (the board record has no fields for them yet). */
  fab?: FabRecord;
}

export type StyleCategory = "silk" | "frames" | "designators" | "text" | "copper" | "fab" | "marks";

export interface StyleCheckResult {
  /** Style drift: warnings and information, never errors, never blocking. */
  findings: Finding[];
  /** Fab guard rails: errors where they are real fab limits. */
  guards: Finding[];
  /** Counts per category and severity, and a drift score per category (0 is on theme). */
  summary: { categories: Record<StyleCategory, { warnings: number; infos: number; errors: number }>; drift: Record<StyleCategory, number>; line: string };
  /** No guard errors, and no style warnings in the categories the style tools own (everything but copper). */
  clean: boolean;
  theme: string;
}

const CATEGORY: Record<string, StyleCategory> = {
  "style.drift.frames": "frames",
  "style.frame_missing": "frames",
  "style.frame_title": "frames",
  "style.drift.designators": "designators",
  "style.designator_hidden": "designators",
  "style.drift.hazard": "silk",
  "style.drift.nameplate": "silk",
  "style.drift.edgeText": "silk",
  "style.drift.marks": "marks",
  "style.silk_on_pad": "silk",
  "style.library_silk_on_pad": "silk",
  "style.text_size": "text",
  "style.odd_angle": "copper",
  "style.width_ladder": "copper",
  "style.fab_record": "fab",
};

function finding(check: string, severity: Finding["severity"], objects: string[], location: { x: number; y: number; layer?: string }, message: string, extra: Partial<Finding> = {}): Finding {
  const loc = { x: Math.round(location.x), y: Math.round(location.y), ...(location.layer ? { layer: location.layer } : {}) };
  const objs = [...new Set(objects)].sort().slice(0, 1000);
  return FindingSchema.parse({ id: findingId(check, extra.rule, objs, loc), check, severity, objects: objs, location: loc, message: message.slice(0, 500), ...extra });
}

/** The style check of a board against its resolved style. */
export function checkStyle(doc: BoardDocument, style: ResolvedStyle, o: StyleCheckOptions = {}): StyleCheckResult {
  const out: Finding[] = [];
  const center = { x: 0, y: 0 };
  // ---------------------------------------------------------------- drift per drawing tool
  for (const tool of RESTYLE_ORDER as StyleTool[]) {
    const cs = runStyleTool(tool, doc, style, o);
    if (cs.empty) continue;
    const r = cs.report;
    const parts = [r.added && `${r.added} to add`, r.edited && `${r.edited} to change`, r.removed && `${r.removed} to remove`, cs.hostOps.length && "footprint texts to move"].filter(Boolean).join(", ");
    out.push(finding(`style.drift.${tool}`, "warning", [], center, `${tool} differ from the ${style.theme.name} theme: ${parts}; run the ${tool} tool to bring them back`, { tier: "policy" }));
  }
  // ---------------------------------------------------------------- frames
  if (tok<string>(style, "frame.style") !== "none") {
    const minParts = tokNum(style, "frame.minParts");
    const sides = tok<string>(style, "frame.sides") === "both" ? (["top", "bottom"] as const) : ([tok<string>(style, "frame.sides")] as ("top" | "bottom")[]);
    const frames = recordsOfKind(doc, "graphic").filter((g) => madeBy(g, "frames") && !g.filled);
    for (const g of groupsOf(doc, tokNum(style, "frame.groupDepth"))) {
      for (const side of sides) {
        const ms = g.members.filter((m) => m.side === side);
        if (ms.length < minParts) continue;
        const layer = side === "top" ? "top_silkscreen" : "bottom_silkscreen";
        const b = ms.map((m) => ringBox(courtyardRing(m))).reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) }));
        const g2 = 2e6;
        const near = frames.some((f) => f.layer === layer && f.points?.some((p) => p.x >= b.minX - g2 && p.x <= b.maxX + g2 && p.y >= b.minY - g2 && p.y <= b.maxY + g2));
        if (!near) out.push(finding("style.frame_missing", "warning", ms.map((m) => m.id), { x: ms[0].x, y: ms[0].y, layer }, `group ${g.key} has ${ms.length} parts on the ${side} and no ${tok<string>(style, "frame.style")} frame`, { tier: "policy" }));
      }
    }
  }
  // ---------------------------------------------------------------- designators
  const { shown } = wantedDesignators(doc, style, o.designators ?? {});
  const boardRefs = new Set(recordsOfKind(doc, "text").filter((t) => t.layer.endsWith("_silkscreen")).map((t) => t.text.toUpperCase()));
  const desCls = tokText(style, "type.class.designator");
  for (const fp of shown) {
    const own = fp.texts?.some((t) => t.role === "ref" && sideLayer(t.layer, fp.side).endsWith("_silkscreen") && t.text !== HIDDEN_MARK);
    if (!own && !boardRefs.has(fp.ref.toUpperCase())) out.push(finding("style.designator_hidden", "warning", [fp.id], { x: fp.x, y: fp.y }, `${fp.ref}: the ${tok<string>(style, "designator.policy")} policy shows it, and no designator is on the silkscreen (no room was found, or it was hidden)`, { tier: "policy" }));
  }
  // ---------------------------------------------------------------- text sizes and floors
  const floorH = style.derived.textFloor.height * 1e6;
  const floorS = style.derived.textFloor.stroke * 1e6;
  const guards: Finding[] = [];
  const refs = new Set(recordsOfKind(doc, "footprint").map((f) => f.ref.toUpperCase()));
  for (const t of recordsOfKind(doc, "text")) {
    if (!t.layer.endsWith("_silkscreen")) continue;
    const stroke = t.stroke_width ?? 0;
    if (t.height < floorH - 1 || (stroke && stroke < floorS - 1))
      guards.push(finding("style.fab.text_floor", "error", [t.id], { x: t.x, y: t.y, layer: t.layer }, `${t.id}: ${toMm(t.height)} mm text with a ${toMm(stroke)} mm stroke is under ${style.fab.name}'s ${style.derived.textFloor.height} mm and ${style.derived.textFloor.stroke} mm floor`, { tier: "floor", measured: t.height, required: floorH }));
    else if (refs.has(t.text.toUpperCase()) && Math.abs(t.height - desCls.height * 1e6) > 0.01 * desCls.height * 1e6)
      out.push(finding("style.text_size", "warning", [t.id], { x: t.x, y: t.y, layer: t.layer }, `designator ${t.text} is ${toMm(t.height)} mm; the theme's designators are ${desCls.height} mm`, { tier: "policy", measured: t.height, required: Math.round(desCls.height * 1e6) }));
  }
  for (const fp of recordsOfKind(doc, "footprint"))
    for (const t of fp.texts ?? []) {
      const layer = sideLayer(t.layer, fp.side);
      if (!layer.endsWith("_silkscreen")) continue;
      if (t.height < floorH - 1 || (t.stroke_width !== undefined && t.stroke_width < floorS - 1))
        guards.push(finding("style.fab.text_floor", "error", [fp.id], { x: fp.x, y: fp.y, layer }, `${fp.ref}: its ${t.role ?? "user"} text is ${toMm(t.height)} mm with a ${toMm(t.stroke_width ?? 0)} mm stroke, under ${style.fab.name}'s ${style.derived.textFloor.height} mm and ${style.derived.textFloor.stroke} mm floor`, { tier: "floor", measured: t.height, required: floorH }));
    }
  // ---------------------------------------------------------------- silkscreen on pads (board-checks' measurement)
  const bc = runBoardChecks(doc);
  for (const f of bc.findings) {
    if (f.check !== "silk_to_pad") continue;
    const silkId = f.objects.find((x) => !x.startsWith("pad:"));
    const rec = silkId ? doc.records.get(silkId) : undefined;
    const library = rec?.kind === "footprint";
    out.push(finding(library ? "style.library_silk_on_pad" : "style.silk_on_pad", library ? "info" : "warning", f.objects, f.location, library ? `library footprint silkscreen over its pads (fabs clip it; fix the footprint): ${f.message}` : f.message, { tier: "policy", ...(f.measured !== undefined ? { measured: f.measured } : {}), ...(f.required !== undefined ? { required: f.required } : {}) }));
  }
  // ---------------------------------------------------------------- copper
  const angle = tok<string>(style, "copper.angle");
  const minLen = tokNum(style, "copper.oddAngle.minLength") * 1e6;
  if (angle !== "any") {
    const step = angle === "45" ? 45 : 90;
    const odd: string[] = [];
    let counted = 0;
    for (const t of recordsOfKind(doc, "track")) {
      if (t.sweep) continue;
      const len = Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y);
      if (len < minLen) continue;
      counted++;
      const a = (Math.atan2(t.end.y - t.start.y, t.end.x - t.start.x) * 180) / Math.PI;
      const off = Math.abs(a / step - Math.round(a / step)) * step;
      if (off > 0.5) odd.push(t.id);
    }
    const share = counted ? odd.length / counted : 0;
    if (share > tokNum(style, "copper.oddAngle.maxShare"))
      out.push(finding("style.odd_angle", "warning", odd, center, `${odd.length} of ${counted} track segments (${Math.round(share * 100)} percent) are off the ${angle} degree grid, over the theme's ${Math.round(tokNum(style, "copper.oddAngle.maxShare") * 100)} percent; copper is electrical: the style tools never change it`, { tier: "policy" }));
  }
  const ladder = tok<number[]>(style, "copper.widthLadder");
  if (ladder.length) {
    const off = recordsOfKind(doc, "track").filter((t) => !ladder.some((w) => Math.abs(w * 1e6 - t.width) <= 1000));
    if (off.length) out.push(finding("style.width_ladder", "info", off.map((t) => t.id), center, `${off.length} track(s) use widths off the theme's ladder (${ladder.join(", ")} mm): ${[...new Set(off.map((t) => toMm(t.width)))].sort((a, b) => a - b).join(", ")} mm`, { tier: "policy" }));
  }
  // ---------------------------------------------------------------- the fab record
  if (o.fab) {
    const pairs: [string, string | undefined, string][] = [
      ["mask, top", o.fab.maskTop, tok<string>(style, "fab.mask.color.top")],
      ["mask, bottom", o.fab.maskBottom, tok<string>(style, "fab.mask.color.bottom")],
      ["silkscreen, top", o.fab.silkTop, tok<string>(style, "fab.silk.color.top")],
      ["silkscreen, bottom", o.fab.silkBottom, tok<string>(style, "fab.silk.color.bottom")],
      ["finish", o.fab.finish, tok<string>(style, "fab.finish")],
    ];
    for (const [what, have, want] of pairs) if (have !== undefined && have.toLowerCase() !== want.toLowerCase()) out.push(finding("style.fab_record", "warning", [], center, `the board's ${what} is ${have}; the theme says ${want}`, { tier: "policy" }));
  } else out.push(finding("style.fab_record", "info", [], center, "the board record carries no mask, silkscreen or finish (the core has no fields for them yet); the theme's values apply at export", { tier: "policy" }));
  // ---------------------------------------------------------------- guard rails as findings
  for (const g of style.guards) guards.push(guardFinding(g));
  const sev = { error: 0, warning: 1, info: 2 } as const;
  const sort = (a: Finding, b: Finding) => sev[a.severity] - sev[b.severity] || (a.id < b.id ? -1 : 1);
  const findings = dedupe(out).sort(sort);
  const gs = dedupe(guards).sort(sort);
  const cats = ["silk", "frames", "designators", "text", "copper", "fab", "marks"] as StyleCategory[];
  const categories = Object.fromEntries(cats.map((c) => [c, { warnings: 0, infos: 0, errors: 0 }])) as StyleCheckResult["summary"]["categories"];
  for (const f of findings) {
    const c = categories[CATEGORY[f.check] ?? "silk"];
    if (f.severity === "warning") c.warnings++;
    else c.infos++;
  }
  for (const g of gs) {
    const c = categories.fab;
    if (g.severity === "error") c.errors++;
    else if (g.severity === "warning") c.warnings++;
    else c.infos++;
  }
  const drift = Object.fromEntries(cats.map((c) => [c, categories[c].errors * 3 + categories[c].warnings])) as Record<StyleCategory, number>;
  const owned = findings.filter((f) => f.severity === "warning" && CATEGORY[f.check] !== "copper");
  const clean = !gs.some((g) => g.severity === "error") && !owned.length;
  const errs = gs.filter((g) => g.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warning").length;
  const line = `style ${style.theme.name}: ${warns} drift warning${warns === 1 ? "" : "s"}${categories.copper.warnings ? ` (${categories.copper.warnings} copper)` : ""}, ${errs} fab error${errs === 1 ? "" : "s"}, ${gs.filter((g) => g.severity === "warning").length} fab warning(s)${clean ? "; clean" : ""}`;
  return { findings, guards: gs, summary: { categories, drift, line }, clean, theme: style.theme.id };
}

function guardFinding(g: GuardResult): Finding {
  const tier = g.severity === "error" ? "floor" : "policy";
  return finding(`style.fab.${g.guard}`, g.severity, g.objects ?? [], g.location ?? { x: 0, y: 0 }, `${g.token}: ${g.message}`, { tier, rule: g.token, ...(g.measured !== undefined ? { measured: Math.round(g.measured * 1e6) } : {}), ...(g.required !== undefined ? { required: Math.round(g.required * 1e6) } : {}) });
}

function dedupe(fs: Finding[]): Finding[] {
  const m = new Map<string, Finding>();
  for (const f of fs) if (!m.has(f.id)) m.set(f.id, f);
  return [...m.values()];
}
