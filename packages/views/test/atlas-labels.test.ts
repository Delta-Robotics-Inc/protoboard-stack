/**
 * Which Atlas labels are drawn (atlas/labels.ts): truncation, the priority
 * order, the chips, and the greedy screen-space culling that keeps labels
 * apart (falling back to a name without its chip) and measures as little as
 * it can.
 */
import { describe, expect, it } from "vitest";
import { LABEL_MAX_CHARS, LABEL_TIER, LABEL_ZOOM, chipShown, chipText, fileLabelAlpha, titleAbove, folderTitles, groupTitled, labelPriority, leafName, overlaps, placeLabels, truncateLabel, truncatePath, type LabelBox, type LabelCandidate } from "../src/atlas/labels.js";

const box = (x0: number, y0: number, x1: number, y1: number): LabelBox => ({ x0, y0, x1, y1 });

/** A candidate whose box is `b`, anchored at its center column, counting how often it is measured. */
function cand(name: string, priority: number, b: LabelBox, measured: string[]): LabelCandidate<string> {
  const cx = (b.x0 + b.x1) / 2;
  return {
    priority,
    anchor: box(cx - 1, b.y0, cx + 1, b.y1),
    box: () => {
      measured.push(name);
      return b;
    },
    item: name,
  };
}

describe("truncateLabel", () => {
  it("keeps short text as it is", () => {
    expect(truncateLabel("frame")).toBe("frame");
    expect(truncateLabel("x".repeat(LABEL_MAX_CHARS))).toBe("x".repeat(LABEL_MAX_CHARS));
  });

  it("cuts long text to at most the limit, at a word break, with an ellipsis", () => {
    const long = "Clear heat-shrink sleeve for the receiver, about 15 mm flat width";
    const cut = truncateLabel(long);
    expect(cut).toBe("Clear heat-shrink sleeve…");
    expect([...cut].length).toBeLessThanOrEqual(LABEL_MAX_CHARS);
    expect(truncateLabel(long, 12)).toBe("Clear heat…");
  });

  it("cuts mid-word when no break is near the end, and drops trailing separators", () => {
    expect(truncateLabel("abcdefghijklmnopqrstuvwxyz0123", 10)).toBe("abcdefghi…");
    expect(truncateLabel("flight-controller-mount", 8)).toBe("flight…");
    expect(truncateLabel("anything", 1)).toBe("…");
  });

  it("counts code points, never splitting a surrogate pair", () => {
    const text = "😀".repeat(30);
    const cut = truncateLabel(text, 10);
    expect([...cut].length).toBe(10);
    expect(cut.endsWith("😀…")).toBe(true);
  });
});

describe("truncatePath", () => {
  it("keeps the end of a long folder, from a folder boundary when one is near", () => {
    expect(truncatePath("DOCS", 32)).toBe("DOCS");
    expect(truncatePath("SRC/MODULES/FRAME/OUT", 12)).toBe("…/FRAME/OUT");
    // no boundary near the start of what is kept: the last characters as they are
    expect(truncatePath("SRC/MODULES/FLIGHT-CONTROLLER/OUT/RENDERS", 24)).toBe("…-CONTROLLER/OUT/RENDERS");
    expect([...truncatePath("a/".repeat(40), 20)].length).toBeLessThanOrEqual(20);
  });
});

describe("labelPriority", () => {
  it("orders tiers first, then modules, then degree", () => {
    const focus = labelPriority(LABEL_TIER.focus, false, 0);
    const group = labelPriority(LABEL_TIER.group, false, 999);
    const near = labelPriority(LABEL_TIER.near, false, 0);
    const hub = labelPriority(LABEL_TIER.rest, true, 1);
    const busy = labelPriority(LABEL_TIER.rest, false, 50_000);
    const quiet = labelPriority(LABEL_TIER.rest, false, 2);
    expect(focus).toBeGreaterThan(group);
    expect(group).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(hub);
    expect(hub).toBeGreaterThan(busy);
    expect(busy).toBeGreaterThan(quiet);
    // a huge degree never crosses a tier
    expect(labelPriority(LABEL_TIER.rest, true, 1e9)).toBeLessThan(near);
  });
});

