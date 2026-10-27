/**
 * The Protoboard Inspector's selection (PB-895, PB-940): what the focused
 * viewer tab has selected (a module or a link), else the level it shows, a
 * part picked in Project Parts or the Library. The card is the shell's part
 * of it (the header, the part's status, the findings, where a part is used,
 * the modules below); its `details` name what the viewer's own inspector
 * shows for the selection (every artifact as a card, the evidence, the
 * interfaces) and the files the page may load for it (inspectorFiles.ts).
 * The page is @protoboardai/views' SelectionInspector. The hierarchy above it
 * is the Explorer tree (tree.ts). No VS Code API here.
 */
import type { Severity } from "./check.js";
import type { Finding } from "./drc.js";
import { linkFromViewer, localLinkId, viewerMessages, type ProjectIndex } from "./model.js";
import { TIER_LABEL, type ExplorerNode, type NodeKind } from "./tree.js";
import { BLANK_BLOCK_TEXT, PART_TRUST_TEXT, partTrustTooltip, type PartTrust } from "@protoboardai/views/part-status";
import { definitionSource } from "./source.js";
import type { InspectorCard as Card, InspectorChip, InspectorContent as PageContent, InspectorDetails, InspectorFinding, InspectorRow } from "@protoboardai/views/inspector-model";
import { partSync, rev } from "./libraryModel.js";
import { money, type CostLine } from "./cost.js";

export type { InspectorChip, InspectorDetails, InspectorRow };
/** The card on the extension's side: its files are paths on disk. */
export type InspectorCard = Card<string>;

/** What the view shows: a card (with the build's bundle, for its details), or why there is none. Files are paths on disk. */
export type InspectorContent = { card: InspectorCard; project: string; bundle?: { file: string; version: string } } | { empty: string; project?: string };

/** The card's details with every file as the page reaches it. */
export function withUrls(details: InspectorDetails<string>, url: (file: string) => string): InspectorDetails<string> {
  return {
    ...details,
    files: Object.fromEntries(Object.entries(details.files).map(([k, f]) => [k, url(f)])),
    previews: Object.fromEntries(Object.entries(details.previews).map(([k, p]) => [k, { ...p, src: url(p.src) }])),
    ...(details.picture ? { picture: url(details.picture) } : {}),
  };
}

/** The content as the page gets it: every file named by the URL the page reaches it at, never by its path. */
export function pageContent(c: InspectorContent, url: (file: string) => string): PageContent {
  if (!("card" in c)) return c;
  const { bundle, card, ...rest } = c;
  return {
    ...rest,
    card: {
      ...card,
      ...(card.details ? { details: withUrls(card.details, url) } : {}),
      ...(card.artifacts ? { artifacts: card.artifacts.map((a) => (a.preview ? { ...a, preview: { ...a.preview, src: url(a.preview.src) } } : a)) } : {}),
    },
    ...(bundle ? { bundle: { src: url(bundle.file), version: bundle.version } } : {}),
  };
}

/** A part's status as a chip: the state's dot and name, its meaning in the tooltip. */
export const statusChip = (trust: PartTrust, basis?: string, blank = false): InspectorChip => ({
  // a blank block (no part chosen) is said in place of "Local": the same gray, as a ring
  text: blank ? BLANK_BLOCK_TEXT.label : PART_TRUST_TEXT[trust].label,
  status: trust,
  ...(blank ? { blank: true } : {}),
  title: partTrustTooltip(trust, basis, blank),
});

/** What the details add to a card: the selection, and the files of the definitions it shows. */
export type DetailFiles = Omit<InspectorDetails, "target">;
const NO_FILES: DetailFiles = { files: {}, previews: {} };

