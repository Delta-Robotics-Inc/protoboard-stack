/**
 * What the part carousels share (PB-918):
 *
 * - `PagerStore`: where every card of a list is (its text page and its
 *   picture), kept by the list so a card that scrolls away and back, or a
 *   part that is opened and closed, comes back where it was; and the "turn
 *   all cards together" switch, with which one card's pager moves them all.
 * - `PagesSource`: the cards' pages, fetched from the host when a card first
 *   shows a page other than its overview, a few at a time, and kept.
 * - The controls: arrows, the "n/N" pager, the page segments, the picture
 *   dots; and swiping (touch, pen, and a trackpad's sideways scroll).
 *
 * Motion is one short fade of the page that came in, and none at all when
 * the reader asked for reduced motion.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { Icon, IconButton, cx } from "@deltarobotics/uhd-viewer/components";
import { CARD_PAGES, type CardPageId, type PartPages, type PartPagesRef } from "./model.js";

// ---------------------------------------------------------------- where the cards are

export class PagerStore {
  private readonly pages = new Map<string, CardPageId>();
  private readonly images = new Map<string, number>();
  private linked = false;
  private shared: CardPageId = "overview";
  /** The page a card was last turned to. */
  private last: CardPageId | undefined;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  /** Changes with every change: what `useSyncExternalStore` compares. */
  snapshot = () => this.version;
  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  get isLinked() {
    return this.linked;
  }
  /** The page every card shows while they turn together. */
  get sharedPage() {
    return this.shared;
  }
  /** The page a card asks for: its own, or everyone's while the cards turn together. */
  page(key: string): CardPageId {
    return this.linked ? this.shared : (this.pages.get(key) ?? "overview");
  }
  setPage(key: string, page: CardPageId) {
    if (this.linked) this.shared = page;
    this.pages.set(key, page);
    this.last = page;
    this.changed();
  }
  /** Turn every card together (they go to `page`: by default the page a card was last turned to, else the specs), or each on its own again. */
  setLinked(on: boolean, page?: CardPageId) {
    this.linked = on;
    if (on) this.shared = page ?? this.last ?? "specs";
    this.changed();
  }
  /** Turn every card to `page` (while they turn together). */
  setShared(page: CardPageId) {
    this.shared = page;
    this.last = page;
    this.changed();
  }
  image(key: string): number {
    return this.images.get(key) ?? 0;
  }
  setImage(key: string, index: number) {
    this.images.set(key, index);
    this.changed();
  }
}

const PagerContext = createContext<PagerStore | null>(null);

/** A list's pager store: every card under it remembers its place there. */
export function PagerProvider({ store, children }: { store: PagerStore; children: ReactNode }) {
  return <PagerContext.Provider value={store}>{children}</PagerContext.Provider>;
}

/** The store of the list a card is in; a card outside any list keeps its own. */
export function usePagerStore(): PagerStore {
  const given = useContext(PagerContext);
  const [own] = useState(() => new PagerStore());
  const store = given ?? own;
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return store;
}

/** A list's own store, made once. */
export function useNewPagerStore(): PagerStore {
  return useState(() => new PagerStore())[0];
}

// ---------------------------------------------------------------- the cards' pages, from the host

export type PagesState = { status: "idle" | "loading" } | { status: "ready"; pages: PartPages } | { status: "error"; error: string };

/** A host's way to a part's pages. */
export type PagesLoader = (ref: PartPagesRef) => Promise<PartPages>;

