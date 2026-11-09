/**
 * Render a board to PNG headless (the agent's image path, from the command line).
 *
 *   npx tsx packages/views/bench/pcb-screen/render.ts --out <file.png> [--board <board folder>] [--width 1200]
 *     [--height 900] [--layers routing|all|top|fab|cu:top,silk:top,...] [--region x0,y0,x1,y1 (mm)] [--flip]
 *     [--net VBUS] [--select fp:power/ldo] [--grid 0.25] [--dpr 1]
 *
 * Without --board it renders the Airnode C3 fixture; --synth renders the performance script's synthetic 6-layer board.
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadBoardDir } from "../../../board/src/format.js";
import { airnodeC3 } from "../../../board/src/fixtures/airnode-c3.js";
import { createHeadlessRenderer } from "../../src/pcb/headless/render.js";
import { synthBoard } from "./synth.js";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    board: { type: "string" },
    synth: { type: "boolean" },
    width: { type: "string" },
    height: { type: "string" },
    layers: { type: "string" },
    region: { type: "string" },
    flip: { type: "boolean" },
    net: { type: "string" },
    select: { type: "string" },
    grid: { type: "string" },
    dpr: { type: "string" },
    active: { type: "string" },
  },
});
if (!values.out) throw new Error("give --out <file.png>");
const doc = values.board ? loadBoardDir(values.board).doc : values.synth ? synthBoard() : airnodeC3();
const r = await createHeadlessRenderer();
try {
  const layers = values.layers ? (["all", "routing", "top", "fab"].includes(values.layers) ? (values.layers as "all") : values.layers.split(",")) : undefined;
  const region = values.region ? values.region.split(",").map((v) => Math.round(Number(v) * 1e6)) : undefined;
  const t0 = Date.now();
  const png = await r.render(doc, {
    width: Number(values.width ?? 1200),
    height: Number(values.height ?? 900),
    dpr: Number(values.dpr ?? 1),
    ...(layers ? { layers } : {}),
    ...(region ? { region: { minX: region[0], minY: region[1], maxX: region[2], maxY: region[3] } } : {}),
    ...(values.flip ? { flip: true } : {}),
    ...(values.net ? { highlightNets: values.net.split(",") } : {}),
    ...(values.select ? { selection: values.select.split(",") } : {}),
    ...(values.grid ? { grid: Number(values.grid) } : {}),
    ...(values.active ? { active: values.active as "top" } : {}),
    origin: true,
  });
  writeFileSync(values.out, png);
  console.log(`${values.out}: ${png.length} bytes in ${Date.now() - t0} ms (${r.backend.kind})`);
} finally {
  await r.close();
}
