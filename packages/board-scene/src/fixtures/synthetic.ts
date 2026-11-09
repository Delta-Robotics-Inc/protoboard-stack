/**
 * A synthetic six-layer board built in code for size measurements and stress tests: 100 x 80 mm, six 32-pin
 * QFN-style ICs, four 2x5 through-hole headers, four mounting holes, about a hundred passives, and about a thousand
 * track segments routed as stubs, vias and L-shaped runs on the inner layers by a seeded generator. It is not a
 * real design and is not meant to pass design rules; it is meant to be big.
 */
import { createDocument, mm, padsOf, type BoardDocument, type BoardRecord, type FootprintRec, type Netlist, type Pad, type Point, type Provenance } from "@protoboardai/board";
import { seeded } from "../util.js";

const GEN: Provenance = { by: "generated", tool: "synthetic-six-layer" };
const ROUTED: Provenance = { by: "routed", tool: "synthetic-router" };

const rect = (w: number, h: number, cx = 0, cy = 0) => [
  { x: mm(cx - w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy - h / 2) },
  { x: mm(cx + w / 2), y: mm(cy + h / 2) },
  { x: mm(cx - w / 2), y: mm(cy + h / 2) },
];
const smd = (number: string, x: number, y: number, w: number, h: number): Pad => ({ number, type: "smd", shape: "rect", x: mm(x), y: mm(y), width: mm(w), height: mm(h), layer: "top" });

function fp(ref: string, name: string, x: number, y: number, pads: Pad[], court: [number, number], rotation = 0, side: "top" | "bottom" = "top"): FootprintRec {
  return { kind: "footprint", id: `fp:${ref}`, ref, footprint: name, x: mm(x), y: mm(y), rotation, side, pads, courtyard: rect(court[0], court[1]), provenance: GEN };
}

function qfn(ref: string, x: number, y: number): FootprintRec {
  const pads: Pad[] = [];
  let n = 1;
  for (let i = 0; i < 8; i++) pads.push(smd(String(n++), -3.4, 2.275 - i * 0.65, 0.8, 0.3));
  for (let i = 0; i < 8; i++) pads.push(smd(String(n++), -2.275 + i * 0.65, -3.4, 0.3, 0.8));
  for (let i = 0; i < 8; i++) pads.push(smd(String(n++), 3.4, -2.275 + i * 0.65, 0.8, 0.3));
  for (let i = 0; i < 8; i++) pads.push(smd(String(n++), 2.275 - i * 0.65, 3.4, 0.3, 0.8));
  pads.push(smd("33", 0, 0, 4.2, 4.2));
  return { ...fp(ref, "Synthetic:QFN-32-7x7", x, y, pads, [8.4, 8.4]), value: "MCU-32" };
}

function header(ref: string, x: number, y: number, rotation: number): FootprintRec {
  const pads: Pad[] = [];
  for (let i = 0; i < 10; i++) pads.push({ number: String(i + 1), type: "th", shape: i === 0 ? "rect" : "circle", x: mm(((i % 2) - 0.5) * 2.54), y: mm((2 - Math.floor(i / 2)) * 2.54), ...(i === 0 ? { outer_width: mm(1.7), outer_height: mm(1.7), hole_diameter: mm(1.0) } : { outer_diameter: mm(1.7), hole_diameter: mm(1.0) }) });
  return { ...fp(ref, "Synthetic:Header-2x5-2.54", x, y, pads, [5.6, 13.2], rotation), value: "2x5" };
}

function chip(ref: string, x: number, y: number, rotation: number, side: "top" | "bottom" = "top"): FootprintRec {
  return { ...fp(ref, ref.startsWith("R") ? "Synthetic:R_0402" : "Synthetic:C_0402", x, y, [smd("1", -0.48, 0, 0.56, 0.62), smd("2", 0.48, 0, 0.56, 0.62)], [1.6, 0.9], rotation, side), value: ref.startsWith("R") ? "10 k" : "100 nF" };
}

function hole(ref: string, x: number, y: number): FootprintRec {
  return fp(ref, "Synthetic:MountingHole-3.2", x, y, [{ number: "1", type: "np", shape: "circle", x: 0, y: 0, hole_diameter: mm(3.2) }], [6.4, 6.4]);
}

