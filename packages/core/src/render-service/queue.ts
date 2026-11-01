/**
 * One capture at a time, and an idle timeout (PB-1180).
 *
 * The render service draws through one headless browser and one page; two
 * jobs at once would fight over the page's view state, and two SwiftShader
 * browsers at once stalled in the phase-1 baseline. Every job (a capture, a
 * views check, a doctor run) goes through `SerialQueue.run`, which starts the
 * next only when the last has settled (resolved or thrown).
 *
 * `IdleTimer` shuts the service down after a quiet period: it is held while a
 * job runs and restarts when the last one ends.
 */

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private running = false;

  /** Jobs queued behind the running one. */
  get pending(): number {
    return this.waiting;
  }

  get busy(): boolean {
    return this.running;
  }

  /** Runs `job` after every job queued before it has settled; resolves or rejects with its result. */
  run<T>(job: () => Promise<T>): Promise<T> {
    this.waiting++;
    const next = this.tail.then(
      () => this.start(job),
      () => this.start(job),
    );
    // the chain itself never rejects, so one failed job does not fail the ones behind it
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async start<T>(job: () => Promise<T>): Promise<T> {
    this.waiting--;
    this.running = true;
    try {
      return await job();
    } finally {
      this.running = false;
    }
  }
}

export interface TimerApi {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realTimers: TimerApi = {
  setTimeout: (fn, ms) => {
    const t = setTimeout(fn, ms);
    // never keep a CLI alive just to time out
    (t as { unref?: () => void }).unref?.();
    return t;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Calls `onIdle` once after `ms` with no activity. `touch()` restarts the
 * wait; `hold()` / `release()` bracket work (no timeout while anything is
 * held); `stop()` cancels for good.
 */
export class IdleTimer {
  private handle: unknown;
  private holds = 0;
  private stopped = false;
  private fired = false;
  /** When the last activity ended (ms since epoch), for `health`. */
  lastActive = Date.now();

  constructor(
    readonly ms: number,
    private readonly onIdle: () => void,
    private readonly timers: TimerApi = realTimers,
    private readonly now: () => number = Date.now,
  ) {
    this.arm();
  }

  touch(): void {
    this.lastActive = this.now();
    this.arm();
  }

  hold(): void {
    this.holds++;
    this.disarm();
  }

  release(): void {
    this.holds = Math.max(0, this.holds - 1);
    this.touch();
  }

  /** Brackets `job` with hold and release. */
  async during<T>(job: () => Promise<T>): Promise<T> {
    this.hold();
    try {
      return await job();
    } finally {
      this.release();
    }
  }

  stop(): void {
    this.stopped = true;
    this.disarm();
  }

  get idleForMs(): number {
    return this.holds ? 0 : this.now() - this.lastActive;
  }

  private disarm() {
    if (this.handle !== undefined) this.timers.clearTimeout(this.handle);
    this.handle = undefined;
  }

  private arm() {
    this.disarm();
    if (this.stopped || this.fired || this.holds || !(this.ms > 0) || !Number.isFinite(this.ms)) return;
    this.handle = this.timers.setTimeout(() => {
      this.handle = undefined;
      if (this.holds || this.stopped) return;
      this.fired = true;
      this.onIdle();
    }, this.ms);
  }
}

/** DEFAULT (PB-1180): the idle timeout, `PROTOBOARD_RENDER_IDLE_S` seconds, else 15 minutes (a warm SwiftShader Chrome holds a few hundred MB). */
export const DEFAULT_IDLE_MS = 15 * 60 * 1000;
export function idleMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const s = Number(env.PROTOBOARD_RENDER_IDLE_S);
  return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : DEFAULT_IDLE_MS;
}
