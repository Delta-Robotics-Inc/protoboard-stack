/**
 * A part's status as the views draw it (PB-932): a dot in the state's colour
 * with a tooltip saying what the state means, and optionally its name. The
 * colours come from part-status.ts through `PartStatusStyles`, which a shell
 * renders once inside its themed root.
 */
import { cx } from "@deltarobotics/uhd-viewer/components";
import { BLANK_BLOCK_TEXT, PART_STATUS_CSS, PART_TRUST_STATES, PART_TRUST_TEXT, partStatusVar, partTrustTooltip, type PartTrust } from "./part-status.js";

/** The status colours' stylesheet: once per page, anywhere inside the themed root. */
export function PartStatusStyles() {
  return <style data-pb="part-status">{PART_STATUS_CSS}</style>;
}

export interface PartStatusDotProps {
  trust: PartTrust;
  /** Why the part has this state ("independent audit recorded"), for the tooltip. */
  basis?: string;
  /** A blank block (no part chosen yet): the state's colour as a dashed ring, named "Blank block". */
  blank?: boolean;
  /** Write the state's name beside the dot. */
  label?: boolean;
  size?: number;
  className?: string;
}

/** The dot (and, with `label`, the state's name), naming itself in a tooltip. */
export function PartStatusDot({ trust, basis, blank, label, size = 8, className }: PartStatusDotProps) {
  const tip = partTrustTooltip(trust, basis, blank);
  return (
    <span role="img" aria-label={tip} data-tooltip={tip} data-tooltip-clamp="4" data-status={trust} data-blank={blank ? "" : undefined} className={cx("inline-flex shrink-0 items-center gap-1.5 align-middle", className)}>
      {blank ? (
        // no part chosen: the same gray, as a dashed ring one pixel larger so it reads at this size
        <span aria-hidden className="box-border shrink-0 rounded-full border-[1.5px] border-dashed" style={{ width: size + 2, height: size + 2, borderColor: `var(${partStatusVar(trust)})` }} />
      ) : (
        <span aria-hidden className="shrink-0 rounded-full outline outline-1 outline-offset-1 outline-[var(--pb-status-ring,transparent)]" style={{ width: size, height: size, background: `var(${partStatusVar(trust)})` }} />
      )}
      {label && <span className="text-[11.5px] leading-none whitespace-nowrap text-fg-muted">{blank ? BLANK_BLOCK_TEXT.label : PART_TRUST_TEXT[trust].label}</span>}
    </span>
  );
}

/** The four states with their meanings: the key under a list of parts. */
export function PartStatusLegend({ className }: { className?: string }) {
  return (
    <ul aria-label="Part status" className={cx("flex flex-wrap gap-x-4 gap-y-1.5", className)}>
      {PART_TRUST_STATES.map((t) => (
        <li key={t} className="flex items-center">
          <PartStatusDot trust={t} label />
        </li>
      ))}
    </ul>
  );
}
