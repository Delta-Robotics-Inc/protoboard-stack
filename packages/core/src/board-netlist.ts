/**
 * Board netlist (tool-integrations.md §2, PB-820): the first step of every
 * `circuit` provider, shared so that each provider starts from the same
 * reading of the board.
 *
 * A UHD board module (docs/boards-and-nets.md in UHD) is flattened into what
 * a PCB tool needs and nothing else:
 *
 *   components  each part on the board, sub-modules expanded (instance
 *               path `power/u1`): part id, kind, value, package facts, pin
 *               designators, body artifacts
 *   nets        the conductors, by union-find over the links of the board
 *               and of every sub-module between leaf pins and Net interfaces
 *               (membership links and plain pin-to-pin links alike)
 *   edge        the board's exports and the pins they carry (a net port: the
 *               whole conductor of the net it exports)
 *
 * Which children are sub-modules, and how their nets join the board's, is
 * docs/specs/nested-boards.md.
 *
 * Nothing here knows a tool: no footprints, no layers, no placement. A
 * provider maps this to its own native design with its own tables, and
 * compares its laid-out copper back to it with `netlistDrift`.
 */
import {
  formatPath,
  isBoard,
  isConnector,
  isNet,
  netPortOf,
  leafPins,
  partPackage,
  passiveOf,
  resolveEndpoint,
  resolveExports,
  slotBindings,
  validateLink,
  type ChildModuleRef,
  type InterfaceLink,
  type DesignEnvelopeTrait,
  type GeometryFrame,
  type InterfaceDef,
  type ModuleDef,
  type ModuleLookup,
  type PartPackage,
} from "@deltarobotics/uhd";
import { NETLIST_SCHEMA, type NetlistReport } from "./outputs.js";
import { placementPart } from "./placement.js";

export const BOARD_NETLIST_SCHEMA = "protoboard.board-netlist/v0";

/** What a pin is electrically, coarsely: enough for a tool to mark supply and ground pins. */
export type BoardPinKind = "power_in" | "power_out" | "ground" | "signal" | "passive" | "nc";

export interface BoardPin {
  /** Leaf interface id on the part, e.g. `pin_8`. */
  interface: string;
  /** Package designator, e.g. `8`, `57`, `EP`, `A7`. */
  pin: string;
  /** Pin name as the part states it, e.g. `VDDIO`. */
  name: string;
  kind: BoardPinKind;
}

/** What a component is, from its passive trait, categories and interfaces. */
export type BoardComponentKind = "resistor" | "capacitor" | "inductor" | "ferrite_bead" | "connector" | "switch" | "ic";

export interface BoardBody {
  /** Artifact id on the part (role `body`). */
  artifact: string;
  format: string;
  units?: string;
  /**
   * The part's mounting frame in its body's coordinates, when the part states
   * one facing the board (normal −Z): where the body meets the board.
   */
  mount?: GeometryFrame;
}

export interface BoardComponent {
  /** Instance path relative to the board, e.g. `u1`, or `power/u1` inside a sub-module. */
  instance: string;
  /** The sub-module the part sits in (its path), when it is not a child of the board itself. */
  group?: string;
  /** Part (module definition) id. */
  part: string;
  name: string;
  kind: BoardComponentKind;
  manufacturer?: string;
  /** This placement's MPN: a series passive's comes from its overrides. */
  mpn?: string;
  /** Passive value in SI units (Ω, F, H), with tolerance as a fraction, as placed (overrides applied). */
  value?: { value: number; unit: string; tolerance?: number };
  /** The child's `ChildModuleRef.overrides`, when it sets any. */
  overrides?: Record<string, unknown>;
  /** Package facts as the manufacturer states them, with the overall size. */
  package?: PartPackage;
  /** Every leaf pin with a designator, in designator order. */
  pins: BoardPin[];
  /** Body artifacts (GLB/STEP) the part carries. */
  bodies: BoardBody[];
}

export interface BoardNetDef {
  /** The Net interface id, or the first link id for a net declared only by pin-to-pin links. */
  id: string;
  name: string;
  kind: "ground" | "power" | "signal";
  /** Design voltage stated on the Net interface. */
  voltageV?: number | [number, number];
  /** `<instance>:<interface>`, sorted. */
  pins: string[];
  /** Ids of the links that make up the net (inside a sub-module: `<path>/<link id>`). */
  links: string[];
  /** The sub-modules' own nets on this conductor, as UHD canonical paths (`led1:gnd`), when there are any. */
  aliases?: string[];
}

