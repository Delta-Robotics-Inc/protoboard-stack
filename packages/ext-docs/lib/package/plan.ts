/**
 * The assembly plan of one Manufacturing Package unit: the technical
 * documents' step planner (doc spec steps, then automatic steps for what the
 * spec leaves out) scoped to the links the unit makes, with each step's
 * parts, actions, tools, materials, torque, notes and connections as plain
 * text. The unit's assembly guide draws it (./assembly.ts); the release's
 * work order numbers the same steps as its assembly operations
 * (`@protoboardai/ext-docs/plan`), so both documents follow one sequence.
 */
import type { ChildModuleRef, ModuleDef, WiringStep } from "@deltarobotics/uhd";
import { jointTorques, looseConnectors, propMounts, toolLabel, toolsFor } from "@deltarobotics/uhd";
import type { Project } from "@protoboardai/core";
import type { Unit } from "@protoboardai/ext-release";
import { leafOf, parseEnd } from "../blocks.ts";
import type { BuiltContext } from "../context.ts";
import { connectorOf, groupBy, instanceLabelOf, jointActions, planSteps, shortName, type StepPlan } from "../docs/assembly.ts";
import { docContext, textValue, unitScope, type UnitScope } from "./common.ts";

export interface PlannedPart {
  /** Grouping key: definition id, or the instance path of an unplaced part. */
  key: string;
  def: ModuleDef;
  count: number;
  /** Letter in the parts strip and on the figure. */
  letter: string;
  /** Hardware (drawn in the accent colour). */
  accent: boolean;
  /** Figure anchor id (`body:<key>` or `hw:<key>`), for parts drawn in the figure. */
  anchor?: string;
}

export interface Connection {
  link: string;
  name: string;
  from: string;
  to: string;
  crossover: boolean;
  termination: string;
  state: string;
}

export interface PlannedStep {
  /** Number within the unit (1…). */
  n: number;
  /** The doc spec step id, or auto-… for a step the planner added. */
  id: string;
  title: string;
  /**
   * What the step mostly does: mates (with fastener stacks), placing parts, making connections, or preparing a
   * part before it is fitted (soldering the connectors it ships with loose, such as a shield's header strips).
   */
  kind: "mate" | "place" | "connect" | "prepare";
  plan: StepPlan;
  parts: PlannedPart[];
  actions: string[];
  tools: string[];
  materials: string[];
  /** Tightening torque of each part turned, from the fastener stacks ("" when no hardware). */
  torque: string;
  notes: { level: "tip" | "caution" | "warning"; text: string }[];
  connections: Connection[];
  /** Connections made by soldering (pads, bare leads). */
  solder: boolean;
  /** Links the step covers (mates, wiring) and the hardware placed. */
  trace: string[];
  /** Part of a doc spec step whose other links are made in another unit. */
  split: boolean;
  /** Instance paths of the cables the step's connections run through (harness instances). */
  cables: string[];
  /** Instance paths of the modules at the other ends of those connections. */
  ends: string[];
  /** Conductors the step's connections make (a link without a pin table counts once), in `links` links. */
  conductors: number;
  links: number;
  /** "16 conductors in 2 links", the count the actions and the joint check both use. */
  extent: string;
  /**
   * Why the step comes after the unit's bench test and configuration (the
   * work order runs the test first and a final check after): it fits
   * propellers, or the doc spec marks it `after: "test"`. Undefined for
   * ordinary steps. Such steps are planned last.
   */
  afterTest?: string;
  /** The actions name a different variant per build (a unit built several times whose builds differ). */
  perBuild: boolean;
}

/** One build of a unit built several times (a module unit), and what its instance sets: spin, overrides. */
export interface Build {
  path: string;
  name: string;
  /** Field → value as text ("spin" → "CCW", "overrides.<key>" → JSON). */
  fields: Record<string, string>;
}

/** A field in which the builds of one unit differ. */
export interface BuildVariant {
  field: string;
  values: { build: string; path: string; value: string }[];
  /** A step's actions name the value per build (propellers by spin). */
  handled: boolean;
}

