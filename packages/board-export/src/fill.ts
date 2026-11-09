/**
 * Which zone fill an export draws: the fill handed in or cached beside the board when it is current (an imported fill
 * is the source tool's last fill), else a fill computed now by `@protoboardai/board-fill`. A fill that is stale and
 * could not be recomputed is still drawn when asked, and marked stale, which blocks a ready package.
 */
import { loadZoneFill, recordsOfKind, zoneFillIsCurrent, type BoardDocument, type DerivedZoneFill, type ZoneFillEntry, type ZoneFillSource } from "@protoboardai/board";
import { fillZones } from "@protoboardai/board-fill";

export interface ResolvedFill {
  /** Who produced the fill drawn. */
  source: ZoneFillSource;
  /** The fill's input hash equals the board's: not stale. */
  current: boolean;
  fills: readonly ZoneFillEntry[];
  /** How the fill was chosen, in plain words. */
  note: string;
}

export interface FillChoice {
  /** A fill to use (an importer's `fill`, or a computed one). */
  fill?: DerivedZoneFill;
  /** A board folder whose cached fill (`zone-fill.json` in the build folder) is read when no fill is given. */
  boardDir?: string;
  projectRoot?: string;
  /** `auto` (default): compute when no current fill is at hand; `always`: compute even then; `never`: do not compute. */
  compute?: "auto" | "always" | "never";
}

/** The fill to draw, or undefined for a board with no zones and no fill. */
export function resolveFill(doc: BoardDocument, choice: FillChoice = {}): ResolvedFill | undefined {
  const zones = recordsOfKind(doc, "zone").length;
  let given = choice.fill;
  let where = "given";
  if (!given && choice.boardDir) {
    const loaded = loadZoneFill(choice.boardDir, doc, choice.projectRoot);
    if (loaded) {
      given = loaded.fill;
      where = "cached beside the board";
    }
  }
  if (!zones && !(given && given.fills.length)) return undefined;
  const mode = choice.compute ?? "auto";
  if (given && mode !== "always" && zoneFillIsCurrent(given, doc)) return { source: given.source, current: true, fills: given.fills, note: `${given.source} fill ${where}, current` };
  if (mode !== "never" && zones) {
    const r = fillZones(doc);
    const why = given ? `the ${given.source} fill ${where} is stale` : "no fill was at hand";
    return { source: "computed", current: true, fills: r.fill.fills, note: mode === "always" ? "computed now (asked)" : `computed now: ${why}` };
  }
  if (given) return { source: given.source, current: zoneFillIsCurrent(given, doc), fills: given.fills, note: `${given.source} fill ${where}, stale (not recomputed)` };
  return { source: "computed", current: false, fills: [], note: "no fill at hand and computing was turned off: zones are drawn empty" };
}
