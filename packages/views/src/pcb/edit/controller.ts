/**
 * The page's interactive editing kernel (browser): one `@protoboardai/board-edit` kernel over the screen's confirmed
 * board, kept current as commits arrive, and the route and drag sessions a person drives from the layout screen.
 *
 * - A route is a draft: each cursor move asks the kernel for the walk-around candidate (or the highlight one), which
 *   the screen draws over the board; nothing is written until `finishRoute`, which commits the session's one
 *   `track.route` transaction with the region precondition the kernel hands back. Esc drops the draft.
 * - A drag (a footprint with its attached tracks, or a track or via with its neighbors following) previews the
 *   kernel's candidate as records on top of the board (the same planner the operation runs), lists what detaches,
 *   holds the dragged ids against agents (`hold`, renewed every few seconds, `releaseHold` at the end) and commits
 *   the session's call.
 * - While a person draws, agents may be paused (`pause`, `resume`); a host without those requests is tolerated.
 *
 * Nothing here names an actor: the host decides who acts.
 */
import { createEditKernel, type DragCandidate, type DragSession, type EditKernel, type RouteCandidate, type RouteSession } from "@protoboardai/board-edit";
import type { CopperLayer } from "../board.js";
import type { BoardReplyMessage, BoardRequest } from "../types.js";
import type { EditSession, Outcome, RequestFn } from "./session.js";

/** Requests a host may not know yet (W3 adds them): hold, releaseHold, pause, resume. */
type ExtraRequest = { method: "hold"; ids: string[]; ttlMs?: number } | { method: "releaseHold"; id?: string } | { method: "pause"; reason?: string; ttlMs?: number } | { method: "resume" };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
/** Renew a drag hold this often (the service's default hold lasts 10 s). */
export const HOLD_RENEW_MS = 3000;

export interface RouteState {
  session: RouteSession;
  net: string;
  candidate?: RouteCandidate;
  mode: "walkaround" | "highlight";
  posture: "45" | "90";
  /** Highlight mode: the first F asked; the second commits the collisions as violations. */
  armed: boolean;
  /** Agents paused while the person draws (the host took the pause). */
  paused: boolean;
  started: number;
}

export interface DragState {
  session: DragSession;
  kind: "footprint" | "track";
  ids: string[];
  candidate?: DragCandidate;
  hold?: string;
  timer?: ReturnType<typeof setInterval>;
}

export interface ControllerOptions {
  session: EditSession;
  request?: RequestFn;
  /** Something the screen shows changed (draft, state). */
  onChange: () => void;
  /** Kernel step budget (ms). */
  budgetMs?: number;
  /** Pause agents while drawing a route (when the host takes it). */
  pauseAgents?: boolean;
}

export class ToolController {
  private kernelRef: EditKernel | undefined;
  route: RouteState | undefined;
  drag: DragState | undefined;
  /** Milliseconds of each kernel step (route moves and drag moves), for the latency bench. */
  readonly timings = { route: [] as number[], drag: [] as number[] };
  pauseAgents: boolean;
  /** The last note to show (a refusal, a fallback), cleared by the screen. */
  note: string | undefined;

  constructor(private readonly o: ControllerOptions) {
    this.pauseAgents = o.pauseAgents ?? true;
  }

  /** The kernel over the confirmed board, brought up to date (re-indexes only what changed). */
  kernel(): EditKernel {
    const s = this.o.session.confirmed();
    if (!this.kernelRef) this.kernelRef = createEditKernel({ epoch: s.epoch, seq: s.seq, doc: s.doc }, this.o.budgetMs !== undefined ? { budgetMs: this.o.budgetMs } : {});
    else if (this.kernelRef.doc !== s.doc) this.kernelRef.update({ epoch: s.epoch, seq: s.seq, doc: s.doc });
    return this.kernelRef;
  }

  // ------------------------------------------------------------------ requests a host may not have yet

