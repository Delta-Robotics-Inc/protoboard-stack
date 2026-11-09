/**
 * Every schematic operation (contract section 8.2). Each `apply` is pure and returns the exact inverse. Operations
 * change presentation only: no operation edits connectivity, which comes from UHD.
 */
import { z } from "zod";
import { byCodeUnit, canonicalRecord, deterministicKey } from "@protoboardai/board";
import { pinKey, splitPinKey } from "../circuit.ts";
import { recordsOfKind, withChanges, type SchematicDocument } from "../document.ts";
import { cardTitleBoxes, geometryOf, labelBox, placeSymbol, powerBoxes } from "../geometry.ts";
import { layoutSchematic } from "../layout/index.ts";
import { Grid, routeNet, type Terminal } from "../layout/route.ts";
import { DirSchema, Gu, Point, RECORD_SCHEMAS, type RecordKind, type SchematicRecord, type SymbolRecT } from "../schema.ts";
import { scoreSchematic } from "../score.ts";
import { opposite, type Rotation, type XY } from "../units.ts";
import { change, distinct, edited, getOperation, need, OpError, pinIfMoved, registerOperation, type ApplyContext, type ApplyResult, type OpCall } from "./registry.ts";

export * from "./registry.ts";

const Ids = z.array(z.string().min(1)).min(1).max(10_000);
const Handle = z.string().regex(/^[A-Za-z0-9_]{1,40}$/);

/** A new id from a handle (or an owner-issued one) and the created map. */
function newId(ctx: ApplyContext, kind: RecordKind, handle: string | undefined, created: Record<string, string>): string {
  const id = ctx.issueId(kind);
  if (handle) {
    if (created[handle]) throw new OpError(`handle ${handle} is used twice`);
    created[handle] = id;
  }
  return id;
}

/** The result of going from one document to another, with the exact inverse (multi-step operations). */
export function diffResult(before: SchematicDocument, after: SchematicDocument, created?: Record<string, string>): ApplyResult {
  const puts: SchematicRecord[] = [];
  const removes: string[] = [];
  for (const [id, r] of after.records) {
    const o = before.records.get(id);
    if (!o || (o !== r && canonicalRecord(o) !== canonicalRecord(r))) puts.push(r);
  }
  for (const id of before.records.keys()) if (!after.records.has(id)) removes.push(id);
  return change(before, puts, removes, created);
}

const needNet = (doc: SchematicDocument, net: string) => {
  if (!doc.nets.has(net)) throw new OpError(`net ${net} is not in the circuit (nets come from UHD)`);
};
const needCard = (doc: SchematicDocument, card: string) => need(doc, card, ["card"]);

function rotatedAboutCenter(doc: SchematicDocument, s: SymbolRecT, next: Partial<SymbolRecT>): SymbolRecT {
  const before = placeSymbol(doc, s)!;
  const trial = { ...s, ...next } as SymbolRecT;
  const after = placeSymbol(doc, trial)!;
  const dx = Math.round(before.center[0] - after.center[0]);
  const dy = Math.round(before.center[1] - after.center[1]);
  return { ...trial, x: trial.x + dx, y: trial.y + dy };
}

// ------------------------------------------------------------------ symbols

