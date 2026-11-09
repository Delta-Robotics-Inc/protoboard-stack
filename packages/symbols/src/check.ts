/**
 * The symbol checker: every rule in STYLE.md that a machine can judge. A finding is an error unless marked a
 * warning; the pack must have no errors (test/pack.test.ts, scripts/check.ts).
 *
 *   format      the file's text is the canonical form (src/format.ts)
 *   meta        schema, id (matches the file name), name, category, refdes, convention, license, provenance, tags
 *   element     only Lucide's elements (text in code-built symbols only), known attributes, a known role; nothing
 *               else (no fill, stroke, style, class or transform)
 *   numbers     at most 3 decimals; drawn symbols on the half-pixel grid (multiples of 0.5)
 *   frame       w and h are 4 + 5k (the lattice 2, 7, 12, …); drawn symbols are 24 or 34 square
 *   pins        unique ids, integer lattice points, on a frame edge but not a corner, the direction is the edge's
 *               outward normal; only net markers (no-connect, junction) may sit inside with direction none
 *   leads       one per pin, straight segments only, starting exactly on the anchor, leaving it inward along the
 *               pin's axis for at least 2 px, and ending on the body
 *   bounds      only leads reach the lattice edge; everything else stays inside the 1 px safe zone (3 … size-3);
 *               a form with no pins (an icon-only drawing) may use Lucide's whole 2 … 22
 *   gap-icon    in the icon rendering (2 px stroke at 24 px, roles in icon.omitRoles left out), separate shapes keep
 *               2 px clear (the Lucide rule that keeps a glyph legible at 16 px)
 *   gap-sheet   in the schematic rendering (0.5 px stroke), separate shapes keep at least 1 px clear
 *   icon        icon.from names the body, a variant or another pack symbol (`pack:<id>`)
 */
import { formatSymbol } from "./format.ts";
import { elementPolylines, numbersOf, pathToPolylines, polyDistance, pointDistance, straightVertices, type Pt } from "./geometry.ts";
import { CATEGORIES, ELEMENT_ATTRS, MARGIN, PIN_TYPES, ROLES, SCHEMA, UNIT, type BodyElement, type Frame, type SymbolDef, type SymbolPin } from "./types.ts";

export interface Finding {
  symbol: string;
  variant?: string;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

/** Two strokes closer than this (centerlines, frame px) touch: they are one shape. */
export const TOUCH = 0.3;
/** Allowance for curves sampled as polylines when measuring gaps, frame px. */
export const SAMPLING = 0.05;
/** Minimum lead length, frame px. */
export const MIN_LEAD = 2;
/** Schematic stroke, frame px (0.1 grid unit: 0.254 mm on a 2.54 mm grid, KiCad's default line). */
export const SHEET_STROKE = 0.5;
/** Icon stroke at 24 px. */
export const ICON_STROKE = 2;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PIN_ID = /^[A-Za-z0-9+\-_~]+$/;
const TEXT_ROLES = new Set(["pin-name", "pin-number", "label"]);
const TOP_KEYS = new Set([
  "schema",
  "id",
  "name",
  "category",
  "refdes",
  "convention",
  "origin",
  "frame",
  "pins",
  "body",
  "variants",
  "fields",
  "icon",
  "tags",
  "match",
  "license",
  "provenance",
  "notes",
]);

export interface CheckOptions {
  /** The file's text, for the format rule. */
  text?: string;
  /** The file's base name without `.symbol.json`, for the id rule. */
  fileId?: string;
  /** Ids of the pack's symbols, for `pack:<id>` icons. */
  packIds?: Set<string>;
  /** Pack license expected on every symbol. */
  license?: string;
}

const px = (v: number) => MARGIN + UNIT * v;
const isHalf = (n: number) => Math.abs(n * 2 - Math.round(n * 2)) < 1e-9;
const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

/** The lattice extent of a frame: columns and rows are 0 … max. */
export function latticeMax(frame: Frame): [number, number] {
  return [(frame.w - 2 * MARGIN) / UNIT, (frame.h - 2 * MARGIN) / UNIT];
}

/** A pin's anchor in frame pixels. */
export function anchorPx(pin: SymbolPin): Pt {
  return [px(pin.at[0]), px(pin.at[1])];
}

/** The edge direction a lattice point implies, `corner`, or `inside`. */
export function edgeDir(at: [number, number], frame: Frame): SymbolPin["dir"] | "corner" | "inside" {
  const [cmax, rmax] = latticeMax(frame);
  const [c, r] = at;
  const onX = c === 0 || c === cmax;
  const onY = r === 0 || r === rmax;
  if (onX && onY) return "corner";
  if (c === 0) return "left";
  if (c === cmax) return "right";
  if (r === 0) return "up";
  if (r === rmax) return "down";
  return "inside";
}

/** Group element indices into shapes: elements whose strokes touch (transitively) are one shape. */
export function shapes(polys: Pt[][][]): number[] {
  const parent = polys.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < polys.length; i++)
    for (let j = i + 1; j < polys.length; j++) if (find(i) !== find(j) && polyDistance(polys[i], polys[j]) <= TOUCH) parent[find(i)] = find(j);
  return polys.map((_, i) => find(i));
}

