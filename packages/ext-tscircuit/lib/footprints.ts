/**
 * The provider's package → land-pattern table (tool-integrations.md §4).
 *
 * UHD parts state their package as the manufacturer prints it ("QFN-56",
 * pitch 0.4 mm, 7 × 7 mm, exposed pad 57). Which copper pattern fits that
 * package is this provider's knowledge, kept here and never written into a
 * part. Two kinds of entry:
 *
 *   footprinter  a tscircuit built-in footprint string ("0402", "jst4_p1mm_sh"),
 *                generated locally by @tscircuit/footprinter (MIT)
 *   pads         a land pattern authored here from the manufacturer's
 *                recommended land pattern, with the drawing cited
 *
 * A project overrides or extends the table with
 * `src/boards/<module>/tscircuit/footprints.json` ({ packages: [...],
 * instances: { <instance>: entry } }). KiCad footprint libraries are not
 * bundled: they are CC-BY-SA 4.0 (see README, "Licensing").
 */
import { fp } from "@tscircuit/footprinter";
import type { Dim, FootprintEntry, LandPad, LandVerification } from "./land-geometry.ts";
import { FOOTPRINTS } from "./land-patterns.ts";

export * from "./land-geometry.ts";
export { FOOTPRINTS } from "./land-patterns.ts";

/** Table overrides from the project: `tscircuit/footprints.json`. */
export interface FootprintOverrides {
  packages?: FootprintEntry[];
  instances?: Record<string, FootprintEntry>;
}

/** Package names compared without case, spaces, underscores or dashes; `×` reads as `x` ("3 × 3" = "3x3"). */
const norm = (s: string) => s.toLowerCase().replace(/×/g, "x").replace(/[\s_\-–]/g, "");

export interface PackageFacts {
  name: string;
  pin_count: number;
  pitch_mm?: number;
  size_mm?: { length?: number; width?: number };
  /** The part's manufacturer, for entries one maker recommends for its own parts. */
  manufacturer?: string;
}

/** Chip-passive metric codes (the "1005" of "0402 (1005 metric)") to the imperial ones the table uses. */
const METRIC: Record<string, string> = { "0603": "0201", "1005": "0402", "1608": "0603", "2012": "0805", "3216": "1206", "3225": "1210", "5025": "2010", "6332": "2512" };

/**
 * A package name's family, for names that say the same package in different words: "SOT-23-5",
 * "SOT23-5" and "SOT23-5L" are `sot23-5`; "SOT23 leads (SMD)" with 3 pins is `sot23`; "0402 (1005
 * metric) chip" is `chip-0402`; "QFN-32-EP", "VQFN-32" and "WQFN32" are `qfn-32`; "VSSOP-10" and
 * "MSOP-10" are `msop-10`. Undefined for a name with no family (a module, a connector series):
 * those match by name only. The family says nothing of pitch or size, so an entry that states them
 * must still agree with the part's (fits).
 */
export function packageFamily(name: string, pinCount?: number): string | undefined {
  const n = name.toLowerCase().replace(/×/g, "x");
  const metric = /\b(\d{4})\s*metric\b/.exec(n) ?? /\(\s*(\d{4})\s*metric\s*\)/.exec(n);
  if (metric && METRIC[metric[1]]) return `chip-${METRIC[metric[1]]}`;
  const chip = /^(?:[a-z ]*\b)?(0201|0402|0603|0805|1206|1210|2010|2512)\b/.exec(n.trim());
  if (chip && !/sot|qfn|dfn|son|soic|ssop|lga|bga/.test(n)) return `chip-${chip[1]}`;
  const sot = /\b(t?sot)[\s-]?(23|223|323|353|363|563|89)(?:[\s-]?(\d{1,2})\s*l?\b)?/.exec(n);
  if (sot) {
    const pins = sot[3] ? Number(sot[3]) : pinCount;
    return `${sot[1]}${sot[2]}${pins && !(sot[2] === "23" && pins === 3) ? `-${pins}` : ""}`;
  }
  const sc70 = /\bsc[\s-]?70(?:[\s-]?(\d))?/.exec(n);
  if (sc70) return `sc70-${sc70[1] ?? pinCount ?? ""}`;
  const sod = /\bsod[\s-]?(\d{3})/.exec(n);
  if (sod) return `sod-${sod[1]}`;
  const flat = /\b(?:[vwux]|t)?(qfn|dfn|son|lga|bga)[\s-]?(\d+)/.exec(n);
  if (flat) return `${flat[1]}-${flat[2]}`;
  const small = /\b(soic|so|tssop|ssop|msop|vssop|umax|µmax)[\s-]?(\d+)/.exec(n);
  if (small) return `${{ so: "soic", vssop: "msop", umax: "msop", "µmax": "msop" }[small[1]] ?? small[1]}-${small[2]}`;
  return undefined;
}

