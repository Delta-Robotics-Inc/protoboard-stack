/**
 * Guard rails on fab and electrical tokens, and the fab floors under cosmetic ones.
 *
 * Token guards read only token values and the fab profile: a mask color the fab does not offer, black silk on a
 * mask other than white, full-color silk without its conditions, a finish not offered and its cost class. Floors
 * clamp printable sizes (text height and stroke, silk lines) to the fab's minimums: the token keeps its value, the
 * resolved style says the effective value and why.
 *
 * Board guards read the board too: the mask web between neighboring pads for the side's mask color, leadless parts
 * on a finish that is not flat, vias in pads that are not filled.
 */
import { copperLayers, padsOf, recordsOfKind, type BoardDocument, type FootprintRec, type WorldPad } from "@protoboardai/board";
import { padShape, shapeGap } from "@protoboardai/board-checks";
import { fabProfile, type FabProfile } from "./fab.js";
import { TOKENS, type TextClass, type TokenValue } from "./tokens.js";

export interface GuardResult {
  /** The guard's name: `mask_color`, `mask_web`, `text_floor`, ... */
  guard: string;
  token: string;
  severity: "error" | "warning" | "info";
  message: string;
  /** mm, for measured guards. */
  measured?: number;
  required?: number;
  objects?: string[];
  location?: { x: number; y: number; layer?: string };
}

