/**
 * The shipped themes on the synthetic Airnode C3, top and bottom, compared with the small renders each theme ships as
 * its examples (src/themes/<id>/examples/), byte for byte. Regenerate after an intended change with
 * `UPDATE_GOLDEN=1 npx vitest run packages/board-style/test/golden.test.ts` and look at every image.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { fillZones } from "@protoboardai/board-fill";
import { pngAvailable } from "@protoboardai/board-scene";
import { exampleDirs, planRestyle, renderPng, resolveStyle, searchExamples, SHIPPED_THEMES_DIR, shippedThemeIds } from "../src/index.js";

const update = process.env.UPDATE_GOLDEN === "1";

describe.runIf(pngAvailable())("golden renders of the shipped themes", () => {
  for (const theme of shippedThemeIds()) {
    it(`${theme}: Airnode C3 top and bottom`, () => {
      const doc = airnodeC3();
      const style = resolveStyle(doc, { userDir: false, theme });
      const plan = planRestyle(doc, style, { nameplate: { rev: "1", date: "2026-11-09" } });
      const fill = fillZones(plan.doc).fill;
      for (const side of ["top", "bottom"] as const) {
        const file = join(SHIPPED_THEMES_DIR, theme, "examples", `airnode-c3-${side}.png`);
        const png = Buffer.from(renderPng(plan.doc, style, { side, width: 480, fill }));
        if (update) writeFileSync(file, png);
        expect(existsSync(file), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
        expect(png.equals(readFileSync(file)), `${file} differs from the render`).toBe(true);
      }
    });
  }
  it("each theme's examples are captioned and found by tag", () => {
    for (const theme of shippedThemeIds()) {
      const hits = searchExamples(exampleDirs(theme).filter((d) => d.layer === "shipped"), { tags: ["airnode-c3"] });
      expect(hits.map((h) => h.file).sort(), theme).toEqual(["airnode-c3-bottom.png", "airnode-c3-top.png"]);
      expect(hits.every((h) => h.title && h.caption)).toBe(true);
    }
  });
});