/** Why an entry does not fit a part's package facts, or undefined when it fits; `by` says whether the name or the family matched. */
function misfit(e: FootprintEntry, pkg: PackageFacts): { by?: "name" | "family"; why?: string } {
  const named = norm(e.match.package) === norm(pkg.name);
  const family = !named && packageFamily(e.match.package, e.match.pin_count) !== undefined && packageFamily(e.match.package, e.match.pin_count) === packageFamily(pkg.name, pkg.pin_count);
  if (!named && !family) return {};
  const by = named ? ("name" as const) : ("family" as const);
  if (e.match.manufacturer !== undefined && !(pkg.manufacturer ?? "").toLowerCase().startsWith(e.match.manufacturer.toLowerCase())) return { by, why: "maker" };
  if (e.match.pin_count !== undefined && e.match.pin_count !== pkg.pin_count) return { by, why: `${e.match.pin_count} pins, the part ${pkg.pin_count}` };
  if (e.match.pitch_mm !== undefined && (pkg.pitch_mm === undefined || Math.abs(e.match.pitch_mm - pkg.pitch_mm) > 1e-6)) return { by, why: pkg.pitch_mm === undefined ? `pitch ${e.match.pitch_mm} mm, the part states none` : `pitch ${e.match.pitch_mm} mm, the part ${pkg.pitch_mm} mm` };
  if (e.match.size_mm) {
    const l = pkg.size_mm?.length;
    const w = pkg.size_mm?.width;
    if (l === undefined || w === undefined) return { by, why: `body ${e.match.size_mm.join(" × ")} mm, the part states no size` };
    const [a, b] = e.match.size_mm;
    const close = (p: number, q: number) => Math.abs(p - q) <= 0.15;
    if (!((close(a, l) && close(b, w)) || (close(a, w) && close(b, l)))) return { by, why: `body ${a} × ${b} mm, the part ${l} × ${w} mm` };
  }
  return { by };
}

const specificity = (e: FootprintEntry) => Object.keys(e.match).length;

export interface ResolvedFootprint {
  entry?: FootprintEntry;
  from?: "instance" | "project" | "provider";
  /** How a package entry matched: the package name (normalised), or only its family. */
  by?: "name" | "family";
  /** Entries of the same name or family that do not fit the part's facts, with why (when nothing fits). */
  near?: string[];
}

/**
 * The land pattern for one component: the project's instance override, then
 * the project's package entries, then the provider's table. A package entry
 * matches by the package name, else by the package family (packageFamily),
 * and then must agree with every fact it states (pin count, pitch, body size,
 * maker). Among those the most specific wins, a name match before a family
 * match. When none fits, `near` says which entries of that name or family
 * were refused and why, so a mismatch is reported instead of a guess.
 */
export function resolveFootprint(instance: string, pkg: PackageFacts | undefined, overrides: FootprintOverrides = {}): ResolvedFootprint {
  const inst = overrides.instances?.[instance];
  if (inst) return { entry: inst, from: "instance" };
  if (!pkg) return {};
  const near: string[] = [];
  const pick = (list: FootprintEntry[]) => {
    const ok: { e: FootprintEntry; by: "name" | "family" }[] = [];
    for (const e of list) {
      const m = misfit(e, pkg);
      if (!m.by) continue;
      if (m.why === undefined) ok.push({ e, by: m.by });
      else if (m.why !== "maker") near.push(`${e.id} (${m.by === "family" ? `family ${packageFamily(e.match.package, e.match.pin_count)}` : e.match.package}): ${m.why}`);
    }
    return ok.sort((a, b) => (a.by === b.by ? specificity(b.e) - specificity(a.e) : a.by === "name" ? -1 : 1))[0];
  };
  const project = pick(overrides.packages ?? []);
  if (project) return { entry: project.e, from: "project", by: project.by };
  const provider = pick(FOOTPRINTS);
  if (provider) return { entry: provider.e, from: "provider", by: provider.by };
  return near.length ? { near } : {};
}

const builtinCache = new Map<string, Set<string>>();

