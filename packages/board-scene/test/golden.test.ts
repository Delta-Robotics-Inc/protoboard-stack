/**
 * The Airnode C3 fixture rendered to SVG and PNG, compared with stored goldens byte for byte. Regenerate after an
 * intended change with `UPDATE_GOLDEN=1 npx vitest run packages/board-scene/test/golden.test.ts` and look at the PNGs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { describeBoard, pngAvailable, svgToPng, type DescribeOptions } from "../src/index.js";

const dir = fileURLToPath(new URL("./golden/", import.meta.url));
const update = process.env.UPDATE_GOLDEN === "1";

const cases: [string, DescribeOptions][] = [
  ["airnode-c3-overview", {}],
  ["airnode-c3-region-sensor", { region: [-18, 4, 0, 14], corridors: [{ from: "pad:sensor/r_sda:2", to: "pad:sensor/ic:1", layer: "top" }] }],
];

describe("golden renders of the Airnode C3 fixture", () => {
  for (const [name, o] of cases) {
    it(`${name}: SVG and scene JSON`, () => {
      const r = describeBoard(airnodeC3(), o);
      if (update) {
        writeFileSync(`${dir}${name}.svg`, r.svg!);
        writeFileSync(`${dir}${name}.json`, `${JSON.stringify(r.scene, null, 1)}\n`);
      }
      expect(existsSync(`${dir}${name}.svg`), "golden missing: run with UPDATE_GOLDEN=1").toBe(true);
      expect(r.svg).toBe(readFileSync(`${dir}${name}.svg`, "utf8"));
      expect(`${JSON.stringify(r.scene, null, 1)}\n`).toBe(readFileSync(`${dir}${name}.json`, "utf8"));
    });
    it.runIf(pngAvailable())(`${name}: PNG`, () => {
      const svg = readFileSync(`${dir}${name}.svg`, "utf8");
      const png = Buffer.from(svgToPng(svg, { width: 640 }).png);
      if (update) writeFileSync(`${dir}${name}.png`, png);
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(png.equals(readFileSync(`${dir}${name}.png`)), "PNG differs from the golden").toBe(true);
    });
  }
});
