/**
 * The flat export (contract section 12): an ordinary hierarchical KiCad schematic written from KiCad's published
 * s-expression file format (schematic version 20250114). A root sheet holds one sheet box per card; each card is
 * its own sheet file with its symbols embedded. Nets join across sheets through global labels and power symbols
 * named after the UHD nets, so no hierarchical pins are needed. It need not be pretty; it must import cleanly.
 *
 * Written from the format documentation only; no KiCad code or library content is used.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { byCodeUnit, sha1Hex } from "@protoboardai/board";
import { elementPolylines } from "../../../symbols/src/geometry.ts";
import { splitPinKey, type SchematicCircuit } from "../circuit.ts";
import { recordsOfKind, type SchematicDocument } from "../document.ts";
import { geometryOf, onSegment, type PlacedSymbol } from "../geometry.ts";
import { packSymbols, symbolPinType } from "../symbols.ts";
import { GU_MM, opposite, transformDir, transformPoint, type Dir, type XY } from "../units.ts";

export const KICAD_SCH_VERSION = "20250114";

// ------------------------------------------------------------------ s-expressions

type S = string | number | S[] | { raw: string };
const q = (s: string) => ({ raw: JSON.stringify(s) });
const n = (v: number) => {
  const r = Math.round(v * 10_000) / 10_000;
  return r === 0 ? 0 : r;
};
function write(e: S, indent = 0): string {
  if (typeof e === "number") return String(n(e));
  if (typeof e === "string") return e;
  if (!Array.isArray(e)) return e.raw;
  const flat = e.every((x) => !Array.isArray(x) || x.every((y) => !Array.isArray(y)));
  if (flat && e.length < 12) return `(${e.map((x) => write(x)).join(" ")})`;
  const pad = "\t".repeat(indent + 1);
  const [head, ...rest] = e;
  return `(${write(head)}${rest.map((x) => (Array.isArray(x) ? `\n${pad}${write(x, indent + 1)}` : ` ${write(x)}`)).join("")}\n${"\t".repeat(indent)})`;
}
const uuid = (seed: string) => {
  const h = sha1Hex(seed);
  return q(`${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`);
};
const font = (size = 1.27): S => ["effects", ["font", ["size", size, size]]];
const fontHidden = (size = 1.27): S => ["effects", ["font", ["size", size, size]], ["hide", "yes"]];
const stroke: S = ["stroke", ["width", 0], ["type", "default"]];

// ------------------------------------------------------------------ library symbols

const PIN_ANGLE: Record<Dir, number> = { right: 0, up: 90, left: 180, down: 270 };
const sane = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");

interface LibSymbol {
  name: string;
  sexpr: S;
}

/** A placed symbol's library symbol with its orientation baked in (always placed at angle 0, unmirrored). */
function libSymbolOf(s: PlacedSymbol): LibSymbol {
  const r = s.resolved;
  const rot = s.rec.rotation;
  const mirror = !!s.rec.mirror;
  // the drawn pins are part of the form: a part with pins folded away (hide_unused) is another library symbol
  const form = sha1Hex(r.pins.map((p) => `${p.id}@${p.at.join(",")}`).join(";")).slice(0, 8);
  const name = `pb:${sane(`${s.part.part}_${r.family}_${r.variant ?? ""}_${rot}${mirror ? "m" : ""}_${form}`)}`;
  const toLib = (px: number, py: number): XY => {
    const [u, v] = transformPoint([(px - 2) / 5, (py - 2) / 5], rot, mirror);
    return [u * GU_MM, -v * GU_MM];
  };
  const gfx: S[] = [];
  const leadLen = new Map<string, number>();
  for (const el of r.body) {
    if (el.role === "lead") {
      const pts = elementPolylines(el).flat();
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      leadLen.set(el.pin ?? "", (len / 5) * GU_MM);
      continue;
    }
    if (el.el === "text") {
      if (el.role !== "label") continue;
      const [x, y] = toLib(el.x!, el.y!);
      gfx.push(["text", q(el.text ?? ""), ["at", x, y, 0], font(1)]);
      continue;
    }
    for (const line of elementPolylines(el)) {
      if (line.length < 2) continue;
      gfx.push(["polyline", ["pts", ...line.map(([x, y]) => ["xy", ...toLib(x, y)] as S)], stroke, ["fill", ["type", el.role === "dot" ? "outline" : "none"]]]);
    }
  }
  const box = r.family.startsWith("pack:") ? false : true;
  const pins: S[] = [];
  for (const sp of r.pins) {
    const members = (r.binding && [...r.binding].filter(([, v]) => v === sp.id).map(([k]) => k)) || [];
    const [x, y] = toLib(2 + 5 * sp.at[0], 2 + 5 * sp.at[1]);
    const outward = transformDir(sp.dir === "none" ? "left" : sp.dir, rot, mirror);
    const angle = PIN_ANGLE[opposite(outward)];
    const len = leadLen.get(sp.id) ?? 0;
    members.forEach((pid, i) => {
      const pin = s.part.pins.find((p) => p.id === pid)!;
      const type = i === 0 ? symbolPinType(pin.type) : "passive";
      const pname = (pin.name || "~").replace(/\s+/g, "_");
      pins.push(["pin", type, "line", ["at", x, y, angle], ["length", n(len)], ...(i > 0 ? [["hide", "yes"] as S] : []), ["name", q(pname), font(1)], ["number", q(pin.number), font(1)]]);
    });
  }
  const sexpr: S = [
    "symbol",
    q(name),
    ["pin_names", ["offset", 0.5], ...(box ? [] : [["hide", "yes"] as S])],
    ...(box ? [] : [["pin_numbers", ["hide", "yes"]] as S]),
    ["exclude_from_sim", "no"],
    ["in_bom", "yes"],
    ["on_board", "yes"],
    ["property", q("Reference"), q("U"), ["at", 0, 0, 0], font()],
    ["property", q("Value"), q(s.part.name), ["at", 0, 0, 0], font()],
    ["property", q("Footprint"), q(""), ["at", 0, 0, 0], fontHidden()],
    ["property", q("Datasheet"), q(""), ["at", 0, 0, 0], fontHidden()],
    ["symbol", q(`${name.slice(3)}_1_1`), ...gfx, ...pins],
    ["embedded_fonts", "no"],
  ];
  return { name, sexpr };
}

