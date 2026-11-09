/**
 * Findings in plain language: one formatter for every place a finding reaches a person (the Checks tab, the review
 * queue and its card, the hover callout, the timeline's queue lane, the agent bar, and `protoboard board check`'s
 * text output). A finding names objects by id (`pad:mcu/module:11`, `trk:f.i2c_sda.2`) and rules by id; this says
 * the same thing with reference designators and pad numbers, net names (or "no net"), the layer in words, measured
 * against required in millimeters, and where the limit comes from ("the fab minimum", "the design target", a net
 * class, the rule's note). The ids stay in `ids` for hover titles and JSON. Browser safe and pure: it reads the board
 * document only.
 */
import { parsePadId, type BoardDocument } from "./board.js";

/** The fields of a finding this reads (the board contract's `Finding`, the screen's `PcbFinding`). */
export interface FindingLike {
  id: string;
  check: string;
  rule?: string;
  tier?: string;
  severity: "error" | "warning" | "info";
  objects: readonly string[];
  location: { x: number; y: number; layer?: string };
  measured?: number;
  required?: number;
  message: string;
}

export interface FindingText {
  /** A short title for a list row or a lane block ("U1 pad 11 too close to the I2C_SDA track"). */
  title: string;
  /** One plain sentence (two at most), ending with a period. */
  sentence: string;
  /** The finding's id, then the ids of its objects and its rule: for hover titles and JSON, never for reading. */
  ids: string[];
  /** The check in words ("clearance", "edge clearance"). */
  check: string;
  /** Where the limit comes from, in words, when a rule set one ("the fab minimum", "the design target for net class power"). */
  source?: string;
}

// ------------------------------------------------------------------ numbers and words

const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** Nanometers as millimeters for a sentence: three decimals below 1 mm, two below 10, one above; trailing zeros dropped. */
export function mmText(nm: number, decimals?: number): string {
  const v = nm / 1e6;
  if (v === 0) return "0";
  const a = Math.abs(v);
  const d = decimals ?? (a >= 10 ? 1 : a >= 1 ? 2 : 3);
  const s = trim(v.toFixed(d));
  if (s === "0" || s === "-0") return a < 0.0001 ? (v < 0 ? "-0.0001" : "under 0.0001") : trim(v.toFixed(4));
  return s;
}

/** A measured value and its limit, with enough decimals that they never read the same when they differ. */
export function mmPair(measured: number, required: number): [string, string] {
  let a = mmText(measured);
  let b = mmText(required);
  for (let d = 4; a === b && measured !== required && d <= 6; d++) {
    a = mmText(measured, d);
    b = mmText(required, d);
  }
  return [a, b];
}

/** A layer in words: `top` is "the top layer", `inner2` "inner layer 2", `top_silkscreen` "the top silkscreen". */
export function layerWords(layer: string | undefined): string | undefined {
  if (!layer) return undefined;
  if (layer === "top" || layer === "bottom") return `the ${layer} layer`;
  const inner = /^inner(\d+)$/.exec(layer);
  if (inner) return `inner layer ${inner[1]}`;
  const m = /^(top|bottom)_(silkscreen|soldermask|paste|fabrication|courtyard)$/.exec(layer);
  if (m) return m[2] === "courtyard" ? `the ${m[1]} side` : `the ${m[1]} ${m[2] === "soldermask" ? "solder mask" : m[2]}`;
  if (layer === "edge_cuts") return "the board edge";
  return layer.replace(/_/g, " ");
}

/** A check id in words (`edge_clearance` is "edge clearance"). */
export function checkWords(check: string): string {
  const w: Record<string, string> = {
    unconnected: "unconnected",
    short: "short",
    unassigned_copper: "copper with no net",
    dangling: "dangling copper",
    isolated_copper: "isolated fill",
    clearance: "clearance",
    physical_clearance: "physical clearance",
    track_width: "track width",
    via_diameter: "via size",
    via_hole: "via hole",
    hole_size: "hole size",
    annular_ring: "annular ring",
    hole_to_hole: "hole to hole",
    hole_clearance: "hole clearance",
    edge_clearance: "edge clearance",
    courtyard_overlap: "courtyards overlap",
    silk_to_pad: "silkscreen on pads",
    via_in_pad: "via in pad",
    via_under_footprint: "via under a part",
    keepout: "keep-out",
    disallow: "not allowed",
  };
  return w[check] ?? check.replace(/_/g, " ");
}

