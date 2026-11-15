/**
 * A time-lapse run (no DOM, no clock of its own: the view hands it the frame
 * times), so the tests can play one step by step.
 *
 * The map starts empty. The playback clock (`ms`, at 1x from play) runs
 * while playing, at the chosen speed; every node whose arrival
 * (timeline.ts) it passes arrives, in sequence. The run steps on a fixed
 * clock (`TIMELAPSE.stepMs`, one simulation tick a step), so the same
 * project gives the same run whatever the frame rate.
 *
 * Live (`live`, what every view plays) the physics runs for the whole time-lapse:
 * only the nodes that have arrived take part in it. The map is heavily
 * damped (`TIMELAPSE.restDamping`) so nodes far from an arrival barely move;
 * a new node and the neighbor it is born beside are loose for a moment
 * (`linkedDamping`, `looseMs`): the newcomer travels into place with
 * momentum (`AtlasSimulation.arrive`: beside its neighbor, carried out by
 * the new link's spring) and the neighbor, yanked by that spring, wobbles
 * once and settles. A newcomer with no neighbor yet is born just outside
 * the cloud and drifts in (an ease-out drift of its own, `loneDamping`). Each arrival warms the layout a little, so the
 * nodes near it are pushed aside. A node fades in as measured from
 * Obsidian (`entryOpacity`: half at once, then a long tail) with a subtle
 * pop (`popScale`), and is drawn at its size for the links that show so
 * far, growing as they come in. A link starts a moment after both its ends
 * are on the map, at full length, fading in while its spring ramps in
 * (`linkAlpha`, `springRamp`). After the last arrival the layout cools on
 * its own: no snap to the saved layout. The camera never moves.
 *
 * Not live (`reduced`, which no view sets) the run still plays in sequence, the simplest way:
 * the layout stays as it was, each node fades in where it is, and its links
 * fade in after both ends, with no physics.
 *
 * Pausing freezes the arrivals (the playback clock) while the physics and
 * the fades go on and settle. Scrubbing back takes the nodes past the new
 * time off the map at once; scrubbing on brings them in as arrivals.
 */
import { nodeRadius, type AtlasSimulation } from "./sim.js";
import { TIMELAPSE, arrivedBy, dateAt, entryOpacity, fadeIn, linkAlpha, popScale, springRamp, type Timeline, type TimelapseSpeed } from "./timeline.js";

export class TimelapseRun {
  readonly timeline: Timeline;
  /** Live physics, births with momentum, the pop. */
  readonly live: boolean;
  /** The playback clock: ms at 1x since play (what the scrubber shows). */
  ms = 0;
  /** How many nodes have arrived (the first that many of `timeline.order`). */
  count = 0;
  playing = true;
  speed: TimelapseSpeed;
  /** The look's clock: the ms of steps run since the start, paused or not (each arrival's age is measured on it). */
  clock = 0;
  /** When each node arrived, on the look's clock (NaN: not on the map). */
  readonly born: Float64Array;
  /** When each node was last loosened (born, or a newcomer born beside it), on the look's clock (NaN: never). */
  readonly looseAt: Float64Array;
  /** The damping each node has while loose: drifting in alone (`loneDamping`), or on a new link's spring (`linkedDamping`). */
  private readonly looseDamp: Float32Array;
  /** What the renderer draws: each node's opacity and scale (the pop times its size for the links shown), each link's opacity. */
  readonly vis: Float32Array;
  readonly scale: Float32Array;
  readonly linkVis: Float32Array;
  /** Each link's spring strength and each node's damping (the simulation's `edgeScale` and `damping` while the run lasts). */
  readonly edgeScale: Float32Array;
  readonly damping: Float32Array;
  /** Scratch: each node's links shown so far (the sum of their opacities). */
  private readonly shownDeg: Float32Array;
  /** Something still fades, pops or draws in. */
  easing = false;
  private acc = 0;
  private wall: number | null = null;