export interface Clamp {
  from: TokenValue;
  to: TokenValue;
  reason: string;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Token-level guards: results and the clamps to apply to effective values. */
export function tokenGuards(values: Record<string, TokenValue>, o: { copperLayers?: number } = {}): { results: GuardResult[]; clamps: Record<string, Clamp> } {
  const fab = fabProfile(values["fab.profile"] as string);
  const results: GuardResult[] = [];
  const clamps: Record<string, Clamp> = {};
  const ev = (e: string) => (e === "verified" ? "" : ` (${e})`);
  for (const side of ["top", "bottom"] as const) {
    const mask = values[`fab.mask.color.${side}`] as string;
    if (!fab.maskColors.value.includes(mask)) results.push({ guard: "mask_color", token: `fab.mask.color.${side}`, severity: "error", message: `${fab.name} does not offer a ${mask} mask (offers ${fab.maskColors.value.join(", ")}; ${fab.maskColors.source})` });
    const silk = values[`fab.silk.color.${side}`] as string;
    if (silk === "black" && fab.blackSilkNeedsWhiteMask.value && mask !== "white") results.push({ guard: "silk_color", token: `fab.silk.color.${side}`, severity: "warning", message: `black silkscreen is made on a white mask only${ev(fab.blackSilkNeedsWhiteMask.evidence)}; the ${side} mask is ${mask}` });
    if (silk === "fullColor") {
      const fc = fab.fullColor;
      if (!fc) results.push({ guard: "silk_color", token: `fab.silk.color.${side}`, severity: "error", message: `${fab.name} offers no full-color silkscreen` });
      else {
        const why: string[] = [];
        if (mask !== fc.maskColor) why.push(`a ${fc.maskColor} mask (${side} is ${mask})`);
        if (values["fab.finish"] !== fc.finish) why.push(`${fc.finish} (finish is ${String(values["fab.finish"])})`);
        if (o.copperLayers !== undefined && (o.copperLayers < fc.minLayers || o.copperLayers > fc.maxLayers)) why.push(`${fc.minLayers} to ${fc.maxLayers} copper layers (board has ${o.copperLayers})`);
        if (why.length) results.push({ guard: "silk_color", token: `fab.silk.color.${side}`, severity: "error", message: `full-color silkscreen needs ${why.join(", ")} (${fc.source})` });
        results.push({ guard: "silk_color", token: `fab.silk.color.${side}`, severity: "info", message: `full-color silkscreen is exported only through ${fc.export}` });
      }
    }
  }
  const finish = values["fab.finish"] as string;
  if (!fab.finishes.value.includes(finish)) results.push({ guard: "finish", token: "fab.finish", severity: "error", message: `${fab.name} does not offer ${finish} (offers ${fab.finishes.value.join(", ")})` });
  else {
    const c = fab.finishCost[finish];
    if (c && c.cost !== "base") results.push({ guard: "finish_cost", token: "fab.finish", severity: "info", message: `${finish} at ${fab.name}: cost class ${c.cost}${c.note ? `, ${c.note}` : ""}` });
  }
  // printable floors
  const minLine = fab.silk.minLine.value;
  const minH = fab.silk.minTextHeight.value;
  const ratio = fab.silk.strokeRatio.value;
  const thin: string[] = [];
  for (const t of TOKENS) {
    if (t.type.kind !== "textClass") continue;
    const v = values[t.path] as TextClass;
    const next = { ...v };
    const why: string[] = [];
    if (v.height < minH) {
      next.height = minH;
      why.push(`height ${v.height} mm is under ${fab.name}'s ${minH} mm text floor${ev(fab.silk.minTextHeight.evidence)}`);
    }
    if (v.stroke < minLine - 1e-9) {
      next.stroke = minLine;
      why.push(`stroke ${v.stroke} mm is under ${fab.name}'s ${minLine} mm line floor${ev(fab.silk.minLine.evidence)}`);
    }
    if (next.stroke < r3(next.height * ratio) - 1e-9) thin.push(`${t.path.slice("type.class.".length)} ${next.height} x ${next.stroke} mm`);
    if (why.length) {
      clamps[t.path] = { from: v, to: next, reason: why.join("; ") };
      results.push({ guard: "text_floor", token: t.path, severity: "info", message: `${why.join("; ")}: kept at ${next.height} x ${next.stroke} mm` });
    }
  }
  if (thin.length) results.push({ guard: "stroke_ratio", token: "type.class.designator", severity: "info", message: `${fab.name} asks for a stroke of at least 1/${Math.round(1 / ratio)} of the text height${ev(fab.silk.strokeRatio.evidence)}; thinner: ${thin.join(", ")} (legible at the floor, a little faint)` });
  for (const path of ["silk.line", "hazard.stripe"]) {
    const v = values[path] as number;
    if (v < minLine) {
      clamps[path] = { from: v, to: minLine, reason: `under ${fab.name}'s ${minLine} mm silk line floor` };
      results.push({ guard: "line_floor", token: path, severity: "info", message: `${v} mm is under ${fab.name}'s ${minLine} mm silk line floor: kept at ${minLine} mm` });
    }
  }
  const padClr = fab.silk.padClearance.value;
  if ((values["silk.clearance.pad"] as number) < padClr) {
    clamps["silk.clearance.pad"] = { from: values["silk.clearance.pad"], to: padClr, reason: `under ${fab.name}'s ${padClr} mm pad to silk clearance` };
    results.push({ guard: "pad_clearance_floor", token: "silk.clearance.pad", severity: "info", message: `${String(values["silk.clearance.pad"])} mm is under ${fab.name}'s ${padClr} mm pad to silk clearance: kept at ${padClr} mm` });
  }
  return { results, clamps };
}

const LEADLESS = /(^|[^A-Za-z])(DFN|QFN|LGA|BGA|WLCSP|SON|LLP)/i;

/** Board-level guards: mask web between pads, leadless parts and the finish, vias in pads and their covering. */
export function boardGuards(doc: BoardDocument, values: Record<string, TokenValue>): GuardResult[] {
  const fab: FabProfile = fabProfile(values["fab.profile"] as string);
  const out: GuardResult[] = [];
  const oz = values["fab.copperWeight"] as number;
  const exp = values["fab.mask.expansion"] as number;
  const layers = copperLayers(doc);
  const fps = recordsOfKind(doc, "footprint");
  for (const side of ["top", "bottom"] as const) {
    const color = values[`fab.mask.color.${side}`] as string;
    const web = fab.maskWeb(color, oz);
    for (const fp of fps) {
      const pads = padsOf(fp, layers).filter((p) => p.layers.includes(side));
      if (pads.length < 2) continue;
      const shapes = pads.map((p) => padShape(fp, p));
      let worst: { gap: number; a: WorldPad; b: WorldPad } | undefined;
      for (let i = 0; i < pads.length; i++)
        for (let j = i + 1; j < pads.length; j++) {
          const g = shapeGap(shapes[i], shapes[j], (2 * exp + web.value) * 1e6 + 1);
          if (!Number.isFinite(g)) continue;
          if (g === 0) continue; // pads that touch are one opening by design
          const margin = (p: WorldPad) => (p.pad.mask_margin !== undefined ? p.pad.mask_margin / 1e6 : exp);
          const webMm = g / 1e6 - margin(pads[i]) - margin(pads[j]);
          if (webMm < web.value - 1e-6 && (!worst || webMm < worst.gap)) worst = { gap: webMm, a: pads[i], b: pads[j] };
        }
      if (worst) {
        const m = Math.max(0, r3(worst.gap));
        out.push({
          guard: "mask_web",
          token: `fab.mask.color.${side}`,
          severity: "error",
          message: `${fp.ref}: the mask web between pads ${worst.a.key} and ${worst.b.key} is ${m} mm, under ${fab.name}'s ${web.value} mm for a ${color} mask (${web.source}${web.evidence === "verified" ? "" : `, ${web.evidence}`}); the fab will open them as one`,
          measured: m,
          required: web.value,
          objects: [worst.a.id, worst.b.id].sort(),
          location: { x: Math.round((worst.a.x + worst.b.x) / 2), y: Math.round((worst.a.y + worst.b.y) / 2), layer: side },
        });
      }
    }
  }
  const finish = values["fab.finish"] as string;
  if (finish !== "ENIG" && finish !== "ENEPIG") {
    const leadless = fps.filter((f: FootprintRec) => LEADLESS.test(f.footprint));
    if (leadless.length)
      out.push({ guard: "finish_flatness", token: "fab.finish", severity: "warning", message: `${leadless.map((f) => f.ref).join(", ")} ${leadless.length === 1 ? "is a leadless part" : "are leadless parts"}: a flat finish (ENIG) solders them more reliably than ${finish}`, objects: leadless.map((f) => f.id).sort() });
  }
  if (values["copperArt.enabled"] === true && finish !== "ENIG") out.push({ guard: "copper_art", token: "copperArt.enabled", severity: "info", message: `copper art reads gold only with ENIG (finish is ${finish})` });
  if (values["fab.viaCovering"] !== "filled") {
    const vias = recordsOfKind(doc, "via");
    const inPad: string[] = [];
    for (const fp of fps)
      for (const p of padsOf(fp, layers))
        for (const v of vias) if (v.x >= p.box.minX && v.x <= p.box.maxX && v.y >= p.box.minY && v.y <= p.box.maxY && p.pad.type === "smd") inPad.push(v.id);
    if (inPad.length) out.push({ guard: "via_in_pad", token: "fab.viaCovering", severity: "warning", message: `${inPad.length} via(s) sit in pads; a via in a pad needs filled vias (covering is ${String(values["fab.viaCovering"])})`, objects: [...new Set(inPad)].sort() });
  }
  return out;
}
