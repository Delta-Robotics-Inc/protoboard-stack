/** The layout screen's quiet markers, the timeline's mode lane window, the Checks tab's notes and the status line's clock. */
import { describe, expect, it } from "vitest";
import { dotSvg, markerLayerSvg } from "../../src/pcb/markers.js";
import type { PcbFinding } from "../../src/pcb/types.js";
import { gatherNotes } from "../../src/pcb/ui/panels.js";
import { clock } from "../../src/pcb/ui/shell.js";
import { laneWindow, type LaneBlock } from "../../src/pcb/ui/timeline.js";

let n = 0;
/** A finding at (x, y) screen pixels (the test's map is the identity). */
const F = (x: number, y: number, extra: Partial<PcbFinding> = {}): PcbFinding => ({ id: `f:t:${++n}`, check: "clearance", severity: "error", objects: [], location: { x, y }, message: "", ...extra });
const id = (p: { x: number; y: number }) => p;
const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;
const base = { width: 1000, height: 800, scale: 15 };

describe("markers", () => {
  it("draws the rest as quiet dots, the one in hand and the one hovered as full markers", () => {
    const fs = [F(100, 100), F(300, 100, { severity: "warning" }), F(500, 100, { id: "f:hand" }), F(700, 100, { id: "f:hover" })];
    const svg = markerLayerSvg(fs, id, { ...base, active: "f:hand", hover: "f:hover" });
    expect(count(svg, /class="marker dot"/g)).toBe(2);
    expect(count(svg, /class="marker hot"/g)).toBe(2);
    // a dot is small: a 3.4 px circle for an error, a diamond for a warning
    expect(svg).toContain(dotSvg("error"));
    expect(svg).toContain(dotSvg("warning"));
    expect(dotSvg("warning")).toContain("<polygon");
  });

  it("leaves open connections to their ratsnest line unless one is in hand", () => {
    const fs = [F(100, 100, { check: "unconnected" }), F(200, 100, { check: "unconnected", id: "f:open" })];
    const svg = markerLayerSvg(fs, id, { ...base, active: "f:open" });
    expect(count(svg, /class="marker dot"/g)).toBe(0);
    expect(count(svg, /class="marker hot"/g)).toBe(1);
  });

  it("merges dots that would touch into a numbered cluster colored by the worst", () => {
    const fs = [F(100, 100, { severity: "warning" }), F(104, 103), F(108, 99), F(400, 400)];
    const svg = markerLayerSvg(fs, id, base);
    expect(count(svg, /class="marker cluster"/g)).toBe(1);
    expect(svg).toMatch(/class="marker cluster" data-cluster="100,99,108,103"[^>]*><title>3 open items here: 2 errors, 1 warning\. Click to zoom in\.<\/title><circle [^>]*stroke="#ef4444"/);
    expect(count(svg, /class="marker dot"/g)).toBe(1);
  });

  it("counts by region when zoomed out, or when the board is dense", () => {
    const fs = Array.from({ length: 40 }, (_, i) => F(10 + (i % 8) * 30, 10 + Math.floor(i / 8) * 30, { severity: i % 3 ? "error" : "warning" }));
    const out = markerLayerSvg(fs, id, { ...base, scale: 4 });
    expect(count(out, /class="marker region"/g)).toBeGreaterThan(0);
    expect(count(out, /class="marker dot"/g) + count(out, /class="marker cluster"/g)).toBe(0);
    const dense = Array.from({ length: 300 }, (_, i) => F((i % 20) * 50, Math.floor(i / 20) * 50));
    expect(count(markerLayerSvg(dense, id, base), /class="marker region"/g)).toBeGreaterThan(0);
    // zoomed in on the same few, dots again
    expect(count(markerLayerSvg(fs.slice(0, 3), id, base), /class="marker region"/g)).toBe(0);
  });

  it("recedes in review and tags the item in hand with its measure", () => {
    const svg = markerLayerSvg([F(100, 100), F(300, 300, { id: "f:hand", measured: 22_800, required: 127_000 })], id, { ...base, active: "f:hand", quiet: true, tag: true });
    expect(svg).toMatch(/class="marker dot"[^>]*opacity="0.5"/);
    expect(svg).toContain("0.023 MM · ASKS 0.127");
  });

  it("skips what is off the canvas", () => {
    expect(markerLayerSvg([F(-100, 50), F(50, 2000)], id, base)).toBe("");
  });
});

describe("the timeline's mode lane", () => {
  const blocks = (k: number, on: number): LaneBlock[] => Array.from({ length: k }, (_, i) => ({ key: `b${i}`, label: `${i + 1} item`, seq: 1, tone: i === on ? "queue-on" : "queue" }));
  it("keeps every block when they fit", () => {
    expect(laneWindow(blocks(5, 0))).toEqual({ shown: blocks(5, 0), before: [], after: [] });
  });
  it("shows a window around the item in hand and counts the rest", () => {
    const w = laneWindow(blocks(30, 12));
    expect(w.shown).toHaveLength(7);
    expect(w.shown.some((b) => b.tone === "queue-on")).toBe(true);
    expect(w.before.length + w.shown.length + w.after.length).toBe(30);
    const end = laneWindow(blocks(30, 29));
    expect(end.shown.at(-1)?.key).toBe("b29");
    expect(end.after).toHaveLength(0);
  });
});

describe("the Checks tab's notes and the status line's clock", () => {
  it("gathers the checks that had no rule into one line", () => {
    expect(gatherNotes(["via_diameter not checked: no enabled via_diameter rule on the board", "hole_to_hole not checked: no enabled hole_to_hole rule on the board", "no netlist: pads have no nets"])).toEqual(["Not checked, no rule on the board: via size, hole to hole.", "no netlist: pads have no nets"]);
  });
  it("says an ISO time as the local clock and leaves other text alone", () => {
    expect(clock("2026-11-09T13:54:41.152Z")).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(clock("14:02:11")).toBe("14:02:11");
  });
});