  constructor(
    private readonly sim: AtlasSimulation,
    timeline: Timeline,
    live: boolean,
    speed: TimelapseSpeed = 1,
  ) {
    this.timeline = timeline;
    this.live = live;
    this.speed = speed;
    const n = sim.nodes.length;
    this.born = new Float64Array(n).fill(Number.NaN);
    this.looseAt = new Float64Array(n).fill(Number.NaN);
    this.looseDamp = new Float32Array(n).fill(TIMELAPSE.restDamping);
    this.vis = new Float32Array(n);
    this.scale = new Float32Array(n);
    this.damping = new Float32Array(n).fill(TIMELAPSE.restDamping);
    this.shownDeg = new Float32Array(n);
    const m = sim.edges.length;
    this.linkVis = new Float32Array(m);
    this.edgeScale = new Float32Array(m);
    // the map empties at once (one frame); the layout warms (live) or stands still (not live)
    sim.setShown(new Uint8Array(n));
    sim.edgeScale = this.edgeScale;
    sim.damping = this.damping;
    if (live) sim.alphaTarget = TIMELAPSE.playAlpha;
    else {
      sim.cool();
      sim.alphaTarget = 0;
    }
    this.look();
  }

  /** Whether every node has arrived. */
  get done(): boolean {
    return this.count >= this.timeline.order.length;
  }

  /** The alpha the layout rests at now: warm while arrivals run live, else none. */
  get restAlpha(): number {
    return this.live && this.playing && !this.done ? TIMELAPSE.playAlpha : 0;
  }

  /** The calendar date at the playback clock. */
  get date(): number {
    return dateAt(this.timeline, this.ms);
  }

  /** The next frame's time counts from its own (a loop restarting, a resume): no jump for the time it was away. */
  resetClock(): void {
    this.wall = null;
    this.acc = 0;
  }

  /**
   * A frame at `now` (ms): the steps its real time is worth (at most
   * `TIMELAPSE.maxStepsPerFrame`), then the look. Returns whether a next
   * frame is due (playing, easing, or the layout still moving).
   */
  frame(now: number): boolean {
    const dt = this.wall === null ? TIMELAPSE.stepMs : Math.max(0, Math.min(100, now - this.wall));
    this.wall = now;
    this.acc += dt;
    let steps = Math.floor(this.acc / TIMELAPSE.stepMs + 1e-9);
    if (steps > TIMELAPSE.maxStepsPerFrame) {
      steps = TIMELAPSE.maxStepsPerFrame;
      this.acc = 0;
    } else this.acc -= steps * TIMELAPSE.stepMs;
    for (let k = 0; k < steps; k++) this.step();
    this.look();
    return this.playing || this.easing || this.sim.active;
  }

  /** One fixed step: the playback clock (while playing) and its arrivals, the springs' ramps, one tick of the physics. */
  step(): void {
    if (this.playing) {
      this.ms = Math.min(this.timeline.duration, this.ms + TIMELAPSE.stepMs * this.speed);
      this.arriveTo(this.ms);
      if (this.done) {
        // the last one is in: the layout cools from here, on its own
        this.playing = false;
        this.sim.alphaTarget = 0;
      }
    }
    this.clock += TIMELAPSE.stepMs;
    this.ramp();
    this.loosen();
    if (this.sim.active) this.sim.tick();
  }

  /** Show the map as it is at playback time `ms` (the scrubber). */
  seek(ms: number): void {
    this.ms = Math.max(0, Math.min(this.timeline.duration, ms));
    this.arriveTo(this.ms);
    this.ramp();
    this.look();
  }

  /** Play or pause; play from the end starts again from an empty map. */
  setPlaying(playing: boolean): void {
    if (playing && this.done) this.seek(0);
    this.playing = playing;
    this.sim.alphaTarget = this.restAlpha;
    this.resetClock();
  }

  setSpeed(speed: TimelapseSpeed): void {
    this.speed = speed;
  }