/** A part of the project (Project parts, PB-919): what it is, where it is used, its interfaces and artifacts. */
export function partCard(
  index: ProjectIndex,
  part: { id: string; name: string; library?: string; revision?: number | string; recommended?: number; edited?: string[]; status?: string; tier?: string; trust?: PartTrust; trustBasis?: string },
  findings: Finding[],
  files: DetailFiles = NO_FILES,
): InspectorCard {
  const bdef = index.bundleDefs.get(part.id);
  const used = index.usedBy.get(part.id) ?? [];
  const mine = used.flatMap((i) => findingsOf(findings, i.path)).filter((f, n, all) => all.findIndex((g) => g.key === f.key) === n);
  const chips: InspectorChip[] = [];
  if (part.trust) chips.push(statusChip(part.trust, part.trustBasis, index.defs.get(part.id)?.partStatus?.blank === true));
  // its sync with the library, in the words every parts view uses
  if (part.tier && part.status) {
    const sync = partSync(part as Parameters<typeof partSync>[0]);
    chips.push({ text: sync.label, ...(sync.tone !== "neutral" ? { tone: sync.tone } : {}), title: sync.meaning });
  }
  if (part.tier && part.tier !== "catalog") chips.push({ text: part.tier === "project-researched" ? "researched here" : "designed here" });
  const sections: InspectorCard["sections"] = [];
  if (used.length)
    sections.push({
      title: "Used in",
      count: used.length,
      ...cut(used.map<InspectorRow>((i) => ({ icon: "cpu", label: i.path, action: { type: "focus", path: i.path } }))),
    });
  sections.push(...checksSection(mine));
  const from = part.library ? `${part.library}${part.revision !== undefined ? ` ${rev(part.revision)}` : ""}` : undefined;
  return {
    kind: "part",
    kindLabel: "Part",
    icon: part.tier === "catalog" || !part.tier ? "package" : "cpu",
    title: part.name,
    subtitle: [part.id, from].filter(Boolean).join(" · "),
    chips,
    counts: countOf(mine),
    sections,
    actions: { focus: used.length > 0, source: used.length > 0, artifacts: false, operation: false, detail: !!part.library },
    path: used[0]?.path ?? "",
    part: { partId: part.id, ...(part.library ? { library: part.library } : {}) },
    // the definition as the build has it: its facts, artifacts, evidence and interfaces
    ...(bdef ? { details: { target: { kind: "definition", id: part.id }, artifactsOf: part.id, ...files, links: [...(files.links ?? []), ...interfaceSourceLinks(index, part.id)] } } : {}),
  };
}

/**
 * A library part (the Library, PB-919): its revision and status, whether the
 * project uses it, and the revision's definition shown as a module of the
 * project is (its artifacts as cards, its interfaces), with the picture and
 * the body model the library sent.
 */