registerOperation({
  name: "symbol.place",
  title: "Place a symbol",
  description: "Absolute placement and look of one symbol: position (grid units, +Y down), rotation (0, 90, 180, 270), mirror, the pack variant or a symbol override, and where its reference and value sit (fields: offset from the symbol origin and text anchor; null returns them to the derived place).",
  input: z.object({ id: z.string(), x: Gu.optional(), y: Gu.optional(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(), mirror: z.boolean().optional(), variant: z.string().max(60).nullable().optional(), symbol: z.string().max(120).nullable().optional(), fields: z.object({ dx: Gu, dy: Gu, anchor: z.enum(["left", "right"]) }).strict().nullable().optional(), pin: z.boolean().optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { id: "sym:sensor/r_sda", x: 120, y: 10 },
  apply(doc, input, ctx) {
    const s = need(doc, input.id, ["symbol"]);
    let r: SymbolRecT = { ...s, ...(input.x !== undefined ? { x: input.x } : {}), ...(input.y !== undefined ? { y: input.y } : {}), ...(input.rotation !== undefined ? { rotation: input.rotation as Rotation } : {}) };
    if (input.mirror === true) r.mirror = true;
    if (input.mirror === false) delete r.mirror;
    if (input.variant === null) delete r.variant;
    else if (input.variant) r.variant = input.variant;
    if (input.symbol === null) delete r.symbol;
    else if (input.symbol) r.symbol = input.symbol;
    if (input.fields === null) delete r.fields;
    else if (input.fields) r.fields = { ...input.fields };
    if (input.x !== undefined || input.y !== undefined) r = pinIfMoved(r, ctx, input.pin);
    return change(doc, [edited(r, ctx)]);
  },
});

registerOperation({
  name: "symbol.rotate",
  title: "Rotate symbols",
  description: "Rotate each symbol counterclockwise by 90, 180 or 270 degrees about its body center (snapped to the grid).",
  input: z.object({ ids: Ids, angle: z.union([z.literal(90), z.literal(180), z.literal(270)]) }).strict(),
  audience: "all",
  phase: 3,
  example: { ids: ["sym:sensor/r_sda"], angle: 180 },
  apply(doc, input, ctx) {
    const puts = distinct(input.ids).map((id) => {
      const s = need(doc, id, ["symbol"]);
      const rotation = ((s.rotation + input.angle) % 360) as Rotation;
      return edited(pinIfMoved(rotatedAboutCenter(doc, s, { rotation }), ctx), ctx);
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "symbol.mirror",
  title: "Mirror symbols",
  description: "Mirror each symbol left to right in its own frame, about its body center.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 3,
  example: { ids: ["sym:status/led1"] },
  apply(doc, input, ctx) {
    const puts = distinct(input.ids).map((id) => {
      const s = need(doc, id, ["symbol"]);
      const next = rotatedAboutCenter(doc, s, s.mirror ? {} : { mirror: true });
      if (s.mirror) delete (next as { mirror?: true }).mirror;
      return edited(pinIfMoved(next, ctx), ctx);
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "item.move",
  title: "Move items",
  description: "Translate symbols, labels, power symbols, text, frames, wires or cards by whole grid units. A card moves with everything in it. A person's move pins what it moved unless pin is false.",
  input: z.object({ ids: Ids, dx: Gu, dy: Gu, pin: z.boolean().optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { ids: ["sym:sensor/r_sda"], dx: 2, dy: 0 },
  apply(doc, input, ctx) {
    const out = new Map<string, SchematicRecord>();
    const shift = (r: SchematicRecord, pin: boolean): SchematicRecord => {
      let m: SchematicRecord;
      switch (r.kind) {
        case "symbol":
        case "label":
        case "power":
        case "text":
        case "card":
        case "frame":
          m = { ...r, x: r.x + input.dx, y: r.y + input.dy };
          break;
        case "wire":
          m = { ...r, points: r.points.map(([x, y]) => [x + input.dx, y + input.dy] as [number, number]) };
          break;
        default:
          throw new OpError(`${r.id} is a ${r.kind}; it cannot be moved`);
      }
      return edited(pin ? pinIfMoved(m, ctx, input.pin) : m, ctx);
    };
    for (const id of distinct(input.ids)) {
      const r = doc.records.get(id);
      if (!r) throw new OpError(`no object ${id} on this schematic`);
      out.set(id, shift(r, true));
      if (r.kind === "card") for (const x of doc.records.values()) if ("card" in x && x.card === id && !out.has(x.id)) out.set(x.id, shift(x, false));
    }
    return change(doc, [...out.values()]);
  },
});

// ------------------------------------------------------------------ wires

const WireIn = z.object({ handle: Handle.optional(), net: z.string(), card: z.string(), points: z.array(Point).min(2).max(10_000) }).strict();

registerOperation({
  name: "wire.add",
  title: "Add wires",
  description: "Add orthogonal wires that draw a UHD net inside a card. A wire never makes a connection UHD does not have: the readability gates refuse to call a sheet presentable when it draws one.",
  input: z.object({ wires: z.array(WireIn).min(1).max(1000), pin: z.boolean().optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { wires: [{ net: "I2C_SDA", card: "card:sensor", points: [[100, 10], [104, 10]] }] },
  apply(doc, input, ctx) {
    const created: Record<string, string> = {};
    const puts = input.wires.map((w) => {
      needNet(doc, w.net);
      needCard(doc, w.card);
      const id = newId(ctx, "wire", w.handle, created);
      return pinIfMoved({ kind: "wire", id, net: w.net, card: w.card, points: w.points as [number, number][], provenance: ctx.provenance } as SchematicRecord, ctx, input.pin);
    });
    return change(doc, puts, [], created);
  },
});

registerOperation({
  name: "wire.edit",
  title: "Reshape a wire",
  description: "Replace a wire's points (orthogonal, grid units).",
  input: z.object({ id: z.string(), points: z.array(Point).min(2).max(10_000) }).strict(),
  audience: "all",
  phase: 3,
  example: { id: "wire:example", points: [[0, 0], [2, 0]] },
  apply(doc, input, ctx) {
    const w = need(doc, input.id, ["wire"]);
    return change(doc, [edited(pinIfMoved({ ...w, points: input.points as [number, number][] }, ctx), ctx)]);
  },
});

for (const [kind, name, title] of [
  ["wire", "wire.delete", "Delete wires"],
  ["label", "label.delete", "Delete labels"],
  ["power", "power.delete", "Delete power symbols"],
  ["noconnect", "noconnect.delete", "Delete no-connect marks"],
  ["text", "text.delete", "Delete text"],
  ["proposal", "proposal.reject", "Reject proposals"],
] as const) {
  registerOperation({
    name,
    title,
    description: `${title} by id.`,
    input: z.object({ ids: Ids }).strict(),
    audience: "all",
    phase: 3,
    example: { ids: [`${kind === "noconnect" ? "nc" : kind === "label" ? "lbl" : kind === "power" ? "pwr" : kind === "text" ? "txt" : kind === "proposal" ? "prop" : "wire"}:example`] },
    apply(doc, input) {
      for (const id of distinct(input.ids)) need(doc, id, [kind]);
      return change(doc, [], [...input.ids]);
    },
  });
}

registerOperation({
  name: "wire.to_label",
  title: "Replace wires with labels",
  description: "Remove wires and put a label on each pin they reached, so the net is named instead of drawn.",
  input: z.object({ ids: Ids }).strict(),
  audience: "all",
  phase: 3,
  example: { ids: ["wire:example"] },
  apply(doc, input, ctx) {
    const g = geometryOf(doc);
    const created: Record<string, string> = {};
    const puts: SchematicRecord[] = [];
    const seen = new Set<string>();
    for (const id of distinct(input.ids)) {
      const w = need(doc, id, ["wire"]);
      for (const end of [w.points[0], w.points[w.points.length - 1]]) {
        const pin = [...g.pins.values()].find((p) => p.at[0] === end[0] && p.at[1] === end[1] && p.net === w.net);
        if (!pin || seen.has(pin.key)) continue;
        seen.add(pin.key);
        const crosses = new Set(doc.nets.get(w.net)!.pins.map((k) => g.symbols.get(`sym:${splitPinKey(k).part}`)?.rec.card)).size > 1;
        puts.push({ kind: "label", id: newId(ctx, "label", undefined, created), net: w.net, card: w.card, x: pin.at[0], y: pin.at[1], side: pin.dir, scope: crosses ? "port" : "local", provenance: ctx.provenance });
      }
    }
    return change(doc, puts, [...input.ids], created);
  },
});

registerOperation({
  name: "label.to_wire",
  title: "Wire a labeled net",
  description: "Replace a net's labels inside one card with a routed wire between its pins there; one port label stays when the net leaves the card.",
  input: z.object({ net: z.string(), card: z.string() }).strict(),
  audience: "all",
  phase: 3,
  example: { net: "I2C_SDA", card: "card:sensor" },
  apply(doc, input, ctx) {
    needNet(doc, input.net);
    const card = needCard(doc, input.card);
    const g = geometryOf(doc);
    const members = new Set([...g.symbols.values()].filter((s) => s.rec.card === card.id).map((s) => s.part.path));
    const pins = [...g.pins.values()].filter((p) => p.net === input.net && members.has(p.part));
    const labels = recordsOfKind(doc, "label").filter((l) => l.net === input.net && l.card === card.id);
    const crosses = doc.nets.get(input.net)!.pins.some((k) => !members.has(splitPinKey(k).part));
    const keep = crosses ? labels.sort((a, b) => byCodeUnit(a.id, b.id))[0] : undefined;
    const terms: Terminal[] = pins.map((p) => ({ at: p.at, exit: p.dir }));
    if (keep) terms.push({ at: [keep.x, keep.y], exit: opposite(keep.side) });
    if (terms.length < 2) throw new OpError(`${input.net} has fewer than two ends in ${card.title}; nothing to wire`);
    const grid = new Grid({ x0: card.x, y0: card.y, x1: card.x + card.w, y1: card.y + card.h });
    for (const s of g.symbols.values()) {
      if (s.rec.card !== card.id) continue;
      grid.wallBox(s.body);
      grid.wallBox(s.ref, 0.1);
      if (s.value) grid.wallBox(s.value, 0.1);
      for (const p of s.pins) grid.own(p.at, p.net === input.net ? "self" : `pin:${p.key}`);
    }
    for (const l of recordsOfKind(doc, "label")) if (l.card === card.id && l.id !== keep?.id && l.net !== input.net) grid.wallBox(labelBox(l), 0.1);
    for (const p of recordsOfKind(doc, "power")) if (p.card === card.id) {
      const b = powerBoxes(p);
      grid.wallBox(b.glyph, 0.1);
      if (b.text) grid.wallBox(b.text, 0.1);
    }
    for (const w of recordsOfKind(doc, "wire")) if (w.card === card.id && w.net !== input.net) grid.addWire(w.id, w.points as XY[]);
    grid.wallBox(cardTitleBoxes(card).tag, 0.1);
    const r = routeNet(grid, "self", terms);
    if (r.failed.length) throw new OpError(`${input.net} cannot be wired in ${card.title} without crossing a part; move parts first`);
    const removes = labels.filter((l) => l.id !== keep?.id).map((l) => l.id);
    const created: Record<string, string> = {};
    const puts: SchematicRecord[] = r.paths.map((points) => ({ kind: "wire", id: newId(ctx, "wire", undefined, created), net: input.net, card: card.id, points: points as [number, number][], provenance: ctx.provenance }));
    return change(doc, puts, removes, created);
  },
});

// ------------------------------------------------------------------ labels, power symbols, marks, text

registerOperation({
  name: "label.add",
  title: "Add labels",
  description: "Name a net at a point: scope port joins it across cards, local names it inside one card. The anchor sits on a pin or a wire end; side is the way the text runs.",
  input: z.object({ labels: z.array(z.object({ handle: Handle.optional(), net: z.string(), card: z.string(), x: Gu, y: Gu, side: DirSchema, scope: z.enum(["local", "port"]) }).strict()).min(1).max(1000) }).strict(),
  audience: "all",
  phase: 3,
  example: { labels: [{ net: "BOOT", card: "card:ui", x: 0, y: 0, side: "left", scope: "port" }] },
  apply(doc, input, ctx) {
    const created: Record<string, string> = {};
    const puts = input.labels.map((l) => {
      needNet(doc, l.net);
      needCard(doc, l.card);
      return { kind: "label", id: newId(ctx, "label", l.handle, created), net: l.net, card: l.card, x: l.x, y: l.y, side: l.side, scope: l.scope, provenance: ctx.provenance } as SchematicRecord;
    });
    return change(doc, puts, [], created);
  },
});

registerOperation({
  name: "power.add",
  title: "Add power symbols",
  description: "A ground or supply symbol on a pin or wire end; dir is where it points (ground down, supplies up).",
  input: z.object({ symbols: z.array(z.object({ handle: Handle.optional(), net: z.string(), card: z.string(), x: Gu, y: Gu, dir: z.enum(["up", "down"]), style: z.enum(["rail", "ground"]) }).strict()).min(1).max(1000) }).strict(),
  audience: "all",
  phase: 3,
  example: { symbols: [{ net: "GND", card: "card:ui", x: 0, y: 0, dir: "down", style: "ground" }] },
  apply(doc, input, ctx) {
    const created: Record<string, string> = {};
    const puts = input.symbols.map((p) => {
      needNet(doc, p.net);
      needCard(doc, p.card);
      return { kind: "power", id: newId(ctx, "power", p.handle, created), net: p.net, card: p.card, x: p.x, y: p.y, dir: p.dir, style: p.style, provenance: ctx.provenance } as SchematicRecord;
    });
    return change(doc, puts, [], created);
  },
});

registerOperation({
  name: "noconnect.add",
  title: "Mark pins no-connect",
  description: "An X on pins left open on purpose (pin keys `<part path>:<pin id>`). A pin on a net cannot be marked.",
  input: z.object({ pins: z.array(z.string()).min(1).max(1000) }).strict(),
  audience: "all",
  phase: 3,
  example: { pins: ["mcu/module:pin_4"] },
  apply(doc, input, ctx) {
    const puts = distinct(input.pins).map((k) => {
      const { part, pin } = splitPinKey(k);
      if (!doc.parts.get(part)?.pins.some((p) => p.id === pin)) throw new OpError(`no pin ${k} in the circuit`);
      if (doc.pinNets.has(k)) throw new OpError(`${k} is on net ${doc.pinNets.get(k)}; it is not open`);
      return { kind: "noconnect", id: `nc:${pinKey(part, pin)}`, pin: k, provenance: ctx.provenance } as SchematicRecord;
    });
    return change(doc, puts);
  },
});

registerOperation({
  name: "text.add",
  title: "Add text",
  description: "A note or heading on the sheet (calculations, decisions, datasheet references).",
  input: z.object({ handle: Handle.optional(), card: z.string().optional(), x: Gu, y: Gu, text: z.string().min(1).max(2000), role: z.enum(["note", "heading"]).optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { card: "card:status", x: 0, y: 0, text: "LED current about 1 mA at 3.3 V" },
  apply(doc, input, ctx) {
    if (input.card) needCard(doc, input.card);
    const created: Record<string, string> = {};
    const id = newId(ctx, "text", input.handle, created);
    return change(doc, [{ kind: "text", id, ...(input.card ? { card: input.card } : {}), x: input.x, y: input.y, text: input.text, role: input.role ?? "note", provenance: ctx.provenance }], [], created);
  },
});

registerOperation({
  name: "text.edit",
  title: "Edit text",
  description: "Change a note's words or role.",
  input: z.object({ id: z.string(), text: z.string().min(1).max(2000).optional(), role: z.enum(["note", "heading"]).optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { id: "txt:example", text: "LED current about 1 mA" },
  apply(doc, input, ctx) {
    const t = need(doc, input.id, ["text"]);
    return change(doc, [edited({ ...t, ...(input.text ? { text: input.text } : {}), ...(input.role ? { role: input.role } : {}) }, ctx)]);
  },
});

// ------------------------------------------------------------------ pins, cards

for (const [name, on] of [
  ["pin", true],
  ["unpin", false],
] as const) {
  registerOperation({
    name,
    title: on ? "Pin items" : "Unpin items",
    description: on ? "Keep items where they are: the layout never moves a pinned item and agents may not change it." : "Let the layout move items again. An agent's unpin waits for a person.",
    input: z.object({ ids: Ids }).strict(),
    audience: "all",
    phase: 3,
    example: { ids: ["sym:sensor/ic"] },
    apply(doc, input) {
      const puts = distinct(input.ids).map((id) => {
        const r = need(doc, id, ["card", "symbol", "wire", "label", "power", "text"]);
        if (on) return { ...r, pinned: true as const };
        const { pinned: _p, ...rest } = r as SchematicRecord & { pinned?: true };
        return rest as SchematicRecord;
      });
      return change(doc, puts);
    },
  });
}

registerOperation({
  name: "card.regroup",
  title: "Move parts to another card",
  description: "Show symbols in another card (presentation only; reported until the UHD source moves the parts to that sub-module).",
  input: z.object({ ids: Ids, card: z.string() }).strict(),
  audience: "all",
  phase: 3,
  example: { ids: ["sym:ui/r_boot"], card: "card:mcu" },
  apply(doc, input, ctx) {
    needCard(doc, input.card);
    return change(doc, distinct(input.ids).map((id) => edited({ ...need(doc, id, ["symbol"]), card: input.card }, ctx)));
  },
});

registerOperation({
  name: "card.edit",
  title: "Edit a card",
  description: "Change a card's title or subtitle.",
  input: z.object({ id: z.string(), title: z.string().max(120).optional(), subtitle: z.string().max(200).nullable().optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { id: "card:ui", title: "User IO" },
  apply(doc, input, ctx) {
    const c = need(doc, input.id, ["card"]);
    const next = { ...c, ...(input.title !== undefined ? { title: input.title } : {}) };
    if (input.subtitle === null) delete next.subtitle;
    else if (input.subtitle !== undefined) next.subtitle = input.subtitle;
    return change(doc, [edited(next, ctx)]);
  },
});

// ------------------------------------------------------------------ layout and proposals

registerOperation({
  name: "layout.run",
  title: "Lay out the schematic",
  description: "Run the automatic layout on every card or on the cards named (mode fresh places unpinned symbols anew; tidy keeps them and redraws the wiring). Pinned items never move; cards laid out before stay where they are unless sheet is repack.",
  input: z.object({ scope: z.union([z.literal("all"), z.array(z.string()).min(1)]).optional(), mode: z.enum(["fresh", "tidy"]).optional(), sheet: z.enum(["keep", "repack"]).optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { scope: ["card:sensor"], mode: "fresh" },
  apply(doc, input) {
    const r = layoutSchematic(doc, { ...(input.scope ? { scope: input.scope } : {}), ...(input.mode ? { mode: input.mode } : {}), ...(input.sheet ? { sheet: input.sheet } : {}) });
    return change(doc, r.puts, r.removes.filter((id) => doc.records.has(id)));
  },
});

/** Apply calls in order without the engine (a proposal's dry run and its accept). */
export function applyCalls(doc: SchematicDocument, calls: OpCall[], ctx: ApplyContext): SchematicDocument {
  let d = doc;
  for (const [i, c] of calls.entries()) {
    const def = getOperation(c.op);
    if (!def || def.audience === "system" || c.op.startsWith("proposal.")) throw new OpError(`operation ${i} (${c.op}) cannot be proposed`);
    const { op: _o, ...args } = c;
    const parsed = def.input.safeParse(args);
    if (!parsed.success) throw new OpError(`operation ${i} (${c.op}): ${parsed.error.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; ")}`);
    d = def.apply(d, parsed.data, ctx).doc;
  }
  return d;
}

registerOperation({
  name: "proposal.add",
  title: "Propose a cleanup",
  description: "An agent's batch of presentation operations, checked by a dry run and scored before and after, waiting for a person to accept or reject it.",
  input: z.object({ handle: Handle.optional(), title: z.string().min(1).max(200), ops: z.array(z.object({ op: z.string() }).passthrough()).min(1).max(200), rule: z.string().max(10).optional(), defects: z.array(z.string()).optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { title: "Move R4 beside SCL", ops: [{ op: "item.move", ids: ["sym:sensor/r_scl"], dx: 2, dy: 0 }], rule: "C13" },
  apply(doc, input, ctx) {
    const after = applyCalls(doc, input.ops as OpCall[], ctx);
    const created: Record<string, string> = {};
    const id = newId(ctx, "proposal", input.handle, created);
    const rec: SchematicRecord = { kind: "proposal", id, title: input.title, ops: input.ops as OpCall[], ...(input.rule ? { rule: input.rule } : {}), ...(input.defects ? { defects: input.defects } : {}), score: { before: scoreSchematic(doc).score, after: scoreSchematic(after).score }, provenance: ctx.provenance };
    return change(doc, [rec], [], created);
  },
});

registerOperation({
  name: "proposal.accept",
  title: "Accept a proposal",
  description: "Apply a proposal's operations (all, or the indices in only) and remove it.",
  input: z.object({ id: z.string(), only: z.array(z.number().int().min(0)).optional() }).strict(),
  audience: "all",
  phase: 3,
  example: { id: "prop:example" },
  apply(doc, input, ctx) {
    const p = need(doc, input.id, ["proposal"]);
    const calls = input.only ? input.only.map((i) => p.ops[i] ?? (() => { throw new OpError(`proposal ${p.id} has no operation ${i}`); })()) : p.ops;
    const after = withChanges(applyCalls(doc, calls as OpCall[], ctx), [], [p.id]);
    return diffResult(doc, after);
  },
});

// ------------------------------------------------------------------ system

registerOperation({
  name: "record.put",
  title: "Write records",
  description: "System: write whole records (hosts, undo, recovery).",
  input: z.object({ records: z.array(z.object({ kind: z.string(), id: z.string() }).passthrough()).min(1) }).strict(),
  audience: "system",
  phase: 3,
  example: { records: [] },
  apply(doc, input) {
    for (const r of input.records) if (!(r.kind in RECORD_SCHEMAS)) throw new OpError(`unknown kind ${r.kind}`);
    return change(doc, input.records as unknown as SchematicRecord[]);
  },
});

registerOperation({
  name: "record.remove",
  title: "Remove records",
  description: "System: remove records (hosts, undo).",
  input: z.object({ ids: Ids }).strict(),
  audience: "system",
  phase: 3,
  example: { ids: [] },
  apply(doc, input) {
    return change(doc, [], input.ids.filter((id) => doc.records.has(id)));
  },
});

