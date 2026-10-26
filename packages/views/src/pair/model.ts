/**
 * The pair view's model (PB-905): the pairs of modules a level links, every
 * stored link between the two of a pair validated as the system checks
 * validate it, and each module's interfaces in a census (linked to the other
 * module, linked elsewhere, or free), with the pairings DRC would also allow.
 * No React here.
 */
import { validateLink, validatePair, type InterfaceDef, type InterfaceLink, type LinkResult, type ModuleDef, type UhdBundle } from "@deltarobotics/uhd";
import { definition } from "../applies.js";

/** One side of a pair: a child of the level, or the level's own boundary. */
export interface PairSide {
  /** The child id; "" for the level's own interfaces (its boundary). */
  child: string;
  /** Instance path from the root. */
  path: string;
  def: ModuleDef;
  label: string;
}

export type LinkState = LinkResult["state"];

export interface PairLink {
  link: InterfaceLink;
  result: LinkResult;
  /** The link's ends as this pair is drawn (`a` on the left). */
  aIface: InterfaceDef;
  bIface: InterfaceDef;
  /** The stored link has the pair's `b` on its `a` end. */
  flipped: boolean;
  /** One row per conductor, left and right as drawn. */
  rows: { a: string; aPin?: string; b: string; bPin?: string; method: string; locked: boolean }[];
}

export interface Pair {
  /** `a~b` by child id (sorted, so each pair once). */
  key: string;
  a: PairSide;
  b: PairSide;
  links: PairLink[];
  /** The worst link state. */
  state: LinkState;
}

const ORDER: LinkState[] = ["incompatible", "partial", "unconfigured", "configured"];
export const worst = (states: LinkState[]): LinkState => ORDER.find((s) => states.includes(s)) ?? "configured";

const endChild = (end: InterfaceLink["a"]) => ("child" in end ? end.child : "");
const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Every pair of modules the level's stored links join, the pair with the most links first. */
export function pairsOf(module: ModuleDef, bundle: UhdBundle, path: string): Pair[] {
  const lookup = (id: string) => definition(bundle, id);
  const side = (child: string): PairSide | undefined => {
    if (!child) return { child: "", path, def: module, label: `${module.name} (boundary)` };
    const ref = module.children?.find((c) => c.id === child);
    const def = ref ? lookup(ref.moduleDefId) : undefined;
    return ref && def ? { child, path: join(path, child), def, label: ref.name ?? def.name } : undefined;
  };
  const pairs = new Map<string, Pair>();
  for (const link of module.links ?? []) {
    const ca = endChild(link.a);
    const cb = endChild(link.b);
    if (ca === cb) continue;
    const [first, second] = [ca, cb].sort();
    const key = `${first}~${second}`;
    let pair = pairs.get(key);
    if (!pair) {
      const a = side(first);
      const b = side(second);
      if (!a || !b) continue;
      pair = { key, a, b, links: [], state: "configured" };
      pairs.set(key, pair);
    }
    let result: LinkResult;
    try {
      result = validateLink(module, link, lookup);
    } catch {
      continue;
    }
    const flipped = ca !== pair.a.child;
    const [ea, eb] = flipped ? [result.b, result.a] : [result.a, result.b];
    pair.links.push({
      link,
      result,
      aIface: ea.iface,
      bIface: eb.iface,
      flipped,
      rows: result.children.map((c) => {
        const [x, y] = flipped ? [c.b, c.a] : [c.a, c.b];
        return { a: x.slotId ?? x.leafId, aPin: x.pin, b: y.slotId ?? y.leafId, bPin: y.pin, method: c.method, locked: c.locked };
      }),
    });
  }
  const out = [...pairs.values()].filter((p) => p.links.length);
  for (const p of out) p.state = worst(p.links.map((l) => l.result.state));
  // two parts before a part and the level's own boundary (a board's nets), then by how much joins them
  const boundary = (p: Pair) => Number(p.a.child === "" || p.b.child === "");
  return out.sort((x, y) => boundary(x) - boundary(y) || y.links.length - x.links.length || x.key.localeCompare(y.key));
}

/** A pair by what a view was opened with: `link` (a link id, or `owner/link`), or `a` and `b` (instance paths or child ids). */
export function findPair(pairs: Pair[], params: Readonly<Record<string, string>> | undefined): Pair | undefined {
  if (!params) return undefined;
  if (params.link) {
    const id = params.link.split("/").pop();
    const hit = pairs.find((p) => p.links.some((l) => l.link.id === id));
    if (hit) return hit;
  }
  if (params.a !== undefined && params.b !== undefined) {
    const name = (s: string) => s.split("/").pop() ?? s;
    const want = new Set([params.a, params.b].flatMap((s) => [s, name(s)]));
    return pairs.find((p) => [p.a, p.b].every((s) => want.has(s.path) || want.has(s.child)));
  }
  return undefined;
}