export interface BoardEdge {
  /** Export id on the board. */
  id: string;
  name: string;
  /** The part the export lands on; for a net port, the module that declares the net ("" for the board itself). */
  instance: string;
  /** The part's interface; for a net port, the net's id. */
  interface: string;
  /** Set for a net port (UHD 0.3.0 `{ self: true, interfaceId }`): the id of the board net (conductor) it exports. */
  net?: string;
  /** Leaf pins the export carries, `<instance>:<interface>`. */
  pins: string[];
}

/** A sub-module expanded onto the board (docs/specs/nested-boards.md §2). */
export interface BoardGroup {
  /** Instance path below the board, e.g. `led1`, `power/ldo`. */
  path: string;
  /** Its module definition id. */
  module: string;
  name: string;
  /** The enclosing sub-module's path, when it is nested in another. */
  parent?: string;
}

/** A child that is not on this PCB: a harness with contents, a separate board, a daughterboard mated by connector. */
export interface BoardBoundary {
  instance: string;
  module: string;
  reason: "harness" | "board" | "mated";
}

export interface BoardNetlist {
  schema: typeof BOARD_NETLIST_SCHEMA;
  /** Board module id. */
  board: string;
  components: BoardComponent[];
  nets: BoardNetDef[];
  edge: BoardEdge[];
  /** The board's `design_envelope` requirement, when it states one. */
  envelope?: DesignEnvelopeTrait["params"];
  /** Sub-modules expanded onto the board, in tree order (only when there are any). */
  groups?: BoardGroup[];
  /** Children kept as boundaries, not on this PCB (only when there are any). */
  boundaries?: BoardBoundary[];
  /** What could not be flattened (unknown parts, composite links, pins without designators). */
  problems: string[];
  /** Warnings about the grouping: an unused export of a sub-module, a sub-module with no parts (only when there are any). */
  notes?: string[];
}

const byDesignator = (a: BoardPin, b: BoardPin) => {
  const na = Number(a.pin);
  const nb = Number(b.pin);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return a.pin.localeCompare(b.pin);
};

function pinKind(iface: InterfaceDef): BoardPinKind {
  const power = iface.protocols.find((p) => p.type === "power");
  if (power?.roles.includes("ground")) return "ground";
  if (power?.roles.includes("output")) return "power_out";
  if (power) return "power_in";
  if (iface.protocols.some((p) => p.type === "passive")) return "passive";
  if (iface.protocols.some((p) => p.roles.includes("no_connect"))) return "nc";
  return "signal";
}

function componentKind(def: ModuleDef): BoardComponentKind {
  const passive = passiveOf(def);
  if (passive) return passive.kind as BoardComponentKind;
  const categories = def.categories ?? [];
  // the UHD taxonomy files switches and buttons under component.switch; the bare forms are older tags
  if (categories.some((c) => /^(component\.switch|switch|button|input\.button)(\.|$)/.test(c))) return "switch";
  if (categories.some((c) => /^connector/.test(c)) || def.interfaces.some(isConnector)) return "connector";
  return "ic";
}

function mountFrame(def: ModuleDef): GeometryFrame | undefined {
  for (const i of def.interfaces) {
    const f = i.geometry?.frame;
    if (i.domain === "mechanical" && f && Math.abs(f.normal[2] + 1) < 1e-6) return f;
  }
  return undefined;
}

function voltageOf(net: InterfaceDef): number | [number, number] | undefined {
  const p = net.parameters?.find((x) => x.id === "voltage");
  if (!p) return undefined;
  if (p.value !== undefined) return p.value;
  return p.range ? [p.range[0], p.range[1]] : undefined;
}

/** Union-find over string keys. */
class Groups {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  keys() {
    return [...this.parent.keys()];
  }
}

export type BoardChildRole = "part" | "submodule" | "harness" | "board" | "mated";

export interface BoardOptions {
  /**
   * Whether a module is a separate board in this project (it has its own circuit binding). A child for
   * which this is true is a boundary, never expanded (docs/specs/nested-boards.md §2, rule 3).
   */
  isBoard?: (moduleDefId: string) => boolean;
}

/** The board options a project gives: a module bound to a circuit provider is a board of its own. */
export function boardOptions(p: { capabilities: { module?: string; capability: string; problem?: unknown }[] }): BoardOptions {
  const boards = new Set(p.capabilities.filter((b) => b.capability === "circuit" && !b.problem && b.module).map((b) => b.module!));
  return { isBoard: (id) => boards.has(id) };
}

