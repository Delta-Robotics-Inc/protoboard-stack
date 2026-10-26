/**
 * The test plan of one unit, generated from the model (PK5; basic for v0.1):
 *
 *   FAI  first-article inspection of each part made for the unit: overall
 *        size from the CAD output, thickness, hole patterns and features
 *        from its interfaces, boards and cables against their files;
 *   JT   one check per assembly step: seating and torque for mates,
 *        continuity and shorts for soldered or plugged connections;
 *   BU   bring-up of the unit's electronics: power-up current-limited,
 *        each rail at its expected voltage, current against the model's
 *        supply budget (and the project's power budget document when it has
 *        one), programming and boot, bus scans with the expected addresses,
 *        a smoke test per signal link. A board in the build (its own unit or
 *        a sub-unit) is read through its nets (design voltages, what its edge
 *        exports) and its firmware map (core boardFirmware: the controller's
 *        USB port and the buses on the board, which links between parts may
 *        not show);
 *   FN   functional checks, one per requirement of docs/brief.md (root unit);
 *
 * and the records to capture. The work order names the test that follows
 * each operation by these ids, so both are built from the same plan.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { checkSystem, i2cAddresses, netVoltageRange, systemLinks, unconnectedOf, type LinkResult } from "@deltarobotics/uhd";
import { PRODUCT_FILE, boardFirmware, boardOptions, briefRequirements, readProduct, type BoardFirmware, type CapabilityBinding, type Project } from "@protoboardai/core";
import type { PlannedStep, UnitPlan } from "@protoboardai/ext-docs/plan";
import { unitModules, fileGroup } from "../collect.ts";
import { cutList, isCable } from "../cutlist.ts";
import { glbBox } from "../glb.ts";
import type { Unit } from "../types.ts";
import { num } from "../util.ts";
import { unitBom } from "../bom.ts";

export type TestGroup = "fai" | "joint" | "bringup" | "function";

export interface TestItem {
  id: string;
  group: TestGroup;
  /** What is checked ("Overall size", "Rail 3V3"). */
  check: string;
  /** The part, link or requirement it concerns. */
  subject: string;
  how: string;
  pass: string;
  /** What to write down. */
  record: string;
  /** Model reference (module, link, interface, requirement id). */
  trace?: string;
  /** Bring-up: "power" checks need no firmware (before power, power-up, rails, current); "running" ones need it loaded. */
  phase?: "power" | "running";
}

export interface UnitTests {
  items: TestItem[];
  /** FAI ids by module id. */
  fai: Map<string, string[]>;
  /** JT id by plan step number. */
  joint: Map<number, string>;
  /** Bring-up ids, in order. */
  bringup: string[];
  /** Requirements source, when the root unit has one. */
  requirements?: string;
  /** Power budget document, when the project has one. */
  powerBudget?: string;
}

const PREFIX: Record<TestGroup, string> = { fai: "FAI", joint: "JT", bringup: "BU", function: "FN" };

const param = (i: InterfaceDef, id: string) => i.parameters?.find((p) => p.id === id);
const hasRole = (i: InterfaceDef, type: string, role: string) => i.protocols.some((p) => p.type === type && p.roles?.includes(role));
const fmtV = (p?: { value?: number; range?: [number, number] }) => {
  if (!p) return undefined;
  const r = p.range && p.range[0] !== p.range[1] ? p.range : undefined;
  if (typeof p.value === "number") return r ? `${num(p.value)} V (${num(r[0])}–${num(r[1])} V)` : `${num(p.value)} V`;
  if (r) return `${num(r[0])}–${num(r[1])} V`;
  return p.range ? `${num(p.range[0])} V` : undefined;
};
const amps = (p?: { value?: number; unit?: string }) => (p && typeof p.value === "number" ? (p.unit === "mA" ? p.value / 1000 : p.value) : undefined);