/** The pages of a list's cards: asked for once each, four at a time, kept while the page lives. */
export class PagesSource {
  private readonly states = new Map<string, PagesState>();
  private readonly queue: PartPagesRef[] = [];
  private running = 0;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly loader: PagesLoader,
    private readonly concurrency = 4,
  ) {}

  static id = (ref: PartPagesRef) => `${ref.key}@${ref.revision ?? ""}`;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  snapshot = () => this.version;
  private set(ref: PartPagesRef, state: PagesState) {
    this.states.set(PagesSource.id(ref), state);
    this.version++;
    for (const fn of this.listeners) fn();
  }

  state(ref: PartPagesRef | undefined): PagesState {
    return (ref && this.states.get(PagesSource.id(ref))) || { status: "idle" };
  }

  /** Ask for a part's pages (again after an error); nothing happens while they are loading or known. */
  want(ref: PartPagesRef, retry = false) {
    const s = this.state(ref);
    if (s.status === "loading" || s.status === "ready" || (s.status === "error" && !retry)) return;
    this.set(ref, { status: "loading" });
    this.queue.push(ref);
    this.pump();
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const ref = this.queue.shift()!;
      this.running++;
      this.loader(ref)
        .then(
          (pages) => this.set(ref, { status: "ready", pages }),
          (e: unknown) => this.set(ref, { status: "error", error: e instanceof Error ? e.message : String(e) }),
        )
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}

const PagesContext = createContext<PagesSource | null>(null);

/** The cards under it can show their pages: `loader` is the host's (absent: the cards keep to their overview). */
export function PagesProvider({ loader, children }: { loader: PagesLoader | undefined; children: ReactNode }) {
  const ref = useRef(loader);
  ref.current = loader;
  const has = !!loader;
  // one source for the life of the list: a host that hands a new function each render does not empty it
  const source = useMemo(() => (has ? new PagesSource((r) => ref.current!(r)) : null), [has]);
  return <PagesContext.Provider value={source}>{children}</PagesContext.Provider>;
}

/** A card's pages: fetched once `wanted` is true. `available` is false when no host offers pages here. */
export function usePartPages(ref: PartPagesRef | undefined, wanted: boolean): { state: PagesState; available: boolean; retry(): void } {
  const source = useContext(PagesContext);
  const subscribe = useCallback((fn: () => void) => (source ? source.subscribe(fn) : () => undefined), [source]);
  useSyncExternalStore(subscribe, () => source?.snapshot() ?? 0, () => 0);
  const key = ref ? PagesSource.id(ref) : "";
  useEffect(() => {
    if (source && ref && wanted) source.want(ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key, wanted]);
  return {
    state: source ? source.state(ref) : { status: "idle" },
    available: !!source && !!ref,
    retry: () => ref && source?.want(ref, true),
  };
}

// ---------------------------------------------------------------- stepping

/** The neighbour of `current` in `list`, going round at the ends. */
export function stepIn<T>(list: readonly T[], current: T, delta: number): T {
  if (!list.length) return current;
  const i = list.indexOf(current);
  return list[(((i < 0 ? 0 : i) + delta) % list.length + list.length) % list.length];
}

/**
 * Swiping sideways turns a carousel: a touch or pen drag past 36 px that is
 * more sideways than up or down, and a trackpad's two-finger sideways scroll
 * (one turn per gesture). A mouse drag does nothing, so text stays selectable.
 */
export function useSwipe(onStep: (delta: number) => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const wheel = useRef({ sum: 0, at: 0, fired: 0 });
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      // the click that follows a swipe must not open the part
      e.currentTarget.addEventListener("click", (c) => (c.stopPropagation(), c.preventDefault()), { capture: true, once: true });
      onStep(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onWheel: (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || e.ctrlKey) return;
      const w = wheel.current;
      const now = e.timeStamp;
      if (now - w.at > 180) w.sum = 0;
      w.at = now;
      w.sum += e.deltaX;
      if (Math.abs(w.sum) > 60 && now - w.fired > 420) {
        w.fired = now;
        onStep(w.sum > 0 ? 1 : -1);
        w.sum = 0;
      }
    },
  };
}

// ---------------------------------------------------------------- controls

/** The stylesheet of the carousels: the page's fade (none with reduced motion), and controls that show on hover or focus (always where there is no hover). */
export const CAROUSEL_CSS = `
@keyframes pb-page-in { from { opacity: 0; transform: translateX(var(--pb-page-from, 6px)); } to { opacity: 1; transform: none; } }
.pb-page-in { animation: pb-page-in 140ms ease-out; }
.pb-reveal { opacity: 0; transition: opacity 120ms ease-out; }
.pb-reveal-host:hover .pb-reveal, .pb-reveal-host:focus-within .pb-reveal, .pb-reveal-host:focus-visible .pb-reveal { opacity: 1; }
@media (hover: none) { .pb-reveal { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pb-page-in { animation: none; } .pb-reveal { transition: none; } }
`;