/** Endpoint targets, as stored on links. */
type End = InterfaceLink["a"];

const isPart = (def: ModuleDef) => !!partPackage(def) || !!def.part_number?.trim();

/**
 * Whether a child of `parent` (a board, or a sub-module expanded onto one) is a part on the PCB, a
 * sub-module to expand, or a boundary that is not on this PCB (docs/specs/nested-boards.md §2): the
 * first rule that applies of harness, part (a package or a part number), separate board (UHD's
 * `kind: "board"`, its own circuit binding or a `design_envelope`), daughterboard (joined at the
 * parent by a connector link), sub-module (`kind: "group"`, or children), part.
 */
export function boardChildRole(def: ModuleDef, ref: ChildModuleRef, parent: ModuleDef, lookup: ModuleLookup, options: BoardOptions = {}): BoardChildRole {
  if (def.kind === "harness") return def.children?.length ? "harness" : "part";
  if (isPart(def)) return "part";
  // UHD 0.3.0's board marker says "this module is one PCB" by itself; a bought module that is a PCB
  // stays a part by rule 2 above
  if (isBoard(def)) return "board";
  const grouped = def.kind === "group" || !!def.children?.length;
  if (!grouped) return "part";
  if (options.isBoard?.(def.id) || (def.traits ?? []).some((t) => t.type === "design_envelope")) return "board";
  if (matedAt(parent, ref.id, lookup)) return "mated";
  return "submodule";
}

/** Whether a stored link of `parent` mates a connector on or below `childId` with another connector. */
function matedAt(parent: ModuleDef, childId: string, lookup: ModuleLookup): boolean {
  for (const link of parent.links ?? []) {
    const ends = [link.a, link.b];
    if (!ends.some((e) => "child" in e && e.child === childId)) continue;
    try {
      if (ends.every((e) => isConnector(resolveEndpoint(parent, e, lookup).iface))) return true;
    } catch {
      // an end that does not resolve is reported where the links are read
    }
  }
  return false;
}

/** A module in the expanded tree whose links are read: the board (path "") and each sub-module. */
interface Scope {
  path: string;
  def: ModuleDef;
}

const join = (path: string, id: string) => (path ? `${path}/${id}` : id);
const MAX_DEPTH = 16;

/**
 * Flatten a UHD board module into components, nets and edge. `lookup`
 * resolves the parts (the project's definition registry).
 *
 * Sub-modules are expanded to any depth (docs/specs/nested-boards.md): their
 * parts are components under instance paths (`power/u1`), every module's
 * links are read in its own scope, and the nets of all levels joined through
 * exported pins are one conductor named by its shallowest net. A board with
 * no sub-module reads exactly as before.
 */