describe("placeLabels", () => {
  it("overlaps: shared area only, touching edges do not count", () => {
    expect(overlaps(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
    expect(overlaps(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(overlaps(box(0, 0, 10, 10), box(0, 10, 10, 20))).toBe(false);
  });

  it("places by priority and skips a label that meets one placed: the higher one wins whatever the input order", () => {
    const measured: string[] = [];
    const placed = placeLabels([cand("low", 1, box(0, 0, 100, 12), measured), cand("high", 9, box(50, 4, 150, 16), measured), cand("apart", 5, box(0, 40, 100, 52), measured)]);
    expect(placed.map((p) => p.item)).toEqual(["high", "apart"]);
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) expect(overlaps(placed[a]!.box, placed[b]!.box)).toBe(false);
  });

  it("keeps the input order between equal priorities", () => {
    const measured: string[] = [];
    const placed = placeLabels([cand("first", 1, box(0, 0, 100, 12), measured), cand("second", 1, box(10, 0, 110, 12), measured)]);
    expect(placed.map((p) => p.item)).toEqual(["first"]);
  });

  it("never places over a reserved box (the minimap)", () => {
    const measured: string[] = [];
    const placed = placeLabels([cand("under", 9, box(0, 0, 100, 12), measured), cand("clear", 1, box(0, 50, 100, 62), measured)], [box(40, -10, 60, 20)]);
    expect(placed.map((p) => p.item)).toEqual(["clear"]);
  });

  it("measures a label only when its anchor is clear, and each at most once", () => {
    const measured: string[] = [];
    placeLabels([
      cand("a", 3, box(0, 0, 100, 12), measured),
      // its center column is inside "a": skipped without measuring
      cand("b", 2, box(30, 2, 70, 14), measured),
      // its center is clear but its box is not: measured, then skipped
      cand("c", 1, box(90, 0, 200, 12), measured),
    ]);
    expect(measured).toEqual(["a", "c"]);
  });

  it("on a crowded line, keeps every label apart", () => {
    const measured: string[] = [];
    const cands = Array.from({ length: 200 }, (_, i) => cand(`n${i}`, i % 7, box(i * 9, (i % 5) * 4, i * 9 + 60, (i % 5) * 4 + 12), measured));
    const placed = placeLabels(cands);
    expect(placed.length).toBeGreaterThan(5);
    expect(placed.length).toBeLessThan(200);
    for (let a = 0; a < placed.length; a++) for (let b = a + 1; b < placed.length; b++) expect(overlaps(placed[a]!.box, placed[b]!.box)).toBe(false);
    expect(new Set(measured).size).toBe(measured.length);
  });

  it("a label that does not fit whole falls back to its alt box (its name without the chip)", () => {
    const measured: string[] = [];
    const wide = { ...cand("chip", 1, box(0, 20, 200, 32), measured), alt: () => box(0, 20, 80, 32) };
    const placed = placeLabels([cand("block", 9, box(120, 18, 220, 34), measured), wide]);
    expect(placed.map((p) => [p.item, p.alt])).toEqual([["block", false], ["chip", true]]);
    expect(placed[1]!.box).toEqual(box(0, 20, 80, 32));
    // with room, the whole box
    expect(placeLabels([wide])[0]!.alt).toBe(false);
  });
});

describe("labels by zoom", () => {
  it("a file label fades in over a bounded range of on-screen radius", () => {
    expect(fileLabelAlpha(0)).toBe(0);
    expect(fileLabelAlpha(LABEL_ZOOM.fileFromPx)).toBe(0);
    const mid = fileLabelAlpha((LABEL_ZOOM.fileFromPx + LABEL_ZOOM.fileFullPx) / 2);
    expect(mid).toBeCloseTo(0.5, 9);
    expect(fileLabelAlpha(LABEL_ZOOM.fileFullPx)).toBe(1);
    // bounded: never past 1, however close in
    expect(fileLabelAlpha(1e6)).toBe(1);
  });

  it("a group gets its title once it spans enough of the screen", () => {
    expect(groupTitled(LABEL_ZOOM.groupMinPx - 1)).toBe(false);
    expect(groupTitled(LABEL_ZOOM.groupMinPx)).toBe(true);
  });

  it("folder titles: the last segment; the parent only for two folders of one name", () => {
    expect(leafName("docs/renders/after")).toBe("after");
    expect(leafName("")).toBe("");
    const t = folderTitles(["docs/renders/after", "docs/renders/before", "cad/after", "firmware", ""]);
    expect(t.get("docs/renders/after")).toEqual({ parent: "renders/", leaf: "after" });
    expect(t.get("cad/after")).toEqual({ parent: "cad/", leaf: "after" });
    expect(t.get("docs/renders/before")).toEqual({ parent: "", leaf: "before" });
    expect(t.get("firmware")).toEqual({ parent: "", leaf: "firmware" });
    expect(t.get("")).toEqual({ parent: "", leaf: "" });
  });

  it("chips: shown at the closest tier or on the focus; the version when there is one, else the extension in capitals, else nothing", () => {
    expect(chipShown(LABEL_ZOOM.fileFullPx - 0.1, false)).toBe(false);
    expect(chipShown(LABEL_ZOOM.fileFullPx, false)).toBe(true);
    expect(chipShown(1, true)).toBe(true);
    expect(chipText({ file: { ext: "step" } })).toBe("STEP");
    expect(chipText({ file: { ext: "png" }, version: "v1.2.0" })).toBe("v1.2.0");
    expect(chipText({ version: "  " })).toBe("");
    expect(chipText({})).toBe("");
    expect(chipText({ file: { ext: "" } })).toBe("");
  });

  it("group titles sit on the group far out and above it once a base-size file spans titleAbovePx", () => {
    expect(titleAbove(LABEL_ZOOM.titleAbovePx - 0.01)).toBe(false);
    expect(titleAbove(LABEL_ZOOM.titleAbovePx)).toBe(true);
  });
});
