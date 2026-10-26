/**
 * How a part's revision is written in every view (beta test 1, decision D2):
 * "v4". Buttons ("Update to v4"), chips, lists, tooltips and the part
 * detail's Revisions tab all use it. The CLI's `id@rev` argument form
 * (`protoboard parts add bme688@4`) and the file formats are not views and
 * keep theirs.
 */
export const rev = (revision: number | string | undefined): string => (revision === undefined || revision === "" ? "v?" : `v${revision}`);

/** "v2 → v4": a pinned revision and the one it would move to. */
export const revChange = (from: number | string | undefined, to: number | string | undefined): string => `${rev(from)} → ${rev(to)}`;