/** A power symbol: the net is its value (and its hidden power-input pin's name). `flag` makes the PWR_FLAG marker. */
function powerLib(net: string, style: "rail" | "ground" | "flag"): LibSymbol {
  const name = `pbpwr:${style === "flag" ? "PWR_FLAG" : sane(net)}`;
  const g = style === "ground" ? "ground" : "power-rail";
  const def = packSymbols().get(g)!;
  const pin0 = def.pins[0];
  const toLib = (px: number, py: number): XY => [((px - 2) / 5 - pin0.at[0]) * GU_MM, -((py - 2) / 5 - pin0.at[1]) * GU_MM];
  const gfx: S[] = [];
  if (style === "flag") gfx.push(["polyline", ["pts", ["xy", 0, 0], ["xy", 0, 1.27], ["xy", -1.016, 1.905], ["xy", 0, 2.54], ["xy", 1.016, 1.905], ["xy", 0, 1.27]], stroke, ["fill", ["type", "none"]]]);
  else for (const el of def.body) for (const line of elementPolylines(el)) if (line.length >= 2) gfx.push(["polyline", ["pts", ...line.map(([x, y]) => ["xy", ...toLib(x, y)] as S)], stroke, ["fill", ["type", "none"]]]);
  const pinAngle = style === "ground" ? 270 : 90;
  const pin: S = style === "flag" ? ["pin", "power_out", "line", ["at", 0, 0, 90], ["length", 0], ["name", q("pwr"), font()], ["number", q("1"), font()]] : ["pin", "power_in", "line", ["at", 0, 0, pinAngle], ["length", 0], ["hide", "yes"], ["name", q(net), font()], ["number", q("1"), font()]];
  return {
    name,
    sexpr: [
      "symbol",
      q(name),
      ["power"],
      ["pin_numbers", ["hide", "yes"]],
      ["pin_names", ["offset", 0], ["hide", "yes"]],
      ["exclude_from_sim", "no"],
      ["in_bom", "yes"],
      ["on_board", "yes"],
      ["property", q("Reference"), q(style === "flag" ? "#FLG" : "#PWR"), ["at", 0, 0, 0], fontHidden()],
      ["property", q("Value"), q(style === "flag" ? "PWR_FLAG" : net), ["at", 0, 0, 0], font()],
      ["property", q("Footprint"), q(""), ["at", 0, 0, 0], fontHidden()],
      ["property", q("Datasheet"), q(""), ["at", 0, 0, 0], fontHidden()],
      ["symbol", q(`${name.slice(6)}_1_1`), ...gfx, pin],
      ["embedded_fonts", "no"],
    ],
  };
}