/** The smallest centerline distance between two different shapes, with the elements it is between. */
export function closestShapes(els: BodyElement[]): { dist: number; a: number; b: number } | null {
  const polys = els.map(elementPolylines);
  const shape = shapes(polys);
  let best: { dist: number; a: number; b: number } | null = null;
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++) {
      if (shape[i] === shape[j]) continue;
      const dist = polyDistance(polys[i], polys[j]);
      if (!best || dist < best.dist) best = { dist, a: i, b: j };
    }
  return best;
}

function describe(el: BodyElement): string {
  const geo = el.d ?? el.points ?? (el.el === "circle" ? `c ${el.cx},${el.cy} r${el.r}` : el.el === "rect" ? `rect ${el.x},${el.y} ${el.width}x${el.height}` : el.el);
  return `${el.role}${el.pin ? `(${el.pin})` : ""} "${geo}"`;
}

function checkElements(def: SymbolDef, body: BodyElement[], add: (rule: string, msg: string, sev?: "error" | "warning") => void) {
  const generated = def.origin === "generated";
  for (const el of body) {
    const allowed = ELEMENT_ATTRS[el.el as keyof typeof ELEMENT_ATTRS];
    if (!allowed) {
      add("element", `element "${el.el}" is not allowed`);
      continue;
    }
    if (el.el === "text" && !generated) add("element", `text in a drawn glyph (${el.text}); drawn glyphs carry no letters (draw a mark instead)`);
    for (const k of Object.keys(el)) if (k !== "el" && k !== "role" && k !== "pin" && !allowed.includes(k)) add("element", `${el.el} has a stray attribute "${k}"`);
    if (!ROLES.includes(el.role)) add("element", `${el.el} has unknown role "${el.role}"`);
    if (el.el === "text" && !TEXT_ROLES.has(el.role)) add("element", `text needs a text role, not "${el.role}"`);
    if (el.el !== "text" && TEXT_ROLES.has(el.role)) add("element", `role "${el.role}" is for text`);
    if (el.role === "lead" && !el.pin) add("element", `a lead without its pin: ${describe(el)}`);
    if (el.role !== "lead" && el.pin) add("element", `only leads name a pin: ${describe(el)}`);
    if (el.role === "dot" && el.el !== "circle") add("element", "a dot is a circle");
    for (const n of numbersOf(el)) {
      if (!Number.isFinite(n)) add("numbers", `not a number in ${describe(el)}`);
      else if (decimals(n) > 3) add("numbers", `${n} has more than 3 decimals in ${describe(el)}`);
      else if (!generated && !isHalf(n)) add("numbers", `${n} is off the half-pixel grid in ${describe(el)}`);
    }
    if (el.el === "path") {
      try {
        pathToPolylines(el.d ?? "");
      } catch (e) {
        add("element", `bad path data "${el.d}": ${(e as Error).message}`);
      }
    }
  }
}

