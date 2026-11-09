/**
 * The agent scene (contract section 10.2): a compact JSON description of the sheet, sized for a model's
 * context, whose marker numbers are the numbered rings in the matching image (as `@protoboardai/board-scene`
 * does for boards). Relations, not only positions: neighbors by direction, the pin a part serves, where each pin
 * ends (wire, label, power symbol, no-connect, open). Same document in, same bytes out.
 */
import { svgToPng } from "@protoboardai/board-scene";
import { byCodeUnit } from "@protoboardai/board";
import { electricalChecks, type SchematicFinding } from "./checks.ts";
import { splitPinKey } from "./circuit.ts";
import { isRail, recordsOfKind, type SchematicDocument } from "./document.ts";
import { boxCenter, boxGap, drawnNetlist, geometryOf, inflateBox, labelBox, onSegment, unionBoxes } from "./geometry.ts";
import { classify } from "./layout/classify.ts";
import { cardCrop, renderSchematicSvg, signalClassOf, type Marker } from "./render/svg.ts";
import { scoreSchematic, type Score } from "./score.ts";
import type { LBox } from "./symbols.ts";
import { GU_MM, type XY } from "./units.ts";

export const SCENE_SCHEMA = "protoboard.schematic-scene/v1";

export interface DescribeOptions {
  /** one card, cropped with a halo */
  card?: string;
  /** one net highlighted */
  net?: string;
  image?: "svg" | "png" | "both" | "none";
  theme?: "dark" | "paper";
  /** pixels per grid unit in the image (default 16) */
  scale?: number;
  score?: Score;
  findings?: SchematicFinding[];
}