// ------------------------------------------------------------------ the export

export interface KicadExport {
  /** file name -> text */
  files: Record<string, string>;
  root: string;
  /** what was added or changed to import cleanly */
  notes: string[];
}

const PAPERS: [string, number, number][] = [
  ["A4", 297, 210],
  ["A3", 420, 297],
  ["A2", 594, 420],
  ["A1", 841, 594],
  ["A0", 1189, 841],
];

/** Build the KiCad files of a schematic (one sheet per card). */
export function buildKicad(doc: SchematicDocument, project: string): KicadExport {
  const g = geometryOf(doc);
  const cards = recordsOfKind(doc, "card");
  const wires = recordsOfKind(doc, "wire");
  const labels = recordsOfKind(doc, "label");
  const powers = recordsOfKind(doc, "power");
  const ncs = recordsOfKind(doc, "noconnect");
  const rootUuid = uuid(`root:${project}`);
  const rootId = (rootUuid.raw as string).slice(1, -1);
  const notes: string[] = [];
  const files: Record<string, string> = {};
  const head = doc.records.get("schematic");
  const tb = head?.kind === "schematic" ? (head.title_block ?? {}) : {};
  const titleBlock = (sheet: string): S => ["title_block", ["title", q(`${tb.title ?? project}${sheet ? ` - ${sheet}` : ""}`)], ...(tb.date ? [["date", q(tb.date)] as S] : []), ...(tb.rev ? [["rev", q(tb.rev)] as S] : []), ["comment", 1, q("Flat export from the Protoboard schematic (one sheet per card)")]];
  // nets with supply inputs and no supply output get a PWR_FLAG once, on their first power symbol
  const typeOf = (k: string) => doc.parts.get(splitPinKey(k).part)!.pins.find((p) => p.id === splitPinKey(k).pin)!.type;
  const needsFlag = new Set(doc.circuit.nets.filter((n) => n.pins.some((k) => typeOf(k) === "power_in" || typeOf(k) === "ground") && !n.pins.some((k) => typeOf(k) === "power_out")).map((n) => n.name));
  const flagged = new Set<string>();
  let pwrN = 0;
  let flgN = 0;
  const sheetSymbols: S[] = [];
  cards.forEach((card, ci) => {
    const key = sane(card.id.slice(5).replace(/\//g, "_"));
    const file = `${key}.kicad_sch`;
    const sheetUuid = uuid(`sheet:${card.id}`);
    const sheetId = (sheetUuid.raw as string).slice(1, -1);
    const path = `/${rootId}/${sheetId}`;
    // paper and offset: the card's top-left at 25.4 mm
    const wmm = card.w * GU_MM + 50.8;
    const hmm = card.h * GU_MM + 50.8;
    const paper = PAPERS.find(([, w, h]) => w >= wmm && h >= hmm);
    const off = (p: XY): XY => [(p[0] - card.x) * GU_MM + 25.4, (p[1] - card.y) * GU_MM + 25.4];
    const items: S[] = [];
    const libs = new Map<string, LibSymbol>();
    const syms = [...g.symbols.values()].filter((s) => s.rec.card === card.id).sort((a, b) => byCodeUnit(a.rec.id, b.rec.id));
    for (const s of syms) {
      const lib = libSymbolOf(s);
      libs.set(lib.name, lib);
      const [x, y] = off([s.rec.x, s.rec.y]);
      const r = s.resolved;
      const pinsOut: S[] = [];
      for (const [pid] of r.binding) {
        const pin = s.part.pins.find((p) => p.id === pid)!;
        pinsOut.push(["pin", q(pin.number), ["uuid", uuid(`pin:${s.rec.id}:${pid}`)]]);
      }
      items.push([
        "symbol",
        ["lib_id", q(lib.name)],
        ["at", x, y, 0],
        ["unit", 1],
        ["exclude_from_sim", "no"],
        ["in_bom", "yes"],
        ["on_board", "yes"],
        ["dnp", "no"],
        ["uuid", uuid(`sym:${s.rec.id}`)],
        ["property", q("Reference"), q(s.rec.ref), ["at", ...off([s.ref.x, s.ref.y]), 0], font()],
        ["property", q("Value"), q(s.part.value ?? s.part.mpn ?? s.part.name), ["at", ...off([s.value?.x ?? s.ref.x, s.value?.y ?? s.ref.y + 1]), 0], font()],
        ["property", q("Footprint"), q(""), ["at", x, y, 0], fontHidden()],
        ["property", q("Datasheet"), q(""), ["at", x, y, 0], fontHidden()],
        ["property", q("UHD_Path"), q(s.part.path), ["at", x, y, 0], fontHidden()],
        ...pinsOut,
        ["instances", ["project", q(project), ["path", q(path), ["reference", q(s.rec.ref)], ["unit", 1]]]],
      ]);
    }
    const powerItem = (lib: LibSymbol, at: XY, ref: string, value: string, seed: string): S => {
      const [x, y] = off(at);
      return [
        "symbol",
        ["lib_id", q(lib.name)],
        ["at", x, y, 0],
        ["unit", 1],
        ["exclude_from_sim", "no"],
        ["in_bom", "yes"],
        ["on_board", "yes"],
        ["dnp", "no"],
        ["uuid", uuid(seed)],
        ["property", q("Reference"), q(ref), ["at", x, y, 0], fontHidden()],
        ["property", q("Value"), q(value), ["at", x, y - 3.2, 0], font()],
        ["property", q("Footprint"), q(""), ["at", x, y, 0], fontHidden()],
        ["property", q("Datasheet"), q(""), ["at", x, y, 0], fontHidden()],
        ["pin", q("1"), ["uuid", uuid(`${seed}:pin`)]],
        ["instances", ["project", q(project), ["path", q(path), ["reference", q(ref)], ["unit", 1]]]],
      ];
    };
    for (const p of powers.filter((x) => x.card === card.id)) {
      const lib = powerLib(p.net, p.style === "ground" ? "ground" : "rail");
      libs.set(lib.name, lib);
      pwrN++;
      items.push(powerItem(lib, [p.x, p.y], `#PWR${String(pwrN).padStart(3, "0")}`, p.net, `pwr:${p.id}`));
      if (needsFlag.has(p.net) && !flagged.has(p.net)) {
        flagged.add(p.net);
        const flag = powerLib(p.net, "flag");
        libs.set(flag.name, flag);
        flgN++;
        items.push(powerItem(flag, [p.x, p.y], `#FLG${String(flgN).padStart(3, "0")}`, "PWR_FLAG", `flg:${p.id}`));
        notes.push(`PWR_FLAG on ${p.net} (supply inputs and no supply output), so ERC checks what matters`);
      }
    }
    // wires, split where a connection point lies inside a segment (KiCad joins at segment ends)
    const cardWires = wires.filter((w) => w.card === card.id);
    const points: XY[] = [
      ...syms.flatMap((s) => s.pins.map((p) => p.at)),
      ...cardWires.flatMap((w) => [w.points[0] as XY, w.points[w.points.length - 1] as XY]),
      ...labels.filter((l) => l.card === card.id).map((l) => [l.x, l.y] as XY),
      ...powers.filter((p) => p.card === card.id).map((p) => [p.x, p.y] as XY),
    ];
    for (const w of cardWires) {
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1] as XY;
        const b = w.points[i] as XY;
        const cuts = points.filter((p) => onSegment(p, { a, b }) && !(p[0] === a[0] && p[1] === a[1]) && !(p[0] === b[0] && p[1] === b[1]));
        const along = (p: XY) => Math.abs(p[0] - a[0]) + Math.abs(p[1] - a[1]);
        const stops = [a, ...[...new Map(cuts.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort((x, y) => along(x) - along(y)), b];
        for (let k = 1; k < stops.length; k++) items.push(["wire", ["pts", ["xy", ...off(stops[k - 1])], ["xy", ...off(stops[k])]], stroke, ["uuid", uuid(`wire:${w.id}:${i}:${k}`)]]);
      }
    }
    for (const j of g.junctions) {
      const here = cardWires.some((w) => w.net === j.net && w.points.slice(1).some((p, i) => onSegment(j.at, { a: w.points[i] as XY, b: p as XY })));
      if (here) items.push(["junction", ["at", ...off(j.at)], ["diameter", 0], ["color", 0, 0, 0, 0], ["uuid", uuid(`junction:${card.id}:${j.at.join(",")}`)]]);
    }
    for (const l of labels.filter((x) => x.card === card.id)) {
      const angle = { right: 0, up: 90, left: 180, down: 270 }[l.side];
      items.push(["global_label", q(l.net), ["shape", "passive"], ["at", ...off([l.x, l.y]), angle], ["fields_autoplaced", "yes"], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", l.side === "left" ? "right" : "left"]], ["uuid", uuid(`lbl:${l.id}`)], ["property", q("Intersheetrefs"), q("${INTERSHEET_REFS}"), ["at", ...off([l.x, l.y]), 0], fontHidden()]]);
    }
    for (const nc of ncs) {
      const p = g.pins.get(nc.pin);
      if (!p || g.symbols.get(`sym:${p.part}`)?.rec.card !== card.id) continue;
      items.push(["no_connect", ["at", ...off(p.at)], ["uuid", uuid(`nc:${nc.pin}`)]]);
    }
    const sheet: S = ["kicad_sch", ["version", KICAD_SCH_VERSION], ["generator", q("protoboard")], ["generator_version", q("0.2")], ["uuid", uuid(`file:${card.id}`)], ["paper", paper ? q(paper[0]) : q("User"), ...(paper ? [] : [n(wmm), n(hmm)])], titleBlock(card.title), ["lib_symbols", ...[...libs.values()].sort((a, b) => byCodeUnit(a.name, b.name)).map((l) => l.sexpr)], ...items, ["embedded_fonts", "no"]];
    files[file] = `${write(sheet)}\n`;
    // the sheet box on the root
    const col = ci % 4;
    const row = Math.floor(ci / 4);
    const sx = 25.4 + col * 63.5;
    const sy = 38.1 + row * 38.1;
    sheetSymbols.push([
      "sheet",
      ["at", sx, sy],
      ["size", 50.8, 25.4],
      ["exclude_from_sim", "no"],
      ["in_bom", "yes"],
      ["on_board", "yes"],
      ["dnp", "no"],
      ["fields_autoplaced", "yes"],
      ["stroke", ["width", 0.1524], ["type", "solid"]],
      ["fill", ["color", 0, 0, 0, 0]],
      ["uuid", sheetUuid],
      ["property", q("Sheetname"), q(card.title), ["at", sx, sy - 0.7, 0], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left", "bottom"]]],
      ["property", q("Sheetfile"), q(file), ["at", sx, sy + 26, 0], ["effects", ["font", ["size", 1.27, 1.27]], ["justify", "left", "top"]]],
      ["instances", ["project", q(project), ["path", q(`/${rootId}`), ["page", q(String(ci + 2))]]]],
    ]);
  });
  const root: S = ["kicad_sch", ["version", KICAD_SCH_VERSION], ["generator", q("protoboard")], ["generator_version", q("0.2")], ["uuid", rootUuid], ["paper", q("A4")], titleBlock(""), ["lib_symbols"], ...sheetSymbols, ["sheet_instances", ["path", q("/"), ["page", q("1")]]], ["embedded_fonts", "no"]];
  const rootFile = `${project}.kicad_sch`;
  files[rootFile] = `${write(root)}\n`;
  files[`${project}.kicad_pro`] = `${JSON.stringify({ meta: { filename: `${project}.kicad_pro`, version: 1 }, erc: { rule_severities: { lib_symbol_issues: "ignore" } }, sheets: [[rootId, "Root"], ...cards.map((c) => [(uuid(`sheet:${c.id}`).raw as string).slice(1, -1), c.title])] }, null, 2)}\n`;
  notes.push("symbols are embedded in each sheet; the project sets ERC's library check (lib_symbol_issues) to ignore, since no library holds them");
  return { files, root: rootFile, notes: [...new Set(notes)] };
}

/** Write the export to a folder. */
export function exportKicad(doc: SchematicDocument, options: { dir: string; project: string }): KicadExport {
  const r = buildKicad(doc, options.project);
  mkdirSync(options.dir, { recursive: true });
  for (const [f, t] of Object.entries(r.files)) writeFileSync(join(options.dir, f), t);
  return r;
}

// ------------------------------------------------------------------ verification helpers

/** kicad-cli: `KICAD_CLI`, else on PATH, else the newest under the Program Files KiCad folders. */
export function findKicadCli(): string | undefined {
  const exe = process.platform === "win32" ? "kicad-cli.exe" : "kicad-cli";
  if (process.env.KICAD_CLI && existsSync(process.env.KICAD_CLI)) return process.env.KICAD_CLI;
  for (const d of (process.env.PATH ?? "").split(delimiter)) if (d && existsSync(join(d, exe))) return join(d, exe);
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "/usr/bin", "/usr/local/bin", "/Applications/KiCad/KiCad.app/Contents/MacOS"].filter((x): x is string => !!x);
  for (const r of roots) {
    if (existsSync(join(r, exe))) return join(r, exe);
    const k = join(r, "KiCad");
    if (!existsSync(k)) continue;
    const versions = readdirSync(k).filter((v) => /^\d/.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) if (existsSync(join(k, v, "bin", exe))) return join(k, v, "bin", exe);
  }
  return undefined;
}

type Node = string | Node[];
/** A small s-expression reader: lists and atoms (quoted strings unquoted). */
export function parseSexpr(text: string): Node[] {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "(") {
      const l: Node[] = [];
      stack[stack.length - 1].push(l);
      stack.push(l);
      i++;
    } else if (c === ")") {
      stack.pop();
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let v = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) {
          v += text[j + 1];
          j += 2;
        } else v += text[j++];
      }
      stack[stack.length - 1].push(v);
      i = j + 1;
    } else if (/\s/.test(c)) i++;
    else {
      let j = i;
      while (j < text.length && !/[\s()]/.test(text[j])) j++;
      stack[stack.length - 1].push(text.slice(i, j));
      i = j;
    }
  }
  return root;
}