function checkPinsAndLeads(def: SymbolDef, frame: Frame, pins: SymbolPin[], body: BodyElement[], add: (rule: string, msg: string, sev?: "error" | "warning") => void) {
  const ids = new Set<string>();
  const spots = new Set<string>();
  for (const p of pins) {
    if (!PIN_ID.test(p.id ?? "")) add("pins", `pin id "${p.id}" is not a plain id`);
    if (ids.has(p.id)) add("pins", `pin id "${p.id}" repeats`);
    ids.add(p.id);
    if (typeof p.name !== "string" || !p.name) add("pins", `pin ${p.id} has no name`);
    if (!PIN_TYPES.includes(p.type)) add("pins", `pin ${p.id} has unknown type "${p.type}"`);
    if (!Array.isArray(p.at) || p.at.length !== 2 || !p.at.every(Number.isInteger)) {
      add("pins", `pin ${p.id} is not on a lattice point (${JSON.stringify(p.at)})`);
      continue;
    }
    const [cmax, rmax] = latticeMax(frame);
    if (p.at[0] < 0 || p.at[1] < 0 || p.at[0] > cmax || p.at[1] > rmax) add("pins", `pin ${p.id} is outside the frame`);
    const key = p.at.join(",");
    if (spots.has(key)) add("pins", `two pins on ${key}`);
    spots.add(key);
    const edge = edgeDir(p.at, frame);
    if (edge === "corner") add("pins", `pin ${p.id} is on a corner (its direction is ambiguous)`);
    else if (edge === "inside") {
      if (p.dir !== "none" || def.category !== "net") add("pins", `pin ${p.id} is inside the frame; only net markers sit inside (direction none)`);
    } else if (p.dir !== edge) add("pins", `pin ${p.id} is on the ${edge} edge but points ${p.dir}`);
  }
  const leads = body.filter((e) => e.role === "lead");
  const others = body.filter((e) => e.role !== "lead" && !TEXT_ROLES.has(e.role));
  for (const l of leads) if (!ids.has(l.pin!)) add("leads", `lead for unknown pin ${l.pin}`);
  for (const p of pins) {
    const mine = leads.filter((l) => l.pin === p.id);
    if (p.dir === "none") {
      if (mine.length) add("leads", `marker pin ${p.id} has a lead`);
      continue;
    }
    if (mine.length !== 1) {
      add("leads", `pin ${p.id} has ${mine.length} leads (needs exactly one)`);
      continue;
    }
    const lead = mine[0];
    if (lead.el !== "path") {
      add("leads", `pin ${p.id}'s lead is a ${lead.el}, not a path`);
      continue;
    }
    const verts = straightVertices(lead.d ?? "");
    if (!verts || verts.length !== 1) {
      add("leads", `pin ${p.id}'s lead must be one run of straight segments: "${lead.d}"`);
      continue;
    }
    const v = verts[0];
    const a = anchorPx(p);
    if (Math.hypot(v[0][0] - a[0], v[0][1] - a[1]) > 1e-9) add("leads", `pin ${p.id}'s lead starts at ${v[0]} not on its anchor ${a}`);
    if (v.length < 2) continue;
    const dx = v[1][0] - v[0][0];
    const dy = v[1][1] - v[0][1];
    const inward = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[p.dir as "left"];
    const along = dx * inward[0] + dy * inward[1];
    const across = Math.abs(dx * inward[1]) + Math.abs(dy * inward[0]);
    if (across > 1e-9 || along <= 0) add("leads", `pin ${p.id}'s lead does not leave its anchor straight inward`);
    else if (along < MIN_LEAD - 1e-9) add("leads", `pin ${p.id}'s lead is ${along} px; leads are at least ${MIN_LEAD}`);
    const end = v[v.length - 1];
    const otherLeads = leads.filter((l) => l !== lead).map(elementPolylines);
    const near = [...others.map(elementPolylines), ...otherLeads].some((poly) => pointDistance(end, poly) <= TOUCH);
    if (!near) add("leads", `pin ${p.id}'s lead ends at ${end}, on nothing (a lead ends on the body)`);
    for (const q of pins)
      if (q !== p && q.dir !== "none" && v.some((pt, i) => i > 0 && Math.hypot(pt[0] - anchorPx(q)[0], pt[1] - anchorPx(q)[1]) < 1e-9))
        add("leads", `pin ${p.id}'s lead runs through pin ${q.id}'s anchor`);
  }
}