/** A net name as written in a sentence: quoted when it has spaces (an imported board's generated names). */
export const netWords = (net: string) => (/\s/.test(net) ? `"${net}"` : net);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// ------------------------------------------------------------------ objects

interface Named {
  id: string;
  kind: string;
  /** In a sentence, with its net: "U1 pad 11 (no net)", "the I2C_SDA track", "a track with no net". */
  phrase: string;
  /** Short, for a title: "U1 pad 11", "I2C_SDA track". */
  short: string;
  net?: string;
  /** The footprint's reference, for pads and footprints. */
  ref?: string;
}

/** The net an object is on: a pad's from the netlist, copper's from its record. */
export function netOfObject(doc: BoardDocument, id: string): string | undefined {
  const pn = doc.padNets.get(id);
  if (pn) return pn;
  const r = doc.records.get(id);
  return r && (r.kind === "track" || r.kind === "via" || r.kind === "zone") ? r.net : undefined;
}

/** An object's name as a person reads it: reference and pad number, net and kind, a keep-out's name. */
export function nameObject(doc: BoardDocument, id: string): Named {
  const pad = parsePadId(id);
  if (pad) {
    const fp = doc.records.get(pad.footprint);
    const ref = fp?.kind === "footprint" ? fp.ref : pad.footprint.slice(3);
    const num = pad.pad.replace(/~\d+$/, "");
    const short = `${ref} pad ${num}`;
    const net = doc.padNets.get(id);
    return { id, kind: "pad", short, phrase: `${short} (${net ? netWords(net) : "no net"})`, ref, ...(net ? { net } : {}) };
  }
  if (id === "outline") return { id, kind: "outline", short: "board edge", phrase: "the board edge" };
  const r = doc.records.get(id);
  if (!r) return { id, kind: "object", short: id, phrase: id };
  switch (r.kind) {
    case "footprint":
      return { id, kind: "footprint", short: r.ref, phrase: r.ref, ref: r.ref };
    case "track":
    case "via": {
      const word = r.kind;
      const nw = r.net ? netWords(r.net) : "";
      return r.net ? { id, kind: word, short: `${nw} ${word}`, phrase: word === "track" ? `the ${nw} track` : `a ${nw} via`, net: r.net } : { id, kind: word, short: `${word} (no net)`, phrase: `a ${word} with no net` };
    }
    case "zone": {
      const label = r.name ?? (r.net ? netWords(r.net) : undefined);
      return { id, kind: "zone", short: label ? `${label} zone` : "zone (no net)", phrase: label ? `the ${label} zone` : "a zone with no net", ...(r.net ? { net: r.net } : {}) };
    }
    case "keepout": {
      const label = r.name ?? r.description;
      return { id, kind: "keepout", short: label ? `${label} keep-out` : "keep-out", phrase: label ? `the ${label} keep-out` : "a keep-out" };
    }
    case "cutout":
      return { id, kind: "cutout", short: "cutout edge", phrase: "the edge of a cutout" };
    case "outline":
      return { id, kind: "outline", short: "board edge", phrase: "the board edge" };
    case "text":
      return { id, kind: "text", short: `text "${clip(r.text, 24)}"`, phrase: `the text "${clip(r.text, 40)}"` };
    case "graphic":
      return { id, kind: "graphic", short: `${r.layer.includes("silk") ? "silkscreen" : "drawn"} ${r.shape}`, phrase: `a ${r.layer.includes("silk") ? "silkscreen" : "drawn"} ${r.shape}` };
    default:
      return { id, kind: r.kind, short: id, phrase: id };
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ------------------------------------------------------------------ the rule's source

const TIER: Record<string, { min: string; max: string; flag: string }> = {
  floor: { min: "the fab minimum", max: "the fab maximum", flag: "a fab rule{scope} does not allow it" },
  target: { min: "the design target", max: "the design target", flag: "the design target{scope} avoids it" },
  policy: { min: "the policy limit", max: "the policy limit", flag: "a policy rule{scope} discourages it" },
  no_go: { min: "the no-go limit", max: "the no-go limit", flag: "a no-go rule{scope} forbids it" },
};

interface Source {
  /** "the fab minimum", "the design target for net class power" */
  limit: string;
  /** For a check with no measure: "a no-go rule for net class usb forbids it". */
  flag: string;
  /** The rule's written note, said after the number. */
  note?: string;
}

function sourceOf(f: FindingLike, doc: BoardDocument, bound: "min" | "max"): Source | undefined {
  const r = f.rule ? doc.records.get(f.rule) : undefined;
  const rule = r?.kind === "rule" ? r : undefined;
  const tier = rule?.tier ?? f.tier;
  if (!f.rule && !tier) return undefined;
  if (!f.rule && tier) {
    // an implicit floor: a zone's own clearance
    const zone = f.objects.map((o) => doc.records.get(o)).find((x) => x?.kind === "zone");
    if (zone && (f.check === "clearance" || f.check === "physical_clearance")) return { limit: "the zone's own clearance", flag: "the zone's own clearance does not allow it" };
  }
  const t = TIER[tier ?? ""] ?? { min: "the rule's minimum", max: "the rule's maximum", flag: "a rule{scope} does not allow it" };
  let scope = "";
  const classes = rule?.applies.classes;
  const nets = rule?.applies.nets;
  if (classes?.length) scope = ` for net class${classes.length > 1 ? "es" : ""} ${list(classes)}`;
  else if (nets?.length && nets.length <= 3) scope = ` for ${list(nets)}`;
  else if (rule?.applies.region) scope = " in its area";
  const limit = `${bound === "max" ? t.max : t.min}${scope}`;
  const flag = t.flag.replace("{scope}", scope);
  return { limit, flag, ...(rule?.note ? { note: rule.note } : {}) };
}

/** "; the fab minimum is 0.127 mm (illustrative fab limit)" */
function limitClause(src: Source | undefined, required: string, builtIn = "the built-in limit"): string {
  return `; ${src?.limit ?? builtIn} is ${required} mm${src?.note ? ` (${src.note})` : ""}`;
}

function flagClause(src: Source | undefined): string {
  if (!src) return "";
  return `; ${src.flag}${src.note ? ` (${src.note})` : ""}`;
}

// ------------------------------------------------------------------ per check

const on = (f: FindingLike, layer?: string) => {
  const w = layerWords(layer ?? f.location.layer);
  return w ? ` on ${w}` : "";
};

/** Which of the objects is which, by kind (the checks sort a finding's objects by id). */
function split(doc: BoardDocument, f: FindingLike) {
  const named = f.objects.map((o) => nameObject(doc, o));
  return { named, pads: named.filter((n) => n.kind === "pad"), copper: named.filter((n) => ["pad", "track", "via", "zone"].includes(n.kind)) };
}

/** A net named in the finding's own message, when the objects do not carry it (as a fallback only). */
const netFromMessage = (msg: string, re: RegExp) => re.exec(msg)?.slice(1).filter(Boolean) ?? [];

export function describeFinding(f: FindingLike, doc: BoardDocument): FindingText {
  const ids = [f.id, ...f.objects, ...(f.rule ? [f.rule] : [])];
  const check = checkWords(f.check);
  const { named, pads, copper } = split(doc, f);
  const measured = f.measured;
  const required = f.required;
  const bound: "min" | "max" = measured !== undefined && required !== undefined && measured > required ? "max" : "min";
  const src = sourceOf(f, doc, bound);
  const pair = measured !== undefined && required !== undefined ? mmPair(measured, required) : undefined;
  const meas = measured !== undefined ? (pair?.[0] ?? mmText(measured)) : undefined;
  const req = pair?.[1];
  const out = (title: string, sentence: string): FindingText => ({ title: cap(title), sentence: end(cap(sentence)), ids, check, ...(src ? { source: src.limit } : {}) });
  const A = named[0];
  const B = named[1];

  switch (f.check) {
    case "clearance":
    case "physical_clearance": {
      if (!A || !B) break;
      // the pad first: "U1 pad 11 is ... from the I2C_SDA track"
      const [p, q] = B.kind === "pad" && A.kind !== "pad" ? [B, A] : [A, B];
      const gap = measured === 0 ? `touches ${q.phrase}` : `is ${meas} mm from ${q.phrase}`;
      return out(`${p.short} too close to ${q.short}`, `${p.phrase} ${gap}${on(f)}${req !== undefined ? limitClause(src, req) : ""}`);
    }
    case "edge_clearance": {
      const edge = named.find((n) => n.kind === "outline" || n.kind === "cutout") ?? nameObject(doc, "outline");
      const item = named.find((n) => n !== edge) ?? A;
      if (!item) break;
      const outside = /outside the board/.test(f.message);
      const what = outside ? "lies outside the board outline" : measured === 0 ? `crosses ${edge.phrase}` : `is ${meas} mm from ${edge.phrase}`;
      const tail = req !== undefined && required! > 0 ? limitClause(src, req) : "; copper must stay inside the board";
      return out(outside ? `${item.short} outside the board` : measured === 0 ? `${item.short} crosses the ${edge.short}` : `${item.short} too close to the ${edge.short}`, `${item.phrase} ${what}${on(f)}${tail}`);
    }
    case "short": {
      let nets = [...new Set(copper.map((c) => c.net).filter((n): n is string => !!n))];
      if (nets.length < 2) nets = netFromMessage(f.message, /nets? (\S+) and (\S+?)[ ,.]/i);
      const bridged = named.some((n) => !n.net) || named.length > 2;
      const joined = nets.length >= 2 ? `${netWords(nets[0])} and ${netWords(nets[1])}` : "two nets";
      if (bridged) {
        const via = named.filter((n) => !n.net).map((n) => n.phrase);
        return out(`Short: ${joined}`, `${joined} are joined through copper with no net${via.length ? ` (${list(via.slice(0, 3))}${via.length > 3 ? ` and ${via.length - 3} more` : ""})` : ""}${on(f)}`);
      }
      return out(`Short: ${joined}`, `${A?.phrase ?? "copper"} touches ${B?.phrase ?? "other copper"}${on(f)}, joining ${joined}`);
    }
    case "unconnected": {
      const found = copper.find((c) => c.net)?.net ?? netFromMessage(f.message, /^Net (.+?) is not connected/)[0];
      const net = found ? netWords(found) : "a net";
      const ends = named.map((n) => n.short);
      const apart = measured === 0 ? ", which touch but are not joined end to end" : meas !== undefined ? `, ${meas} mm apart` : "";
      return out(`${net} not joined: ${ends.join(" to ")}`, `${net} is not joined between ${list(ends)}${apart}`);
    }
    case "unassigned_copper": {
      const loose = named.find((n) => !n.net) ?? A;
      const other = named.find((n) => n !== loose) ?? B;
      if (!loose || !other) break;
      return out(`${cap(loose.kind)} with no net touches ${other.net ? netWords(other.net) : other.short}`, `${loose.phrase} touches ${other.phrase}${on(f)}`);
    }
    case "dangling": {
      if (!A) break;
      if (A.kind === "via") {
        const n = /on (\d+) of its layers/.exec(f.message)?.[1];
        return out(`${A.short} connects on one side only`, `${A.phrase} meets other copper on ${n === "0" ? "none" : n ? `only ${n}` : "only some"} of its layers`);
      }
      return out(`${A.short} ends in the air`, `an end of ${A.phrase} touches no other copper${on(f)}`);
    }
    case "isolated_copper": {
      const zone = named.find((n) => n.kind === "zone") ?? A;
      if (!zone) break;
      const net = zone.net ?? netFromMessage(f.message, /net (\S+) near/)[0];
      return out(`${zone.short} has an isolated island`, `an island of ${zone.phrase} fill${on(f)} touches no ${net ? `${netWords(net)} ` : ""}pad, track or via`);
    }
    case "track_width": {
      if (!A || meas === undefined) break;
      return out(`${A.short} too ${bound === "max" ? "wide" : "narrow"}`, `${A.phrase}${on(f)} is ${meas} mm wide${req !== undefined ? limitClause(src, req) : ""}`);
    }
    case "via_diameter":
    case "via_hole":
    case "hole_size": {
      if (!A || meas === undefined) break;
      const hole = f.check !== "via_diameter";
      const size = bound === "max" ? (hole ? "large" : "large") : "small";
      const what = hole ? `has a ${meas} mm hole` : `is ${meas} mm across`;
      return out(`${A.short} ${hole ? "hole " : ""}too ${size}`, `${A.phrase} ${what}${req !== undefined ? limitClause(src, req) : ""}`);
    }
    case "annular_ring": {
      if (!A || meas === undefined) break;
      return out(`${A.short} ring too thin`, `${A.phrase} has a ${meas} mm annular ring${req !== undefined ? limitClause(src, req) : ""}`);
    }
    case "hole_to_hole": {
      if (!A || !B) break;
      return out(`Holes too close: ${A.short} and ${B.short}`, `the holes of ${A.phrase} and ${B.phrase} are ${meas ?? "?"} mm apart${req !== undefined ? limitClause(src, req) : ""}`);
    }
    case "hole_clearance": {
      if (!A || !B) break;
      const holeId = /^Hole of (\S+) is/.exec(f.message)?.[1];
      const [h, o] = holeId && B.id === holeId ? [B, A] : [A, B];
      return out(`Hole of ${h.short} too close to ${o.short}`, `the hole of ${h.phrase} is ${meas ?? "?"} mm from ${o.phrase}${on(f)}${req !== undefined ? limitClause(src, req) : ""}`);
    }
    case "courtyard_overlap": {
      if (!A || !B) break;
      return out(`${A.short} and ${B.short} overlap`, `the courtyards of ${A.short} and ${B.short} overlap${on(f)}${flagClause(src)}`);
    }
    case "silk_to_pad": {
      const silk = named.find((n) => n.kind !== "pad");
      const owner = silk ? (silk.kind === "footprint" ? `the silkscreen of ${silk.short}` : silk.phrase) : "silkscreen";
      const ownerShort = silk ? (silk.kind === "footprint" ? `Silkscreen of ${silk.short}` : cap(silk.short)) : "Silkscreen";
      const refs = [...new Set(pads.map((p) => p.ref))];
      const padText = pads.length === 1 ? pads[0].short : refs.length === 1 && pads.length > 1 ? `${pads.length} pads of ${refs[0]}` : `${pads.length} pads (${list(pads.slice(0, 3).map((p) => p.short))}${pads.length > 3 ? " and others" : ""})`;
      const text = /text checked as its box/.test(f.message) ? " (text is checked as its box)" : "";
      const what = measured === 0 || meas === undefined ? `overlaps ${padText}` : `is ${meas} mm from ${padText}`;
      return out(`${ownerShort} ${measured === 0 ? "on" : "near"} ${pads.length === 1 ? "a pad" : "pads"}`, `${owner} ${what}${on(f)}${text}${req !== undefined && required! > 0 ? limitClause(src, req) : ""}`);
    }
    case "via_in_pad": {
      const via = named.find((n) => n.kind === "via") ?? A;
      const pad = named.find((n) => n.kind === "pad") ?? B;
      if (!via || !pad) break;
      return out(`Via in ${pad.short}`, `${via.phrase} sits in ${pad.phrase}${on(f)}${flagClause(src)}`);
    }
    case "via_under_footprint": {
      const via = named.find((n) => n.kind === "via") ?? A;
      const fp = named.find((n) => n.kind === "footprint") ?? B;
      if (!via || !fp) break;
      return out(`Via under ${fp.short}`, `${via.phrase} is under ${fp.short}${on(f)}${flagClause(src)}`);
    }
    case "keepout": {
      const k = named.find((n) => n.kind === "keepout") ?? A;
      const item = named.find((n) => n !== k) ?? B;
      if (!k || !item) break;
      const blocks = /which blocks (\w+)/.exec(f.message)?.[1];
      const tier = f.tier === "no_go" ? "a no-go area" : f.tier === "policy" ? "a policy area" : undefined;
      const verb = item.kind === "footprint" ? "overlaps" : "is inside";
      return out(`${item.short} in the ${k.short}`, `${item.phrase}${item.kind === "footprint" ? "" : on(f)} ${verb} ${k.phrase}${blocks ? `, which blocks ${blocks}` : ""}${tier ? ` (${tier})` : ""}`);
    }
    case "disallow": {
      if (!A) break;
      return out(`${A.short} not allowed here`, `${A.phrase}${on(f)} is not allowed here${flagClause(src)}`);
    }
  }
  // a check this formatter does not know: its own message, the objects named
  const who = named.slice(0, 2).map((n) => n.short);
  return out(`${check}${who.length ? `: ${who.join(", ")}` : ""}`, f.message);
}

/** An unconnected net with several open links, as one review item. */
export function describeOpenNet(doc: BoardDocument, net: string, findings: readonly FindingLike[]): FindingText {
  if (findings.length === 1) return describeFinding(findings[0], doc);
  const pads = [...new Set(findings.flatMap((f) => f.objects))];
  const refs = [...new Set(pads.map((p) => nameObject(doc, p).ref ?? nameObject(doc, p).short))];
  const shown = refs.slice(0, 4);
  const nw = netWords(net);
  return {
    title: `${nw} is not joined`,
    sentence: `${nw} has ${findings.length} open connections between ${list(refs.length > 4 ? [...shown, "others"] : shown)}.`,
    ids: [...findings.map((f) => f.id), ...pads],
    check: "unconnected",
  };
}

/** The severity in words, for a label. */
export const severityWords = (s: FindingLike["severity"]) => (s === "error" ? "error" : s === "warning" ? "warning" : "note");
