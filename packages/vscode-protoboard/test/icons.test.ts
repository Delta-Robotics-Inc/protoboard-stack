/**
 * The activity-bar icons (PB-916): Library and Project Parts carry the
 * Protoboard 0 as a corner badge, in the bottom-LEFT corner since beta test 1
 * (VS Code draws its own notification badge over the bottom-right). The badge
 * is the exact logo path (cloud.svg, the plain 0), scaled, with a knockout
 * mask around it so the glyph's strokes stop short of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const media = (name: string) => readFileSync(fileURLToPath(new URL(`../media/${name}`, import.meta.url)), "utf8");
const LOGO = /<path fill="currentColor" d="([^"]+)"/.exec(media("cloud.svg"))![1];
/** The logo's outline: its last sub-path, which the knockout mask strokes. */
const OUTLINE = LOGO.slice(LOGO.lastIndexOf("M"));
/** The outline's extent in the logo's own 24-unit box. */
const BOX = { x0: 5.643, x1: 18.357, y0: 2, y1: 22 };

describe.each(["library", "parts"])("the %s icon", (name) => {
  const svg = media(`${name}.svg`);
  const badge = /<path fill="currentColor" stroke="none" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)" d="([^"]+)"\/>/.exec(svg);

  it("carries the exact logo path as its badge, scaled", () => {
    expect(badge, "no badge path").toBeTruthy();
    expect(badge![4]).toBe(LOGO);
    expect(Number(badge![3])).toBe(0.5);
  });

  it("puts the badge in the bottom-left corner, inside the icon's box", () => {
    const [tx, ty, s] = [Number(badge![1]), Number(badge![2]), Number(badge![3])];
    const box = { x0: tx + BOX.x0 * s, x1: tx + BOX.x1 * s, y0: ty + BOX.y0 * s, y1: ty + BOX.y1 * s };
    // left half and bottom half, clear of the bottom-right corner where VS Code's notification badge sits
    expect(box.x1).toBeLessThan(12);
    expect(box.y0).toBeGreaterThanOrEqual(12);
    expect(box.x0).toBeGreaterThanOrEqual(1);
    expect(box.y1).toBeLessThanOrEqual(23);
    // the mirror of where it was (centred on x = 18.58): the same distance from the other edge
    expect((box.x0 + box.x1) / 2).toBeCloseTo(24 - 18.5785, 3);
  });

  it("knocks the glyph out around the badge with a mask at the same place", () => {
    const mask = new RegExp(`<mask id="ko-${name}"[^>]*>.*?<path transform="translate\\(([-\\d.]+) ([-\\d.]+)\\) scale\\(([\\d.]+)\\)" d="([^"]+)" fill="#000" stroke="#000" stroke-width="4"`).exec(svg);
    expect(mask, "no knockout mask").toBeTruthy();
    expect([mask![1], mask![2], mask![3]]).toEqual([badge![1], badge![2], badge![3]]);
    expect(mask![4]).toBe(OUTLINE);
    expect(svg).toContain(`<g mask="url(#ko-${name})">`);
    // the glyph is drawn in the theme's colour: VS Code tints the icon
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toMatch(/#(?!000|fff)[0-9a-f]{3,6}/i);
  });
});

describe("the Cloud icon", () => {
  it("stays the plain 0", () => {
    expect(media("cloud.svg")).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="${LOGO}"/></svg>\n`.trimEnd() + (media("cloud.svg").endsWith("\n") ? "\n" : ""));
  });
});
