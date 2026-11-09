/**
 * The editing kernel (contract phase2-editing.md, sections 7 and 8): one routing world per snapshot, kept current
 * with `update`, from which routing and drag sessions start. It reads and never writes; a session hands back the one
 * operation and transaction to commit.
 */
import { diffIds, HUMAN, type Actor, type BoardDocument } from "@protoboardai/board/browser";
import { DragSession, type DragStart } from "./drag.js";
import { RouteSession, type RouteOptions } from "./route.js";
import { RouteWorld } from "./world.js";

/** DEFAULT: the time one cursor move may take (ms); the target is a frame (16 ms) with room to draw. */
export const STEP_BUDGET_MS = 12;

export interface KernelSnapshot {
  epoch: string;
  seq: number;
  doc: BoardDocument;
}

export interface EditKernel {
  readonly doc: BoardDocument;
  readonly seq: number;
  readonly world: RouteWorld;
  /** Bring the kernel to a newer snapshot (re-indexes only what changed). */
  update(snapshot: KernelSnapshot, changed?: readonly string[]): void;
  startRoute(options: RouteOptions): RouteSession | { error: string };
  startDrag(start: DragStart): DragSession | { error: string };
}

let kernels = 0;

export function createEditKernel(snapshot: KernelSnapshot, options: { budgetMs?: number; actor?: Actor } = {}): EditKernel {
  let doc = snapshot.doc;
  let seq = snapshot.seq;
  let epoch = snapshot.epoch;
  const world = new RouteWorld(doc);
  const budgetMs = options.budgetMs ?? STEP_BUDGET_MS;
  const actor = options.actor ?? HUMAN;
  const id = `k${++kernels}`;
  let sessions = 0;
  const host = () => ({ world, doc, epoch, seq, budgetMs, sessionId: `${id}.${++sessions}`, actor });
  return {
    get doc() {
      return doc;
    },
    get seq() {
      return seq;
    },
    world,
    update(s, changed) {
      if (s.doc !== doc) world.update(s.doc, changed ?? diffIds(doc, s.doc));
      doc = s.doc;
      seq = s.seq;
      epoch = s.epoch;
    },
    startRoute(o) {
      try {
        return new RouteSession(host(), o);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    startDrag(start) {
      try {
        return new DragSession(host(), start);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  };
}