  /** Bring the nodes up to playback time `ms` on the map (in sequence), or take off those past it. */
  private arriveTo(ms: number): void {
    const { order } = this.timeline;
    const k = arrivedBy(this.timeline, ms);
    if (k > this.count) {
      const come = Array.from(order.subarray(this.count, k));
      const anchors = this.sim.arrive(come, this.live);
      come.forEach((i, q) => {
        this.born[i] = this.clock;
        this.looseAt[i] = this.clock;
        const a = anchors[q]!;
        // a lone newcomer drifts in on its own drift (the simulation's), under the map's damping
        this.looseDamp[i] = a >= 0 ? TIMELAPSE.linkedDamping : TIMELAPSE.restDamping;
        if (a >= 0) {
          this.looseAt[a] = this.clock;
          this.looseDamp[a] = TIMELAPSE.linkedDamping;
        }
      });
      this.count = k;
    } else if (k < this.count) {
      const go = Array.from(order.subarray(k, this.count));
      this.sim.depart(go);
      for (const i of go) {
        this.born[i] = Number.NaN;
        this.looseAt[i] = Number.NaN;
        this.vis[i] = 0;
        this.scale[i] = 0;
      }
      this.count = k;
    }
  }

  /** Each link's spring strength: nothing until both ends are on the map, then the ramp (full at once when not live). */
  private ramp(): void {
    const { edges } = this.sim;
    for (let e = 0; e < edges.length; e++) {
      const a = this.born[edges[e]!.s]!;
      const b = this.born[edges[e]!.t]!;
      if (Number.isNaN(a) || Number.isNaN(b)) this.edgeScale[e] = 0;
      else this.edgeScale[e] = this.live ? springRamp(this.clock - Math.max(a, b)) : 1;
    }
  }

  /** Each node's damping: loose for `looseMs` after it was born or a newcomer was born beside it, else the map's heavy damping. */
  private loosen(): void {
    for (let i = 0; i < this.looseAt.length; i++) {
      const at = this.looseAt[i]!;
      this.damping[i] = this.live && !Number.isNaN(at) && this.clock - at < TIMELAPSE.looseMs ? this.looseDamp[i]! : TIMELAPSE.restDamping;
    }
  }

  /** What the renderer draws now, from each arrival's age. */
  private look(): void {
    let easing = false;
    const { edges, nodes } = this.sim;
    this.shownDeg.fill(0);
    for (let e = 0; e < edges.length; e++) {
      const a = this.born[edges[e]!.s]!;
      const b = this.born[edges[e]!.t]!;
      if (Number.isNaN(a) || Number.isNaN(b)) {
        this.linkVis[e] = 0;
        continue;
      }
      const age = this.clock - Math.max(a, b);
      const v = this.live ? linkAlpha(age) : linkAlpha(age, TIMELAPSE.linkDelayMs, TIMELAPSE.revealFadeMs);
      this.linkVis[e] = v;
      this.shownDeg[edges[e]!.s] += v;
      this.shownDeg[edges[e]!.t] += v;
      if (v < 1) easing = true;
    }
    for (let i = 0; i < this.born.length; i++) {
      const b = this.born[i]!;
      if (Number.isNaN(b)) {
        this.vis[i] = 0;
        this.scale[i] = 0;
        continue;
      }
      const age = this.clock - b;
      const n = nodes[i]!;
      // drawn at its size for the links shown so far: the smallest on arrival, growing as its links come in
      const size = nodeRadius({ kind: n.kind, root: n.root, deg: this.shownDeg[i]! }) / n.r;
      this.vis[i] = this.live ? entryOpacity(age) : fadeIn(age);
      this.scale[i] = (this.live ? popScale(age) : 1) * size;
      if (this.vis[i]! < 1 || (this.live && age < TIMELAPSE.popMs)) easing = true;
    }
    this.easing = easing;
  }

  /** The run is left: the simulation's springs and damping its own again (the view shows every node and glides home). */
  dispose(): void {
    if (this.sim.edgeScale === this.edgeScale) this.sim.edgeScale = null;
    if (this.sim.damping === this.damping) this.sim.damping = null;
  }
}