/** The synthetic six-layer board and its netlist. */
export function syntheticSixLayer(seed = 7): { doc: BoardDocument; netlist: Netlist } {
  const rnd = seeded(seed);
  const fps: FootprintRec[] = [];
  const ics: FootprintRec[] = [];
  const icPos = [
    [-30, 15],
    [0, 15],
    [30, 15],
    [-30, -15],
    [0, -15],
    [30, -15],
  ];
  icPos.forEach(([x, y], i) => ics.push(qfn(`U${i + 1}`, x, y)));
  fps.push(...ics);
  const headers = [header("J1", -44, 30, 0), header("J2", 44, 30, 0), header("J3", -44, -30, 0), header("J4", 44, -30, 0)];
  fps.push(...headers);
  fps.push(hole("H1", -46, 0), hole("H2", 46, 0), hole("H3", -15, 0), hole("H4", 15, 0));
  // passives around each IC: 9 resistors and 9 capacitors on a ring
  let r = 1;
  let c = 1;
  const passives: FootprintRec[] = [];
  icPos.forEach(([x, y]) => {
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const rad = 7.5 + (k % 2) * 1.6;
      const ref = k % 2 ? `C${c++}` : `R${r++}`;
      passives.push(chip(ref, Math.round((x + rad * Math.cos(a)) * 100) / 100, Math.round((y + rad * Math.sin(a)) * 100) / 100, (Math.round((a * 180) / Math.PI / 90) % 4) * 90_000, k % 6 === 5 ? "bottom" : "top"));
    }
  });
  fps.push(...passives);

  // nets
  const nets = new Map<string, string[]>();
  const add = (net: string, pin: string) => {
    const l = nets.get(net) ?? [];
    l.push(pin);
    nets.set(net, l);
  };
  for (const u of ics) {
    add("GND", `${u.ref}.33`);
    add("+3V3", `${u.ref}.1`);
    add("+1V8", `${u.ref}.17`);
  }
  for (const p of passives) {
    if (p.ref.startsWith("C")) {
      add(Number(p.ref.slice(1)) % 2 ? "+3V3" : "+1V8", `${p.ref}.1`);
      add("GND", `${p.ref}.2`);
    }
  }
  for (const h of headers) {
    add("GND", `${h.ref}.2`);
    add("+3V3", `${h.ref}.1`);
  }
  // signals: each IC side talks to its neighbors; resistors sit in series on some of them
  let sig = 0;
  const pinsFree = new Map(ics.map((u) => [u.ref, [...Array(32).keys()].map((i) => i + 1).filter((n) => n !== 1 && n !== 17)]));
  const take = (ref: string) => {
    const l = pinsFree.get(ref)!;
    return l.length ? l.splice(Math.floor(rnd() * l.length), 1)[0] : undefined;
  };
  const pairs: [number, number][] = [
    [0, 1],
    [1, 2],
    [3, 4],
    [4, 5],
    [0, 3],
    [1, 4],
    [2, 5],
    [0, 4],
    [1, 5],
  ];
  for (let round = 0; round < 5; round++)
    for (const [a, b] of pairs) {
      const pa = take(ics[a].ref);
      const pb = take(ics[b].ref);
      if (pa === undefined || pb === undefined) continue;
      add(`SIG${String(++sig).padStart(3, "0")}`, `${ics[a].ref}.${pa}`);
      add(`SIG${String(sig).padStart(3, "0")}`, `${ics[b].ref}.${pb}`);
    }
  // series resistors: IC pin -> R.1, R.2 -> another IC's pin or a header pin
  const hp = new Map(headers.map((h) => [h.ref, 3]));
  passives
    .filter((p) => p.ref.startsWith("R"))
    .forEach((p, i) => {
      const u = ics[i % 6];
      const pin = take(u.ref);
      if (pin === undefined) return;
      const n1 = `SIG${String(++sig).padStart(3, "0")}`;
      add(n1, `${u.ref}.${pin}`);
      add(n1, `${p.ref}.1`);
      const n2 = `SIG${String(++sig).padStart(3, "0")}`;
      add(n2, `${p.ref}.2`);
      const h = headers[i % 4];
      const next = hp.get(h.ref)!;
      if (i % 3 === 0 && next <= 10) {
        add(n2, `${h.ref}.${next}`);
        hp.set(h.ref, next + 1);
      } else {
        const v = ics[(i + 2) % 6];
        const q = take(v.ref);
        if (q !== undefined) add(n2, `${v.ref}.${q}`);
      }
    });
  const netlist: Netlist = { source: "fixture", nets: [...nets.entries()].map(([name, pins]) => ({ name, ...(name === "GND" || name.startsWith("+") ? { class: "power" } : {}), pins: [...new Set(pins)].sort() })) };

  // world pad positions
  const byRef = new Map(fps.map((f) => [f.ref, f]));
  const padAt = (pin: string): Point & { side: "top" | "bottom"; th: boolean } => {
    const [ref, num] = pin.split(".");
    const f = byRef.get(ref)!;
    const p = padsOf(f).find((x) => x.pad.number === num)!;
    return { x: p.x, y: p.y, side: f.side, th: p.pad.type === "th" };
  };
  const copper: BoardRecord[] = [];
  let t = 0;
  let v = 0;
  const inner = ["inner1", "inner2", "inner3", "inner4", "bottom"] as const;
  const seg = (net: string, layer: string, w: number, a: Point, b: Point) => {
    if (a.x === b.x && a.y === b.y) return;
    copper.push({ kind: "track", id: `trk:s.${String(++t).padStart(4, "0")}`, net, layer: layer as never, width: mm(w), start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, provenance: ROUTED });
  };
  const via = (net: string, at: Point) => copper.push({ kind: "via", id: `via:s.${String(++v).padStart(4, "0")}`, net, x: at.x, y: at.y, outer_diameter: mm(0.6), hole_diameter: mm(0.3), from_layer: "top", to_layer: "bottom", provenance: ROUTED });
  const names = [...nets.keys()].sort();
  for (const name of names) {
    const pins = nets.get(name)!.slice().sort();
    if (name === "GND") {
      // GND is the inner1 pour: each surface pad drops to it through a stub and a via
      for (const pin of pins) {
        const a = padAt(pin);
        if (a.th) continue;
        const bend = { x: a.x + mm(0.5 + rnd() * 0.3), y: a.y };
        const at = { x: bend.x + mm(0.4), y: a.y - mm(0.7 + rnd() * 0.4) };
        seg(name, a.side, 0.3, a, bend);
        seg(name, a.side, 0.3, bend, at);
        via(name, at);
      }
      continue;
    }
    const w = name.startsWith("+") ? 0.4 : 0.15;
    for (let i = 0; i + 1 < pins.length; i++) {
      // skip a few links so the board has unrouted work
      if (rnd() < 0.06) continue;
      const a = padAt(pins[i]);
      const b = padAt(pins[i + 1]);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const sideA = a.th ? "top" : a.side;
      if (d < mm(6) && a.side === b.side && !a.th && !b.th) {
        const corner = { x: b.x, y: a.y };
        seg(name, sideA, w, a, corner);
        seg(name, sideA, w, corner, b);
        continue;
      }
      const off = () => mm((rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 0.6));
      const va = a.th ? a : { x: a.x + off(), y: a.y + off() };
      const vb = b.th ? b : { x: b.x + off(), y: b.y + off() };
      if (!a.th) {
        seg(name, a.side, w, a, va);
        via(name, va);
      }
      if (!b.th) {
        seg(name, b.side, w, b, vb);
        via(name, vb);
      }
      const layer = inner[Math.floor(rnd() * inner.length)];
      const mid = rnd() < 0.5 ? { x: vb.x, y: va.y } : { x: va.x, y: vb.y };
      const jog = { x: Math.round((va.x + mid.x) / 2), y: Math.round((va.y + mid.y) / 2) };
      seg(name, layer, w, va, jog);
      seg(name, layer, w, jog, mid);
      seg(name, layer, w, mid, vb);
    }
  }
  const layers: BoardRecord[] = [{ kind: "layer", id: "layer:top_mask", name: "top_mask", type: "soldermask", order: 0, thickness: mm(0.01) }];
  const cu = ["top", "inner1", "inner2", "inner3", "inner4", "bottom"];
  cu.forEach((name, i) => {
    layers.push({ kind: "layer", id: `layer:${name}`, name, type: "copper", order: 1 + i * 2, thickness: mm(0.035), copper_weight_oz: 1 });
    if (i < cu.length - 1) layers.push({ kind: "layer", id: `layer:d${i + 1}`, name: `d${i + 1}`, type: "dielectric", order: 2 + i * 2, thickness: mm(0.25), material: "FR4", epsilon_r: 4.3 });
  });
  layers.push({ kind: "layer", id: "layer:bottom_mask", name: "bottom_mask", type: "soldermask", order: 12, thickness: mm(0.01) });
  const records: BoardRecord[] = [
    { kind: "board", id: "board", name: "Synthetic six-layer", thickness: mm(1.6), copper_layers: 6, origin: "center" },
    ...layers,
    { kind: "outline", id: "outline", outline: rect(100, 80), source: { kind: "board" }, provenance: GEN },
    ...fps,
    ...copper,
    { kind: "zone", id: "zone:s.gnd", net: "GND", layers: ["inner1"], outline: rect(99, 79), priority: 0, pad_connection: "solid", fill_mode: "solid", remove_islands: "always", name: "GND plane", provenance: GEN },
    { kind: "zone", id: "zone:s.3v3", net: "+3V3", layers: ["inner2"], outline: rect(40, 30, -25, 20), priority: 1, pad_connection: "thermal", fill_mode: "solid", remove_islands: "always", name: "3V3 island", provenance: GEN },
    { kind: "keepout", id: "kpo:s.h3", outline: rect(7, 7, -15, 0), layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"], blocks: { tracks: true, vias: true, pours: true, footprints: true }, tier: "no_go", name: "hole H3 keep-out", provenance: GEN },
    { kind: "rule", id: "rule:target.track_width", tier: "target", check: "track_width", applies: {}, min: mm(0.15), preferred: mm(0.15) },
    { kind: "rule", id: "rule:target.clearance", tier: "target", check: "clearance", applies: {}, min: mm(0.15) },
  ];
  return { doc: createDocument(records, netlist), netlist };
}
