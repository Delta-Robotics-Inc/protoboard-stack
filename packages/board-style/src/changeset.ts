/**
 * Change sets: what a style tool hands back. A tool never writes; it returns the operations that would make the
 * board match the theme, as one change set an agent proposes and a person accepts (or a host applies).
 *
 * Provenance: everything a tool draws carries `{ by: "generated", tool: "board-style/<tool>" }`. A re-run finds
 * what the tool made before by that provenance and updates it in place: identical records stay, changed ones are
 * edited, missing ones removed, new ones added, so a second run on an unchanged board is empty. A record a person
 * edited by hand since (`provenance.edited: "hand"`) is kept and reported unless the call says `force`.
 *
 * Board text and graphics are written with ordinary operations (`text.*`, `graphic.*`), which a person-accepted
 * proposal carries. Footprints' own designator texts have no operation in the board core yet: a tool that needs
 * them changed (designators) returns `hostOps` (`record.put` of the footprint, system audience), which only a host
 * applies; see `applyStyleChange`.
 */
import { randomBytes } from "node:crypto";
import { canonical, openBoardService, recordsOfKind, sha1Hex, type Actor, type BoardDocument, type BoardRecord, type BoardService, type GraphicRec, type OpCall, type Provenance, type Reply, type TextRec } from "@protoboardai/board";

export const STYLE_TOOLS = ["frames", "hazard", "nameplate", "marks", "edgeText", "designators", "alignParts"] as const;
export type StyleTool = (typeof STYLE_TOOLS)[number];

/** The order the drawing tools run in: each avoids what the tools before it drew, never what later ones draw. */
export const RESTYLE_ORDER: StyleTool[] = ["frames", "hazard", "nameplate", "edgeText", "marks", "designators"];

/**
 * Silk a tool plans around: everything except its own records and those of the tools after it in the order (so a
 * re-run on a finished board makes the same choices as the first run).
 */
export function ignoredByTool(doc: BoardDocument, tool: StyleTool): (id: string) => boolean {
  const i = RESTYLE_ORDER.indexOf(tool);
  const later = new Set(RESTYLE_ORDER.slice(i < 0 ? 0 : i).map(toolTag));
  return (id) => {
    const r = doc.records.get(id);
    const t = (r as { provenance?: Provenance } | undefined)?.provenance?.tool;
    return !!t && later.has(t);
  };
}

/** The host actor style tools propose and apply as (hosts may give provenance). */
export const STYLE_HOST: Actor = { kind: "host", id: "host:board-style", name: "board-style" };

export const toolTag = (tool: StyleTool): string => `board-style/${tool}`;
export const styleProvenance = (tool: StyleTool): Provenance => ({ by: "generated", tool: toolTag(tool) });

/** Whether a record was made by a style tool (any, or the one named). */
export function madeBy(rec: BoardRecord, tool?: StyleTool): boolean {
  const p = (rec as { provenance?: Provenance }).provenance;
  if (!p?.tool) return false;
  return tool ? p.tool === toolTag(tool) : p.tool.startsWith("board-style/");
}

export interface Skipped {
  what: string;
  reason: string;
  objects?: string[];
}

export interface StyleChangeSet {
  tool: StyleTool;
  /** 3 to 12 words, for the proposal title. */
  title: string;
  /** 3 to 8 words, for the transaction label. */
  label: string;
  /** Ordinary operations (proposals carry them). */
  ops: OpCall[];
  /** System operations a host applies (footprint texts): empty for most tools. */
  hostOps: OpCall[];
  provenance: Provenance;
  /** Counts and what was left alone. */
  report: {
    added: number;
    edited: number;
    removed: number;
    unchanged: number;
    keptHandEdits: string[];
    skipped: Skipped[];
    notes: string[];
    [k: string]: unknown;
  };
  /** True when there is nothing to do. */
  empty: boolean;
}

/** A record a tool wants: board text or graphic fields (no id or provenance). */
export type Desired = (Omit<TextRec, "id" | "provenance"> | Omit<GraphicRec, "id" | "provenance">) & { kind: "text" | "graphic" };

const strip = (r: BoardRecord): Record<string, unknown> => {
  const { id: _i, provenance: _p, locked: _l, ...rest } = r as unknown as Record<string, unknown>;
  return rest;
};
const keyOf = (r: Record<string, unknown>): string => canonical(r);

function centerOf(r: Record<string, unknown>): [number, number] {
  const p = (r.center ?? r.start ?? (r.points as { x: number; y: number }[] | undefined)?.[0] ?? { x: r.x, y: r.y }) as { x: number; y: number };
  if (Array.isArray(r.points) && r.points.length) {
    let sx = 0;
    let sy = 0;
    for (const v of r.points as { x: number; y: number }[]) {
      sx += v.x;
      sy += v.y;
    }
    return [sx / r.points.length, sy / r.points.length];
  }
  return [p.x ?? 0, p.y ?? 0];
}

