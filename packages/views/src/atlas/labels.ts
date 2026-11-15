/**
 * Which Atlas labels are drawn: pure functions (no canvas), so the tests can
 * check them directly: the zoom tiers (`fileLabelAlpha`, `groupTitled`), the
 * folder titles (`folderTitles`), truncation and placement.
 *
 * A label is cut to a sensible length with an ellipsis (`truncateLabel`; the
 * full name stays in the inspector, and on the hovered node). Labels are then
 * placed greedily in screen space (`placeLabels`): in priority order, each
 * one is skipped when its box meets a box already placed (or a reserved one,
 * such as the minimap), so two labels never overlap. A label's width is
 * measured only when its anchor (a sliver at its center that it certainly
 * covers) is still clear, so a label that cannot be placed is rarely measured.
 * A label may offer a smaller box to fall back on (`alt`: a node's name
 * without its chip) when its whole box does not fit.
 */

/** A screen-space box, CSS pixels. */
export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The longest node label drawn, in characters (the hovered node's is drawn whole). */
export const LABEL_MAX_CHARS = 26;

/**
 * `text` cut to `max` characters (code points), ending in an ellipsis: at the
 * last word break when one falls in the last 40 % of the cut, with trailing
 * spaces and separators dropped. Shorter text is returned as it is.
 */
export function truncateLabel(text: string, max = LABEL_MAX_CHARS): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  if (max <= 1) return "…";
  let cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  if (space >= Math.ceil((max - 1) * 0.6)) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,;:.\-_/(]+$/u, "")}…`;
}

/** A path cut to `max` characters from its start, so its end (the folder's own name) stays: "…/frame/out". */
export function truncatePath(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  if (max <= 1) return "…";
  const tail = chars.slice(chars.length - (max - 1)).join("");
  const slash = tail.indexOf("/");
  // from a folder boundary when one falls in the first 40 %
  return `…${slash >= 0 && slash < (max - 1) * 0.4 ? tail.slice(slash) : tail}`;
}

/**
 * Labels by zoom, in three tiers, decided by how big things are on screen:
 * - far out, nothing but the group titles that are large enough;
 * - in the middle, the same: group titles only (a kind, a folder, a module's
 *   cluster), each once its group spans `groupMinPx` on screen;
 * - close in, file labels fade in as a node's on-screen radius grows from
 *   `fileFromPx` to `fileFullPx` (a bounded ramp: fully shown past it).
 * The hovered or selected node is always labeled. A file's chip (its version
 * or extension, `chipText`) shows at the closest tier, once its label is
 * fully shown (`fileFullPx`), or on the focus. A group title sits on its
 * group's center far out, and above the group once a file of the base size
 * spans `titleAbovePx` on screen (`titleAbove`).
 */
export const LABEL_ZOOM = { fileFromPx: 5.5, fileFullPx: 9, groupMinPx: 90, titleAbovePx: 3 } as const;

/** A file label's opacity for a node of on-screen radius `rpx` (CSS pixels): 0 up to `fileFromPx`, 1 from `fileFullPx`. */
export function fileLabelAlpha(rpx: number): number {
  const t = (rpx - LABEL_ZOOM.fileFromPx) / (LABEL_ZOOM.fileFullPx - LABEL_ZOOM.fileFromPx);
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Whether a group spanning `spanPx` on screen (its larger side, CSS pixels) gets its title. */
export const groupTitled = (spanPx: number): boolean => spanPx >= LABEL_ZOOM.groupMinPx;

/** Whether group titles sit above their groups (closer in) rather than on their centers (far out): `basePx` is a base-size file's on-screen radius. */
export const titleAbove = (basePx: number): boolean => basePx >= LABEL_ZOOM.titleAbovePx;

/** Whether a node's label carries its chip: at the closest tier (`rpx`, its on-screen radius) or when it is the focus. */
export const chipShown = (rpx: number, focus: boolean): boolean => focus || rpx >= LABEL_ZOOM.fileFullPx;

/**
 * What a node's chip says after its name: its version when the Atlas data
 * has one for it, else its file's extension in capitals (STEP, PNG); nothing
 * when it has neither (a module, a folder).
 */
export function chipText(n: { version?: unknown; file?: { ext: string } }): string {
  if (typeof n.version === "string" && n.version.trim()) return n.version.trim();
  const ext = n.file?.ext.trim();
  return ext ? ext.toUpperCase() : "";
}

/** A folder's last segment ("docs/renders/after" is "after"; the project folder is ""). */
export function leafName(folder: string): string {
  const parts = folder.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * What each folder title draws: its last segment, and, only when another
 * folder shown shares that last segment, its parent segment before it (to be
 * drawn dimmer). The full path is the inspector's and the tooltip's.
 */
export function folderTitles(folders: readonly string[]): Map<string, { parent: string; leaf: string }> {
  const count = new Map<string, number>();
  for (const f of folders) count.set(leafName(f), (count.get(leafName(f)) ?? 0) + 1);
  const out = new Map<string, { parent: string; leaf: string }>();
  for (const f of folders) {
    const parts = f.split("/").filter(Boolean);
    const leaf = leafName(f);
    const shared = (count.get(leaf) ?? 0) > 1;
    out.set(f, { parent: shared && parts.length > 1 ? `${parts[parts.length - 2]}/` : "", leaf });
  }
  return out;
}

/** Whether two boxes share any area (touching edges do not). */
export const overlaps = (a: LabelBox, b: LabelBox): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * How much a label matters, highest first: the hovered or selected node, then
 * the group labels (Kind and Folder), then the focus's neighbors and the
 * search's matches, then the members of a selected group, then the rest.
 * Within a tier, project modules come before other nodes, then the higher
 * degree.
 */
export const LABEL_TIER = { focus: 5, group: 4, near: 3, member: 2, rest: 1 } as const;

export function labelPriority(tier: number, hub: boolean, degree: number): number {
  return tier * 1e6 + (hub ? 5e5 : 0) + Math.min(Math.max(degree, 0), 99_999);
}

export interface LabelCandidate<T> {
  priority: number;
  /** A box the label certainly covers (a sliver at its center), tested before it is measured. */
  anchor: LabelBox;
  /** The label's whole box: may measure text; called at most once, and only when the anchor is clear. */
  box(): LabelBox;
  /** A smaller box to fall back on when the whole one does not fit (a name without its chip). */
  alt?: () => LabelBox;
  item: T;
}

/**
 * Greedy placement: candidates in priority order (equal priorities keep their
 * order), each placed unless its box meets a placed or reserved box (then its
 * `alt` box, if it has one, is tried: `alt` is true in what is returned).
 * Returns what was placed, in placement order.
 */
export function placeLabels<T>(candidates: readonly LabelCandidate<T>[], reserved: readonly LabelBox[] = []): { item: T; box: LabelBox; alt: boolean }[] {
  const order = candidates.map((c, i) => ({ c, i })).sort((a, b) => b.c.priority - a.c.priority || a.i - b.i);
  const placed: LabelBox[] = [...reserved];
  const out: { item: T; box: LabelBox; alt: boolean }[] = [];
  const clear = (box: LabelBox) => {
    for (const p of placed) if (overlaps(p, box)) return false;
    return true;
  };
  for (const { c } of order) {
    if (!clear(c.anchor)) continue;
    let box = c.box();
    let alt = false;
    if (!clear(box)) {
      if (!c.alt) continue;
      box = c.alt();
      alt = true;
      if (!clear(box)) continue;
    }
    placed.push(box);
    out.push({ item: c.item, box, alt });
  }
  return out;
}
