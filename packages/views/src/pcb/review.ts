/**
 * The review queue (L2): the findings and unconnected links of a board as a ranked list of things to fix. Blocks the
 * fab first (errors other than open connections), then unconnected nets (one item per net, its links counted), then
 * style (warnings), then notes (infos). Within a group: by severity, then by message. Pure; no DOM.
 */
import type { BoardDocument } from "./board.js";
import { parsePadId } from "./board.js";
import { describeFinding, describeOpenNet, mmPair } from "./findings-text.js";
import type { PcbFinding, WaivedFinding } from "./types.js";

export type QueueGroup = "fab" | "unconnected" | "style" | "note";

export interface QueueItem {
  /** Stable while the findings behind it are: the finding id, or `net:<name>` for an unconnected net. */
  id: string;
  group: QueueGroup;
  /** A short title, for the list. */
  title: string;
  /** The plain sentence (the finding's own message, or the net's links). */
  sentence: string;
  /** Mono meta line: check, tier, counts. */
  meta: string;
  findings: PcbFinding[];
  objects: string[];
  /** Board box of everything in it (nanometers). */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  net?: string;
  severity: "error" | "warning" | "info";
}

export const GROUP_LABEL: Record<QueueGroup, string> = { fab: "blocks fab", unconnected: "unconnected", style: "looks", note: "note" };
const ORDER: Record<QueueGroup, number> = { fab: 0, unconnected: 1, style: 2, note: 3 };

function boxOf(fs: readonly PcbFinding[]): QueueItem["box"] {
  let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const f of fs) {
    const x = f.box ?? { minX: f.location.x, minY: f.location.y, maxX: f.location.x, maxY: f.location.y };
    b = { minX: Math.min(b.minX, x.minX), minY: Math.min(b.minY, x.minY), maxX: Math.max(b.maxX, x.maxX), maxY: Math.max(b.maxY, x.maxY) };
  }
  return b;
}

/** Short names of objects: references for pads and footprints, ids otherwise. */
export function shortName(doc: BoardDocument, id: string): string {
  const pad = parsePadId(id);
  if (pad) {
    const fp = doc.records.get(pad.footprint);
    return `${fp?.kind === "footprint" ? fp.ref : pad.footprint.slice(3)} pad ${pad.pad}`;
  }
  const r = doc.records.get(id);
  if (r?.kind === "footprint") return r.ref;
  if (r && (r.kind === "track" || r.kind === "via") && r.net) return `${r.net} ${r.kind}`;
  return id;
}

const netOf = (doc: BoardDocument, f: PcbFinding): string | undefined => {
  for (const o of f.objects) {
    const n = doc.padNets.get(o);
    if (n) return n;
    const r = doc.records.get(o);
    if (r && (r.kind === "track" || r.kind === "via" || r.kind === "zone") && r.net) return r.net;
  }
  return undefined;
};

/** The ranked queue for the open findings of a board. */
export function buildQueue(doc: BoardDocument, findings: readonly PcbFinding[]): QueueItem[] {
  const items: QueueItem[] = [];
  const byNet = new Map<string, PcbFinding[]>();
  for (const f of findings) {
    if (f.check === "unconnected") {
      const net = netOf(doc, f) ?? "(no net)";
      const l = byNet.get(net) ?? [];
      l.push(f);
      byNet.set(net, l);
      continue;
    }
    const group: QueueGroup = f.severity === "error" ? "fab" : f.severity === "warning" ? "style" : "note";
    // in plain language (findings-text.ts)
    const said = describeFinding(f, doc);
    items.push({
      id: f.id,
      group,
      title: said.title,
      sentence: said.sentence,
      meta: [said.check, said.source?.replace(/^the /, ""), f.measured !== undefined && f.required !== undefined ? (([m, r]) => `${m} mm, asks ${r}`)(mmPair(f.measured, f.required)) : ""].filter(Boolean).join(" · "),
      findings: [f],
      objects: [...f.objects],
      box: boxOf([f]),
      ...(netOf(doc, f) ? { net: netOf(doc, f)! } : {}),
      severity: f.severity,
    });
  }
  for (const [net, fs] of byNet) {
    const pads = [...new Set(fs.flatMap((f) => f.objects))];
    const refs = [...new Set(pads.map((p) => shortName(doc, p).split(" pad ")[0]))].slice(0, 4);
    items.push({
      id: `net:${net}`,
      group: "unconnected",
      title: `${net} is not joined`,
      sentence: describeOpenNet(doc, net, fs).sentence,
      meta: `${fs.length} link${fs.length === 1 ? "" : "s"} · ${refs.join(", ")}`,
      findings: fs,
      objects: pads,
      box: boxOf(fs),
      net,
      severity: fs.some((f) => f.severity === "error") ? "error" : "warning",
    });
  }
  const sev = { error: 0, warning: 1, info: 2 } as const;
  return items.sort((a, b) => ORDER[a.group] - ORDER[b.group] || sev[a.severity] - sev[b.severity] || (a.group === "unconnected" ? b.findings.length - a.findings.length : 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

/** Counts per group, for the filter chips. */
export function queueCounts(items: readonly QueueItem[]): Record<QueueGroup | "all", number> {
  const c = { all: items.length, fab: 0, unconnected: 0, style: 0, note: 0 };
  for (const i of items) c[i.group]++;
  return c;
}

/**
 * Whether the board may be exported: nothing left in the queue, or every leftover has a reason (waived). The
 * waived ones are already out of the queue; this says so in words for the button's title.
 */
export function exportState(items: readonly QueueItem[], waived: readonly WaivedFinding[] | undefined, checksRan: boolean): { allowed: boolean; why: string } {
  if (!checksRan) return { allowed: false, why: "no check has run on this board yet" };
  if (items.length) return { allowed: false, why: `${items.length} item${items.length === 1 ? "" : "s"} left in review: fix each, or mark it not a problem with a reason` };
  return { allowed: true, why: waived?.length ? `nothing left; ${waived.length} waived with a reason` : "nothing left to review" };
}