function checkBounds(def: SymbolDef, frame: Frame, pins: SymbolPin[], body: BodyElement[], add: (rule: string, msg: string, sev?: "error" | "warning") => void) {
  // a form with no pins (an icon-only drawing, a mounting hole) has no leads to keep apart: Lucide's 1 px padding
  const inset = pins.length ? 1 : 0;
  const lo = MARGIN + inset;
  const hiX = frame.w - MARGIN - inset;
  const hiY = frame.h - MARGIN - inset;
  for (const el of body) {
    if (TEXT_ROLES.has(el.role)) continue;
    const pts = elementPolylines(el).flat();
    const isLead = el.role === "lead";
    const [x0, y0, x1, y1] = isLead ? [MARGIN, MARGIN, frame.w - MARGIN, frame.h - MARGIN] : [lo, lo, hiX, hiY];
    const out = pts.find((p) => p[0] < x0 - 1e-6 || p[0] > x1 + 1e-6 || p[1] < y0 - 1e-6 || p[1] > y1 + 1e-6);
    if (out) add("bounds", `${describe(el)} reaches ${out.map((n) => Math.round(n * 100) / 100)}, outside ${isLead ? "the lattice" : "the safe zone"} (${x0}…${x1}, ${y0}…${y1})`);
  }
  void def;
}

function checkGaps(def: SymbolDef, frame: Frame, body: BodyElement[], omit: string[], add: (rule: string, msg: string, sev?: "error" | "warning") => void, isIconSource: boolean) {
  const drawn = body.filter((e) => !TEXT_ROLES.has(e.role));
  const sheet = closestShapes(drawn);
  if (sheet && sheet.dist < SHEET_STROKE + 1 - SAMPLING)
    add("gap-sheet", `${describe(drawn[sheet.a])} and ${describe(drawn[sheet.b])} are ${sheet.dist.toFixed(2)} px apart (schematic needs ${SHEET_STROKE + 1})`);
  if (!isIconSource) return;
  const scale = Math.max(frame.w, frame.h) / 24;
  const need = (ICON_STROKE + 2) * scale;
  const iconEls = drawn.filter((e) => !omit.includes(e.role));
  const icon = closestShapes(iconEls);
  if (icon && icon.dist < need - SAMPLING)
    add("gap-icon", `${describe(iconEls[icon.a])} and ${describe(iconEls[icon.b])} are ${icon.dist.toFixed(2)} px apart; the icon needs ${need.toFixed(2)} (2 px clear at 24 px)`);
}

