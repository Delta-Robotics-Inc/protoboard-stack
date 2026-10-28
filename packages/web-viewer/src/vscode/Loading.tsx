/**
 * What a viewer tab shows before it has a project to draw: a skeleton of the
 * tab's frame (the header and the hierarchy card, where they will be) and,
 * in the middle of what the canvas will be, the Protoboard mark with a comet
 * running round the chamfered triangle it sits in, the stage under it
 * ("Connecting to the project…", "Loading the project…").
 *
 * The comet is a string of dots that travel the (undrawn) triangle with CSS
 * transform keyframes (`pb-comet-travel` in styles.css), staggered by
 * animation delay, their opacity falling off exponentially toward the tail.
 * Transforms keep it smooth while the page is busy. With reduced motion the
 * dots stay where the first frame puts them.
 */
import type { CSSProperties } from "react";
import { HIERARCHY_WIDTH, panelState } from "@deltarobotics/uhd-viewer/components";
import { MARK_PATH } from "../logo-mark.js";
import { cometDots } from "./comet.js";
import { Logo } from "../Logo.js";

/** The mark with the comet round it, 100 px square. */
export function Comet() {
  return (
    <div className="relative size-[100px]" aria-hidden>
      {cometDots().map((d, k) => (
        <div
          key={k}
          className="pb-comet-dot"
          style={
            {
              width: d.size,
              height: d.size,
              marginLeft: -d.size / 2,
              marginTop: -d.size / 2,
              opacity: d.opacity,
              animationDelay: `${d.delay}s`,
              transform: `translate(${d.at[0].toFixed(2)}px, ${d.at[1].toFixed(2)}px)`,
              ...(k === 0 ? { boxShadow: "0 0 3px 0.5px var(--uhd-accent)" } : null),
            } as CSSProperties
          }
        />
      ))}
      {/* the "0" mark, in the text colour, on the triangle's incentre (below the box's middle) */}
      <svg width="38" height="38" viewBox="0 0 24 24" className="absolute top-[55%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-fg">
        <path fill="currentColor" d={MARK_PATH} />
      </svg>
    </div>
  );
}

/** A grey block that pulses, standing in for what will be there. */
function Block({ className, style }: { className: string; style?: CSSProperties }) {
  return <div className={`animate-pulse rounded-md bg-hover ${className}`} style={style} />;
}

/**
 * The tab before its project loads: the frame's skeleton and the comet, with
 * `message` under it. `hierarchy` is the tab's kept panel state (it says
 * whether the hierarchy card will be open).
 */
export function LoadingScreen({ message, hierarchy }: { message: string; hierarchy?: unknown }) {
  const kept = panelState(hierarchy, typeof window === "undefined" || window.innerWidth >= 640);
  const width = kept.open ? Math.max(HIERARCHY_WIDTH.min, Math.min(kept.width, typeof window === "undefined" ? kept.width : window.innerWidth * 0.5)) : 0;
  return (
    <div className="relative size-full overflow-hidden bg-background" data-loading="">
      <header aria-hidden className="absolute top-1 right-1 left-1 z-10 flex h-10 min-w-0 items-center gap-1 rounded-panel border border-line bg-surface px-1 shadow-panel outline outline-1 -outline-offset-1 outline-contrast">
        <Logo />
        <span className="mx-1 h-5 w-px bg-line" />
        <Block className="h-6 w-[84px]" />
        <Block className="h-6 w-14" />
        <Block className="h-6 w-14" />
        <span className="mx-1 h-5 w-px bg-line" />
        <Block className="h-4 w-36 max-[560px]:hidden" />
        <Block className="ml-auto h-4 w-44 max-[760px]:hidden" />
      </header>
      {width > 0 && (
        <div aria-hidden className="absolute top-12 bottom-1 left-1 flex flex-col gap-2.5 rounded-panel border border-line bg-surface p-3 shadow-panel outline outline-1 -outline-offset-1 outline-contrast" style={{ width }}>
          <div className="flex h-5 items-center justify-between">
            <Block className="h-3 w-24" />
            <Block className="size-5" />
          </div>
          <Block className="h-7 w-full" />
          {[0.7, 0.45, 0.55, 0.5, 0.62, 0.4, 0.58, 0.48].map((w, i) => (
            <div key={i} className="flex h-5 items-center gap-2" style={{ paddingLeft: i === 0 ? 0 : 16 }}>
              <Block className="size-3.5 shrink-0" />
              <Block className="h-3" style={{ width: `${w * 100}%` }} />
            </div>
          ))}
        </div>
      )}
      <div className="absolute top-11 right-0 bottom-0 grid place-items-center" style={{ left: width ? width + 4 : 0 }}>
        <div role="status" className="flex flex-col items-center gap-5 text-center">
          <Comet />
          <p className="m-0 font-ui text-[13px] font-medium text-fg">{message}</p>
        </div>
      </div>
    </div>
  );
}