export function boardNetlist(board: ModuleDef, lookup: ModuleLookup, options: BoardOptions = {}): BoardNetlist {
  const problems: string[] = [];
  const notes: string[] = [];
  const components: BoardComponent[] = [];
  const parts = new Map<string, ModuleDef>(); // instance path → part
  const groups: BoardGroup[] = [];
  const boundaries: BoardBoundary[] = [];
  const scopes: Scope[] = [{ path: "", def: board }];
  const scopeAt = new Map<string, Scope>([["", scopes[0]]]);

  // ---- components: the board's parts and every sub-module's, in tree order
  const walk = (parent: ModuleDef, path: string, depth: number) => {
    for (const child of parent.children ?? []) {
      const inst = join(path, child.id);
      const def = lookup(child.moduleDefId);
      if (!def) {
        problems.push(`component ${inst}: part ${child.moduleDefId} is not defined`);
        continue;
      }
      const role = boardChildRole(def, child, parent, lookup, options);
      if (role === "harness" || role === "board" || role === "mated") {
        boundaries.push({ instance: inst, module: def.id, reason: role });
        continue;
      }
      if (role === "submodule") {
        if (depth >= MAX_DEPTH) {
          problems.push(`sub-module ${inst} (${def.id}) is nested more than ${MAX_DEPTH} deep (a definition that contains itself?)`);
          continue;
        }
        if ((child.quantity ?? 1) > 1) problems.push(`sub-module ${inst} (${def.id}) has quantity ${child.quantity}: a board places each part, so give each copy its own child`);
        groups.push({ path: inst, module: def.id, name: child.name ?? def.name, ...(path ? { parent: path } : {}) });
        const scope = { path: inst, def };
        scopes.push(scope);
        scopeAt.set(inst, scope);
        const before = components.length;
        walk(def, inst, depth + 1);
        if (components.length === before) notes.push(`sub-module ${inst} (${def.id}) contributes no parts to the board`);
        continue;
      }
      parts.set(inst, def);
      const pins: BoardPin[] = [];
      const missing: string[] = [];
      for (const leaf of leafPins(def)) {
        if (leaf.pin === undefined) missing.push(leaf.id);
        else pins.push({ interface: leaf.id, pin: String(leaf.pin), name: leaf.name ?? leaf.id, kind: pinKind(leaf) });
      }
      if (missing.length) problems.push(`component ${inst} (${def.id}): ${missing.length} pin(s) without a designator: ${missing.join(", ")}`);
      const placed = placementPart(def, child.overrides);
      for (const problem of placed.problems) problems.push(`component ${inst} (${def.id}): ${problem}`);
      const pkg = partPackage(def);
      const mount = mountFrame(def);
      components.push({
        instance: inst,
        ...(path ? { group: path } : {}),
        part: def.id,
        name: child.name ?? def.name,
        kind: componentKind(def),
        ...(def.manufacturer ? { manufacturer: def.manufacturer } : {}),
        ...(placed.mpn ? { mpn: placed.mpn } : {}),
        ...(placed.value ? { value: placed.value } : {}),
        ...(child.overrides && Object.keys(child.overrides).length ? { overrides: child.overrides } : {}),
        ...(pkg ? { package: pkg } : {}),
        pins: pins.sort(byDesignator),
        bodies: (def.artifacts ?? [])
          .filter((a) => a.role === "body" && (a.format === "glb" || a.format === "step"))
          .map((a) => ({ artifact: a.id, format: a.format!, ...(a.units ? { units: a.units } : {}), ...(mount ? { mount } : {}) })),
      });
    }
  };
  walk(board, "", 0);
  const boundaryAt = new Map(boundaries.map((b) => [b.instance, b]));

  /**
   * Where an end of a link stored on `scope` lands in the expanded board: a part's pin, a net or own
   * interface of a sub-module, or a boundary. Exports are followed down through sub-modules; a part
   * stops the walk (its own exports, if any, are its business, as on a flat board). A sub-module's net
   * reached through the net port it exports (UHD 0.3.0) is a landing with `port` set; one reached
   * without a port is UHD's `net_not_own`.
   */
  type Landing = { kind: "pin"; key: string; part: string; interfaceId: string } | { kind: "port"; key: string } | { kind: "net"; key: string; port: boolean } | { kind: "boundary"; instance: string } | { kind: "missing"; message: string };
  const land = (scope: Scope, childId: string, interfaceId: string): Landing => {
    let at = scope;
    let child = childId;
    let id = interfaceId;
    let throughPort = false;
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      const inst = join(at.path, child);
      if (parts.has(inst)) return { kind: "pin", key: `${inst}:${id}`, part: inst, interfaceId: id };
      if (boundaryAt.has(inst)) return { kind: "boundary", instance: inst };
      const inner = scopeAt.get(inst);
      if (!inner) return { kind: "missing", message: `${formatPath([inst], id)} is not on the board` };
      const own = inner.def.interfaces.find((i) => i.id === id);
      // a net port may take its net's id, so the net is then named directly
      if (own) return isNet(own) ? { kind: "net", key: `${inst}:${id}`, port: throughPort || netPortOf(inner.def, own.id)?.id === own.id } : { kind: "port", key: `${inst}:${id}` };
      let ex;
      try {
        ex = resolveExports(inner.def, lookup).find((e) => e.id === id);
      } catch (e) {
        return { kind: "missing", message: (e as Error).message };
      }
      if (!ex) return { kind: "missing", message: `${inst} (${inner.def.id}) has no interface or export ${id}` };
      if (!("child" in ex.from)) {
        // a net port: the sub-module's own net, on the same module (the next turn finds it as its own)
        id = ex.from.interfaceId;
        throughPort = true;
        continue;
      }
      at = inner;
      child = ex.from.child;
      id = ex.from.interfaceId;
    }
    return { kind: "missing", message: `${formatPath([join(scope.path, childId)], interfaceId)} is exported more than ${MAX_DEPTH} levels deep` };
  };

  // ---- nets: union-find over the links between leaf pins and nets, every module in its own scope
  const groupsUf = new Groups();
  const linksOf = new Map<string, string[]>();
  const netIfaces = new Map<string, { iface: InterfaceDef; scope: string }>(); // net key → its interface
  const ports = new Set<string>(); // a sub-module's own non-net interfaces joined by links: junctions, not nets
  for (const s of scopes) for (const i of s.def.interfaces.filter(isNet)) netIfaces.set(`${s.path}:${i.id}`, { iface: i, scope: s.path });
  for (const n of netIfaces.keys()) groupsUf.find(n);
  const consumed = new Set<string>(); // "<sub-module path>:<export id>" a link or export of the parent uses
  const paired = new Set<InterfaceLink>();
  /** Whether a link joins two functional composites directly: not connectors, not composed, carried by no harness. */
  const bus = (link: InterfaceLink) =>
    !link.harness &&
    [link.a, link.b].every((e) => "child" in e && !e.compose) &&
    [link.a, link.b].every((e) => {
      try {
        const iface = resolveEndpoint(scopeOfLink.get(link)!.def, e, lookup).iface;
        return !!iface.slots?.length && !isConnector(iface) && !isNet(iface) && iface.domain === "electrical";
      } catch {
        return false;
      }
    });
  const scopeOfLink = new Map<InterfaceLink, Scope>();
  for (const s of scopes) for (const l of s.def.links ?? []) scopeOfLink.set(l, s);
  /** The conductors of a direct link between composites, from UHD's own pairing of their slots (LinkResult.children). */
  const pairBus = (s: Scope, link: InterfaceLink, lid: string) => {
    let r;
    try {
      r = validateLink(s.def, link, lookup);
    } catch (e) {
      problems.push(`link ${lid}: ${(e as Error).message}`);
      return;
    }
    if (r.state === "incompatible") {
      problems.push(`link ${lid} pairs ${r.a.path} with ${r.b.path}, which UHD finds incompatible: ${r.diagnostics.find((d) => d.severity === "error")?.message ?? r.state}`);
      return;
    }
    const pin = (end: typeof r.a, leaf: string) => {
      const inst = join(s.path, end.ownerPath.join("/"));
      return parts.has(inst) ? `${inst}:${leaf}` : undefined;
    };
    for (const c of r.children) {
      const [x, y] = [pin(r.a, c.a.leafId), pin(r.b, c.b.leafId)];
      if (!x || !y) continue;
      groupsUf.union(x, y);
      linksOf.set(x, [...(linksOf.get(x) ?? []), `${lid}.${c.a.slotId ?? c.a.leafId}`]);
    }
    if (r.unresolvedSlots.length) notes.push(`link ${lid} leaves ${r.unresolvedSlots.join(", ")} unpaired: those lines are not connected`);
  };
  for (const s of scopes) {
    const where = (id: string) => (s.path ? `${s.path}/${id}` : id);
    const isMate = (link: InterfaceLink) => {
      const ends = [link.a, link.b].filter((e): e is Extract<End, { child: string }> => "child" in e);
      return ends.length === 2 && ends.some((e) => boundaryAt.get(join(s.path, e.child))?.reason === "mated");
    };
    for (const link of s.def.links ?? []) {
      for (const e of [link.a, link.b]) if ("child" in e && scopeAt.has(join(s.path, e.child))) consumed.add(`${join(s.path, e.child)}:${e.interfaceId}`);
      if (isMate(link)) continue; // the mate of a daughterboard: its positions are on the other PCB
      const lid = where(link.id);
      const ends: string[] = [];
      let skip = false;
      for (const end of [link.a, link.b]) {
        if (!("child" in end)) {
          if (netIfaces.has(`${s.path}:${end.interfaceId}`)) ends.push(`${s.path}:${end.interfaceId}`);
          else if (s.path && s.def.interfaces.some((i) => i.id === end.interfaceId && i.domain === "electrical" && !i.slots?.length && !isConnector(i))) {
            // a sub-module's own pin, linked to its parts inside and to the parent's nets outside: a junction
            ports.add(`${s.path}:${end.interfaceId}`);
            ends.push(`${s.path}:${end.interfaceId}`);
          } else skip = true; // the board's own non-net interface (a mount, a label): not a conductor
          continue;
        }
        let resolved;
        try {
          resolved = resolveEndpoint(s.def, end, lookup);
        } catch (e) {
          problems.push(`link ${lid}: ${(e as Error).message}`);
          skip = true;
          continue;
        }
        const iface = resolved.iface;
        const at = formatPath(s.path ? [...s.path.split("/"), end.child] : [end.child], end.interfaceId);
        if (iface.domain !== "electrical") {
          skip = true;
          continue;
        }
        if (iface.slots?.length || isConnector(iface) || resolved.composed) {
          // a direct link between two functional composites (an I2C port to an I2C port) is copper, conductor by
          // conductor as UHD pairs them (docs/specs/nested-boards.md §4.4); a connector, a link-scoped composition
          // or a composite linked to a pin is not
          if (!bus(link)) problems.push(`link ${lid} joins ${at}, a composite interface; a board netlist needs leaf pins (use netLinks for each pin)`);
          else if (!paired.has(link)) {
            paired.add(link);
            pairBus(s, link, lid);
          }
          skip = true;
          continue;
        }
        const l = land(s, end.child, end.interfaceId);
        if (l.kind === "pin") ends.push(l.key);
        else if (l.kind === "port") {
          ports.add(l.key);
          ends.push(l.key);
        } else if (l.kind === "net" && l.port) {
          // the sub-module's net port (UHD 0.3.0): the parent joins the sub-module's own net, which is then
          // one conductor with the parent's net or pin
          ends.push(l.key);
        } else if (l.kind === "net") {
          problems.push(`link ${lid} joins ${l.key}, a net of the sub-module ${l.key.slice(0, l.key.lastIndexOf(":"))} that it does not export; a net joins pins on the module that declares it (UHD net_not_own): export the net as a net port (exports: [{ id, from: { self: true, interfaceId } }]) or link a pin the sub-module exports`);
          skip = true;
        } else if (l.kind === "boundary") {
          const b = boundaryAt.get(l.instance)!;
          problems.push(`link ${lid} joins ${at}, which is on ${l.instance} (${b.module}), ${b.reason === "harness" ? "a harness" : b.reason === "board" ? "a separate board" : "a daughterboard mated by connector"}, not on this PCB; join it through a connector on this board`);
          skip = true;
        } else {
          problems.push(`link ${lid}: ${l.message}`);
          skip = true;
        }
      }
      if (skip || ends.length !== 2) continue;
      groupsUf.union(ends[0], ends[1]);
      const root = ends[0];
      linksOf.set(root, [...(linksOf.get(root) ?? []), lid]);
    }
  }

  const members = new Map<string, string[]>();
  for (const k of groupsUf.keys()) {
    const r = groupsUf.find(k);
    members.set(r, [...(members.get(r) ?? []), k]);
  }
  const linkGroups = new Map<string, string[]>();
  for (const [first, ids] of linksOf) {
    const r = groupsUf.find(first);
    linkGroups.set(r, [...(linkGroups.get(r) ?? []), ...ids]);
  }

  const depthOf = (scope: string) => (scope ? scope.split("/").length : 0);
  const nets: BoardNetDef[] = [];
  const netAt = new Map<string, BoardNetDef>(); // union-find root → the conductor's net
  for (const [root, keys] of members) {
    const pins = keys.filter((k) => netIfaces.has(k) === false && !ports.has(k)).sort();
    const declared = keys.filter((k) => netIfaces.has(k)).sort((a, b) => depthOf(netIfaces.get(a)!.scope) - depthOf(netIfaces.get(b)!.scope) || a.localeCompare(b));
    const links = (linkGroups.get(root) ?? []).sort();
    // two nets of one module on one conductor (a flat board's rule, in each module's scope)
    const byScope = new Map<string, string[]>();
    for (const k of declared) byScope.set(netIfaces.get(k)!.scope, [...(byScope.get(netIfaces.get(k)!.scope) ?? []), netIfaces.get(k)!.iface.id]);
    for (const [scope, ids] of byScope) {
      if (ids.length < 2) continue;
      const msg = `nets ${ids.sort().join(", ")} are joined by links into one conductor`;
      problems.push(scope ? `in ${scope} (${scopeAt.get(scope)!.def.id}): ${msg}` : msg);
    }
    const primary = declared.length ? netIfaces.get(declared[0])! : undefined;
    const iface = primary?.iface;
    if (!pins.length) continue; // a declared net with no pins: UHD's net rule reports it
    const kinds = pins.map((p) => {
      const at = p.lastIndexOf(":");
      const leaf = parts.get(p.slice(0, at))?.interfaces.find((i) => i.id === p.slice(at + 1));
      return leaf ? pinKind(leaf) : "signal";
    });
    // the design voltage: the shallowest net that states one; another declared net stating a different one, in
    // another module, is an error (within one module the joined nets are already one)
    const voltaged = declared.find((k) => voltageOf(netIfaces.get(k)!.iface) !== undefined);
    const voltage = voltaged ? voltageOf(netIfaces.get(voltaged)!.iface) : undefined;
    for (const k of declared) {
      const v = voltageOf(netIfaces.get(k)!.iface);
      if (!voltaged || k === voltaged || v === undefined || netIfaces.get(k)!.scope === netIfaces.get(voltaged)!.scope) continue;
      if (JSON.stringify(v) !== JSON.stringify(voltage)) problems.push(`net ${voltaged.startsWith(":") ? voltaged.slice(1) : voltaged} is joined to ${k}, which states ${JSON.stringify(v)} V against ${JSON.stringify(voltage)} V`);
    }
    const kind = kinds.some((k) => k === "power_in" || k === "power_out") || (voltage !== undefined && voltage !== 0) ? "power" : kinds.some((k) => k === "ground") ? "ground" : "signal";
    const nested = primary && primary.scope !== "";
    const aliases = declared.slice(1).filter((k) => netIfaces.get(k)!.scope !== "");
    const net: BoardNetDef = {
      id: iface ? (nested ? declared[0] : iface.id) : links[0],
      name: iface ? (nested ? `${primary!.scope}/${iface.name ?? iface.id}` : (iface.name ?? iface.id)) : links[0],
      kind,
      ...(voltage !== undefined ? { voltageV: voltage } : {}),
      pins,
      links,
      ...(aliases.length ? { aliases } : {}),
    };
    nets.push(net);
    netAt.set(root, net);
  }
  nets.sort((a, b) => a.id.localeCompare(b.id));

  // ---- edge: what plugs into the board from outside (followed through sub-modules to the part)
  const edge: BoardEdge[] = [];
  for (const ex of board.exports ?? []) {
    const from = ex.from;
    const l: Landing = "child" in from ? land(scopes[0], from.child, from.interfaceId) : { kind: "net", key: `:${from.interfaceId}`, port: true };
    if ("child" in from) consumed.add(`${from.child}:${from.interfaceId}`);
    if (l.kind === "net" && l.port) {
      // a net port on the edge (the board's own, or a sub-module's it re-exports): the net's whole conductor
      const net = netIfaces.has(l.key) ? netAt.get(groupsUf.find(l.key)) : undefined;
      const at = l.key.lastIndexOf(":");
      if (!net) {
        problems.push(`export ${ex.id}: the net ${l.key.startsWith(":") ? l.key.slice(1) : l.key} it exports has no pins`);
        continue;
      }
      const declared = netIfaces.get(l.key)!.iface;
      edge.push({ id: ex.id, name: ex.name ?? declared.name ?? ex.id, instance: l.key.slice(0, at), interface: l.key.slice(at + 1), net: net.id, pins: [...net.pins] });
      continue;
    }
    const def = l.kind === "pin" ? parts.get(l.part) : undefined;
    const iface = l.kind === "pin" ? def?.interfaces.find((i) => i.id === l.interfaceId) : undefined;
    if (l.kind !== "pin" || !def || !iface) {
      problems.push(`export ${ex.id}: ${"child" in from ? `${from.child}:` : ""}${from.interfaceId} is not an interface of a component`);
      continue;
    }
    const leaves = iface.slots?.length || isConnector(iface) ? Object.values(slotBindings(iface)) : [iface.id];
    edge.push({ id: ex.id, name: ex.name ?? iface.name ?? ex.id, instance: l.part, interface: l.interfaceId, pins: leaves.map((leaf) => `${l.part}:${leaf}`) });
  }

  // ---- a sub-module's declared export its parent neither links nor re-exports (and does not mark unconnected)
  for (const s of scopes.slice(1)) {
    const parentPath = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/")) : "";
    const parent = scopeAt.get(parentPath)!.def;
    const id = s.path.slice(parentPath ? parentPath.length + 1 : 0);
    const ref = parent.children?.find((c) => c.id === id);
    const marked = new Set((ref?.unconnected ?? []).map((u) => u.interfaceId));
    const reexported = new Set((parent.exports ?? []).flatMap((e) => ("child" in e.from && e.from.child === id ? [e.from.interfaceId] : [])));
    for (const ex of s.def.exports ?? []) {
      if (consumed.has(`${s.path}:${ex.id}`) || reexported.has(ex.id) || marked.has(ex.id)) continue;
      const l = land(scopeAt.get(parentPath)!, id, ex.id);
      const where = l.kind === "pin" ? ` (${l.key})` : l.kind === "net" && l.port ? ` (a net port, ${s.path}:${ex.id})` : "";
      notes.push(`${s.path} exports ${ex.id}${where}, which ${parent.id} leaves unconnected; mark it unconnected on ${s.path} (ChildModuleRef.unconnected) if that is intended`);
    }
  }

  const envelope = board.traits?.find((t) => t.type === "design_envelope") as DesignEnvelopeTrait | undefined;
  return {
    schema: BOARD_NETLIST_SCHEMA,
    board: board.id,
    components,
    nets,
    edge,
    ...(envelope ? { envelope: envelope.params } : {}),
    ...(groups.length ? { groups } : {}),
    ...(boundaries.length ? { boundaries } : {}),
    problems,
    ...(notes.length ? { notes } : {}),
  };
}