  /** A request the host may not know; an unknown method is not an error the person needs to see. */
  async extra(req: ExtraRequest): Promise<BoardReplyMessage | undefined> {
    if (!this.o.request) return undefined;
    try {
      const r = await this.o.request(req as unknown as BoardRequest);
      return r;
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------------ route

  startRoute(from: Parameters<EditKernel["startRoute"]>[0]["from"], o: { layer?: CopperLayer; width?: number; mode?: "walkaround" | "highlight"; posture?: "45" | "90" } = {}): { ok: true } | { error: string } {
    this.cancelRoute();
    const k = this.kernel();
    let s = k.startRoute({ from, ...(o.layer ? { layer: o.layer } : {}), ...(o.width ? { width: o.width } : {}), mode: o.mode ?? "walkaround", posture: o.posture ?? "45" });
    // the start has no copper on the active layer: start on its own layer
    if ("error" in s && o.layer && /no copper on/.test(s.error)) s = k.startRoute({ from, ...(o.width ? { width: o.width } : {}), mode: o.mode ?? "walkaround", posture: o.posture ?? "45" });
    if ("error" in s) return { error: s.error };
    this.route = { session: s, net: s.net, mode: o.mode ?? "walkaround", posture: o.posture ?? "45", armed: false, paused: false, started: Date.now() };
    if (this.pauseAgents) {
      const r = this.route;
      void this.extra({ method: "pause", reason: `a person is routing ${s.net}`, ttlMs: 120_000 }).then((x) => {
        const res = x?.ok ? (x.result as { status?: string } | undefined) : undefined;
        if (this.route === r && res && res.status !== "invalid") {
          r.paused = true;
          this.o.onChange();
        }
      });
    }
    this.o.onChange();
    return { ok: true };
  }

  /** Re-plan the head to the cursor (nanometers). */
  moveRoute(cursor: { x: number; y: number }): RouteCandidate | undefined {
    const r = this.route;
    if (!r) return undefined;
    const t0 = now();
    r.candidate = r.session.move(cursor);
    this.timings.route.push(now() - t0);
    if (this.timings.route.length > 5000) this.timings.route.splice(0, 1000);
    r.armed = false;
    return r.candidate;
  }

  clickRoute(cursor: { x: number; y: number }): RouteCandidate | undefined {
    const r = this.route;
    if (!r) return undefined;
    r.candidate = r.session.click(cursor);
    r.armed = false;
    this.o.onChange();
    return r.candidate;
  }

  /** V: a via at the head's end and on to the next layer. */
  viaRoute(layer?: CopperLayer, cursor?: { x: number; y: number }): { ok: boolean; reason?: string } {
    const r = this.route;
    if (!r) return { ok: false, reason: "no route in progress" };
    const res = r.session.changeLayer(layer);
    if (res.ok && cursor) r.candidate = r.session.move(cursor);
    else if (res.ok) r.candidate = undefined;
    this.o.onChange();
    return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "no legal spot for a via" };
  }

  backRoute(): void {
    const r = this.route;
    if (!r) return;
    r.candidate = r.session.back() ?? r.candidate;
    r.armed = false;
    this.o.onChange();
  }

  setRouteMode(mode: "walkaround" | "highlight", cursor?: { x: number; y: number }): void {
    const r = this.route;
    if (!r) return;
    r.mode = mode;
    r.session.setMode(mode);
    if (cursor) r.candidate = r.session.move(cursor);
    this.o.onChange();
  }
  flipPosture(cursor?: { x: number; y: number }): void {
    const r = this.route;
    if (!r) return;
    r.posture = r.posture === "45" ? "90" : "45";
    r.session.flipPosture();
    if (cursor) r.candidate = r.session.move(cursor);
    this.o.onChange();
  }
  setRouteWidth(w: number, cursor?: { x: number; y: number }): void {
    const r = this.route;
    if (!r) return;
    r.session.setWidth(w);
    if (cursor) r.candidate = r.session.move(cursor);
    this.o.onChange();
  }

  /**
   * F or a double click: commit the draft as one `track.route` transaction with the kernel's region precondition.
   * In highlight mode with collisions the first call only arms (`armed`); the second commits them.
   */
  async finishRoute(): Promise<Outcome | { armed: true } | { error: string }> {
    const r = this.route;
    if (!r) return { error: "no route in progress" };
    if (r.mode === "highlight" && r.candidate && r.candidate.collisions.length && !r.armed) {
      r.armed = true;
      this.o.onChange();
      return { armed: true };
    }
    const f = r.session.finish();
    if ("error" in f) return { error: f.error };
    this.endRoute();
    const label = r.mode === "highlight" && r.candidate?.collisions.length ? `route ${r.net} by hand, with collisions` : f.tx.label;
    // the region precondition, not the epoch: a host that opens the board on the first write starts a new epoch, and
    // the page's other gestures do not pin it either (a reload re-reads the board and the kernel with it)
    const opts = f.tx.expectRegion ? { expectRegion: f.tx.expectRegion } : {};
    // never retried without the precondition: a route whose neighborhood changed must be redrawn, not forced in
    const out = await this.o.session.commit(label.split(" ").slice(0, 8).join(" "), f.tx.ops as never, opts);
    this.o.onChange();
    return out;
  }

  /** Esc: drop the draft; nothing was written. */
  cancelRoute(): void {
    if (!this.route) return;
    this.route.session.cancel();
    this.endRoute();
    this.o.onChange();
  }

  private endRoute(): void {
    const r = this.route;
    this.route = undefined;
    if (r?.paused) void this.extra({ method: "resume" });
  }

  // ------------------------------------------------------------------ drag

  /** Start a kernel drag: footprints with their attached tracks, or one track segment or via. */
  startDrag(start: { kind: "footprint"; ids: string[] } | { kind: "track"; id: string }): boolean {
    this.cancelDrag();
    const d = this.kernel().startDrag(start.kind === "footprint" ? { kind: "footprint", ids: start.ids, tracks: "attached" } : { kind: "track", id: start.id, posture: "45" });
    if ("error" in d) return false;
    const ids = start.kind === "footprint" ? start.ids : [start.id];
    const st: DragState = { session: d, kind: start.kind, ids };
    this.drag = st;
    const hold = () =>
      void this.extra({ method: "hold", ids, ttlMs: 10_000 }).then((r) => {
        const h = r?.ok ? (r.result as { status?: string; hold?: { id: string }; id?: string } | undefined) : undefined;
        const id = h?.hold?.id ?? h?.id;
        if (id && this.drag === st) st.hold = id;
        else if (id && this.drag !== st) void this.extra({ method: "releaseHold", id });
      });
    hold();
    st.timer = setInterval(hold, HOLD_RENEW_MS);
    return true;
  }

  /** A drag step (nanometers from the press): the candidate, previewed as records over the board. */
  moveDrag(dx: number, dy: number): DragCandidate | undefined {
    const d = this.drag;
    if (!d) return undefined;
    const t0 = now();
    d.candidate = d.session.move({ dx, dy });
    this.timings.drag.push(now() - t0);
    if (this.timings.drag.length > 5000) this.timings.drag.splice(0, 1000);
    this.o.session.previewRecords(d.candidate.puts, d.candidate.removes);
    return d.candidate;
  }

  /** Release: commit the session's call (the last legal delta), or put everything back. */
  async endDrag(cancel: boolean, label: string): Promise<Outcome | undefined> {
    const d = this.drag;
    if (!d) return undefined;
    this.stopDrag();
    if (cancel || !d.candidate || (!d.candidate.dx && !d.candidate.dy)) {
      d.session.cancel();
      this.o.session.previewRecords([], []);
      return undefined;
    }
    const f = d.session.finish();
    this.o.session.previewRecords([], []);
    if ("error" in f) return undefined;
    return this.o.session.commit(label, [f.call as never], { expectFor: d.ids });
  }

  cancelDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.stopDrag();
    d.session.cancel();
    this.o.session.previewRecords([], []);
  }

  private stopDrag(): void {
    const d = this.drag;
    this.drag = undefined;
    if (!d) return;
    if (d.timer) clearInterval(d.timer);
    void this.extra({ method: "releaseHold", ...(d.hold ? { id: d.hold } : {}) });
  }

  dispose(): void {
    this.cancelRoute();
    this.cancelDrag();
  }
}