/** Check one symbol definition. */
export function checkSymbol(def: SymbolDef, opts: CheckOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const id = def?.id ?? opts.fileId ?? "?";
  const adder =
    (variant?: string) =>
    (rule: string, message: string, severity: "error" | "warning" = "error") =>
      findings.push({ symbol: id, variant, rule, message, severity });
  const add = adder();

  if (opts.text !== undefined && opts.text !== formatSymbol(def)) add("format", "the file is not in the canonical form (run scripts/format.ts)");
  for (const k of Object.keys(def)) if (!TOP_KEYS.has(k)) add("meta", `unknown key "${k}"`);
  if (def.schema !== SCHEMA) add("meta", `schema is "${def.schema}", not "${SCHEMA}"`);
  if (!KEBAB.test(def.id ?? "")) add("meta", `id "${def.id}" is not kebab-case`);
  if (opts.fileId && opts.fileId !== def.id) add("meta", `id "${def.id}" does not match the file name "${opts.fileId}"`);
  if (!def.name) add("meta", "no name");
  if (!CATEGORIES.includes(def.category)) add("meta", `unknown category "${def.category}"`);
  if (!/^#?[A-Z]+$/.test(def.refdes ?? "")) add("meta", `refdes prefix "${def.refdes}" is not capital letters`);
  if (!["ieee", "iec", "common"].includes(def.convention)) add("meta", `convention "${def.convention}" is not ieee, iec or common`);
  if (!["drawn", "generated"].includes(def.origin)) add("meta", `origin "${def.origin}" is not drawn or generated`);
  if (!def.license) add("meta", "no license");
  else if (opts.license && def.license !== opts.license) add("meta", `license "${def.license}" is not the pack's (${opts.license})`);
  if (!def.provenance?.author || !def.provenance?.date || !def.provenance?.basis || !["draft", "approved"].includes(def.provenance?.review)) add("meta", "provenance needs author, date, basis and review (draft or approved)");
  if (!Array.isArray(def.tags) || !def.tags.length) add("meta", "no tags");
  if (!Array.isArray(def.match?.keywords) || !def.match.keywords.length) add("meta", "match.keywords is empty");
  if (!def.fields?.refdes || !def.fields?.value) add("meta", "fields needs refdes and value");
  if (!def.frame || !Array.isArray(def.pins) || !Array.isArray(def.body) || !def.body.length) {
    add("meta", "needs frame, pins and a body");
    return findings;
  }

  const frameOk = (f: Frame, v?: string) => {
    const a = adder(v);
    if ((f.w - 2 * MARGIN) % UNIT || (f.h - 2 * MARGIN) % UNIT || f.w < 14 || f.h < 14) a("frame", `frame ${f.w}x${f.h} is not 4 + 5k on both sides`);
    if (def.origin === "drawn" && !(f.w === f.h && (f.w === 24 || f.w === 34))) a("frame", `a drawn glyph's frame is 24 or 34 square, not ${f.w}x${f.h}`);
  };
  frameOk(def.frame);

  const icon = def.icon;
  const iconFrom = icon?.from ?? "";
  if (!icon || !Array.isArray(icon.omitRoles)) add("icon", "icon needs from and omitRoles");
  else {
    for (const r of icon.omitRoles) if (!ROLES.includes(r) || r === "lead" || r === "body") add("icon", `icon cannot omit role "${r}"`);
    if (iconFrom.startsWith("pack:")) {
      if (opts.packIds && !opts.packIds.has(iconFrom.slice(5))) add("icon", `icon uses unknown pack symbol ${iconFrom.slice(5)}`);
    } else if (iconFrom !== "body" && !def.variants?.[iconFrom]) add("icon", `icon.from "${iconFrom}" is neither body, a variant nor pack:<id>`);
  }

  const forms: { variant?: string; frame: Frame; pins: SymbolPin[]; body: BodyElement[] }[] = [{ frame: def.frame, pins: def.pins, body: def.body }];
  for (const [name, v] of Object.entries(def.variants ?? {})) {
    const a = adder(name);
    if (!KEBAB.test(name)) a("meta", `variant name "${name}" is not kebab-case`);
    if (!v.name) a("meta", "variant has no display name");
    if (v.generator) {
      if (v.body) a("meta", "a variant is drawn or generated, not both");
      continue;
    }
    if (!v.body?.length) {
      a("meta", "variant has no body");
      continue;
    }
    if (v.frame) frameOk(v.frame, name);
    forms.push({ variant: name, frame: v.frame ?? def.frame, pins: v.pins ?? def.pins, body: v.body });
  }

  for (const f of forms) {
    const a = adder(f.variant);
    checkElements(def, f.body, a);
    checkPinsAndLeads(def, f.frame, f.pins, f.body, a);
    checkBounds(def, f.frame, f.pins, f.body, a);
    const isIconSource = (f.variant ?? "body") === iconFrom;
    checkGaps(def, f.frame, f.body, icon?.omitRoles ?? [], a, isIconSource);
  }
  return findings;
}

/** One line per finding. */
export function formatFindings(findings: Finding[]): string {
  return findings.map((f) => `${f.severity === "error" ? "ERROR" : "warn "} ${f.symbol}${f.variant ? `[${f.variant}]` : ""} ${f.rule}: ${f.message}`).join("\n");
}
