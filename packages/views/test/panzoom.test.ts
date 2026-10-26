/** The drawing views' pan and zoom (drawing/usePanZoom.ts): the fit and the zoom as plain arithmetic. */
import { describe, expect, it } from "vitest";
import { fitView, viewBoxOf, zoomAbout } from "../src/drawing/usePanZoom.js";

describe("pan and zoom of a drawing", () => {
  it("fits a drawing whole in the host, with a margin", () => {
    const v = fitView([0, 0, 100, 50], 1000, 500, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(v.cx).toBe(50);
    expect(v.cy).toBe(25);
    expect(v.s).toBeCloseTo(9.6);
  });
  it("fits between the floating panels: the drawing's centre moves to the middle of what they leave clear", () => {
    const v = fitView([0, 0, 100, 100], 1400, 800, { left: 200, right: 360, top: 60, bottom: 60 });
    const clear = Math.min((1400 - 560) / 100, (800 - 120) / 100) * 0.96;
    expect(v.s).toBeCloseTo(clear);
    // the drawing's centre is drawn at the clear area's centre (x = 200 + 840 / 2)
    const screenX = 1400 / 2 + (50 - v.cx) * v.s;
    expect(screenX).toBeCloseTo(620);
  });
  it("never fits into less than a third of a small host: the drawing stays under its panels instead", () => {
    const v = fitView([0, 0, 100, 100], 400, 300, { left: 200, right: 360, top: 60, bottom: 60 });
    // 400 wide less 560 of panels: a third of the width (133 px) is what the drawing gets, not nothing
    expect(v.s).toBeCloseTo((400 / 3 / 100) * 0.96);
  });
  it("zooms about a point: the drawing point under it stays put", () => {
    const v = { cx: 10, cy: 20, s: 4 };
    const [w, h] = [800, 600];
    const at = (vv: typeof v, x: number, y: number) => [vv.cx + (x - w / 2) / vv.s, vv.cy + (y - h / 2) / vv.s];
    const z = zoomAbout(v, 2.5, 600, 150, w, h, [0.1, 100]);
    expect(z.s).toBe(10);
    expect(at(z, 600, 150)[0]).toBeCloseTo(at(v, 600, 150)[0]);
    expect(at(z, 600, 150)[1]).toBeCloseTo(at(v, 600, 150)[1]);
  });
  it("keeps the zoom between its limits", () => {
    expect(zoomAbout({ cx: 0, cy: 0, s: 4 }, 1000, 0, 0, 100, 100, [1, 40]).s).toBe(40);
    expect(zoomAbout({ cx: 0, cy: 0, s: 4 }, 0.001, 0, 0, 100, 100, [1, 40]).s).toBe(1);
  });
  it("writes the view as the drawing's viewBox", () => {
    expect(viewBoxOf({ cx: 50, cy: 25, s: 10 }, 1000, 500)).toBe("0 0 100 50");
  });
});