export interface DescribeResult {
  json: Record<string, unknown>;
  svg?: string;
  png?: Uint8Array;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const bx = (b: LBox): [number, number, number, number] => [r1(b.x0), r1(b.y0), r1(b.x1), r1(b.y1)];
type Direction = "left" | "right" | "up" | "down";
function direction(a: XY, b: XY): Direction {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

export function describeSchematic(doc: SchematicDocument, o: DescribeOptions = {}): DescribeResult {
  const g = geometryOf(doc);
  const cls = classify(doc);
  const score = o.score ?? scoreSchematic(doc);
  const findings = o.findings ?? electricalChecks(doc.circuit, doc);
  const cards = recordsOfKind(doc, "card");
  const labels = recordsOfKind(doc, "label");
  const powers = recordsOfKind(doc, "power");
  const wires = recordsOfKind(doc, "wire");
  const ncs = new Set(recordsOfKind(doc, "noconnect").map((n) => n.pin));
  const dn = drawnNetlist(doc, { byName: false });
  const inCard = (card?: string) => !o.card || card === o.card;
  const cardBox = (c: { x: number; y: number; w: number; h: number }): LBox => ({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h });

  // where each pin ends
  const endOf = (key: string): string => {
    const p = g.pins.get(key)!;
    if (!p.net) return ncs.has(key) ? "nc" : "open";
    if (powers.some((x) => x.x === p.at[0] && x.y === p.at[1])) return "power";
    if (labels.some((x) => x.x === p.at[0] && x.y === p.at[1])) return "label";
    if (g.segments.some((s) => onSegment(p.at, s))) return "wire";
    return "open";
  };

  const symbols = [...g.symbols.values()].sort((a, b) => byCodeUnit(a.rec.id, b.rec.id));
  const parts = symbols
    .filter((s) => inCard(s.rec.card))
    .map((s) => {
      const info = cls.parts.get(s.part.path);
      const near: Record<string, [string, number]> = {};
      for (const other of symbols) {
        if (other === s || other.rec.card !== s.rec.card) continue;
        const d = direction(s.center, other.center);
        const gap = r1(boxGap(s.body, other.body));
        if (!near[d] || gap < near[d][1]) near[d] = [other.rec.ref, gap];
      }
      return {
        id: s.rec.id,
        ref: s.rec.ref,
        ...(s.part.value ? { value: s.part.value } : {}),
        class: s.part.class,
        ...(info?.anchor ? { role: "anchor" } : info?.role ? { role: info.role } : {}),
        ...(info?.serves ? { serves: info.serves.replace(/^sat:/, "") } : {}),
        card: s.rec.card,
        box: bx(s.body),
        rot: s.rec.rotation,
        ...(s.rec.mirror ? { mirror: true } : {}),
        ...(s.rec.pinned ? { pinned: true } : {}),
        symbol: s.resolved.family,
        fields: { ref: bx(s.ref), ...(s.value ? { value: bx(s.value) } : {}) },
        pins: s.pins.map((p) => [p.pin, p.name, p.keys.length > 1 ? p.keys.map((k) => s.part.pins.find((x) => `${s.part.path}:${x.id}` === k)?.number ?? "").join(",") : p.number, p.dir, p.at, p.net ?? null, endOf(p.key)]),
        near,
      };
    });

  const nets = doc.circuit.nets
    .filter((n) => !o.card || (cls.nets.get(n.name)?.cards ?? []).includes(o.card))
    .map((n) => {
      const info = cls.nets.get(n.name)!;
      const style: Record<string, string> = {};
      for (const c of info.cards) {
        const ls = labels.filter((l) => l.net === n.name && l.card === c).length;
        const ps = powers.filter((p) => p.net === n.name && p.card === c).length;
        const ws = wires.filter((w) => w.net === n.name && w.card === c).length;
        style[c] = ps ? "power" : ws && !ls ? "wire" : ws ? "wire+label" : ls ? "label" : "none";
      }
      return {
        name: n.name,
        class: info.cls,
        color: signalClassOf(doc, n.name),
        pins: n.pins.length,
        cards: info.cards,
        style,
        ...(o.card || o.net === n.name ? { wires: wires.filter((w) => w.net === n.name && inCard(w.card)).map((w) => w.points) } : {}),
        junctions: g.junctions.filter((j) => j.net === n.name).map((j) => j.at),
        labels: labels.filter((l) => l.net === n.name && inCard(l.card)).map((l) => ({ at: [l.x, l.y], card: l.card, scope: l.scope, box: bx(labelBox(l, doc)) })),
      };
    });

  // card relations and digests
  const flows = (card: string, dir: "in" | "out") =>
    [...cls.nets.values()]
      .filter((n) => n.cards.includes(card) && n.cards.length > 1 && n.cls !== "ground" && !isRail(doc, n.name))
      .filter((n) => {
        const pins = n.pinsIn.get(card) ?? [];
        const out = pins.some((k) => {
          const t = doc.parts.get(splitPinKey(k).part)!.pins.find((x) => x.id === splitPinKey(k).pin)!.type;
          return t === "output" || t === "power_out" || doc.parts.get(splitPinKey(k).part)!.class === "mcu";
        });
        return dir === "out" ? out : !out;
      })
      .map((n) => n.name)
      .sort(byCodeUnit);
  const cardList = cards
    .filter((c) => inCard(c.id))
    .map((c) => {
      const members = symbols.filter((s) => s.rec.card === c.id);
      const anchor = members.find((s) => cls.parts.get(s.part.path)?.anchor);
      const neighbors: Record<string, string[]> = {};
      for (const other of cards) {
        if (other === c) continue;
        const d = direction(boxCenter(cardBox(c)), boxCenter(cardBox(other)));
        (neighbors[d] ??= []).push(other.id);
      }
      const defects = score.defects.filter((d) => d.card === c.id);
      const inN = flows(c.id, "in");
      const outN = flows(c.id, "out");
      const sats = members.filter((s) => s !== anchor).map((s) => `${s.rec.ref} ${(cls.parts.get(s.part.path)?.role ?? "part").replace("_", "-")}`);
      const digest = `${c.title}: ${anchor ? `${anchor.rec.ref} ${anchor.part.value ?? anchor.part.mpn ?? anchor.part.name} at center` : "no anchor part"}; ${inN.length ? `${inN.join(", ")} enter` : "nothing enters"}; ${outN.length ? `${outN.join(", ")} leave` : "nothing leaves"}; ${sats.length ? sats.join(", ") : "no other parts"}; score ${score.cards[c.id] ?? "-"}; ${defects.length ? `defects ${defects.map((d) => d.n).join(", ")}` : "no defects"}.`;
      return { id: c.id, title: c.title, group: c.group, box: bx(cardBox(c)), members: members.map((s) => s.rec.id), ...(anchor ? { anchor: anchor.rec.id } : {}), flowIn: inN, flowOut: outN, neighbors, score: score.cards[c.id], digest };
    });

  // markers: defects, then electrical findings, numbered on from the defects
  const defects = score.defects.filter((d) => inCard(d.card));
  const firstFinding = score.defects.length + 1;
  const findingList = findings.filter((f) => inCard(f.location?.card)).map((f, i) => ({ n: firstFinding + i, ...f }));
  const markers: Marker[] = [
    ...defects.filter((d) => d.severity !== "info").map((d) => ({ n: d.n, at: d.at, severity: d.severity })),
    ...findingList.filter((f) => f.location).map((f) => ({ n: f.n, at: [f.location!.x, f.location!.y] as XY, severity: f.severity })),
  ];
  const sheetBox = unionBoxes(cards.map(cardBox));
  const json: Record<string, unknown> = {
    schema: SCENE_SCHEMA,
    units: { length: "gu", gu_mm: GU_MM, y: "down", box: "[x0, y0, x1, y1]" },
    legend: { pin: "[pin id, name, number(s), side, at, net, end]", end: "wire | label | power | nc | open", near: "nearest part in the card per direction: [ref, gap]" },
    sheet: { board: doc.circuit.board, bounds: bx(sheetBox), score: score.score, presentable: score.presentable, gates: score.gates, counts: { cards: cards.length, parts: symbols.length, nets: doc.circuit.nets.length, wires: wires.length, labels: labels.length, power: powers.length } },
    view: { ...(o.card ? { card: o.card } : {}), ...(o.net ? { net: o.net } : {}) },
    cards: cardList,
    parts,
    nets,
    defects,
    findings: findingList,
    markers: markers.map((m) => [m.n, m.n < firstFinding ? `D${m.n}` : findingList.find((f) => f.n === m.n)!.id]),
    rules: score.rules.filter((r) => r.count).map((r) => [r.id, r.severity, r.count, r.opportunities]),
  };
  void dn;
  const out: DescribeResult = { json };
  if (o.image && o.image !== "none") {
    const crop = o.card ? cardCrop(doc, o.card, 4) : undefined;
    const svg = renderSchematicSvg(doc, { theme: o.theme ?? "dark", scale: o.scale ?? 16, markers, ...(crop ? { crop: inflateBox(crop, 0) } : {}), ...(o.net ? { highlight: o.net } : {}) });
    if (o.image === "svg" || o.image === "both") out.svg = svg;
    if (o.image === "png" || o.image === "both") out.png = svgToPng(svg).png;
  }
  return out;
}
