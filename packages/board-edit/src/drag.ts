/**
 * Drag sessions (contract phase2-editing.md, section 8): a footprint dragged with its tracks attached, or a track
 * segment or via dragged with its neighbors following. Each move returns the records the commit would write,
 * computed by the same planners the operations use (`planFootprintMove`, `planTrackDrag`), so the preview is the
 * commit. Track and via drags stop at the last legal position: no short and no new clearance violation.
 */
import { copperOf, OpError, planFootprintMove, planTrackDrag, type Actor, type BoardDocument, type BoardRecord, type Detached, type OpCall, type PlanContext, type Provenance, type Transaction } from "@protoboardai/board/browser";
import type { SessionHost } from "./route.js";

export type DragStart = { kind: "footprint"; ids: string[]; tracks?: "attached" | "stay" } | { kind: "track"; id: string; posture?: "45" | "90" };

export interface DragCandidate {
  ok: boolean;
  dx: number;
  dy: number;
  puts: BoardRecord[];
  removes: string[];
  detached: Detached[];
  collisions: { id: string; against: string; required: number; actual: number }[];
  timing: { ms: number; budgetHit: boolean };
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface DragHost extends SessionHost {
  actor: Actor;
}

export class DragSession {
  private last: DragCandidate;
  private serial = 0;
  private draftIds = 0;
  private readonly ctx: PlanContext;
  private readonly baseline = new Map<string, number>();
  private done = false;

  constructor(
    private readonly host: DragHost,
    readonly start: DragStart,
  ) {
    const doc = host.doc;
    if (start.kind === "footprint") {
      if (!start.ids.length) throw new Error("drag at least one footprint");
      for (const id of start.ids) if (doc.records.get(id)?.kind !== "footprint") throw new Error(`${id} is not a footprint on this board`);
    } else {
      const r = doc.records.get(start.id);
      if (r?.kind !== "track" && r?.kind !== "via") throw new Error(`${start.id} is not a track or via on this board`);
    }
    const a = host.actor;
    const provenance: Provenance = a.kind === "human" ? { by: "hand" } : a.kind === "agent" ? { by: "agent", actor: a.id } : a.kind === "router" ? { by: "routed", tool: a.id } : { by: "system" };
    this.ctx = {
      actor: a,
      issueId: (kind) => `${kind === "via" ? "via" : "trk"}:draft.${++this.draftIds}`,
      edited: a.kind === "human" ? "hand" : a.kind === "agent" ? "agent" : a.kind === "router" ? "routed" : undefined,
      provenance,
    };
    this.last = { ok: true, dx: 0, dy: 0, puts: [], removes: [], detached: [], collisions: [], timing: { ms: 0, budgetHit: false } };
  }

  /** The least clearance slack of a record's copper against other nets, ignoring `ignore` owners. */
  private slackOf(doc: BoardDocument, rec: BoardRecord, ignore: ReadonlySet<string>, out?: DragCandidate["collisions"]): number {
    let worst = Infinity;
    for (const p of copperOf(doc, rec)) {
      const ctx = this.host.world.context(p.net ?? "", p.layer, 0, p.kind === "via" ? "via" : p.kind === "pad" ? "pad" : "track");
      for (const v of ctx.violations(p.prim, ignore)) {
        if (v.check !== "clearance") continue;
        worst = Math.min(worst, v.slack);
        out?.push({ id: p.id, against: v.against, required: Math.round(v.required), actual: Math.round(v.gap) });
      }
    }
    return worst === Infinity ? 0 : worst;
  }