const slotOf = (r: Record<string, unknown>): string => (r.kind === "text" ? `text|${String(r.layer)}|${String(r.text)}` : `graphic|${String(r.layer)}|${String(r.shape)}|${r.filled ? "f" : "s"}`);

/**
 * The operations that turn what `tool` made before into `desired`: unchanged records stay, others are edited in
 * place (paired by kind, layer and text or shape, nearest first), the rest removed or added.
 */
export function reconcile(doc: BoardDocument, tool: StyleTool, desired: Desired[], o: { force?: boolean } = {}): { ops: OpCall[]; added: number; edited: number; removed: number; unchanged: number; keptHandEdits: string[] } {
  const old = [...recordsOfKind(doc, "text"), ...recordsOfKind(doc, "graphic")].filter((r) => madeBy(r, tool)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const want = desired.map((d) => ({ d: d as unknown as Record<string, unknown>, key: keyOf(d as unknown as Record<string, unknown>) }));
  const ops: OpCall[] = [];
  const keptHandEdits: string[] = [];
  // 1. exact matches stay
  const wantLeft = new Map<string, number[]>();
  want.forEach((w, i) => wantLeft.set(w.key, [...(wantLeft.get(w.key) ?? []), i]));
  const used = new Set<number>();
  const oldLeft: BoardRecord[] = [];
  let unchanged = 0;
  for (const r of old) {
    const k = keyOf(strip(r));
    const list = wantLeft.get(k);
    if (list?.length) {
      used.add(list.shift()!);
      unchanged++;
    } else oldLeft.push(r);
  }
  // 2. pair the rest by slot, nearest first
  const bySlot = new Map<string, number[]>();
  want.forEach((w, i) => {
    if (used.has(i)) return;
    const s = slotOf(w.d);
    bySlot.set(s, [...(bySlot.get(s) ?? []), i]);
  });
  let edited = 0;
  let removed = 0;
  const removeIds: { kind: string; id: string }[] = [];
  for (const r of oldLeft) {
    const rr = strip(r);
    const cands = bySlot.get(slotOf({ ...rr, kind: r.kind })) ?? [];
    const hand = (r as { provenance?: Provenance }).provenance?.edited === "hand";
    if (!cands.length) {
      if (hand && !o.force) {
        keptHandEdits.push(r.id);
        continue;
      }
      removeIds.push({ kind: r.kind, id: r.id });
      continue;
    }
    const [cx, cy] = centerOf(rr);
    let best = 0;
    let bd = Infinity;
    cands.forEach((wi, k) => {
      const [x, y] = centerOf(want[wi].d);
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    const wi = cands.splice(best, 1)[0];
    used.add(wi);
    if (hand && !o.force) {
      keptHandEdits.push(r.id);
      continue;
    }
    const next = want[wi].d;
    const { kind: _k, ...patch } = next;
    const unset = Object.keys(rr).filter((k) => k !== "kind" && next[k] === undefined);
    ops.push({ op: r.kind === "text" ? "text.edit" : "graphic.edit", id: r.id, patch, ...(unset.length ? { unset } : {}) });
    edited++;
  }
  const delText = removeIds.filter((x) => x.kind === "text").map((x) => x.id);
  const delGfx = removeIds.filter((x) => x.kind === "graphic").map((x) => x.id);
  if (delText.length) ops.push({ op: "text.delete", ids: delText });
  if (delGfx.length) ops.push({ op: "graphic.delete", ids: delGfx });
  removed = removeIds.length;
  let added = 0;
  want.forEach((w, i) => {
    if (used.has(i)) return;
    const { kind, ...fields } = w.d;
    ops.push(kind === "text" ? { op: "text.add", text: fields } : { op: "graphic.add", graphic: fields });
    added++;
  });
  return { ops, added, edited, removed, unchanged, keptHandEdits };
}

/** Build a change set from a tool's desired records (and host operations). */
export function changeSet(tool: StyleTool, title: string, label: string, doc: BoardDocument, desired: Desired[], extra: { hostOps?: OpCall[]; skipped?: Skipped[]; notes?: string[]; force?: boolean; report?: Record<string, unknown>; ops?: OpCall[] } = {}): StyleChangeSet {
  const r = reconcile(doc, tool, desired, extra.force ? { force: true } : {});
  const ops = [...(extra.ops ?? []), ...r.ops];
  const hostOps = extra.hostOps ?? [];
  return {
    tool,
    title,
    label,
    ops,
    hostOps,
    provenance: styleProvenance(tool),
    report: { added: r.added, edited: r.edited, removed: r.removed, unchanged: r.unchanged, keptHandEdits: r.keptHandEdits, skipped: extra.skipped ?? [], notes: extra.notes ?? [], ...(extra.report ?? {}) },
    empty: !ops.length && !hostOps.length,
  };
}

/** The change set that removes everything a tool made (all tools when none is named), and undoes its host changes. */
export function removeStyle(doc: BoardDocument, tool?: StyleTool): StyleChangeSet {
  const recs = [...recordsOfKind(doc, "text"), ...recordsOfKind(doc, "graphic")].filter((r) => madeBy(r, tool));
  const ops: OpCall[] = [];
  const texts = recs.filter((r) => r.kind === "text").map((r) => r.id);
  const gfx = recs.filter((r) => r.kind === "graphic").map((r) => r.id);
  if (texts.length) ops.push({ op: "text.delete", ids: texts });
  if (gfx.length) ops.push({ op: "graphic.delete", ids: gfx });
  const hostOps: OpCall[] = [];
  if (!tool || tool === "designators") {
    // designators moved footprints' own reference texts to the fabrication layer: put them back on the silkscreen
    const puts: BoardRecord[] = [];
    for (const fp of recordsOfKind(doc, "footprint")) {
      if (!fp.texts?.some((t) => t.role === "ref" && t.text === HIDDEN_MARK)) continue;
      puts.push({ ...fp, texts: fp.texts.map((t) => (t.role === "ref" && t.text === HIDDEN_MARK ? { ...t, layer: "top_silkscreen" as const, text: "REF" } : t)) });
    }
    if (puts.length) hostOps.push({ op: "record.put", records: puts });
  }
  const t = tool ?? "frames";
  return {
    tool: t,
    title: `Remove board style ${tool ?? "drawing"} from the board`,
    label: `remove ${tool ?? "all"} style drawing`,
    ops,
    hostOps,
    provenance: styleProvenance(t),
    report: { added: 0, edited: 0, removed: recs.length, unchanged: 0, keptHandEdits: [], skipped: [], notes: hostOps.length ? ["footprint reference texts moved back to the silkscreen"] : [] },
    empty: !ops.length && !hostOps.length,
  };
}

/**
 * A footprint's own reference text the designator tool moved off the silkscreen (to the fabrication layer, where
 * assembly drawings still show it) carries this as its text field; a reference text shows the footprint's
 * reference whatever its text field says, so nothing visible changes. Removal puts it back.
 */
export const HIDDEN_MARK = "style:hidden";

const batchId = (cs: StyleChangeSet, seq: number): string => `style-${cs.tool}-${seq}-${sha1Hex(canonical([cs.ops, cs.hostOps])).slice(0, 12)}`;

/**
 * Apply a change set directly as the style host (a person who ran the tool, a test, a scripted restyle). Ordinary and
 * host operations go in one transaction with the tool's provenance and change set id `style:<tool>`.
 */
export function applyStyleChange(svc: BoardService, cs: StyleChangeSet, o: { actor?: Actor; dryRun?: boolean } = {}): Reply {
  if (cs.empty) return { status: "applied", batchId: `style-${cs.tool}-empty`, epoch: svc.epoch, seq: svc.seq, changed: [], created: {}, removed: [], versions: {} } as Reply;
  return svc.apply({ batchId: batchId(cs, svc.seq), label: cs.label, ops: [...cs.ops, ...cs.hostOps], changeSet: { id: `style:${cs.tool}`, title: cs.title }, provenance: cs.provenance, expectSeq: svc.seq, ...(o.dryRun ? { dryRun: true } : {}) }, o.actor ?? STYLE_HOST);
}

/**
 * Store a change set as a proposal for a person to accept (the agent's path). The proposal carries the ordinary
 * operations and the tool's provenance; `hostOps` cannot ride in a person's transaction (they are system
 * operations), so they come back for the host to apply after the accept.
 */
export function proposeStyleChange(svc: BoardService, cs: StyleChangeSet): { proposal?: string; status: string; error?: string; hostOps: OpCall[] } {
  if (!cs.ops.length) return { status: cs.hostOps.length ? "host-only" : "empty", hostOps: cs.hostOps };
  const r = svc.propose(STYLE_HOST, { title: cs.title, items: [{ key: cs.tool, label: cs.label, ops: cs.ops }], provenance: cs.provenance, changeSet: { id: `style:${cs.tool}`, title: cs.title } });
  if (r.status === "proposed") return { status: "proposed", proposal: r.proposal.id, hostOps: cs.hostOps };
  return { status: r.status, error: (r as { error?: string }).error ?? "refused", hostOps: cs.hostOps };
}

/**
 * An in-memory service on a copy of a document (for planning a restyle without touching the real board). Each one
 * has a new epoch, so ids it issues never collide with ids an earlier scratch board issued.
 */
export function scratchService(doc: BoardDocument): BoardService {
  return openBoardService({ document: doc, journal: false, ownerLock: false, epoch: randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(-6) });
}
