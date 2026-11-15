/**
 * How the Atlas's highlight moves: time-based easing and hover intent (pure,
 * no canvas), so the tests can run a clock of their own.
 *
 * Every highlight value (a node's opacity, its outline) approaches its
 * target exponentially, with a time constant, over real elapsed time
 * (`Ease`): an ease-out that looks the same at any frame rate and, when the
 * target changes mid-way, turns back from wherever it is (never a snap). The
 * timing is in one place (`HOVER`), measured from Obsidian's graph view.
 *
 * Hover intent (`HoverIntent`) decides which node drives the dimming, so a
 * pointer sweeping a dense map does not flicker:
 * - moving onto a node starts its dimming, outline and label on the same
 *   frame;
 * - while dimmed, moving onto another node switches the focus at once (a
 *   node dimmed under both stays dimmed: no bounce toward full brightness);
 * - leaving a node onto empty canvas keeps the dimming for `holdMs` before
 *   the map is restored, so a pointer crossing a gap between two nodes goes
 *   straight from one focus to the next (Obsidian has no hold, and bounces
 *   back about half way between nodes).
 * With `instant` everything is at once (no hold, no easing).
 */

/** The highlight's timing, in milliseconds. */
export const HOVER = {
  /** The time constant of the other nodes dimming as a focus comes on or moves (90 % at about 2.3 of it, settled by about 4). */
  dimTauMs: 220,
  /** The time constant of everything easing back to rest once no focus is left, the outline's fade-out included. */
  restoreTauMs: 250,
  /** The hovered or selected node's outline is in (95 %) within this time: a time constant of a third of it. */
  accentInMs: 150,
  /** How long the dimming stays after the pointer leaves a node for empty canvas. */
  holdMs: 160,
};

/** The share of the way to its target an exponential ease covers in `dtMs` with time constant `tauMs`. */
export const easeShare = (dtMs: number, tauMs: number): number => (tauMs <= 0 || dtMs >= tauMs * 50 ? 1 : dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / tauMs));

/** Close enough to the target to land on it. */
const SNAP = 0.002;

/** One eased value per node, each approaching its target exponentially. */
export class Ease {
  /** The current values (what is drawn). */
  readonly value: Float32Array;

  constructor(n: number, init: number) {
    this.value = new Float32Array(n).fill(init);
  }

  get length(): number {
    return this.value.length;
  }

  /** Move value `i` toward `target` over `dtMs` with time constant `tauMs`; whether it is still moving. */
  step(i: number, target: number, dtMs: number, tauMs: number): boolean {
    const v = this.value[i]!;
    const d = target - v;
    if (Math.abs(d) <= SNAP) {
      this.value[i] = target;
      return false;
    }
    const next = v + d * easeShare(dtMs, tauMs);
    this.value[i] = next;
    if (Math.abs(target - next) <= SNAP) {
      this.value[i] = target;
      return false;
    }
    return true;
  }

  /** At its target now (not live). */
  set(i: number, target: number): void {
    this.value[i] = target;
  }
}

/**
 * Which node drives the dimming, given where the pointer is and what is
 * selected, over time (the rules above). Call `update` every frame.
 */
export class HoverIntent {
  /** The node the dimming is about (the hovered one, held a moment after it is left), or the selection, or none. */
  focus: number | null = null;
  /** When the pointer left the focus for empty canvas (the hold). */
  private leftAt: number | null = null;

  /**
   * The dimming's focus at `now` for the pointer's node (`hover`) and the
   * selection (`selected`, what the map rests on); `instant` skips
   * the easing (no view asks for it). `waiting` is true while the hold runs (a frame is due).
   */
  update(hover: number | null, selected: number | null, now: number, instant: boolean): { focus: number | null; waiting: boolean } {
    if (hover !== null) {
      // onto a node: its focus at once (straight from another node's, with no rest between)
      this.leftAt = null;
      this.focus = hover;
      return { focus: hover, waiting: false };
    }
    if (!instant && this.focus !== null && this.focus !== selected) {
      // left for empty canvas: hold the dimming a moment, then rest on the selection (or nothing)
      if (this.leftAt === null) this.leftAt = now;
      if (now - this.leftAt < HOVER.holdMs) return { focus: this.focus, waiting: true };
    }
    this.leftAt = null;
    this.focus = selected;
    return { focus: selected, waiting: false };
  }
}
