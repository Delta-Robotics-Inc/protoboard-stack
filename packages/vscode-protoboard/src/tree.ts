/**
 * The Explorer's tree: the root system, its instances by hierarchy, and for
 * each module short sections with its interfaces and the links it declares.
 * Badges: part tier, worst finding (in the node or below it), stale outputs.
 * No VS Code API here: the view turns nodes into tree items.
 */
import type { CheckDiagnostic, Severity } from "./check.js";
import type { PartTrust } from "@protoboardai/views/part-status";
import { diagnosticTarget, isStaleCode, localLinkId, worse, type PartTier, type ProjectIndex, type ResolvedInstance } from "./model.js";

export type NodeKind =
  | "system"
  | "assembly"
  | "group"
  | "part"
  | "board"
  | "enclosure"
  | "structure"
  | "harness"
  | "fasteners"
  | "interfaces"
  | "links"
  | "interface"
  | "link";

export interface Counts {
  error: number;
  warning: number;
  info: number;
}

export interface ExplorerNode {
  /** Unique in the tree: `i:<path>`, `s:<path>:interfaces`, `if:<path>:<id>`, `s:<path>:links`, `l:<link id>`. */
  key: string;
  parentKey?: string;
  type: "instance" | "section" | "interface" | "link";
  kind: NodeKind;
  label: string;
  description?: string;
  /** The instance (for sections, interfaces and links: the module they belong to). */
  path: string;
  defId?: string;
  linkId?: string;
  interfaceId?: string;
  tier?: PartTier;
  /** The part's status (PB-932): local, unverified, verified or official, and why. */
  trust?: PartTrust;
  trustBasis?: string;
  /** A blank block: a module of the project that stands for a part nobody has chosen yet. */
  blank?: boolean;
  quantity?: number;
  /** Findings on this node itself. */
  counts: Counts;
  /** Worst finding here or below. */
  worst?: Severity;
  /** Generated outputs of this module are stale. */
  stale: boolean;
  /** Capability operations that apply (`cad:generate`, …). */
  ops: string[];
  hasArtifacts: boolean;
  children: ExplorerNode[];
}

export const TIER_LABEL: Record<PartTier, string> = { catalog: "catalog", "project-researched": "researched", "project-specific": "project" };

export const CAPABILITY_OPS = ["generate", "export", "extract", "check"] as const;

const zero = (): Counts => ({ error: 0, warning: 0, info: 0 });

/** What kind of thing an instance is: from its UHD kind, its children and fastener stack, and the capability that designs it. */
export function instanceKind(index: ProjectIndex, inst: ResolvedInstance): NodeKind {
  if (inst.path === "") return "system";
  const def = index.bundleDefs.get(inst.definition);
  if (inst.kind === "group") return "group";
  if (inst.kind === "harness") return def?.fastenerStack?.length ? "fasteners" : "harness";
  const caps = index.capabilities.get(inst.definition) ?? [];
  if (inst.kind === "board" || caps.some((c) => c.capability === "circuit")) return "board";
  if (caps.some((c) => c.capability === "cad")) return caps.some((c) => /enclosure/.test(c.provider)) ? "enclosure" : "structure";
  return index.children.get(inst.path)?.length ? "assembly" : "part";
}

/** Findings per node key, as the tree places them. */
export function placeFindings(index: ProjectIndex, diagnostics: CheckDiagnostic[]): Map<string, CheckDiagnostic[]> {
  const byKey = new Map<string, CheckDiagnostic[]>();
  const add = (key: string, d: CheckDiagnostic) => byKey.set(key, [...(byKey.get(key) ?? []), d]);
  for (const d of diagnostics) {
    const t = diagnosticTarget(index, d);
    if (t.linkId) add(`l:${t.linkId}`, d);
    else if (d.entity.kind === "definition" || d.entity.kind === "artifact") {
      // a definition's finding is every instance's
      // (one with no instance is the root system's, as unlocated findings are)
      const used = index.usedBy.get(t.defId!) ?? [];
      if (!used.length) add(`i:${index.rootPath}`, d);
      for (const i of used) add(`i:${i.path}`, d);
    } else if (t.path !== undefined) add(`i:${t.path}`, d);
    else add(`i:${index.rootPath}`, d);
  }
  return byKey;
}