export type CensusStatus = "here" | "elsewhere" | "free";

export interface CensusEntry {
  iface: InterfaceDef;
  status: CensusStatus;
  /** For `elsewhere`: the modules it is linked to (labels). */
  others: string[];
  /** For `here`: the link's state. */
  state?: LinkState;
  /** The group it is listed under (its domain and first protocol). */
  group: string;
}

/**
 * Every interface of one side: linked to the other side of the pair, linked
 * to another module of the level, or free. Leaves composed into another
 * interface of the same module (an I2C bus's SDA) are listed under it, not
 * on their own.
 */
export function censusOf(module: ModuleDef, pair: Pair, which: "a" | "b", labels: (child: string) => string): CensusEntry[] {
  const me = pair[which];
  const other = pair[which === "a" ? "b" : "a"];
  const here = new Map<string, LinkState>();
  const elsewhere = new Map<string, Set<string>>();
  for (const link of module.links ?? []) {
    for (const [end, far] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      if (endChild(end) !== me.child) continue;
      const id = end.interfaceId;
      if (endChild(far) === other.child) {
        const state = pair.links.find((l) => l.link === link)?.result.state ?? "configured";
        here.set(id, here.has(id) ? worst([here.get(id)!, state]) : state);
      } else {
        const s = elsewhere.get(id) ?? new Set<string>();
        s.add(labels(endChild(far)));
        elsewhere.set(id, s);
      }
    }
  }
  const composedInto = new Set(me.def.interfaces.flatMap((i) => (i.profiles?.[0] ? Object.values(i.profiles[0].bindings ?? {}).filter((b): b is string => typeof b === "string") : [])));
  // an assembly links through its parts' interfaces (`fc.stack_mount`): those count as its own here
  const own = new Set(me.def.interfaces.map((i) => i.id));
  const through: InterfaceDef[] = [];
  for (const l of pair.links) {
    const end = (which === "a") !== l.flipped ? l.link.a : l.link.b;
    const iface = which === "a" ? l.aIface : l.bIface;
    if (!own.has(end.interfaceId) && !through.some((t) => t.id === end.interfaceId)) through.push({ ...iface, id: end.interfaceId, name: iface.name ?? end.interfaceId });
  }
  return [...me.def.interfaces, ...through]
    .filter((i) => !composedInto.has(i.id) || here.has(i.id) || elsewhere.has(i.id))
    .map((iface) => ({
      iface,
      status: here.has(iface.id) ? ("here" as const) : elsewhere.has(iface.id) ? ("elsewhere" as const) : ("free" as const),
      others: [...(elsewhere.get(iface.id) ?? [])],
      state: here.get(iface.id),
      group: `${iface.domain} · ${iface.protocols[0]?.type ?? "custom"}`,
    }));
}

export interface Potential {
  a: string;
  b: string;
  protocol: string;
  clean: boolean;
}

/** Pairings DRC would also allow between the two, top level only, cleanest first, without the interfaces already linked. */
export function potentialsOf(pair: Pair, limit = 3): { shown: Potential[]; hidden: number } {
  let result;
  try {
    result = validatePair(pair.a.def, pair.b.def);
  } catch {
    return { shown: [], hidden: 0 };
  }
  const used = new Set(pair.links.flatMap((l) => [`a:${l.aIface.id}`, `b:${l.bIface.id}`]));
  const seen = new Set<string>();
  const all: Potential[] = [];
  for (const p of result.potentials) {
    if (p.a.regionPath.length !== 1 || p.b.regionPath.length !== 1) continue;
    const [a, b] = p.a.moduleId === pair.a.def.id ? [p.a.regionPath[0], p.b.regionPath[0]] : [p.b.regionPath[0], p.a.regionPath[0]];
    if (used.has(`a:${a}`) || used.has(`b:${b}`) || seen.has(`${a}~${b}`)) continue;
    seen.add(`${a}~${b}`);
    all.push({ a, b, protocol: p.protocol, clean: p.clean });
  }
  all.sort((x, y) => Number(y.clean) - Number(x.clean) || x.a.localeCompare(y.a));
  return { shown: all.slice(0, limit), hidden: Math.max(0, all.length - limit) };
}