export interface UnitPlan {
  ctx: BuiltContext;
  scope: UnitScope;
  steps: PlannedStep[];
  /** The builds of a unit built several times (empty for one build). */
  builds: Build[];
  /** Where those builds differ; a variant no step handles needs checking per build. */
  variants: BuildVariant[];
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const SOLDER = /solder|bare_wire|pad/;

/** The unit's steps, in assembly order: the doc spec's order, with the steps that follow the bench test last. */
export async function unitPlan(p: Project, u: Unit): Promise<UnitPlan> {
  const ctx = await docContext(p);
  const scope = unitScope(u, p);
  const plans = planSteps({ ctx }, scope);
  const full = planSteps({ ctx });
  const v = textValue(ctx);
  const builds = buildsOf(p, u);
  const described = plans.map((plan) => describe(ctx, plan, v, full, scope, builds));
  const steps = [...prepareSteps(described), ...described.filter((x) => !x.afterTest), ...described.filter((x) => x.afterTest)];
  steps.forEach((x, i) => (x.n = i + 1));
  return { ctx, scope, steps, builds, variants: variantsOf(builds, steps) };
}

const CONNECTOR_WORDS: Record<string, string> = {
  pin_header: "header strips",
  arduino_r3_shield_header: "header strips",
  socket_header: "socket headers",
  screw_terminal: "screw terminals",
  terminal_block: "terminal blocks",
};
const connectorWords = (type: string) => CONNECTOR_WORDS[type] ?? (/^pin_header/.test(type) ? "pin headers" : `${type.replace(/_/g, " ")} connectors`);

/**
 * Parts that ship with connectors loose (UHD `connector` trait `supplied: "loose"`, a shield's header strips):
 * one soldering step each, first in the unit (before any step fits the part), in the order the steps use them.
 */
function prepareSteps(steps: PlannedStep[]): PlannedStep[] {
  const seen = new Set<string>();
  const out: PlannedStep[] = [];
  for (const st of steps)
    for (const part of st.parts) {
      if (seen.has(part.def.id)) continue;
      seen.add(part.def.id);
      const loose = looseConnectors(part.def);
      if (!loose.length) continue;
      const name = shortName(part.def);
      const kinds = [...new Set(loose.map((l) => connectorWords(l.connectorType)))];
      const what = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}` : kinds[0];
      const notes = [...new Set(loose.map((l) => l.note?.replace(/\.$/, "")).filter((n): n is string => Boolean(n)))];
      const id = `auto-prepare-${part.def.id}`;
      const title = `Solder the ${what} to the ${name}`;
      out.push({
        n: 0,
        id,
        title,
        kind: "prepare",
        plan: { n: 0, spec: { id, title }, mates: [], wiring: [], moving: [], placed: [], hardware: [], extras: [] },
        parts: [{ key: part.def.id, def: part.def, count: part.count, letter: "A", accent: false }],
        actions: [
          `The ${name} ships with its ${what} loose${notes.length ? ` (${notes.join("; ")})` : ""}: solder them before the part is fitted${part.count > 1 ? `, on each of the ${part.count}` : ""}.`,
          `Seat each strip square in its holes from the side the part's drawing shows, solder one pin at each end, check the strip is square to the board, then solder the rest.`,
        ],
        tools: ["soldering iron"],
        materials: ["solder and flux"],
        torque: "",
        notes: [],
        connections: [],
        solder: true,
        trace: [`part ${part.def.id}: connectors supplied loose (${[...new Set(loose.map((l) => l.iface.id))].length} interfaces)`],
        split: false,
        cables: [],
        ends: [],
        conductors: 0,
        links: 0,
        extent: `the ${what}`,
        perBuild: false,
      });
    }
  return out;
}