export function unitTests(p: Project, u: Unit, plan: UnitPlan): UnitTests {
  const items: TestItem[] = [];
  const count: Record<TestGroup, number> = { fai: 0, joint: 0, bringup: 0, function: 0 };
  const add = (group: TestGroup, t: Omit<TestItem, "id" | "group">) => {
    const id = `${PREFIX[group]}-${++count[group]}`;
    items.push({ id, group, ...t });
    return id;
  };
  const out: UnitTests = { items, fai: new Map(), joint: new Map(), bringup: [] };

  // ---------------------------------------------------------------- FAI
  for (const b of unitModules(p, u)) {
    const def = p.definitions.get(b.module!)!.def;
    const ids: string[] = [];
    for (const t of faiChecks(p, b, def)) ids.push(add("fai", t));
    out.fai.set(def.id, ids);
  }
  for (const r of unitBom(p, u).filter((r) => r.kind === "cable" && r.action === "fabricate" && !out.fai.has(r.definition))) {
    const def = p.lookup(r.definition)!;
    out.fai.set(def.id, cableChecks(def).map((t) => add("fai", t)));
  }

  // ---------------------------------------------------------------- joints
  for (const s of plan.steps) out.joint.set(s.n, add("joint", jointCheck(s)));

  // ---------------------------------------------------------------- bring-up
  out.powerBudget = ["docs/power-budget.md", "docs/power-budget.json"].find((f) => existsSync(join(p.root, f)));
  const bring: Check[] = bringUp(p, u, out.powerBudget);

  // ---------------------------------------------------------------- the project's own steps (release.checks)
  const mine = (p.config.release?.checks ?? []).filter((c) => (c.unit ? [u.entry, u.id, u.definition, ...u.instances].includes(c.unit) : u.kind === "root"));
  for (const c of mine.filter((c) => (c.group ?? "bringup") === "bringup")) bring.push({ check: c.check, subject: c.subject, how: c.how, pass: c.pass, record: c.record, ...(c.trace ? { trace: c.trace } : {}), phase: c.phase ?? "running" });
  // numbered in the order the bench runs them: every check that needs only power, then those that need the firmware
  for (const t of [...bring.filter((t) => t.phase === "power"), ...bring.filter((t) => t.phase !== "power")]) out.bringup.push(add("bringup", t));

  // ---------------------------------------------------------------- functions (root)
  if (u.kind === "root") {
    const brief = ["docs/brief.md", "docs/requirements.md"].find((f) => existsSync(join(p.root, f)));
    // the project's structured statement (docs/product.json, PB-935) is the source when it states requirements; else the brief
    const product = readProduct(p.root);
    if (product.requirementsFrom === PRODUCT_FILE) {
      out.requirements = PRODUCT_FILE;
      for (const c of mine.filter((c) => c.group === "function")) add("function", { check: c.check, subject: c.subject, how: c.how, pass: c.pass, record: c.record, ...(c.trace ? { trace: c.trace } : {}) });
      for (const r of product.requirements)
        add("function", { check: r.id ?? "Requirement", subject: r.text, how: r.how ?? "Demonstrate on the built product", pass: r.pass ?? "the requirement is met as stated", record: r.record ?? "pass or fail, with a note or photo", trace: `${PRODUCT_FILE}${r.id ? ` ${r.id}` : ""}` });
    } else if (brief) {
      out.requirements = brief;
      for (const c of mine.filter((c) => c.group === "function")) add("function", { check: c.check, subject: c.subject, how: c.how, pass: c.pass, record: c.record, ...(c.trace ? { trace: c.trace } : {}) });
      for (const r of briefRequirements(readFileSync(join(p.root, brief), "utf8"))) add("function", { check: r.id ?? "Requirement", subject: r.text, how: r.how, pass: r.pass, record: r.record, trace: `${brief}${r.id ? ` ${r.id}` : ""}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// First-article inspection
// ---------------------------------------------------------------------------

type Check = Omit<TestItem, "id" | "group">;

function faiChecks(p: Project, b: CapabilityBinding, def: ModuleDef): Check[] {
  const group = fileGroup(p, b);
  const name = def.name ?? def.id;
  const out: Check[] = [];
  if (group === "harnesses") return cableChecks(def);
  if (group === "firmware") return [];
  if (group === "boards") {
    const c = b.constraints as { layers?: number; thickness_mm?: number; mounting_holes?: unknown[] };
    out.push({ check: "Bare board", subject: name, how: "Inspect against the Gerber files and the fabrication order", pass: `outline and ${c.mounting_holes?.length ?? 0} mounting hole(s) as the files; ${c.layers ?? "?"} layers, ${c.thickness_mm ?? "?"} mm; finish and solder mask as ordered`, record: "thickness measured; deviations", trace: def.id });
    out.push({ check: "Assembled board", subject: name, how: "Visual (or AOI) against pnp.csv and bom.csv; X-ray for leadless packages where available", pass: "every component present, in its place and orientation; no bridges, tombstones or insufficient joints", record: "defects found and reworked", trace: def.id });
    return out;
  }
  const box = glbBox(join(p.root, b.out, "body.glb"));
  const m = readJson<{ manufacturing?: { thickness_mm?: Record<string, number> }; features?: Record<string, unknown> }>(join(p.root, b.out, "body.manifest.json"));
  if (box) out.push({ check: "Overall size", subject: name, how: "Calipers, on a flat surface", pass: `${num(box.size[0], 1)} × ${num(box.size[1], 1)} × ${num(box.size[2], 1)} mm (CAD bounding box) within the fabrication order's tolerance`, record: "the three measured sizes", trace: `${b.out}/body.glb` });
  for (const [body, t] of Object.entries(m?.manufacturing?.thickness_mm ?? {})) out.push({ check: "Thickness", subject: `${name}: ${body}`, how: "Micrometer or calipers, at three points", pass: `${t} mm, as the stock ordered`, record: "three readings", trace: `${b.out}/body.manifest.json` });
  for (const i of def.interfaces.filter((x) => x.protocols.some((pr) => pr.type === "bolt_pattern"))) {
    const spacing = param(i, "hole_spacing");
    const spacingY = param(i, "hole_spacing_y");
    const holes = param(i, "hole_count")?.value;
    const d = param(i, "fastener_diameter");
    const t = (i.traits ?? []).find((x) => x.type === "bolt_pattern")?.params as { shape?: string; fastener?: string; threaded?: boolean } | undefined;
    const sp = (x?: { value?: number; range?: [number, number] }) => (x?.value !== undefined ? `${num(x.value)}` : x?.range ? `${num(x.range[0])}–${num(x.range[1])}` : "?");
    const pattern = t?.shape === "circle" ? `on a Ø${sp(spacing)} mm circle` : t?.shape === "rectangle" ? `${sp(spacing)} × ${sp(spacingY)} mm` : `${sp(spacing)} mm square`;
    out.push({
      check: "Hole pattern",
      subject: `${name}: ${i.name ?? i.id}`,
      how: `Calipers or a pin gauge; a ${t?.fastener ?? (d?.value ? `M${d.value}` : "")} fastener through each hole`,
      pass: `${holes ?? "?"} holes ${pattern}; the fastener ${t?.threaded ? "threads in by hand" : "passes freely"}`,
      record: "spacing measured; holes that do not pass",
      trace: `${def.id}:${i.id}`,
    });
  }
  const seals = def.interfaces.filter((i) => (i.traits ?? []).some((x) => x.type === "enclosure_feature" && (x.params as { kind?: string })?.kind === "seal_gland"));
  for (const i of seals) out.push({ check: "Seal gland", subject: `${name}: ${i.name ?? i.id}`, how: "Inspect the groove; fit the O-ring", pass: "groove clean and unbroken; the O-ring seats without twist or stretch marks", record: "pass or fail", trace: `${def.id}:${i.id}` });
  const features = Object.keys(m?.features ?? {}).filter((f) => !def.interfaces.some((i) => i.id === f && i.protocols.some((pr) => pr.type === "bolt_pattern")));
  if (features.length) out.push({ check: "Features present", subject: name, how: "Visual, against the CAD figure", pass: `${features.map((f) => def.interfaces.find((i) => i.id === f)?.name ?? f).join(", ")}`, record: "missing or damaged features", trace: `${b.out}/body.manifest.json` });
  return out;
}

function cableChecks(def: ModuleDef): Check[] {
  const name = def.name ?? def.id;
  const rows = isCable(def) ? cutList(def) : [];
  const len = rows[0]?.length_mm;
  const out: Check[] = [];
  if (len) out.push({ check: "Length", subject: name, how: "Rule, end to end", pass: `${len} mm installed length${rows[0]?.strip_mm ? `, ${rows[0].strip_mm} mm stripped at each soldered end` : ""}`, record: "measured length", trace: def.id });
  if (rows.length) out.push({ check: "Conductor order", subject: name, how: `Against the cut list (files/harnesses/${def.id}/cut-list.csv); a continuity tester end to end`, pass: `${rows.length} conductor(s), each continuous to its position${rows.some((r) => r.colour) ? `; colours ${rows.map((r) => r.colour).filter(Boolean).join(", ")}` : ""}; no short between any two`, record: "pass or fail per conductor", trace: def.id });
  return out;
}

// ---------------------------------------------------------------------------
// Joints
// ---------------------------------------------------------------------------

function jointCheck(s: PlannedStep): Check {
  const trace = s.trace.join("; ");
  const variant = s.perBuild ? "; each build has the variant the step lists for its position" : "";
  if (s.kind === "mate")
    return { check: "Seated and torqued", subject: s.title, how: s.torque ? "Torque driver set to the step's torque; witness mark each fastener" : "Visual and by hand", pass: `every part seats without force and without a gap${s.torque ? `; fasteners at ${s.torque}` : ""}${variant}`, record: s.torque ? "torque driver setting; fasteners marked" : "pass or fail", trace };
  if (s.kind === "prepare")
    return { check: "Solder joints", subject: s.title, how: "Visual (magnifier); a square against each strip", pass: "every pin soldered, joints wetted and concave, no bridges between neighbouring pins; each strip flush and square to the board", record: "pass or fail; pins reworked", trace };
  if (s.kind === "place") return { check: "Placed and secured", subject: s.title, how: "Visual and by hand", pass: "the part sits where the figure shows and cannot shift", record: "pass or fail", trace };
  // the same count as the step's actions: conductors (pin rows of the step's table), in links
  const one = /^1 /.test(s.extent);
  return {
    check: s.solder ? "Solder joints and continuity" : "Connectors and continuity",
    subject: s.title,
    how: `${s.solder ? "Visual (magnifier); " : "Check each connector is fully seated and latched; "}multimeter continuity for ${one ? "the" : "each of the"} ${s.extent} in the step's table, and between neighbouring pads`,
    pass: `${s.solder ? "joints wetted and concave, no bridges; " : ""}each ${s.extent.includes("conductor") ? "conductor" : "connection"} continuous end to end, no short to a neighbour${s.connections.some((c) => c.crossover) ? "; crossovers as the table marks them" : ""}`,
    record: `pass or fail per ${s.extent.includes("conductor") ? "conductor" : "connection"}`,
    trace,
  };
}

// ---------------------------------------------------------------------------
// Bring-up
// ---------------------------------------------------------------------------

interface Rail {
  name: string;
  where: string;
  voltage: string;
}

/** Leaf modules of one build with their instance paths (sub-units included: they are part of what is powered). */
function leaves(p: Project, u: Unit): { path: string; def: ModuleDef }[] {
  const at = u.kind === "root" ? "" : u.representative;
  return p.instances
    .filter((i) => i.path !== "" && (at === "" || i.path === at || i.path.startsWith(at + "/")))
    .map((i) => ({ path: i.path, def: p.lookup(i.definition)! }))
    .filter((x) => x.def && !x.def.children?.length);
}

/**
 * Interfaces the instance at `path` leaves unconnected on purpose (UHD
 * ChildModuleRef.unconnected), with why: the bench does not power them.
 */
function unconnectedAt(p: Project, path: string): Map<string, string> {
  const cut = path.lastIndexOf("/");
  const parent = cut < 0 ? "" : path.slice(0, cut);
  const def = parent === "" ? p.rootDef : p.lookup(p.instances.find((i) => i.path === parent)?.definition ?? "");
  const ref = def?.children?.find((c) => c.id === path.slice(cut + 1));
  return ref ? unconnectedOf(ref) : new Map();
}

/** Links of one build: of the unit's module and of every module inside it that declares links, with paths from the system root. */
function buildLinks(p: Project, u: Unit): { link: LinkResult; prefix: string }[] {
  const at = u.kind === "root" ? "" : u.representative;
  const out: { link: LinkResult; prefix: string }[] = [];
  const visit = (def: ModuleDef, prefix: string) => {
    if (def.kind === "harness") return;
    if (def.links?.length) {
      try {
        for (const l of systemLinks(def, p.lookup)) out.push({ link: l, prefix });
      } catch {
        // an unresolvable link is a check error, reported by protoboard check
      }
    }
    for (const c of def.children ?? []) {
      const d = p.lookup(c.moduleDefId);
      if (d) visit(d, prefix ? `${prefix}/${c.id}` : c.id);
    }
  };
  const root = u.kind === "root" ? p.rootDef! : p.lookup(u.definition)!;
  visit(root, at);
  return out;
}

const endName = (p: Project, prefix: string, ownerPath: string[]) => {
  const path = [prefix, ...ownerPath].filter(Boolean).join("/");
  const inst = p.instances.find((i) => i.path === path);
  return inst ? (p.lookup(inst.definition)?.name ?? path) : path;
};
const at = (prefix: string, ownerPath: string[]) => [prefix, ...ownerPath].filter(Boolean).join("/");

const PROGRAM = /^(swd|jtag|usb|usb_[a-z_]+|dfu)$/;
const SMOKE: Record<string, string> = {
  uart: "data arrives from the peer at the configured baud rate",
  crsf: "receiver frames arrive (link-quality and channel values update)",
  sbus: "channel values update",
  spi: "read the device's ID register; it matches the datasheet value",
  i2c: "the device answers at its address and its ID register reads back",
  pwm: "the output follows a commanded duty cycle",
  dshot: "props off: each motor turns at minimum throttle, in its position",
  bldc_3phase: "props off: the motor turns smoothly at minimum throttle",
  analog: "the reading is plausible against a meter",
  gpio: "the line toggles when driven",
  can: "frames are received from the peer",
  rf: "the link is established",
};

function bringUp(p: Project, u: Unit, budgetDoc?: string): Check[] {
  const parts = leaves(p, u);
  const out: Check[] = [];
  // every board powered in this build: its own, folded in, or a sub-unit's (built before, powered again here)
  const within = u.kind === "root" ? () => true : (i: string) => i === u.representative || i.startsWith(u.representative + "/");
  const boards = p.capabilities.filter((b) => !b.problem && b.module && b.capability === "circuit" && b.instances.some(within));
  // every board of the product: a part on a board that another unit builds was brought up there
  const allBoards = p.capabilities.filter((b) => !b.problem && b.capability === "circuit" && b.module);
  const links = buildLinks(p, u).filter((x) => x.link.state !== "incompatible");
  const batteryDefs = new Set(parts.filter((x) => x.def.interfaces.some((i) => hasRole(i, "power", "output") && param(i, "cell_count"))).map((x) => x.def.id));
  const battery = batteryDefs.size > 0;

  // ---- what feeds each board at its edge: nets with a design voltage that an exported part's pins sit on and nothing on the board drives
  const edge = boards.map((b) => {
    const def = p.definitions.get(b.module!)!.def;
    const exported = new Set((def.exports ?? []).map((e) => ("child" in e.from ? e.from.child : "")));
    const nets = def.interfaces.filter((i) => i.protocols.some((x) => x.type === "net") && netVoltageRange(i));
    const members = (net: string) =>
      (def.links ?? []).flatMap((l) => (["a", "b"] as const).filter((k) => { const o = l[k === "a" ? "b" : "a"]; return "self" in o && o.interfaceId === net && "child" in l[k]; }).map((k) => l[k] as { child: string; interfaceId: string }));
    const output = (m: { child: string; interfaceId: string }) => {
      const ref = def.children?.find((c) => c.id === m.child);
      const i = ref ? p.lookup(ref.moduleDefId)?.interfaces.find((x) => x.id === m.interfaceId) : undefined;
      return !!i && hasRole(i, "power", "output");
    };
    return { b, def, inputs: nets.filter((n) => members(n.id).some((m) => exported.has(m.child)) && !members(n.id).some(output)) };
  });

  // ---- rails: board nets with a design voltage, and regulated outputs of the modules
  const rails: Rail[] = [];
  for (const { def, inputs: edgeInputs } of edge) {
    for (const n of def.interfaces.filter((i) => i.protocols.some((x) => x.type === "net"))) {
      const r = netVoltageRange(n);
      // a board input fed from outside the build (USB VBUS while a pack powers the product) is not a rail of this test
      if (battery && edgeInputs.includes(n)) continue;
      if (r && r[1] > 0) rails.push({ name: n.name ?? n.id, where: `${def.name ?? def.id} (any pin on net ${n.name ?? n.id})`, voltage: r[0] === r[1] ? tolerance(r[0]) : `${num(r[0])}–${num(r[1])} V` });
    }
  }
  // parts on a board: the board's nets carry the design voltages, and only what the board exports is reachable
  const boardOf = (path: string) => allBoards.find((b) => b.instances.some((i) => path.startsWith(i + "/")));
  const reachable = (path: string, id: string) => {
    const b = boardOf(path);
    if (!b) return true;
    const def = p.definitions.get(b.module!)!.def;
    const child = path.slice(path.lastIndexOf("/") + 1);
    return (def.exports ?? []).some((e) => "child" in e.from && e.from.child === child && e.from.interfaceId === id);
  };
  const sources: { path: string; def: ModuleDef; iface: InterfaceDef }[] = [];
  // an input is fed when a link in the build reaches it, directly or through a port that binds it
  const fed = new Set<string>();
  for (const l of links)
    for (const e of [l.link.a, l.link.b]) {
      const base = at(l.prefix, e.ownerPath);
      fed.add(`${base}:${e.iface.id}`);
      for (const pr of e.iface.profiles ?? []) for (const v of Object.values(pr.bindings ?? {})) if (typeof v === "string") fed.add(`${base}:${v}`);
    }
  // rails that read an input left unconnected on purpose (a motor driver's outputs, its supply terminal
  // open in the product): they are measured with a temporary supply on that input, connected first
  const temporary = new Map<string, { input: string; what: string; volts: ReturnType<typeof supplyVolts>; reason: string; rails: Rail[] }>();
  const words = (x: string) => new Set(x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  for (const x of parts) {
    // parts on a board are read through its nets; a battery is what the bench supply stands in for
    if (boardOf(x.path) || batteryDefs.has(x.def.id)) continue;
    for (const i of x.def.interfaces) {
      if (!hasRole(i, "power", "output") || param(i, "cell_count")) continue;
      const pv = param(i, "voltage") as { value?: number; range?: [number, number] } | undefined;
      const v = fmtV(pv as never);
      if (!v) continue;
      sources.push({ path: x.path, def: x.def, iface: i });
      // an output stated only by the same range as one of the part's inputs passes that input through (an ESC's
      // battery voltage to the FC): it reads the supply's voltage, not anywhere in the range
      // several inputs may state that range: one the build feeds, else the one whose name shares most with the output's
      const marks = unconnectedAt(p, x.path);
      const about = words(`${i.id} ${i.name ?? ""} ${(i.traits ?? []).map((t) => String((t.params as { description?: string; note?: string } | undefined)?.description ?? (t.params as { note?: string } | undefined)?.note ?? "")).join(" ")}`);
      const overlap = (j: InterfaceDef) => [...words(`${j.id} ${j.name ?? ""}`)].filter((w) => about.has(w)).length;
      const candidates =
        pv?.value === undefined && pv?.range
          ? x.def.interfaces.filter((j) => j !== i && hasRole(j, "power", "input") && (param(j, "voltage") as { range?: [number, number] } | undefined)?.range?.join() === pv.range!.join())
          : [];
      const isFed = (j: InterfaceDef) => fed.has(`${x.path}:${j.id}`) || !marks.has(j.id);
      const through = [...candidates].sort((a, b) => Number(fed.has(`${x.path}:${b.id}`)) - Number(fed.has(`${x.path}:${a.id}`)) || overlap(b) - overlap(a))[0];
      const rail: Rail = {
        name: i.name ?? i.id,
        where: `${x.def.name ?? x.def.id} (${x.path}:${i.id})`,
        voltage: through ? `the supply voltage set at power-up, read on ${through.name ?? through.id} (passed through; the part accepts ${v})` : v,
      };
      if (through && !candidates.some(isFed)) {
        const key = `${x.path}:${through.id}`;
        const t = temporary.get(key) ?? { input: key, what: `${x.def.name ?? x.def.id} ${through.name ?? through.id} (${key})`, volts: supplyVolts(param(through, "voltage") as never), reason: marks.get(through.id)!, rails: [] };
        rail.voltage = `the temporary supply's voltage, read on ${through.name ?? through.id} (passed through; the part accepts ${v})`;
        t.rails.push(rail);
        temporary.set(key, t);
        continue;
      }
      rails.push(rail);
    }
  }
  // ---- inputs: battery packs in the build, else power inputs nothing in the build feeds
  const batteries = parts.flatMap((x) => x.def.interfaces.filter((i) => hasRole(i, "power", "output") && param(i, "cell_count")).map((i) => ({ x, i })));
  // a board is fed through its edge (above)
  const boardInputs = edge.flatMap(({ def, inputs: ns }) =>
    ns.map((n) => {
      const r = netVoltageRange(n)!;
      return { what: `into ${def.name ?? def.id} net ${n.name ?? n.id}, at its edge connector`, ...supplyVolts({ value: r[0] === r[1] ? r[0] : undefined, range: r }), pack: false };
    }),
  );
  const inputs: SupplyInput[] = batteries.length
    ? batteries.map(({ x, i }) => ({ what: `in place of ${x.def.name ?? x.def.id} (${x.path})`, ...supplyVolts(param(i, "voltage") as never), pack: true }))
    : [
        ...boardInputs,
        // an input left unconnected on purpose (UHD ChildModuleRef.unconnected) gets no bench supply
        ...parts.filter((x) => !boardOf(x.path)).flatMap((x) => {
          const marks = unconnectedAt(p, x.path);
          return x.def.interfaces.filter((i) => hasRole(i, "power", "input") && !fed.has(`${x.path}:${i.id}`) && !marks.has(i.id) && fmtV(param(i, "voltage") as never)).map((i) => ({ what: `into ${x.def.name ?? x.def.id} ${i.name ?? i.id} (${x.path}:${i.id})`, ...supplyVolts(param(i, "voltage") as never), pack: false }));
        }),
      ];
  // what an input stated only as a range sees in the product: the pack that powers the product
  const pack = u.kind === "root" ? undefined : productPack(p);
  // firmware maps of the boards: the controller's USB port and the buses on the board
  const maps = edge.map((x) => ({ ...x, fw: firmwareMap(p, x.b, x.def) }));
  const usbBoards = maps.filter((m) => m.fw?.usb && m.fw.controller && (m.def.exports ?? []).some((e) => "child" in e.from && m.fw!.usb!.peers.includes(e.from.child)));
  const kindOf = (i: InterfaceDef) => (i.protocols.some((pr) => /^usb/.test(pr.type)) ? "usb" : "probe");
  const programAll = parts.flatMap((x) =>
    x.def.interfaces
      .filter((i) => (i.protocols.some((pr) => PROGRAM.test(pr.type)) || /^(swd|jtag)/.test(i.id)) && i.exposed !== false && reachable(x.path, i.id))
      // a board whose controller's USB reaches its edge is programmed there (one check below), not through each
      // connector pin; a debug probe port (SWD, JTAG) keeps its own check (a controller with no bootloader yet is
      // first programmed through it)
      .filter((i) => kindOf(i) !== "usb" || !usbBoards.some((m) => boardOf(x.path) === m.b))
      .map((i) => ({ x, i })),
  );
  // the rest: one USB check and one probe check per part (a connector's composite and its pins are the same port)
  const program = [...new Map(programAll.sort((a, b) => (b.i.slots?.length ?? 0) - (a.i.slots?.length ?? 0)).map((e) => [`${e.x.path}:${kindOf(e.i)}`, e])).values()];
  // and a board's USB connector covers the controller's USB behind it, when the firmware map does not show that path
  const usbOn = new Set(program.filter((e) => kindOf(e.i) === "usb").map((e) => boardOf(e.x.path)?.module).filter(Boolean));
  for (let k = program.length - 1; k >= 0; k--) {
    const e = program[k];
    if (kindOf(e.i) === "usb" && !(e.x.def.categories ?? []).some((c) => c.startsWith("connector")) && usbOn.has(boardOf(e.x.path)?.module) && program.some((o) => o !== e && kindOf(o.i) === "usb" && boardOf(o.x.path)?.module === boardOf(e.x.path)?.module)) program.splice(k, 1);
  }
  const buses = links.filter((l) => l.link.protocol === "i2c");
  const boardBuses = maps.flatMap((m) => (m.fw?.buses ?? []).filter((bus) => bus.protocol === "i2c" && bus.devices.length).map((bus) => ({ m, bus })));
  const signals = links.filter((l) => !["power", "net", "i2c", "connector", "mechanical", "bolt_pattern", "shaft"].includes(l.link.protocol) && l.link.a.iface.domain !== "mechanical" && !l.link.derived?.nets?.length);
  if (!rails.length && !temporary.size && !inputs.length && !program.length && !buses.length && !usbBoards.length && !boardBuses.length) return out;

  out.push({ check: "Before power", subject: u.name, how: "Visual; multimeter resistance from each rail to ground, power off", pass: `no solder debris or damage; no rail shorted to ground${rails.length ? ` (${rails.map((r) => r.name).join(", ")})` : ""}`, record: "resistance of each rail to ground", phase: "power" });
  for (const i of inputs) out.push({ check: "Power up", subject: u.name, how: `Bench supply ${i.what}, current limit set low: start at a low voltage and raise slowly to ${target(i, pack)}`, pass: "no current limit hit, no heat, no smell; the supply current settles", record: "input voltage and idle current", phase: "power" });
  for (const r of rails) out.push({ check: `Rail ${r.name}`, subject: r.where, how: "Multimeter to ground, powered", pass: r.voltage, record: "measured voltage", phase: "power" });
  // the checks that need an input the product leaves open: a temporary supply on it first, removed at the end
  for (const t of temporary.values()) {
    out.push({
      check: "Temporary supply",
      subject: t.what,
      how: `Connect a second current-limited bench supply to ${t.what}, set to ${t.volts.nominal !== undefined ? `${num(t.volts.nominal)} V` : t.volts.range ? `a voltage within its ${num(t.volts.range[0])}–${num(t.volts.range[1])} V range (the supply the product is meant to get)` : "its design voltage"}, for the checks that follow; disconnect it when the bring-up is done (unconnected in the product: ${t.reason})`,
      pass: "no current limit hit, no heat, no smell; the supply current settles",
      record: "supply voltage and idle current",
      trace: t.input,
      phase: "power",
    });
    for (const r of t.rails) out.push({ check: `Rail ${r.name}`, subject: r.where, how: "Multimeter to ground, powered, with the temporary supply on", pass: r.voltage, record: "measured voltage", phase: "power" });
  }

  // ---- current against the model's supply budget (and the project's power budget)
  const def = u.kind === "root" ? p.rootDef! : p.lookup(u.definition)!;
  const budget: string[] = [];
  const budgetAll: [ModuleDef, string][] = [[def, ""], ...boards.map((b) => [p.definitions.get(b.module!)!.def, `${b.module} `] as [ModuleDef, string])];
  const budgetDefs = budgetAll.filter(([d], k) => budgetAll.findIndex(([x]) => x.id === d.id) === k);
  for (const [d, label] of budgetDefs) {
    try {
      for (const x of checkSystem(d, p.lookup).diagnostics) {
        const det = x.details as { capacityW?: number; unknownLoads?: string[] } | undefined;
        if (x.rule !== "supply_budget" || typeof det?.capacityW !== "number") continue;
        const unknown = det.unknownLoads?.length ?? 0;
        // with no load that states a draw, the rail's rating is what the measurement is held to
        const rating = /\(([\d.]+) V × ([\d.]+) A/.exec(x.message);
        const ref = x.message.split(": ")[0];
        if (!((det as { loadW?: number }).loadW ?? 0) && rating) budget.push(`${label}${ref}: under its ${rating[2]} A rating at ${rating[1]} V (no load on it states a draw)`);
        else budget.push(`${label}${x.message.split("; ")[0].replace(/\.$/, "")}${unknown ? `; ${unknown} load(s) state no draw` : ""}`);
      }
    } catch {
      // a link that does not resolve is a check error, reported by protoboard check
    }
  }
  const sourceRating = sources.map((s) => ({ s, a: amps(param(s.iface, "max_current") as never) })).filter((x) => x.a !== undefined);
  if (budget.length || budgetDoc || sourceRating.length)
    out.push({
      check: "Current against the power budget",
      subject: u.name,
      how: `Read the supply current idle, then with each load active${budgetDoc ? `; compare with ${budgetDoc}` : ""}`,
      pass: [
        ...budget.map((m) => m.replace(/\.$/, "")),
        ...(!budget.length ? sourceRating.map(({ s, a }) => `${s.iface.name ?? s.iface.id} of ${s.def.name ?? s.def.id}: below its ${num(a!)} A rating`) : []),
        ...(budgetDoc && !budget.length && !sourceRating.length ? [`within ${budgetDoc}`] : []),
      ].join("; "),
      record: "idle and loaded current, per rail where it can be measured",
      phase: "power",
    });

  // ---- programming and boot: a board's controller over the USB its edge exports
  for (const m of usbBoards) {
    const fw = m.fw!;
    const ctl = p.lookup(fw.controller!.part);
    const port = ctl?.interfaces.find((i) => i.id === fw.usb!.interface);
    const conn = (m.def.exports ?? []).find((e) => "child" in e.from && fw.usb!.peers.includes(e.from.child))!;
    out.push({
      check: "USB, programming and boot",
      subject: `${m.def.name ?? m.def.id} ${conn.name ?? conn.id}`,
      how: `Connect ${conn.name ?? conn.id} to a computer; load the firmware over ${port?.name ?? fw.usb!.interface} of the ${fw.controller!.name}`,
      pass: `${port?.name ?? "the controller's USB port"} enumerates; the firmware loads, verifies and boots; its console connects`,
      record: "firmware name and version loaded",
      trace: `${m.def.id}:${fw.controller!.instance}:${fw.usb!.interface}`,
      phase: "running",
    });
  }
  for (const { x, i } of program) {
    const usb = i.protocols.some((pr) => /^usb/.test(pr.type));
    out.push({
      check: usb ? "USB and boot" : "Programming and boot",
      subject: `${x.def.name ?? x.def.id} ${i.name ?? i.id}`,
      how: usb ? "Connect USB to a computer" : `Debug probe on ${i.name ?? i.id}; read the target's ID, load the firmware`,
      pass: usb ? "the device enumerates; firmware boots (its configurator or console connects)" : "the probe reads the target; the firmware loads, verifies and boots",
      record: "firmware name and version loaded",
      trace: `${x.path}:${i.id}`,
      phase: "running",
    });
  }

  // ---- bus scans: expected I2C addresses from the parts
  const byMaster = new Map<string, { name: string; devices: string[] }>();
  for (const { link: l, prefix } of buses) {
    const [m, s] = hasRole(l.a.iface, "i2c", "master") ? [l.a, l.b] : [l.b, l.a];
    const key = `${at(prefix, m.ownerPath)}:${m.iface.id}`;
    // every address the device answers at: its own, then the all-call and sub-addresses it states (a PCA9685's 0x70)
    const addrs = i2cAddresses(s.iface);
    const hex = (a: number) => `0x${a.toString(16).toUpperCase().padStart(2, "0")}`;
    const e = byMaster.get(key) ?? { name: `${endName(p, prefix, m.ownerPath)} ${m.iface.name ?? m.iface.id}`, devices: [] };
    const who = endName(p, prefix, s.ownerPath);
    if (!addrs.length) e.devices.push(`address not in the model (${who})`);
    for (const a of addrs) e.devices.push(`${hex(a.address)} (${who}${a.name === "address" ? "" : `, ${a.name.replace(/_/g, "-")} address`})`);
    byMaster.set(key, e);
  }
  for (const [key, b] of byMaster) out.push({ check: "Bus scan", subject: b.name, how: "I2C scan from the controller's firmware or a bus adapter", pass: `answers at ${b.devices.join(", ")}; nothing else unexpected`, record: "addresses found", trace: key, phase: "running" });
  // buses on a board that links between parts do not show (a controller whose I2C is routed through its pin matrix): from the firmware map
  for (const { m, bus } of boardBuses) {
    // already scanned from the links (a controller part that states its I2C)
    const ctlPaths = m.b.instances.filter(within).map((i) => `${i}/${m.fw!.controller!.instance}:`);
    if ([...byMaster.keys()].some((k) => ctlPaths.some((c) => k.startsWith(c)))) continue;
    const pins = bus.signals.map((x) => `${x.role.toUpperCase()} net ${x.net}`).join(", ");
    const hex = (a?: number) => (a !== undefined ? `0x${a.toString(16).toUpperCase().padStart(2, "0")}` : "address not in the model");
    out.push({
      check: "Bus scan",
      subject: `${m.def.name ?? m.def.id} ${bus.id.toUpperCase()} (${pins})`,
      how: `I2C scan from the ${m.fw!.controller!.name}'s firmware or a bus adapter on the test pads`,
      pass: `answers at ${bus.devices.map((d) => `${hex(d.address)} (${d.name})`).join(", ")}; nothing else unexpected`,
      record: "addresses found",
      trace: `${m.def.id}:${bus.id}`,
      phase: "running",
    });
    for (const d of bus.devices)
      out.push({ check: "Smoke test: i2c", subject: `${d.name} (${m.def.id} ${d.instance}, ${hex(d.address)})`, how: "With the firmware running", pass: SMOKE.i2c, record: "pass or fail; ID register value", trace: `${m.def.id}:${d.instance}`, phase: "running" });
  }

  // ---- one smoke test per signal link
  const seen = new Set<string>();
  for (const { link: l, prefix } of signals) {
    // a composite port (many conductors of several kinds) is covered by the checks of what it carries
    if (!SMOKE[l.protocol] && l.a.iface.slots?.length) continue;
    const key = `${l.link.name ?? l.link.id}`;
    if (seen.has(`${prefix}/${key}`)) continue;
    seen.add(`${prefix}/${key}`);
    out.push({
      check: `Smoke test: ${l.protocol}`,
      subject: `${l.link.name ?? l.link.id}: ${endName(p, prefix, l.a.ownerPath)} ↔ ${endName(p, prefix, l.b.ownerPath)}`,
      how: "With the firmware running",
      pass: SMOKE[l.protocol] ?? "the peer responds as its datasheet says",
      record: "pass or fail",
      trace: [prefix, l.link.id].filter(Boolean).join("/"),
      phase: "running",
    });
  }
  return out;
}

/** A single design voltage as a pass band: ±5 % unless the model gives a range (an assumption, stated). */
const tolerance = (v: number) => `${num(v)} V ± 5 % (${num(v * 0.95, 2)}–${num(v * 1.05, 2)} V; tolerance assumed)`;

/** The board's firmware map (core), with the controller its firmware config names; undefined for a board with no controller. */
function firmwareMap(p: Project, b: CapabilityBinding, def: ModuleDef): BoardFirmware | undefined {
  const fwb = p.capabilities.find((x) => x.capability === "firmware" && x.module === b.module && !x.problem);
  const controller = (fwb?.constraints as { controller?: string } | undefined)?.controller;
  try {
    const fw = boardFirmware(def, p.lookup, { ...(controller ? { controller } : {}), board: boardOptions(p) });
    return fw.controller ? fw : undefined;
  } catch {
    return undefined;
  }
}

interface SupplyInput {
  what: string;
  /** Nominal voltage, when the model states one. */
  nominal?: number;
  /** The range it runs over or accepts. */
  range?: [number, number];
  /** A battery pack the bench supply stands in for. */
  pack: boolean;
}

const supplyVolts = (v?: { value?: number; range?: [number, number] }) => ({
  ...(typeof v?.value === "number" ? { nominal: v.value } : {}),
  ...(v?.range && v.range[0] !== v.range[1] ? { range: v.range } : {}),
});

/** The pack that powers the whole product: its name and nominal voltage. */
function productPack(p: Project): { name: string; v: number } | undefined {
  for (const i of p.instances) {
    const def = p.lookup(i.definition);
    const out = def?.interfaces.find((x) => hasRole(x, "power", "output") && param(x, "cell_count"));
    const v = out ? param(out, "voltage")?.value : undefined;
    if (def && typeof v === "number") return { name: def.name ?? def.id, v };
  }
  return undefined;
}

/** Where the bench supply ends up: the nominal voltage, else the pack's voltage the input sees in the product, else its range. */
function target(i: SupplyInput, pack?: { name: string; v: number }): string {
  const r = i.range ? `${num(i.range[0])}–${num(i.range[1])} V` : "";
  if (i.nominal !== undefined) return `${num(i.nominal)} V${r ? ` (${i.pack ? "the pack runs" : "it accepts"} ${r})` : ""}`;
  if (i.range && pack && pack.v >= i.range[0] && pack.v <= i.range[1]) return `${num(pack.v)} V, the voltage of the ${pack.name} that feeds it in the product (it accepts ${r})`;
  return i.range ? `the voltage it sees in the product, within its ${r} range` : "its design voltage";
}

function readJson<T>(f: string): T | undefined {
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, "utf8")) as T;
  } catch {
    return undefined;
  }
}
