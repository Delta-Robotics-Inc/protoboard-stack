/**
 * The Protoboard mark (the "0" of PR0TOBOARD, PB-916) and wordmark. Its
 * colour is the theme's accent: orange in the Protoboard theme, the host's
 * accent anywhere else (PB-900: the brand colour is never hard-coded, not
 * even here).
 */
import { MARK_PATH } from "./logo-mark.js";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex h-8 shrink-0 items-center gap-2 px-1.5 select-none" aria-label="Protoboard">
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" className="text-accent">
        <path fill="currentColor" d={MARK_PATH} />
      </svg>
      {!compact && <span className="font-label text-[13px] leading-none tracking-[0.08em] text-fg max-[900px]:hidden">PROTOBOARD</span>}
    </span>
  );
}

/** The mark as a standalone SVG in one colour (the page's favicon, in the theme's accent). */
export function markSvg(color: string): string {
  const c = color.replace(/[^#a-zA-Z0-9(),.% ]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="${c}" d="${MARK_PATH}"/></svg>`;
}
