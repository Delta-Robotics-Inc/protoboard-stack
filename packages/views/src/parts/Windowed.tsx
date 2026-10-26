/**
 * A list's window (PB-918): a card far from what is on screen is kept as an
 * empty box of its own size, and drawn again when the list scrolls near it,
 * so a list of several hundred parts scrolls like a short one. It works in a
 * grid, a column and a grouped page alike, since each card decides for
 * itself; the list's scroll position and height never change, because the
 * box keeps the size the card had.
 *
 * Where there is no IntersectionObserver (a test's DOM), every card is drawn.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@deltarobotics/uhd-viewer/components";

/** How far beyond the visible part of the list cards stay drawn. */
const MARGIN = "700px 0px";

type Seen = (visible: boolean) => void;
const observers = new WeakMap<Element | Document, { io: IntersectionObserver; seen: WeakMap<Element, Seen> }>();

/** One observer per scrolling list, shared by its cards. */
function observe(el: Element, fn: Seen): () => void {
  // the list scrolls inside a Radix viewport: the margin has to be measured against it, not the page
  const root = el.closest("[data-radix-scroll-area-viewport]");
  const key = root ?? document;
  let o = observers.get(key);
  if (!o) {
    const seen = new WeakMap<Element, Seen>();
    const io = new IntersectionObserver((entries) => entries.forEach((e) => seen.get(e.target)?.(e.isIntersecting)), { root, rootMargin: MARGIN });
    o = { io, seen };
    observers.set(key, o);
  }
  o.seen.set(el, fn);
  o.io.observe(el);
  return () => {
    o.io.unobserve(el);
    o.seen.delete(el);
  };
}

export interface WindowedProps {
  /** The card's height before it has been drawn once. */
  height: number;
  /** Drawn from the start (the first screenful), so the list does not open on empty boxes. */
  eager?: boolean;
  className?: string;
  children: ReactNode;
}

export function Windowed({ height, eager, className, children }: WindowedProps) {
  const can = typeof IntersectionObserver !== "undefined";
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(!can || !!eager);
  const size = useRef(height);
  useEffect(() => {
    const el = ref.current;
    if (!el || !can) return;
    return observe(el, (visible) => {
      // a card that holds the keyboard focus stays drawn, wherever the list is scrolled to
      if (!visible && el.contains(document.activeElement)) return;
      // remember the card's size as it leaves, so its box holds the same room
      if (!visible && el.firstElementChild) size.current = el.offsetHeight || size.current;
      setShown(visible);
    });
  }, [can]);
  return (
    <div ref={ref} data-windowed={shown ? "shown" : "away"} className={cx("min-w-0", className)} style={shown ? undefined : { height: size.current }}>
      {shown ? children : null}
    </div>
  );
}