/** The intended nets as a `protoboard.netlist/v0` report (the shape a provider exports as laid out). */
export function netlistReport(netlist: BoardNetlist): NetlistReport {
  return { schema: NETLIST_SCHEMA, nets: netlist.nets.map((n) => ({ id: n.id, ...(n.links.length === 1 ? { link: n.links[0] } : {}), pins: n.pins })) };
}

export interface NetlistDriftFinding {
  code: "net_open" | "net_short" | "extra_connection" | "pin_missing" | "net_unrouted";
  /** The intended net, when there is one. */
  net?: string;
  pins: string[];
  message: string;
}

/**
 * Drift between the intended nets and the nets as laid out (each a set of
 * `<instance>:<interface>` pins joined by copper):
 *
 *   pin_missing       an intended pin is not on the board at all
 *   net_unrouted      none of an intended net's pins are joined by copper
 *   net_open          an intended net is split over several copper pieces
 *   net_short         one copper piece joins pins of several intended nets
 *   extra_connection  copper joins a pin that is on no intended net to a net
 *
 * `present` lists every pin the layout has (connected or not), so a pin on
 * a part that was never placed is told apart from one left unrouted.
 */
export function netlistDrift(intended: { id: string; pins: string[] }[], laidOut: { pins: string[] }[], present?: Set<string>): NetlistDriftFinding[] {
  const out: NetlistDriftFinding[] = [];
  const pieceOf = new Map<string, number>();
  laidOut.forEach((g, i) => g.pins.forEach((p) => pieceOf.set(p, i)));
  const netOf = new Map<string, string>();
  for (const n of intended) for (const p of n.pins) netOf.set(p, n.id);

  for (const n of intended) {
    const missing = present ? n.pins.filter((p) => !present.has(p)) : [];
    if (missing.length) out.push({ code: "pin_missing", net: n.id, pins: missing, message: `${n.id}: ${missing.join(", ")} not on the board` });
    const onBoard = n.pins.filter((p) => !missing.includes(p));
    const pieces = new Map<string, string[]>();
    for (const p of onBoard) {
      const key = pieceOf.has(p) ? `c${pieceOf.get(p)}` : `alone:${p}`;
      pieces.set(key, [...(pieces.get(key) ?? []), p]);
    }
    if (onBoard.length > 1 && [...pieces.keys()].every((k) => k.startsWith("alone:"))) {
      out.push({ code: "net_unrouted", net: n.id, pins: onBoard, message: `${n.id} is not routed: none of its ${onBoard.length} pins are joined by copper` });
    } else if (pieces.size > 1) {
      const list = [...pieces.values()].map((g) => `{${g.join(" ")}}`).join(" / ");
      out.push({ code: "net_open", net: n.id, pins: onBoard, message: `${n.id} is split into ${pieces.size} copper pieces: ${list}` });
    }
  }
  for (const g of laidOut) {
    const nets = [...new Set(g.pins.map((p) => netOf.get(p)).filter((x): x is string => !!x))].sort();
    if (nets.length > 1) out.push({ code: "net_short", pins: [...g.pins].sort(), message: `copper joins nets ${nets.join(" + ")} (${[...g.pins].sort().join(" ")})` });
    const stray = g.pins.filter((p) => !netOf.has(p)).sort();
    if (nets.length && stray.length) out.push({ code: "extra_connection", net: nets[0], pins: stray, message: `${stray.join(", ")} joined to ${nets.join(" + ")} by copper, but on no net of the model` });
  }
  return out;
}