const child = (l: Node[], key: string): Node[] | undefined => l.find((x): x is Node[] => Array.isArray(x) && x[0] === key);

/** The nets of a `kicad-cli sch export netlist` (kicadsexpr) file: name and `ref.pin` nodes. Unconnected one-pin nets are left out. */
export function readKicadNetlist(text: string): { name: string; nodes: string[] }[] {
  const top = parseSexpr(text)[0];
  if (!Array.isArray(top)) return [];
  const nets = child(top, "nets");
  if (!nets) return [];
  const out: { name: string; nodes: string[] }[] = [];
  for (const net of nets.slice(1)) {
    if (!Array.isArray(net) || net[0] !== "net") continue;
    const name = String(child(net, "name")?.[1] ?? "");
    const nodes = net
      .filter((x): x is Node[] => Array.isArray(x) && x[0] === "node")
      .map((nd) => `${String(child(nd, "ref")?.[1] ?? "")}.${String(child(nd, "pin")?.[1] ?? "")}`)
      .sort(byCodeUnit);
    if (/^unconnected-/.test(name) && nodes.length <= 1) continue;
    out.push({ name, nodes });
  }
  return out;
}

/** The circuit's nets as `ref.pin` sets (designators from the schematic). */
export function circuitNetlist(doc: SchematicDocument, c: SchematicCircuit = doc.circuit): { name: string; nodes: string[] }[] {
  const refs = new Map(recordsOfKind(doc, "symbol").map((s) => [s.part, s.ref]));
  return c.nets.map((n) => ({
    name: n.name,
    nodes: n.pins
      .map((k) => {
        const { part, pin } = splitPinKey(k);
        return `${refs.get(part) ?? part}.${c.parts.find((p) => p.path === part)!.pins.find((x) => x.id === pin)!.number}`;
      })
      .sort(byCodeUnit),
  }));
}

/** Whether two netlists group the same pins (names aside); the differences when not. */
export function netlistsEqual(a: { name: string; nodes: string[] }[], b: { name: string; nodes: string[] }[]): { equal: boolean; onlyA: string[][]; onlyB: string[][] } {
  const key = (ns: string[]) => ns.join(" ");
  const A = new Set(a.filter((x) => x.nodes.length).map((x) => key(x.nodes)));
  const B = new Set(b.filter((x) => x.nodes.length).map((x) => key(x.nodes)));
  const onlyA = [...A].filter((k) => !B.has(k)).map((k) => k.split(" "));
  const onlyB = [...B].filter((k) => !A.has(k)).map((k) => k.split(" "));
  return { equal: !onlyA.length && !onlyB.length, onlyA, onlyB };
}