const parentPath = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** The child entry that declares an instance (in its parent's definition). */
function childRef(p: Project, path: string): ChildModuleRef | undefined {
  const parent = parentPath(path);
  const def = parent === "" ? p.rootDef : p.lookup(p.instances.find((i) => i.path === parent)?.definition ?? "");
  const id = path.slice(path.lastIndexOf("/") + 1);
  return def?.children?.find((c) => c.id === id);
}

/**
 * The builds of a unit named by module id and built several times, with
 * what each instance's context sets: its own overrides, and the spin it
 * has or inherits from a group above it. The definition is the same, so
 * these are the only ways two builds can differ.
 */
function buildsOf(p: Project, u: Unit): Build[] {
  if (u.instances.length < 2) return [];
  return u.instances.map((path) => {
    const fields: Record<string, string> = {};
    for (const [k, val] of Object.entries(childRef(p, path)?.overrides ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) fields[`overrides.${k}`] = JSON.stringify(val);
    for (let at = path; at && !fields.spin; at = parentPath(at)) {
      const spin = childRef(p, at)?.spin;
      if (spin) fields.spin = spin.toUpperCase();
    }
    const inst = p.instances.find((i) => i.path === path);
    return { path, name: inst?.name ?? childRef(p, path)?.name ?? path, fields };
  });
}

function variantsOf(builds: Build[], steps: PlannedStep[]): BuildVariant[] {
  const fields = [...new Set(builds.flatMap((b) => Object.keys(b.fields)))];
  return fields
    .filter((f) => new Set(builds.map((b) => b.fields[f] ?? "(not set)")).size > 1)
    .map((field) => ({
      field,
      values: builds.map((b) => ({ build: b.name, path: b.path, value: b.fields[field] ?? "(not set)" })),
      handled: field === "spin" && steps.some((x) => x.perBuild),
    }));
}

function describe(ctx: BuiltContext, p: StepPlan, v: (q: string, f?: string) => string, full: StepPlan[], scope: UnitScope, builds: Build[]): PlannedStep {
  const s = p.spec;
  const own = scope.own;
  const rel = (id: string) => (own && id.startsWith(own + "/") ? id.slice(own.length + 1) : id);
  // ---- parts: moving modules, placed modules, extras, hardware by part, cables of the wiring
  const parts: PlannedPart[] = [];
  for (const [id, bs] of groupBy([...p.moving, ...p.placed], (b) => b.def.id)) {
    const main = bs.find((b) => !b.key.includes("#")) ?? bs[0];
    parts.push({ key: id, def: bs[0].def, count: new Set(bs.map((b) => b.path.join("/"))).size, letter: "", anchor: `body:${main.key}`, accent: false });
  }
  for (const x of p.extras) parts.push({ key: x.path, def: x.def, count: 1, letter: "", accent: false, ...(x.def.kind === "harness" ? { anchor: `harness:${x.path}` } : {}) });
  for (const [, hs] of groupBy(p.hardware, (h) => h.def.id)) parts.push({ key: hs[0].def.id, def: hs[0].def, count: hs.length, letter: "", anchor: `hw:${hs[0].key}`, accent: true });
  for (const [h, ws] of groupBy(p.wiring.filter((w) => w.harness), (w) => w.harness!)) {
    const def = ctx.instances.get(h);
    if (!def) continue;
    const have = parts.find((x) => x.def.id === def.id);
    if (have) have.count = Math.max(have.count, 1);
    else parts.push({ key: h, def, count: new Set(ws.map((w) => w.harness)).size, letter: "", anchor: `harness:${h}`, accent: false });
  }
  parts.forEach((x, i) => (x.letter = LETTERS[i] ?? String(i + 1)));

  // ---- actions: joints in stacking order, props by handedness, placements, connections
  const fillText = (t: string) => t.replace(/\{\{([^|}]+)(?:\|([^}]+))?\}\}/g, (_m, q: string, f?: string) => v(q.trim(), f?.trim()));
  const actions = [...(s.before ?? []).map(fillText), ...jointActions({ ctx }, p, { v, e: (x) => x })];
  const allMounts = propMounts(ctx.sys.system, ctx.sys.lookup);
  const mounts = allMounts.filter((m) => p.mates.some((x) => x.linkId === m.linkId));
  let perBuild = false;
  for (const m of mounts) {
    const prop = shortName(m.prop.def);
    if (builds.length > 1) {
      // one plan for every build: the propeller's hand comes from the position each build goes to
      const per = builds.map((b) => ({ b, spin: allMounts.find((x) => x.linkId === `${b.path}/${rel(m.linkId)}`)?.motor.spin?.toUpperCase() ?? "?" }));
      if (new Set(per.map((x) => x.spin)).size === 1) actions.push(`Every build: the motor spins ${per[0].spin} seen from above, so fit a ${per[0].spin} ${prop}.`);
      else {
        perBuild = true;
        const counts = [...new Set(per.map((x) => x.spin))].map((sp) => `${per.filter((x) => x.spin === sp).length} with ${sp}`).join(", ");
        actions.push(`The builds differ (${counts} propellers): the hand depends on the position each build goes to. Mark each build with its position, then fit its propeller:`);
        for (const x of per) actions.push(`${x.b.name} (${x.b.path}): the motor spins ${x.spin} seen from above, so fit a ${x.spin} ${prop}.`);
      }
      continue;
    }
    const arm = m.motor.setAt ?? m.motor.path.split("/")[0];
    const armName = ctx.sys.system.children?.find((c) => c.id === arm.split("/")[0])?.name ?? arm;
    const spin = v(`sys:system.children[id=${arm.split("/")[0]}].spin`, "upper");
    actions.push(`${armName}: the motor spins ${spin} seen from above, so fit a ${spin} ${prop}.`);
  }
  for (const b of p.placed) actions.push(`Place the ${shortName(b.def)} as shown. It has no mechanical interface in the model; it is placed by ${b.via?.replace(/^hint:/, "") ?? "a hint"}.`);
  for (const x of p.extras.filter(() => !p.wiring.length)) actions.push(`Fit the ${shortName(x.def)}.`);
  for (const a of s.actions ?? []) actions.push(a);

  const connections: Connection[] = [];
  let solder = false;
  let bare = false;
  for (const w of p.wiring) {
    const ea = parseEnd(w.a);
    const eb = parseEnd(w.b);
    const la = leafOf(ctx.sys.system, ctx.sys.lookup, ea.path, ea.iface);
    const lb = leafOf(ctx.sys.system, ctx.sys.lookup, eb.path, eb.iface);
    const types = [la && connectorOf(la.def, la.iface.id), lb && connectorOf(lb.def, lb.iface.id)].filter((x): x is string => Boolean(x));
    if (types.some((t) => SOLDER.test(t))) solder = true;
    if (types.some((t) => /bare_wire/.test(t))) bare = true;
    const rows = w.connections.length ? w.connections : [{ from: `${w.a} ${la?.iface.pin ?? ""}`, to: `${w.b} ${lb?.iface.pin ?? ""}`, crossover: false }];
    const pads = (sel: (c: { from: string; to: string }) => string) => rows.map((c) => parseEnd(sel(c)).pad || parseEnd(sel(c)).iface).join(" · ");
    connections.push({
      link: w.linkId,
      name: w.name,
      from: `${la ? instanceLabelOf({ ctx }, w, "a") : endLabel(ctx, w, "a")}: ${pads((c) => c.from)}`,
      to: `${lb ? instanceLabelOf({ ctx }, w, "b") : endLabel(ctx, w, "b")}: ${pads((c) => c.to)}`,
      crossover: rows.some((c) => c.crossover),
      termination: types.join(" / ") || w.protocol,
      state: w.state,
    });
  }
  for (const [h, ws] of groupBy(p.wiring, (w) => w.harness ?? "")) {
    const hdef = h ? ctx.instances.get(h) : undefined;
    actions.push(`${hdef ? `Using the ${shortName(hdef)}, connect` : "Connect"} ${ws.map((w) => w.name).join(", ")} as in the table (${extentOf(ws)}).`);
  }

  // ---- what the connections join: cables (harness instances) and the modules at their ends
  const cables = new Set<string>(p.wiring.map((w) => w.harness).filter((h): h is string => Boolean(h)));
  const ends = new Set<string>();
  for (const w of p.wiring)
    for (const e of ["a", "b"] as const) {
      const at = endPath(ctx, w, e);
      if (!at) continue;
      if (ctx.instances.get(at)?.kind === "harness") cables.add(at);
      else ends.add(at);
    }

  // ---- notes: the doc spec's, then the model's usage notes of the step's harnesses and modules
  const notes: PlannedStep["notes"] = [];
  const fill = (t: string) => t.replace(/\{\{([^|}]+)(?:\|([^}]+))?\}\}/g, (_m, q: string, f?: string) => v(q.trim(), f?.trim()));
  for (const x of s.notes ?? []) notes.push({ level: x.kind, text: fill(x.text) });
  const noteDefs = new Map<string, ModuleDef>();
  for (const h of new Set([...p.hardware.map((x) => x.harness!), ...cables])) {
    const d = ctx.instances.get(h);
    if (d) noteDefs.set(d.id, d);
  }
  for (const b of [...p.moving, ...p.placed]) noteDefs.set(b.def.id, b.def);
  for (const x of p.extras) noteDefs.set(x.def.id, x.def);
  const materials = new Set<string>();
  for (const d of noteDefs.values()) {
    for (const t of (d.traits ?? []).filter((t) => t.type === "usage_note" && d.kind === "harness").slice(0, 2)) {
      const tl = t.params?.threadlocker;
      if (tl) materials.add(`threadlocker (${String(tl)} strength)`);
      notes.push({ level: "tip", text: `${String(t.params?.note ?? "")} (${d.id})` });
    }
    const cooling = (d.traits ?? []).find((t) => t.type === "operating_conditions")?.params?.cooling;
    if (cooling) notes.push({ level: "caution", text: `${String(cooling).split(". ").slice(0, 3).join(". ")}. (${d.id})` });
  }
  // the same note from several cables or modules once, naming each source
  const merged: PlannedStep["notes"] = [];
  for (const x of notes) {
    const m = /^(.*) \(([^()]+)\)$/.exec(x.text);
    const same = m ? merged.find((y) => y.level === x.level && y.text.startsWith(m[1] + " (")) : undefined;
    if (same && m) same.text = same.text.replace(/\)$/, `, ${m[2]})`);
    else merged.push({ ...x });
  }
  notes.splice(0, notes.length, ...merged);
  if (solder) {
    materials.add("solder and flux");
    if (bare) materials.add("heat-shrink");
  }

  // ---- torque and tools
  const harnessDefs = [...new Map(p.hardware.map((h) => ctx.instances.get(h.harness!)).filter((d): d is ModuleDef => Boolean(d)).map((d) => [d.id, d])).values()];
  const torque = harnessDefs
    .flatMap((hd) => {
      const seen = new Set<number>();
      return jointTorques(hd, ctx.sys.lookup)
        .filter((t) => (seen.has(t.torque.torqueNm) ? false : (seen.add(t.torque.torqueNm), true)))
        .map((t) => `${v(`def:${hd.id}:fastenerStack[${t.index}].torque.torqueNm`, "u=N·m")}${t.basis === "assumption" ? " (assumed)" : ""} ${shortName(t.part ?? hd)}${harnessDefs.length > 1 ? ` (${hd.name})` : ""}`);
    })
    .join("; ");
  const tools = toolsFor([...new Map(p.hardware.map((h) => [h.def.id, h.def])).values()]).map(toolLabel);
  if (solder) tools.push("soldering iron");

  // a unit built several times: the links of one build, made in every build
  const each = builds.length > 1 ? ` in each build (${builds.map((b) => b.path).join(", ")})` : "";
  const ids = (xs: string[]) => (each ? xs.map(rel) : xs).join(", ");
  const trace = [
    p.mates.length ? `mates ${ids(p.mates.map((m) => m.linkId))}${each}` : "",
    p.wiring.length ? `links ${ids(p.wiring.map((w) => w.linkId))}${each}` : "",
  ].filter(Boolean);
  const whole = full.find((f) => f.spec.id === s.id);
  const split = !!whole && (whole.mates.length !== p.mates.length || whole.wiring.length !== p.wiring.length || whole.placed.length !== p.placed.length);
  const afterTest =
    s.after === "test" ? "marked after: \"test\" in the doc spec" : mounts.length ? "it fits propellers, and the bench test runs the motors with the propellers off" : undefined;
  return {
    n: 0,
    id: s.id,
    title: s.title,
    kind: p.mates.length ? "mate" : p.placed.length || (p.extras.length && !p.wiring.length) ? "place" : "connect",
    plan: p,
    parts,
    actions,
    tools,
    materials: [...materials],
    torque,
    notes,
    connections,
    solder,
    trace,
    split,
    cables: [...cables],
    ends: [...ends],
    conductors: p.wiring.reduce((t, w) => t + Math.max(1, w.connections.length), 0),
    links: p.wiring.length,
    extent: extentOf(p.wiring),
    ...(afterTest ? { afterTest } : {}),
    perBuild,
  };
}

