/**
 * The synthetic device from the provider's tests (test/fixture.ts): a board
 * on four insert bosses and a pouch cell in a two-part printed case. The
 * case is generated and exported for the 30 × 24 mm board; then the circuit
 * provider's next export grows the board to 30 × 26 mm. The case no longer
 * holds it: `protoboard check` reports the fit failure. The board is the
 * given; the agent has to make the enclosure fit it again.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineEvalCase, runSteps } from "@protoboardai/core";
import { BOARD, boardBoxes, boardManifest, glbBoxes, writeFixture } from "../../test/fixture.ts";

const OUT = "src/boards/mainboard/out";
const GROWN = { w: BOARD.w, h: BOARD.h + 2 };

export default defineEvalCase({
  title: "Make the enclosure fit a board that grew 2 mm",
  skills: ["enclosure-cad"],
  tags: ["cad", "fit"],
  requires: ["python-build123d"],
  fixture: {
    recipe: async (dir, ctx) => {
      writeFixture(dir);
      await runSteps(
        [
          { protoboard: ["run", "cad:generate", "--module", "fixture-case"], expect: { status: "succeeded" } },
          { protoboard: ["run", "cad:export", "--module", "fixture-case"], expect: { status: "succeeded" } },
          { remove: "operations" },
        ],
        ctx,
      );
      // the board's next revision, as its circuit provider would export it
      writeFileSync(join(dir, OUT, "board.glb"), glbBoxes(boardBoxes(GROWN.w, GROWN.h)));
      const m = boardManifest();
      m.features.outline.area_mm2 = GROWN.w * GROWN.h;
      writeFileSync(join(dir, OUT, "board.manifest.json"), JSON.stringify(m, null, 2));
    },
  },
  instruction:
    "The mainboard's latest export (src/boards/mainboard/out) is 2 mm longer in Y than before, and `npx protoboard check` now reports that the case (src/enclosures/case, module fixture-case) does not hold it. The board is final: change the enclosure, not the board, so that check reports no errors and nothing stale for the case, and its standard outputs are fresh. Say what was wrong and what you changed.",
  tools: { read: true, edit: true, commands: ["npx protoboard *"] },
  budget: { turns: 25, seconds: 1200, usd: 3 },
  graders: [
    { id: "fit-fixed", kind: "fault", code: "ENCLOSURE_NOT_CONTAINED", seeded: ["ENCLOSURE_NOT_CONTAINED", "ENCLOSURE_STALE"] },
    { id: "case-clean", kind: "check", maxErrors: 0, absent: ["ENCLOSURE_COLLISION", "ENCLOSURE_STALE", "ENCLOSURE_NOT_GENERATED"], ran: ["ext:@protoboardai/ext-enclosure-cad/cad:check"] },
    { id: "outputs-valid", kind: "outputs", module: "fixture-case" },
    { id: "base-printable", kind: "format", file: "src/enclosures/case/out/base.stl", format: "stl" },
    { id: "lid-printable", kind: "format", file: "src/enclosures/case/out/lid.3mf", format: "3mf" },
    { id: "body-regenerated", kind: "digest", file: "src/enclosures/case/out/body.step", changed: true },
    { id: "board-unchanged", kind: "digest", file: `${OUT}/board.glb`, changed: false },
    { id: "manifest-unchanged", kind: "digest", file: `${OUT}/board.manifest.json`, changed: false },
    {
      id: "everything-clear",
      kind: "facts",
      file: "src/enclosures/case/build123d/fixture-case.report.json",
      facts: [
        { path: "fit.bodies[key=board].status", equals: "clear" },
        { path: "fit.bodies[key=battery].status", equals: "clear" },
        { path: "problems", length: 0 },
      ],
    },
  ],
  solution: [
    { protoboard: ["check"], expect: { exit: 1 } },
    { protoboard: ["run", "cad:generate", "--module", "fixture-case"], expect: { status: "succeeded" } },
    { protoboard: ["run", "cad:export", "--module", "fixture-case"], expect: { status: "succeeded" } },
    { protoboard: ["check"] },
    { say: "The case was generated for the 24 mm board, so the 26 mm board reached outside the cavity and into the base. The cavity follows its contents, so I regenerated the case (cad:generate) and exported it (cad:export); check is clean and the fit report shows the board and cell clear." },
  ],
});