/** The pad numbers a built-in footprint string generates (each pad's numeric port hint), locally. */
export function builtinPads(footprinter: string): Set<string> {
  let pads = builtinCache.get(footprinter);
  if (!pads) {
    let cj: { type: string; port_hints?: string[] }[] = [];
    try {
      cj = fp.string(footprinter).circuitJson() as typeof cj;
    } catch {
      // an unknown string: no pads, so every pin is reported
    }
    pads = new Set(cj.filter((e) => e.type === "pcb_smtpad" || e.type === "pcb_plated_hole").flatMap((e) => (e.port_hints ?? []).filter((h) => /^\d+$/.test(h))));
    builtinCache.set(footprinter, pads);
  }
  return pads;
}

/** Problems with an entry from a project file (it is hand-written JSON). */
export function entryProblems(e: FootprintEntry): string[] {
  const out: string[] = [];
  if (!e || typeof e !== "object") return ["is not an object"];
  if (!e.footprinter === !e.pads) out.push("needs exactly one of footprinter or pads");
  if (typeof e.source !== "string" || !e.source) out.push("needs a source (where the land pattern comes from)");
  for (const p of e.pads ?? []) {
    if (typeof p.pin !== "string" || ![p.x, p.y, p.w, p.h].every((v) => typeof v === "number" && Number.isFinite(v)) || p.w <= 0 || p.h <= 0) {
      out.push(`pad ${JSON.stringify(p)} needs pin (string), x, y and positive w, h in mm`);
      break;
    }
    if (p.drill && !(p.drill.w > 0 && p.drill.h > 0 && p.drill.w < p.w && p.drill.h < p.h)) out.push(`pad ${JSON.stringify(p)}: drill needs positive w, h smaller than the pad`);
  }
  if (e.holes && e.footprinter) out.push("holes are for authored pads entries only");
  for (const h of e.holes ?? []) {
    if (![h.x, h.y, h.diameter_mm].every((v) => typeof v === "number" && Number.isFinite(v)) || h.diameter_mm <= 0) out.push(`hole ${JSON.stringify(h)} needs x, y and a positive diameter_mm`);
  }
  return out;
}

// ---- verification against the manufacturer's drawing

const TOL = 0.011;
const within = (v: number, d: Dim) => (Array.isArray(d) ? v >= d[0] - TOL && v <= d[1] + TOL : Math.abs(v - d) <= TOL);
const show = (d: Dim) => (Array.isArray(d) ? `${d[0]}–${d[1]}` : String(d));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Either way round: [w, h] matches [a, b] or [b, a]. */
const sizeFits = (w: number, h: number, [a, b]: [Dim, Dim]) => (within(w, a) && within(h, b)) || (within(w, b) && within(h, a));

/** Pads on one line: grouped by a shared y (a row along X) or a shared x (a column along Y), two or more pads each. */
function lines(pads: { x: number; y: number }[]): { axis: "x" | "y"; at: number; along: number[] }[] {
  const out: { axis: "x" | "y"; at: number; along: number[] }[] = [];
  for (const axis of ["x", "y"] as const) {
    const across = axis === "x" ? "y" : "x";
    const groups = new Map<number, number[]>();
    for (const p of pads) {
      const key = [...groups.keys()].find((k) => Math.abs(k - p[across]) < 0.002) ?? p[across];
      groups.set(key, [...(groups.get(key) ?? []), p[axis]]);
    }
    for (const [at, along] of groups) if (along.length >= 2) out.push({ axis, at, along: along.sort((a, b) => a - b) });
  }
  return out;
}

/**
 * Compare an entry with its verification record. Returns the problems; an
 * entry is verified when it has a record and this returns none. Built-in
 * (footprinter) entries cannot be verified: their copper is not stated here.
 */