/** "16 conductors in 2 links": the pin rows of the links' tables (a link without one counts as one connection). */
export function extentOf(ws: WiringStep[]): string {
  const n = ws.reduce((t, w) => t + Math.max(1, w.connections.length), 0);
  const noun = ws.every((w) => w.connections.length) ? "conductor" : "connection";
  return `${n} ${noun}${n === 1 ? "" : "s"}${ws.length > 1 ? ` in ${ws.length} links` : ""}`;
}

/** Name of the module at one end of a connection, when the end is reached through a group's export. */
function endLabel(ctx: BuiltContext, w: WiringStep, end: "a" | "b"): string {
  const at = endPath(ctx, w, end);
  const def = at ? ctx.instances.get(at) : undefined;
  return def ? `${shortName(def)} (${at})` : parseEnd(end === "a" ? w.a : w.b).path;
}

/** Instance path of one end of a connection: its leaf module, through group exports and sub-assembly prefixes. */
export function endPath(ctx: BuiltContext, w: WiringStep, end: "a" | "b"): string | undefined {
  const e = parseEnd(end === "a" ? w.a : w.b);
  const prefix = w.linkId.includes("/") ? w.linkId.slice(0, w.linkId.lastIndexOf("/") + 1) : "";
  const leaf = leafOf(ctx.sys.system, ctx.sys.lookup, e.path, e.iface);
  if (leaf) {
    const at = leaf.path.join("/");
    return prefix && !at.startsWith(prefix) ? prefix + at : at;
  }
  // a group exports its children's interfaces: the child below the path that has the interface
  const hit = [...ctx.instances.entries()].find(([k, d]) => (k === e.path || k.startsWith(e.path + "/")) && !d.children?.length && d.interfaces.some((i) => i.id === e.iface));
  return hit?.[0];
}

export type { WiringStep };