  private plan(dx: number, dy: number): { puts: BoardRecord[]; removes: string[]; detached: Detached[] } {
    const doc = this.host.doc;
    if (this.start.kind === "footprint") {
      if (this.start.tracks === "stay") return { puts: this.start.ids.map((id) => ({ ...(doc.records.get(id) as BoardRecord & { x: number; y: number }), x: (doc.records.get(id) as { x: number }).x + dx, y: (doc.records.get(id) as { y: number }).y + dy }) as BoardRecord), removes: [], detached: [] };
      const p = planFootprintMove(doc, this.start.ids, dx, dy, this.ctx, this.host.world.index);
      return { puts: p.puts, removes: p.removes, detached: p.detached };
    }
    const p = planTrackDrag(doc, this.start.id, dx, dy, this.start.posture ?? "45", this.ctx, this.host.world.index);
    return { puts: p.puts, removes: p.removes, detached: [] };
  }

  /** A candidate at a delta, or undefined when it shorts or adds clearance violations (track drags). */
  private tryAt(dx: number, dy: number): DragCandidate | undefined {
    let plan: ReturnType<DragSession["plan"]>;
    try {
      plan = this.plan(dx, dy);
    } catch (e) {
      if (e instanceof OpError) return undefined;
      throw e;
    }
    const doc = this.host.doc;
    const ignore = new Set<string>([...plan.puts.map((r) => r.id), ...plan.removes]);
    const collisions: DragCandidate["collisions"] = [];
    let legal = true;
    for (const r of plan.puts) {
      if (r.kind !== "track" && r.kind !== "via" && r.kind !== "footprint") continue;
      const s = this.slackOf(doc, r, ignore, collisions);
      if (this.start.kind === "track") {
        let base = this.baseline.get(r.id);
        if (base === undefined) {
          const old = doc.records.get(r.id);
          base = old ? Math.min(0, this.slackOf(doc, old, ignore)) : 0;
          this.baseline.set(r.id, base);
        }
        if (s < base - 1) legal = false;
      }
    }
    if (!legal) return undefined;
    return { ok: true, dx, dy, puts: plan.puts, removes: plan.removes, detached: plan.detached, collisions, timing: { ms: 0, budgetHit: false } };
  }

  move(delta: { dx: number; dy: number }): DragCandidate {
    if (this.done) throw new Error("this drag session has ended");
    const t0 = now();
    const DX = Math.round(delta.dx),
      DY = Math.round(delta.dy);
    let c = this.tryAt(DX, DY);
    let budgetHit = false;
    if (!c && this.start.kind === "track") {
      // the furthest legal fraction of the requested delta
      let lo = 0,
        hi = 1;
      let best: DragCandidate | undefined;
      for (let k = 0; k < 10; k++) {
        if (now() - t0 > this.host.budgetMs) {
          budgetHit = true;
          break;
        }
        const t = (lo + hi) / 2;
        const got = this.tryAt(Math.round(DX * t), Math.round(DY * t));
        if (got) {
          best = got;
          lo = t;
        } else hi = t;
      }
      c = best ? { ...best, ok: false } : { ok: false, dx: 0, dy: 0, puts: [], removes: [], detached: [], collisions: [], timing: { ms: 0, budgetHit } };
    }
    this.last = { ...c!, timing: { ms: Math.round((now() - t0) * 100) / 100, budgetHit } };
    return this.last;
  }

  /** The operation and transaction of the last legal position. */
  finish(): { call: OpCall; tx: Transaction } | { error: string } {
    if (this.done) throw new Error("this drag session has ended");
    const { dx, dy } = this.last;
    if (!dx && !dy) return { error: "the drag has not moved anything" };
    this.done = true;
    const call: OpCall =
      this.start.kind === "footprint" ? { op: "footprint.move", ids: [...this.start.ids], dx, dy, tracks: this.start.tracks ?? "attached" } : { op: "track.drag", id: this.start.id, dx, dy, posture: this.start.posture ?? "45" };
    const label = this.start.kind === "footprint" ? "move footprints with their tracks" : `drag ${this.start.id.replace(/\s+/g, "_")} by hand`;
    return { call, tx: { batchId: `drag.${this.host.sessionId}.${++this.serial}`, label, ops: [call], expectEpoch: this.host.epoch } };
  }

  cancel(): void {
    this.done = true;
  }
}