export function CarouselStyles() {
  return <style data-pb="carousel">{CAROUSEL_CSS}</style>;
}

/** A small arrow of a carousel: named, with a tooltip, and never opening the card it is on. */
export function StepButton({ dir, label, onClick, size = 16, className, tabIndex, disabled }: { dir: "prev" | "next"; label: string; onClick: () => void; size?: number; className?: string; tabIndex?: number; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      tabIndex={tabIndex}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cx(
        "grid shrink-0 cursor-pointer place-items-center rounded-[3px] text-fg-muted hover:bg-active hover:text-fg",
        "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Icon name={dir === "prev" ? "chevron-left" : "chevron-right"} size={Math.round(size * 0.8)} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** "‹ 2/6 ›": the text carousel's pager. */
export function Pager({ index, count, what, onStep, tabIndex, size = 16 }: { index: number; count: number; /** "page" or "section", for the arrows' names. */ what: string; onStep: (delta: number) => void; tabIndex?: number; size?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <StepButton dir="prev" label={`Previous ${what}`} onClick={() => onStep(-1)} tabIndex={tabIndex} size={size} />
      <span aria-hidden className="min-w-[24px] text-center font-ui text-[10.5px] leading-none text-fg-muted tabular-nums">
        {index + 1}/{count}
      </span>
      <StepButton dir="next" label={`Next ${what}`} onClick={() => onStep(1)} tabIndex={tabIndex} size={size} />
    </span>
  );
}

/** Where the carousel is among its pages: one segment each, the current one in the accent. Decoration: the pager says the same in words. */
export function Segments({ index, count, className }: { index: number; count: number; className?: string }) {
  if (count < 2) return null;
  return (
    <span aria-hidden className={cx("flex shrink-0 items-center gap-[3px]", className)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cx("h-[2px] rounded-full outline-1 outline-contrast", i === index ? "w-4 bg-accent outline-contrast-active" : "w-2 bg-line-strong")} />
      ))}
    </span>
  );
}

const PAGE_NAME: Record<CardPageId, string> = { overview: "Overview", specs: "Specs", dimensions: "Dimensions", interfaces: "Interfaces", cad: "CAD", artifacts: "Artifacts" };

/**
 * The list's "turn all cards together" switch (design 07's first open
 * question): on, one pager turns every card to the same page, so one page
 * (the specs, say) reads across the parts; beside it the page they are on,
 * with its own arrows. A part without that page keeps to its overview.
 */
export function LinkPagesToggle({ store, compact }: { store: PagerStore; compact?: boolean }) {
  useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const on = store.isLinked;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <IconButton
        icon={on ? "link-2" : "unlink-2"}
        size={compact ? "sm" : undefined}
        label={on ? "The cards turn together: turn each card on its own" : "Turn all cards together, to compare one page across the parts"}
        pressed={on}
        onClick={() => store.setLinked(!on)}
      />
      {on && (
        <span role="group" aria-label="The page every card shows" className="flex items-center gap-0.5">
          <StepButton dir="prev" label="All cards: previous page" onClick={() => store.setShared(stepIn(CARD_PAGES, store.sharedPage, -1))} size={compact ? 18 : 22} />
          <span aria-live="polite" className={cx("text-center font-ui text-[10.5px] tracking-[0.06em] text-fg uppercase", compact ? "min-w-[62px]" : "min-w-[78px]")}>
            {PAGE_NAME[store.sharedPage]}
          </span>
          <StepButton dir="next" label="All cards: next page" onClick={() => store.setShared(stepIn(CARD_PAGES, store.sharedPage, 1))} size={compact ? 18 : 22} />
        </span>
      )}
    </span>
  );
}
