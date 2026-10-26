/**
 * The IMU tile board's first build (test/fixtures/imu-tile: modelled, never
 * generated), with a seeded fault in the model: the SCL pull-up r4 is placed
 * but its second pin is on no net, so SCL has no pull-up. The model is the
 * source of truth for the copper, so a board generated from it would be built
 * with the fault; check flags it (UHD_BUS_PULLUP, a warning) before generate.
 * The agent must catch it, fix the model (not drop the resistor or the check),
 * then generate and export a board whose netlist has r4 on SCL. One routed
 * build takes about 35 s and 1.2 GB.
 */
import { defineEvalCase } from "@protoboardai/core";
import { vendorParts } from "../../test/fixture.ts";

const MODEL = "src/boards/imu/imu.uhd.ts";
const SCL = '...netLinks("scl", ["u1:pin_3", "u2:pin_13", "r4:pin_2"]),';

export default defineEvalCase({
  title: "Generate a board from its model and catch the fault in the model first",
  skills: ["circuit-board", "system-compose"],
  tags: ["circuit", "generate", "fault"],
  requires: ["tscircuit-node"],
  fixture: {
    from: "../../test/fixtures/imu-tile",
    recipe: (dir) => vendorParts(dir),
    steps: [{ note: "the seeded fault: r4 (the SCL pull-up) has its pin 2 on no net", replace: { file: MODEL, find: SCL, with: '...netLinks("scl", ["u1:pin_3", "u2:pin_13"]),', count: 1 } }],
  },
  instruction:
    "The IMU tile board (src/boards/imu, module imu-tile-board) is modelled but has never been built. Generate and export it with its circuit provider so that it can go to fabrication: fresh standard outputs, and `npx protoboard check` with no errors, no warning about the board's design and nothing stale. The board's circuit.config.ts (outline, holes, placements, keep-out) is agreed: do not change it. If the model is wrong, fix the model before you build from it, and tell me what was wrong.",
  tools: { read: true, edit: true, commands: ["npx protoboard *"] },
  budget: { turns: 30, seconds: 1500, usd: 4 },
  graders: [
    { id: "pullup-fixed-and-named", kind: "fault", code: "UHD_BUS_PULLUP", caught: "(scl[\\s\\S]{0,200}(pull|r4))|((pull|r4)[\\s\\S]{0,200}scl)", description: "SCL had no pull-up: r4's pin 2 was on no net" },
    { id: "check-clean", kind: "check", maxErrors: 0, absent: ["UHD_BUS_PULLUP", "CIRCUIT_NOT_BUILT", "CIRCUIT_STALE", "CIRCUIT_NET_OPEN", "CIRCUIT_NET_SHORT", "CIRCUIT_UNROUTED", "PB_OUTPUT_NOT_EXPORTED"], ran: ["ext:@protoboardai/ext-tscircuit/circuit:check"] },
    { id: "outputs-valid", kind: "outputs", module: "imu-tile-board" },
    { id: "body-step", kind: "format", file: "src/boards/imu/out/board.step", format: "step" },
    { id: "geometry-manifest", kind: "format", file: "src/boards/imu/out/board.manifest.json", format: "manifest" },
    {
      id: "netlist-has-pullups",
      kind: "facts",
      file: "src/boards/imu/out/netlist.json",
      facts: [
        { path: "nets[id=scl].pins", includes: "r4:pin_2" },
        { path: "nets[id=scl].pins", includes: "u2:pin_13" },
        { path: "nets[id=sda].pins", includes: "r3:pin_2" },
        { path: "nets[id=v3v3].pins", includes: "r4:pin_1" },
      ],
    },
    { id: "pullup-kept", kind: "text", file: MODEL, matches: ['id: "r4", moduleDefId: "fx-r-4k7-0402"'], description: "the resistor stays on the board" },
    { id: "constraints-untouched", kind: "digest", file: "src/boards/imu/circuit.config.ts", changed: false },
  ],
  solution: [
    { protoboard: ["check"] },
    { replace: { file: MODEL, find: '...netLinks("scl", ["u1:pin_3", "u2:pin_13"]),', with: SCL, count: 1 } },
    { protoboard: ["check"] },
    { protoboard: ["run", "circuit:generate", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
    { protoboard: ["run", "circuit:export", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
    { protoboard: ["check"] },
    { say: "check warned UHD_BUS_PULLUP: SCL had no pull-up because r4 (the 4.7 kΩ SCL pull-up) had its pin 2 on no net. I added r4:pin_2 to the scl net in the model, then generated and exported the board: Gerber and drill, BOM, pick-and-place, GLB, STEP, manifest and a netlist with r4 on SCL and r3 on SDA. check reports no errors and nothing stale." },
  ],
});