export function verifyEntry(e: FootprintEntry): string[] {
  const v: LandVerification | undefined = e.verification;
  if (!v) return ["no verification record: not compared with the manufacturer's recommended land pattern"];
  const out: string[] = [];
  if (e.footprinter || !e.pads) return ["a built-in footprint string: its copper is not stated in the entry, so it cannot be compared with a drawing; author the pads"];
  if (!v.document || !v.figure || v.page === undefined || v.page === "" || !v.checked) out.push("the record needs the document, page, figure and the date it was checked");

  // pads by group
  const smd = e.pads.filter((p) => !p.drill);
  const grouped = new Map<string, number>();
  v.pads.forEach((g, i) => g.pins.forEach((pin) => grouped.set(pin, i)));
  for (const p of smd) if (!grouped.has(p.pin)) out.push(`pad ${p.pin || "(mechanical)"} at (${p.x}, ${p.y}) is in no group of the record`);
  for (const [i, g] of v.pads.entries()) {
    const pads = smd.filter((p) => g.pins.includes(p.pin));
    const label = `group ${i + 1} (${g.pins.slice(0, 4).join(", ")}${g.pins.length > 4 ? ", …" : ""})`;
    if (!pads.length) {
      out.push(`${label}: the entry has no such pads`);
      continue;
    }
    for (const pin of g.pins) if (pin && !pads.some((p) => p.pin === pin)) out.push(`${label}: no pad for pin ${pin}`);
    let centres: { x: number; y: number }[];
    if (g.merged) {
      const xs = pads.flatMap((p) => [p.x - p.w / 2, p.x + p.w / 2]);
      const ys = pads.flatMap((p) => [p.y - p.h / 2, p.y + p.h / 2]);
      const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      const area = pads.reduce((a, p) => a + p.w * p.h, 0);
      if (!sizeFits(w, h, g.size)) out.push(`${label}: merged land ${r3(w)} × ${r3(h)} mm, the drawing ${show(g.size[0])} × ${show(g.size[1])}`);
      if (Math.abs(area - w * h) > 1e-4) out.push(`${label}: the merged pads leave a gap or overlap (${r3(area)} of ${r3(w * h)} mm²)`);
      centres = [{ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 }];
    } else {
      for (const p of pads) if (!sizeFits(p.w, p.h, g.size)) out.push(`${label}: pad ${p.pin || "(mechanical)"} is ${p.w} × ${p.h} mm, the drawing ${show(g.size[0])} × ${show(g.size[1])}`);
      centres = pads;
    }
    const ls = lines(centres);
    if (g.pitch_mm !== undefined) {
      const steps = ls.flatMap((l) => l.along.slice(1).map((a, k) => a - l.along[k]));
      const min = steps.length ? Math.min(...steps) : undefined;
      if (min === undefined) out.push(`${label}: pitch ${show(g.pitch_mm)} stated but no two pads share a row`);
      else if (!within(min, g.pitch_mm)) out.push(`${label}: pitch ${r3(min)} mm, the drawing ${show(g.pitch_mm)}`);
    }
    if (g.row_mm !== undefined) {
      // opposite rows: a row is a line of pads side by side, each longer across the line than
      // along it (a row along X has pads taller than wide); every direction with two such rows
      // must be row_mm apart (a quad's rows both ways). Without rows (square pads, a chip's two
      // lands, merged lands) the centres' extent in X or in Y must be.
      const rowLines = g.merged ? [] : lines(pads).filter((l) => l.along.length >= 2 && pads.filter((p) => Math.abs((l.axis === "x" ? p.y : p.x) - l.at) < 0.002).every((p) => (l.axis === "x" ? p.h > p.w : p.w > p.h)));
      const spans = (["x", "y"] as const).map((axis) => rowLines.filter((l) => l.axis === axis).map((l) => l.at)).filter((at) => at.length >= 2).map((at) => Math.max(...at) - Math.min(...at));
      if (spans.length) {
        if (spans.some((sp) => !within(sp, g.row_mm!))) out.push(`${label}: rows ${spans.map(r3).join(" and ")} mm apart, the drawing ${show(g.row_mm)}`);
      } else {
        const ext = (["x", "y"] as const).map((k) => Math.max(...centres.map((c) => c[k])) - Math.min(...centres.map((c) => c[k])));
        if (!ext.some((sp) => within(sp, g.row_mm!))) out.push(`${label}: pad centres span ${ext.map(r3).join(" × ")} mm, the drawing's rows ${show(g.row_mm)} apart`);
      }
    }
  }

  // every pad centre the drawing dimensions
  if (v.centres) {
    const [ox, oy] = v.centres.origin;
    const want = v.centres.points.map(([x, y]) => [r3(x - ox), r3(y - oy)]);
    const have = smd.map((p) => [r3(p.x), r3(p.y)]);
    const missing = want.filter(([x, y]) => !have.some(([a, b]) => Math.abs(a - x) < TOL && Math.abs(b - y) < TOL));
    const extra = have.filter(([x, y]) => !want.some(([a, b]) => Math.abs(a - x) < TOL && Math.abs(b - y) < TOL));
    if (missing.length) out.push(`${missing.length} pad centre(s) of the drawing have no pad: ${missing.slice(0, 4).map((c) => `(${c.join(", ")})`).join(", ")}`);
    if (extra.length) out.push(`${extra.length} pad(s) are not at a centre the drawing gives: ${extra.slice(0, 4).map((c) => `(${c.join(", ")})`).join(", ")}`);
  }

  // slots and holes
  const plated = e.pads.filter((p) => p.drill);
  const slots = plated.filter((p) => Math.abs(p.drill!.w - p.drill!.h) > 1e-6);
  const rounds = plated.filter((p) => Math.abs(p.drill!.w - p.drill!.h) <= 1e-6);
  const slotWant = v.slots ?? [];
  const slotCount = slotWant.reduce((a, s) => a + s.count, 0);
  if (slots.length !== slotCount) out.push(`${slots.length} plated slot(s), the drawing ${slotCount}`);
  for (const p of slots) {
    if (!slotWant.some((s) => sizeFits(p.drill!.w, p.drill!.h, s.drill) && sizeFits(p.w, p.h, s.pad))) out.push(`slot at (${p.x}, ${p.y}): drill ${p.drill!.w} × ${p.drill!.h}, ring ${p.w} × ${p.h} mm match no slot of the drawing`);
  }
  const holesWant = v.holes ?? [];
  const pth = holesWant.filter((h) => h.plated);
  const npth = holesWant.filter((h) => !h.plated);
  const pthCount = pth.reduce((a, h) => a + h.count, 0);
  if (rounds.length !== pthCount) out.push(`${rounds.length} plated round hole(s), the drawing ${pthCount}`);
  for (const p of rounds) if (!pth.some((h) => within(p.drill!.w, h.diameter_mm) && (h.pad_mm === undefined || (within(p.w, h.pad_mm) && within(p.h, h.pad_mm))))) out.push(`plated hole at (${p.x}, ${p.y}): Ø${p.drill!.w} in a ${p.w} mm pad matches no hole of the drawing`);
  const npthCount = npth.reduce((a, h) => a + h.count, 0);
  if ((e.holes ?? []).length !== npthCount) out.push(`${(e.holes ?? []).length} non-plated hole(s), the drawing ${npthCount}`);
  for (const h of e.holes ?? []) if (!npth.some((n) => within(h.diameter_mm, n.diameter_mm))) out.push(`non-plated hole at (${h.x}, ${h.y}): Ø${h.diameter_mm} matches no hole of the drawing`);

  // where the drawing puts the slots and holes: each stated centre has one of that kind there
  const placed = (what: string, want: [number, number][] | undefined, count: number, have: { x: number; y: number }[]) => {
    if (!want) return;
    if (want.length !== count) out.push(`${what}: the record gives ${want.length} centre(s) for ${count}`);
    const missing = want.filter(([x, y]) => !have.some((h) => Math.abs(h.x - x) < TOL && Math.abs(h.y - y) < TOL));
    if (missing.length) out.push(`${what}: none at ${missing.slice(0, 4).map((c) => `(${c.map(r3).join(", ")})`).join(", ")}, where the drawing puts ${missing.length === 1 ? "one" : "them"}`);
  };
  for (const s of slotWant) placed(`slots ${s.drill.join(" × ")}`, s.at, s.count, slots.filter((p) => sizeFits(p.drill!.w, p.drill!.h, s.drill) && sizeFits(p.w, p.h, s.pad)));
  for (const h of pth) placed(`plated holes Ø${h.diameter_mm}`, h.at, h.count, rounds.filter((p) => within(p.drill!.w, h.diameter_mm)));
  for (const h of npth) placed(`non-plated holes Ø${h.diameter_mm}`, h.at, h.count, (e.holes ?? []).filter((x) => within(x.diameter_mm, h.diameter_mm)));

  // courtyard: the recorded size, and it holds every pad and hole
  if (!e.courtyard_mm) out.push("no courtyard_mm (the record states one)");
  else {
    if (!sizeFits(e.courtyard_mm[0], e.courtyard_mm[1], v.courtyard.size_mm) || !within(e.courtyard_mm[0], v.courtyard.size_mm[0])) out.push(`courtyard ${e.courtyard_mm.join(" × ")} mm, the record ${v.courtyard.size_mm.join(" × ")}`);
    const [cx, cy] = e.courtyard_at ?? [0, 0];
    const [hw, hh] = [e.courtyard_mm[0] / 2 + 1e-6, e.courtyard_mm[1] / 2 + 1e-6];
    const outside = [...e.pads.map((p) => ({ x: p.x, y: p.y, w: p.w / 2, h: p.h / 2 })), ...(e.holes ?? []).map((h) => ({ x: h.x, y: h.y, w: h.diameter_mm / 2, h: h.diameter_mm / 2 }))].filter((p) => Math.abs(p.x - cx) + p.w > hw || Math.abs(p.y - cy) + p.h > hh);
    if (outside.length) out.push(`${outside.length} pad(s) or hole(s) reach outside the courtyard`);
  }

  // stencil and mask: the entry applies what the record states
  const paste = e.paste ?? {};
  if (Math.abs((paste.margin_mm ?? 0) - v.paste.margin_mm) > 1e-6) out.push(`paste margin ${paste.margin_mm ?? 0} mm, the record ${v.paste.margin_mm}`);
  for (const [pin, w] of Object.entries(v.paste.windows ?? {})) {
    const spec = paste.pins?.[pin];
    const windows = spec && typeof spec === "object" && "windows" in spec ? spec.windows : undefined;
    if (!windows) {
      out.push(`pin ${pin}: the record gives ${w.count} paste window(s), the entry none`);
      continue;
    }
    if (windows.length !== w.count) out.push(`pin ${pin}: ${windows.length} paste window(s), the drawing ${w.count}`);
    for (const win of windows) if (!sizeFits(win.w, win.h, w.size)) out.push(`pin ${pin}: paste window ${win.w} × ${win.h} mm, the drawing ${w.size.join(" × ")}`);
    const pad = smd.find((p) => p.pin === pin);
    if (pad) {
      const outside = windows.filter((win) => Math.abs(win.x - pad.x) + win.w / 2 > pad.w / 2 + 1e-6 || Math.abs(win.y - pad.y) + win.h / 2 > pad.h / 2 + 1e-6);
      if (outside.length) out.push(`pin ${pin}: ${outside.length} paste window(s) reach outside the pad`);
      if (w.coverage !== undefined) {
        const cov = windows.reduce((a, win) => a + win.w * win.h, 0) / (pad.w * pad.h);
        if (!within(cov, Array.isArray(w.coverage) ? w.coverage : [w.coverage - 0.02, w.coverage + 0.02])) out.push(`pin ${pin}: paste covers ${Math.round(cov * 100)} % of the pad, the drawing ${show(w.coverage)}`);
      }
    }
  }
  for (const pin of v.paste.none ?? []) if (paste.pins?.[pin] !== "none") out.push(`pin ${pin}: the record prints no paste there, the entry does`);
  if (!!paste.plated !== !!v.paste.plated) out.push(`paste on plated holes: the entry ${paste.plated ? "prints" : "prints none"}, the record ${v.paste.plated ? "prints it" : "none"}`);
  if (!e.mask) out.push("no mask spec (the record states the opening)");
  else if (Math.abs(e.mask.margin_mm - v.mask.margin_mm) > 1e-6) out.push(`mask margin ${e.mask.margin_mm} mm, the record ${v.mask.margin_mm}`);
  return out;
}

/** An entry's verification status: verified, or the first problems. */
export function footprintStatus(e: FootprintEntry): { verified: boolean; problems: string[] } {
  const problems = verifyEntry(e);
  return { verified: problems.length === 0, problems };
}


/** One land pattern a board uses: the entry, where it came from, the instances on it, and its verification problems. */
export interface BoardLand {
  entry: FootprintEntry;
  from: "instance" | "project" | "provider";
  instances: string[];
  problems: string[];
}

/** Every land pattern a board's components resolve to, with its verification status (unresolved components are generate's to report). */
export function boardLands(components: { instance: string; manufacturer?: string; package?: PackageFacts & { name: string } }[], overrides: FootprintOverrides = {}): BoardLand[] {
  const out = new Map<string, BoardLand>();
  for (const c of components) {
    const { entry, from } = resolveFootprint(c.instance, c.package ? { ...c.package, manufacturer: c.manufacturer } : undefined, overrides);
    if (!entry) continue;
    const key = `${from}:${entry.id}:${from === "instance" ? c.instance : ""}`;
    const hit = out.get(key);
    if (hit) hit.instances.push(c.instance);
    else out.set(key, { entry, from: from!, instances: [c.instance], problems: verifyEntry(entry) });
  }
  return [...out.values()];
}