/** The whole tree from the last build; `[root]`, or nothing without one. */
export function buildTree(index: ProjectIndex): ExplorerNode[] {
  const placed = placeFindings(index, index.resolved.diagnostics);
  const countsOf = (key: string): Counts => {
    const c = zero();
    for (const d of placed.get(key) ?? []) if (d.severity in c) c[d.severity]++;
    return c;
  };
  const staleOf = (key: string) => (placed.get(key) ?? []).some((d) => isStaleCode(d.code));

  const instanceNode = (inst: ResolvedInstance, parentKey?: string): ExplorerNode => {
    const key = `i:${inst.path}`;
    const def = index.defs.get(inst.definition);
    const bdef = index.bundleDefs.get(inst.definition);
    const caps = index.capabilities.get(inst.definition) ?? [];
    const node: ExplorerNode = {
      key,
      parentKey,
      type: "instance",
      kind: instanceKind(index, inst),
      label: inst.path === "" ? (def?.name ?? inst.definition) : (inst.name ?? def?.name ?? inst.path.split("/").pop()!),
      path: inst.path,
      defId: inst.definition,
      tier: def?.origin.tier,
      ...(def?.partStatus ? { trust: def.partStatus.trust, trustBasis: def.partStatus.basis, ...(def.partStatus.blank ? { blank: true } : {}) } : {}),
      quantity: inst.quantity,
      counts: countsOf(key),
      stale: staleOf(key),
      ops: caps.filter((c) => !c.problem).flatMap((c) => CAPABILITY_OPS.map((op) => `${c.capability}:${op}`)),
      hasArtifacts: (index.artifacts.get(inst.definition) ?? []).some((a) => a.present === true || a.present === "remote"),
      children: [],
    };
    node.children.push(...(index.children.get(inst.path) ?? []).map((c) => instanceNode(c, key)));

    const interfaces = [
      ...(bdef?.interfaces ?? []).map((i) => ({ id: i.id, name: i.name, detail: [i.domain, ...(i.protocols ?? []).map((p) => p.type)].filter(Boolean).join(" · ") })),
      ...(bdef?.exports ?? []).map((e) => ({ id: e.id, name: e.name, detail: !e.from ? "export" : "child" in e.from ? `from ${e.from.child}:${e.from.interfaceId}` : `net port of ${e.from.interfaceId}` })),
    ];
    if (interfaces.length) {
      const skey = `s:${inst.path}:interfaces`;
      node.children.push({
        key: skey,
        parentKey: key,
        type: "section",
        kind: "interfaces",
        label: "Interfaces",
        description: String(interfaces.length),
        path: inst.path,
        defId: inst.definition,
        counts: zero(),
        stale: false,
        ops: [],
        hasArtifacts: false,
        children: interfaces.map((i) => ({
          key: `if:${inst.path}:${i.id}`,
          parentKey: skey,
          type: "interface",
          kind: "interface",
          label: i.id,
          description: [i.name && i.name !== i.id ? i.name : "", i.detail].filter(Boolean).join(" · "),
          path: inst.path,
          defId: inst.definition,
          interfaceId: i.id,
          counts: zero(),
          stale: false,
          ops: [],
          hasArtifacts: false,
          children: [],
        })),
      });
    }

    const links = index.linksByOwner.get(inst.path) ?? [];
    if (links.length) {
      const skey = `s:${inst.path}:links`;
      const names = new Map((bdef?.links ?? []).map((l) => [l.id, l.name]));
      node.children.push({
        key: skey,
        parentKey: key,
        type: "section",
        kind: "links",
        label: "Links",
        description: String(links.length),
        path: inst.path,
        defId: inst.definition,
        counts: zero(),
        stale: false,
        ops: [],
        hasArtifacts: false,
        children: links.map((l) => {
          const local = localLinkId(l);
          const lkey = `l:${l.id}`;
          return {
            key: lkey,
            parentKey: skey,
            type: "link" as const,
            kind: "link" as const,
            label: names.get(local) ?? local,
            description: `${l.a} ↔ ${l.b}`,
            path: inst.path,
            linkId: l.id,
            counts: countsOf(lkey),
            stale: false,
            ops: [],
            hasArtifacts: false,
            children: [],
          };
        }),
      });
    }
    return node;
  };

  const root = index.instances.get(index.rootPath);
  if (!root) return [];
  const tree = instanceNode(root);
  rollUp(tree);
  for (const n of walk([tree])) n.description = describe(n);
  return [tree];
}

/** Worst finding of each node and its descendants. */
function rollUp(n: ExplorerNode): Severity | undefined {
  let w: Severity | undefined = n.counts.error ? "error" : n.counts.warning ? "warning" : n.counts.info ? "info" : undefined;
  for (const c of n.children) w = worse(w, rollUp(c));
  n.worst = w;
  return w;
}

/** The muted text after a node's label: quantity, tier, stale outputs; sections keep their counts. */
function describe(n: ExplorerNode): string | undefined {
  if (n.type !== "instance") return n.description;
  return [n.quantity && n.quantity > 1 ? `×${n.quantity}` : "", n.tier && n.type === "instance" ? TIER_LABEL[n.tier] : "", n.stale ? "stale outputs" : ""].filter(Boolean).join(" · ") || undefined;
}

export function* walk(nodes: ExplorerNode[]): Generator<ExplorerNode> {
  for (const n of nodes) {
    yield n;
    yield* walk(n.children);
  }
}

/** Every node by key. */
export const nodeMap = (nodes: ExplorerNode[]): Map<string, ExplorerNode> => new Map([...walk(nodes)].map((n) => [n.key, n]));

/**
 * The tree reduced to what matches `text` (label, instance path, definition
 * id or description, case-insensitive; every word must match), with the
 * ancestors that lead there. A matching module keeps its own children.
 * Returns the reduced tree and the keys to show expanded.
 */
export function filterTree(nodes: ExplorerNode[], text: string): { nodes: ExplorerNode[]; expanded: Set<string> } {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const expanded = new Set<string>();
  if (!words.length) return { nodes, expanded };
  const hay = (n: ExplorerNode) => [n.label, n.path, n.defId, n.linkId, n.interfaceId, n.description].filter(Boolean).join(" ").toLowerCase();
  const matches = (n: ExplorerNode) => words.every((w) => hay(n).includes(w));
  const visit = (n: ExplorerNode): ExplorerNode | undefined => {
    if (matches(n)) return n;
    const kept = n.children.map(visit).filter((c): c is ExplorerNode => !!c);
    if (!kept.length) return undefined;
    expanded.add(n.key);
    return { ...n, children: kept };
  };
  return { nodes: nodes.map(visit).filter((n): n is ExplorerNode => !!n), expanded };
}