export function libraryPartCard(p: {
  partId: string;
  name: string;
  library: string;
  revision: number;
  recommended?: boolean;
  used?: string;
  facts: { label: string; value: string }[];
  interfaceCount: number;
  /** The library's picture of the part, in the cache. */
  thumbnail?: string;
  /** Its body model in the cache, when it is small enough to draw as a thumbnail. */
  model?: string;
  /** The revision's UHD definition. */
  definition?: unknown;
  trust?: PartTrust;
  trustBasis?: string;
}): InspectorCard {
  const chips: InspectorChip[] = [...(p.trust ? [statusChip(p.trust, p.trustBasis)] : []), { text: `${rev(p.revision)}${p.recommended ? " · recommended" : ""}` }];
  if (p.interfaceCount) chips.push({ text: `${p.interfaceCount} interface${p.interfaceCount === 1 ? "" : "s"}` });
  if (p.used) chips.push({ text: p.used, tone: "ok" });
  const def = p.definition && typeof p.definition === "object" && (p.definition as { id?: unknown }).id === p.partId ? (p.definition as { id: string; artifacts?: { id: string; url?: string; filePath?: string; role?: string; format?: string }[] }) : undefined;
  const arts = Array.isArray(def?.artifacts) ? def.artifacts : [];
  // the body's models show the library's model, drawn small
  const previews: DetailFiles["previews"] = {};
  if (p.model) for (const a of arts) if (a.role !== "interface" && /^(glb|gltf|step|stp)$/i.test(a.format ?? (a.filePath ?? "").split(".").pop() ?? "")) previews[`${p.partId}#${a.id}`] = { kind: "model", src: p.model };
  const links = arts.flatMap((a) => (typeof a.url === "string" && /^https?:\/\//i.test(a.url) ? [a.url] : []));
  return {
    kind: "part",
    kindLabel: "Library part",
    icon: "package",
    title: p.name,
    subtitle: `${p.partId} · ${p.library}`,
    chips,
    counts: { error: 0, warning: 0, info: 0 },
    sections: [...(p.facts.length ? [{ title: "Specs", count: p.facts.length, ...cut(p.facts.map<InspectorRow>((f) => ({ icon: "list", label: f.label, detail: f.value }))) }] : [])],
    actions: { focus: false, source: false, artifacts: false, operation: false, detail: true },
    path: "",
    part: { partId: p.partId, library: p.library },
    ...(def || p.thumbnail ? { details: { target: { kind: "definition", id: p.partId }, files: {}, previews, links, ...(def ? { definitions: [def] } : {}), ...(p.thumbnail ? { picture: p.thumbnail } : {}) } } : {}),
  };
}

/** Icon names (Lucide, drawn by the page) per kind. */
export const KIND_ICON: Record<NodeKind, string> = {
  system: "circuit-board",
  assembly: "package",
  group: "folder",
  part: "cpu",
  board: "circuit-board",
  enclosure: "archive",
  structure: "layers",
  harness: "cable",
  fasteners: "wrench",
  interfaces: "plug",
  links: "link",
  interface: "plug",
  link: "link",
};

const KIND_LABEL: Partial<Record<NodeKind, string>> = {
  system: "System",
  assembly: "Assembly",
  group: "Group",
  part: "Part",
  board: "Board",
  enclosure: "Enclosure",
  structure: "Structure",
  harness: "Harness",
  fasteners: "Fasteners",
};

const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Findings about a module and what is below it, or about a link. */
function findingsOf(findings: Finding[], path: string, linkId?: string): Finding[] {
  return findings
    .filter((f) => (linkId ? f.target.linkId === linkId : f.target.path !== undefined && (path === "" || f.target.path === path || f.target.path.startsWith(`${path}/`))))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const countOf = (list: Finding[]) => ({
  error: list.filter((f) => f.severity === "error").length,
  warning: list.filter((f) => f.severity === "warning").length,
  info: list.filter((f) => f.severity === "info").length,
});

/** Findings as the Checks section's rows (design A): every severity, the worst first, each with its code under its message. */
function findingRows(list: Finding[]): { rows: InspectorRow[] } {
  return { rows: list.map((f) => ({ icon: f.severity === "error" ? "circle-x" : f.severity === "warning" ? "triangle-alert" : "info", label: f.summary, code: f.code, tone: f.severity, action: { type: "finding", key: f.key } })) };
}

/** The Checks section: every finding here and below, the worst first; the count is all of them. */
function checksSection(list: Finding[]): InspectorCard["sections"] {
  return list.length ? [{ title: "Checks", count: list.length, ...findingRows(list) }] : [];
}

/** A link's canonical id as the viewer selects it: `owner/local`, or `local` at the root. */
const viewerLinkId = (owner: string, id: string) => {
  const local = owner && (id.startsWith(`${owner}:`) || id.startsWith(`${owner}/`)) ? id.slice(owner.length + 1) : id;
  return owner ? `${owner}/${local}` : local;
};

/**
 * The findings the interface cards of the module at `path` may show: those on the links of its level that end on it
 * and on the links and interfaces inside it, each with the ids the viewer knows its link or interface by.
 */
export function interfaceFindings(findings: Finding[], path: string): InspectorFinding[] {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const inside = (p: string | undefined) => p !== undefined && (path === "" || p === path || p.startsWith(`${path}/`));
  return findings.flatMap((f) => {
    const t = f.target;
    const refs: string[] = [];
    if (t.linkId && (t.path === parent || inside(t.path))) {
      refs.push(viewerLinkId(t.path ?? "", t.linkId));
      if (t.derivedId) refs.push(viewerLinkId(t.path ?? "", t.derivedId));
    } else if (!t.linkId && t.label.includes(":") && inside(t.label.slice(0, t.label.lastIndexOf(":")))) refs.push(t.label);
    return refs.length ? [{ key: f.key, code: f.code, message: f.summary, severity: f.severity, refs }] : [];
  });
}

/** Web addresses the interfaces of a definition and its parts cite (their traits' sources): the cards' Notes may open them. */
export function interfaceSourceLinks(index: ProjectIndex, defId: string | undefined, depth = 2): string[] {
  const out = new Set<string>();
  const walk = (id: string | undefined, d: number) => {
    const def = id ? (index.bundleDefs.get(id) as { interfaces?: { traits?: { params?: Record<string, unknown> }[] }[]; children?: { moduleDefId: string }[] } | undefined) : undefined;
    if (!def) return;
    for (const i of def.interfaces ?? [])
      for (const t of i.traits ?? [])
        for (const v of [t.params?.source, t.params?.sources].flat())
          if (typeof v === "string") {
            const url = v.trim().split(/\s/)[0];
            if (/^https?:\/\//i.test(url)) out.add(url);
          }
    if (d > 0) for (const c of def.children ?? []) walk(c.moduleDefId, d - 1);
  };
  walk(defId, depth);
  return [...out];
}

/**
 * What the module at `path` costs, from the project's bill (cost.ts): its lines and everything below it, each
 * line's unit price times the units here. The Sourcing section, closed, with the supplier and the price in its
 * header; the price goes to the header's summary row as well.
 */
export function sourcingOf(lines: CostLine[] | undefined, path: string): { price?: string; section?: InspectorCard["sections"][number] } {
  if (!lines?.length) return {};
  const here = (i: string) => path === "" || i === path || i.startsWith(`${path}/`);
  const mine = lines.map((l) => ({ l, n: l.instances.filter(here).length })).filter((x) => x.n > 0);
  if (!mine.length) return {};
  const priced = mine.filter((x) => x.l.kind === "priced" && x.l.unitPrice !== undefined);
  const currency = priced[0]?.l.currency ?? "USD";
  const total = priced.reduce((sum, x) => sum + x.l.unitPrice! * x.n, 0);
  const price = priced.length ? money(total, currency) : undefined;
  const suppliers = [...new Set(priced.map((x) => x.l.supplier).filter((s): s is string => !!s))];
  const unpriced = mine.filter((x) => x.l.kind === "unpriced").length;
  const summary = [suppliers.length > 2 ? `${suppliers.length} suppliers` : suppliers.join(", "), price ? `${price}${unpriced ? "+" : ""}` : unpriced ? "unpriced" : ""].filter(Boolean).join(" · ");
  return {
    ...(price ? { price } : {}),
    section: {
      title: "Sourcing",
      collapsed: true,
      ...(summary ? { summary } : {}),
      rows: mine.map(({ l, n }) => ({
        icon: l.kind === "priced" ? "receipt" : l.kind === "made" ? "hammer" : l.kind === "included" ? "package-check" : "circle-dashed",
        label: `${n > 1 ? `${n} × ` : ""}${l.item}`,
        detail: l.kind === "priced" ? `${money(l.unitPrice! * n, l.currency!)}${l.supplier ? ` · ${l.supplier}` : ""}` : l.kind === "made" ? "quote" : l.kind,
      })),
    },
  };
}

/** Every row: the page shows them ten at a time (SelectionInspector, PB-1088). */
function cut<T>(rows: T[]): { rows: T[] } {
  return { rows };
}

/**
 * The file a module's Open source opens, as the build records it: an
 * instance is declared in its parent's definition, the root system and a
 * level in their own (source.ts, `instanceSource`). The line is given only
 * where the build knows it (the definition's own).
 */
export function moduleSourceFile(index: ProjectIndex, node: Pick<ExplorerNode, "path" | "defId">): { file: string; line?: number } | undefined {
  const inst = index.instances.get(node.path);
  const parent = inst && node.path !== "" && inst.parent !== undefined ? index.instances.get(inst.parent) : undefined;
  if (parent) {
    const at = definitionSource(index, parent.definition);
    if (at) return { file: at.file };
  }
  const own = node.defId ? definitionSource(index, node.defId) : undefined;
  return own ? { file: own.file, ...(own.line !== undefined ? { line: own.line } : {}) } : undefined;
}

/**
 * Where a component sits on the routed board that holds it (the PCB tab's
 * selection, or the same module picked anywhere else): its reference, part,
 * footprint, side and place, from the circuit provider's own files, the
 * routed board (`circuit.json`) and its name map (`build.json`), which the
 * board module carries as artifacts. Undefined for a module that is not a
 * component of such a board. `read` gives a project file's text.
 */
export function boardSection(index: ProjectIndex, node: Pick<ExplorerNode, "path">, read: (file: string) => string | undefined): InspectorCard["sections"][number] | undefined {
  const at = node.path.lastIndexOf("/");
  if (!node.path) return undefined;
  const parentPath = at < 0 ? "" : node.path.slice(0, at);
  const id = node.path.slice(at + 1);
  const parentDef = index.instances.get(parentPath)?.definition ?? (parentPath ? undefined : (index.resolved.project.root ?? undefined));
  // a file the board carries, by its name, as the build resolved it (project-relative, there)
  const file = (name: string) => (parentDef ? index.artifacts.get(parentDef) ?? [] : []).find((a) => a.present === true && a.resolved && !a.resolved.startsWith("package:") && a.resolved.split("/").pop() === name)?.resolved;
  const buildFile = file("build.json");
  if (!buildFile) return undefined;
  let map: Record<string, { instance?: string; part?: string; footprint?: string }> | undefined;
  try {
    map = (JSON.parse(read(buildFile) ?? "null") as { map?: { components?: typeof map } } | null)?.map?.components;
  } catch {
    return undefined;
  }
  const entry = Object.entries(map ?? {}).find(([ref, m]) => (m.instance ?? ref) === id);
  if (!entry) return undefined;
  const [ref, m] = entry;
  const rows: InspectorRow[] = [{ icon: "tag", label: "Reference", detail: ref.toUpperCase() }];
  if (m.part) rows.push({ icon: "cpu", label: "Part", detail: m.part });
  if (m.footprint) rows.push({ icon: "square-dashed", label: "Footprint", detail: m.footprint });
  const circuitFile = file("circuit.json");
  try {
    const cj = circuitFile ? (JSON.parse(read(circuitFile) ?? "[]") as { type: string; [k: string]: unknown }[]) : [];
    const sc = cj.find((e) => e.type === "source_component" && e.name === ref);
    const pc = sc && cj.find((e) => e.type === "pcb_component" && e.source_component_id === sc.source_component_id);
    if (pc) {
      const c = pc.center as { x: number; y: number };
      rows.push({ icon: pc.layer === "bottom" ? "panel-bottom" : "panel-top", label: "Side", detail: pc.layer === "bottom" ? "bottom" : "top" });
      rows.push({ icon: "crosshair", label: "Position", detail: `${c.x.toFixed(2)}, ${c.y.toFixed(2)} mm · ${Number(pc.rotation ?? 0)}°` });
    }
  } catch {
    // the place is extra: the reference and footprint stand without it
  }
  return { title: "On the board", rows };
}

/** The card for a module's node. `board`: where it sits on the routed board that holds it (boardSection). */
export function moduleCard(
  index: ProjectIndex,
  node: ExplorerNode,
  findings: Finding[],
  level = false,
  files: DetailFiles = NO_FILES,
  board?: InspectorCard["sections"][number],
  /** The project's bill's lines (cost.ts): the module's price and its Sourcing section. */
  cost?: CostLine[],
): InspectorCard {
  const bdef = node.defId ? index.bundleDefs.get(node.defId) : undefined;
  const def = node.defId ? index.defs.get(node.defId) : undefined;
  const mine = findingsOf(findings, node.path);
  const chips: InspectorChip[] = [];
  // where the part comes from (plain: the tier is not a verdict), then its status with the state's colour
  if (node.tier) chips.push({ text: TIER_LABEL[node.tier], title: `Part tier: ${node.tier}` });
  if (node.trust && node.type === "instance" && !level) chips.push(statusChip(node.trust, node.trustBasis, node.blank));
  if (node.quantity && node.quantity > 1) chips.push({ text: `×${node.quantity}` });
  if (node.stale) chips.push({ text: "stale outputs", tone: "warning" });

  const sections: InspectorCard["sections"] = [];
  if (board && !level) sections.push(board);
  // design A: the checks open, then what is secondary, closed, saying what it holds in its header
  sections.push(...checksSection(mine));
  // a parent lists no children (PB-1088, Mark: "this can explode the size of the inspector"): the Explorer and the
  // canvas are where they are picked; the summary row says how many there are
  const children = node.children.filter((c) => c.type === "instance");
  const links = index.linksByOwner.get(node.path) ?? [];
  if (links.length) {
    const names = new Map((bdef?.links ?? []).map((l) => [l.id, l.name]));
    sections.push({
      title: "Links",
      count: links.length,
      collapsed: true,
      ...cut(links.map<InspectorRow>((l) => ({ icon: "link", label: names.get(localLinkId(l)) ?? localLinkId(l), detail: `${l.a} ↔ ${l.b}` }))),
    });
  }
  const sourcing = sourcingOf(cost, node.path);
  if (sourcing.section) sections.push(sourcing.section);
  return {
    kind: level ? "level" : "module",
    kindLabel: KIND_LABEL[node.kind] ?? "Module",
    icon: KIND_ICON[node.kind],
    title: node.label,
    // which part: the definition's name (its path is a parameter, and the tooltip of the tree)
    subtitle: (def?.name && def.name !== node.label ? def.name : node.defId) || undefined,
    summary: { ...(sourcing.price ? { price: sourcing.price } : {}), ...(children.length ? { children: children.length } : {}) },
    chips,
    counts: countOf(mine),
    sections,
    actions: { focus: !level, source: !!node.defId, artifacts: false, operation: node.ops.length > 0 },
    // what Open source opens: the action is drawn with the file's name (D7: it is the way to the code)
    ...(node.defId && moduleSourceFile(index, node) ? { source: moduleSourceFile(index, node)! } : {}),
    path: node.path,
    // the module as the viewer's inspector shows it; without a bundle there is nothing to show it from
    ...(index.bundle && bdef
      ? { details: { target: { kind: "module", path: node.path }, artifactsOf: bdef.id, ...files, links: [...(files.links ?? []), ...interfaceSourceLinks(index, node.defId)], findings: interfaceFindings(findings, node.path) } }
      : {}),
  };
}

/** The card for a link the viewer selected (by its canonical id), or undefined when it is not one of the build's links. */
/**
 * Modules selected together on the canvas (a selection box, Shift-click; QA B10): "3 selected", their findings
 * together, and the list of them (a click shows one). No details: each module's are a click away.
 */
export function groupCard(nodes: ExplorerNode[], findings: Finding[]): InspectorCard {
  const seen = new Set<string>();
  const mine = nodes
    .flatMap((n) => findingsOf(findings, n.path))
    .filter((f) => !seen.has(f.key) && (seen.add(f.key), true))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
  const parents = [...new Set(nodes.map((n) => (n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "")))];
  return {
    kind: "level",
    kindLabel: "Selection",
    icon: "boxes",
    title: `${nodes.length} selected`,
    subtitle: nodes.map((n) => n.label).join(", "),
    chips: [],
    counts: countOf(mine),
    sections: [
      { title: "Selected", count: nodes.length, rows: nodes.map<InspectorRow>((n) => ({ icon: KIND_ICON[n.kind], label: n.label, detail: n.path, tone: n.worst, action: { type: "focus", path: n.path } })) },
      ...checksSection(mine),
    ],
    actions: { focus: false, source: false, artifacts: false, operation: false },
    path: parents.length === 1 ? parents[0] : "",
  };
}

/** The links one harness run carries with `link`: those of the same module that end on a harness this one ends on. */
export function runLinks(index: ProjectIndex, link: { id: string; owner: string; a: string; b: string }): string[] {
  const moduleOf = (ref: string) => (ref.includes(":") ? ref.slice(0, ref.lastIndexOf(":")) : ref);
  const pathOf = (ref: string) => (link.owner ? `${link.owner}/${moduleOf(ref)}` : moduleOf(ref));
  const harnesses = new Set([link.a, link.b].map(pathOf).filter((p) => index.instances.get(p)?.kind === "harness"));
  if (!harnesses.size) return [link.id];
  const others = (index.linksByOwner.get(link.owner) ?? []).filter((l) => l.id !== link.id && [l.a, l.b].some((r) => harnesses.has(pathOf(r))));
  return [link.id, ...others.map((l) => l.id)];
}

export function linkCard(index: ProjectIndex, viewerId: string, findings: Finding[], files: DetailFiles = NO_FILES): InspectorCard | undefined {
  const link = linkFromViewer(index, viewerId);
  if (!link) return undefined;
  const local = localLinkId(link);
  const name = index.bundleDefs.get(index.instances.get(link.owner)?.definition ?? "")?.links?.find((l) => l.id === local)?.name;
  // the viewer draws a harness run as one line carrying both its links (battery → XT60 lead → ESC pads) and selects it
  // by the first: the findings of every link on that run are the line's (QA B14)
  const mine = runLinks(index, link)
    .flatMap((id) => findingsOf(findings, link.owner, id))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
  const end = (ref: string): InspectorRow => {
    const [mod, iface] = ref.includes(":") ? [ref.slice(0, ref.lastIndexOf(":")), ref.slice(ref.lastIndexOf(":") + 1)] : [ref, ""];
    const path = link.owner ? `${link.owner}/${mod}` : mod;
    return { icon: "plug", label: iface || ref, detail: mod, action: index.instances.has(path) ? { type: "focus", path } : undefined };
  };
  return {
    kind: "link",
    kindLabel: link.harness ? "Harness link" : "Link",
    icon: link.harness ? "cable" : "link",
    title: name ?? local,
    subtitle: `${local}${link.owner ? ` in ${link.owner}` : " in the system"}`,
    chips: link.harness ? [{ text: `harness ${link.harness}` }] : [],
    counts: countOf(mine),
    sections: [{ title: "Ends", count: 2, rows: [end(link.a), end(link.b)] }, ...checksSection(mine)],
    // the pair view compares the link's two ends: an editor tab of its own (PB-905)
    actions: { focus: true, source: true, artifacts: false, operation: false, pair: true },
    path: link.owner,
    linkId: link.id,
    // the link on the level of the module that declares it, by the ids the viewer selects it with
    ...(index.bundle
      ? {
          details: {
            target: { kind: "link", owner: link.owner, ids: viewerMessages({ path: link.owner, linkId: link.id }).flatMap((m) => (m.type === "uhd-viewer:select" ? m.ids : [])) },
            ...files,
          },
        }
      : {}),
  };
}

/** What a bundle says of an interface, as far as the card reads it. */
interface BundleInterface {
  id: string;
  name?: string;
  domain?: string;
  description?: string;
  pin?: string | number;
  protocols?: { type: string; roles?: string[]; params?: Record<string, unknown> }[];
}

const shown = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(shown).join(", ") : typeof v === "object" && v ? JSON.stringify(v) : String(v));

/**
 * An interface picked in the hierarchy: what it is (its domain and
 * protocols, their roles and parameters, its pin), what it is linked to on
 * the level of its module (each end leads there), and its geometry, a card.
 */
export function interfaceCard(index: ProjectIndex, node: ExplorerNode, artifacts: NonNullable<InspectorCard["artifacts"]> = []): InspectorCard | undefined {
  if (node.type !== "interface" || !node.interfaceId) return undefined;
  const bdef = node.defId ? index.bundleDefs.get(node.defId) : undefined;
  const iface = (bdef?.interfaces as BundleInterface[] | undefined)?.find((i) => i.id === node.interfaceId);
  const exported = bdef?.exports?.find((e) => e.id === node.interfaceId);
  const inst = index.instances.get(node.path);
  const owner = inst?.parent ?? "";
  const name = node.path.split("/").pop() ?? "";
  const ref = `${name}:${node.interfaceId}`;
  const sections: InspectorCard["sections"] = [];
  const protocols = iface?.protocols ?? [];
  if (protocols.length) sections.push({ title: "Protocols", count: protocols.length, rows: protocols.map<InspectorRow>((p) => ({ icon: "waypoints", label: p.type, ...(p.roles?.length ? { detail: p.roles.join(", ") } : {}) })) });
  const params = protocols.flatMap((p) => Object.entries(p.params ?? {}).filter(([, v]) => v !== undefined && v !== null && typeof v !== "object").map<InspectorRow>(([k, v]) => ({ icon: "list", label: k.replace(/_/g, " "), detail: shown(v) })));
  if (params.length) sections.push({ title: "Parameters", count: params.length, rows: params });
  const from = exported?.from;
  if (from && "child" in from) sections.push({ title: "Exports", rows: [{ icon: "plug", label: from.interfaceId, detail: from.child, action: { type: "focus", path: node.path ? `${node.path}/${from.child}` : from.child } }] });
  // a net port (UHD 0.3.0): the module's own net on its edge, with no child behind it
  else if (from) sections.push({ title: "Exports", rows: [{ icon: "plug", label: from.interfaceId, detail: "net port" }] });
  // links on the level of its module that end here
  const links = node.path === "" ? [] : (index.linksByOwner.get(owner) ?? []).filter((l) => l.a === ref || l.b === ref);
  if (links.length) {
    const names = new Map((index.bundleDefs.get(index.instances.get(owner)?.definition ?? "")?.links ?? []).map((l) => [l.id, l.name]));
    sections.push({
      title: "Linked to",
      count: links.length,
      rows: links.map<InspectorRow>((l) => {
        const other = l.a === ref ? l.b : l.a;
        const mod = other.includes(":") ? other.slice(0, other.lastIndexOf(":")) : other;
        const path = owner ? `${owner}/${mod}` : mod;
        return { icon: "link", label: other, detail: names.get(localLinkId(l)) ?? localLinkId(l), ...(index.instances.has(path) ? { action: { type: "focus", path } } : {}) };
      }),
    });
  }
  const chips: InspectorChip[] = [];
  if (iface?.domain) chips.push({ text: iface.domain });
  if (iface?.pin !== undefined) chips.push({ text: `pin ${iface.pin}` });
  chips.push({ text: links.length ? `${links.length} link${links.length === 1 ? "" : "s"}` : "not linked", ...(links.length ? { tone: "ok" } : {}) });
  return {
    kind: "interface",
    kindLabel: exported && !iface ? "Exported interface" : "Interface",
    icon: "plug",
    title: (iface?.name ?? exported?.name) && (iface?.name ?? exported?.name) !== node.interfaceId ? (iface?.name ?? exported?.name)! : node.interfaceId,
    subtitle: `${node.path || index.defs.get(node.defId ?? "")?.name || "root"}:${node.interfaceId}`,
    chips,
    counts: { error: 0, warning: 0, info: 0 },
    sections,
    actions: { focus: true, source: !!node.defId, artifacts: false, operation: false },
    path: node.path,
    ...(artifacts.length ? { artifacts } : {}),
  };
}

/**
 * The definitions of the harnesses a link may run through: the one it names,
 * and the harnesses on its level (a link carried by a physical cable does not
 * name it). Their artifacts show with the link.
 */
export function linkHarnessDefs(index: ProjectIndex, viewerId: string, max = 12): string[] {
  const link = linkFromViewer(index, viewerId);
  if (!link) return [];
  const at = (child: string) => index.instances.get(link.owner ? `${link.owner}/${child}` : child);
  const named = link.harness ? at(link.harness)?.definition : undefined;
  const level = (index.children.get(link.owner) ?? []).filter((i) => i.kind === "harness").map((i) => i.definition);
  return [...new Set([...(named ? [named] : []), ...level])].slice(0, max);
}
