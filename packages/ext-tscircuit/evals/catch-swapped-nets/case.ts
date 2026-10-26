/**
 * The IMU tile board (test/fixtures/imu-tile) generated and exported clean,
 * then its tscircuit source hand-edited: the BMI270's SDA and SCL traces go
 * to each other's nets. `protoboard check` can only say the source is newer
 * than the outputs; the agent has to rebuild the board to see what the
 * copper does, name the fault, and restore a board that matches the model.
 * One routed build takes about 35 s and 1.2 GB; the fixture builds once and
 * the known-good solution twice.
 */
import { defineEvalCase } from "@protoboardai/core";
import { vendorParts } from "../../test/fixture.ts";

const SDA = '<trace from=".u2 > .pin14" to="net.sda" />';
const SCL = '<trace from=".u2 > .pin13" to="net.scl" />';
const SOURCE = "src/boards/imu/tscircuit/board.gen.tsx";

export default defineEvalCase({
  title: "Rebuild a hand-edited board, catch the netlist fault, and restore the board",
  skills: ["circuit:generate", "circuit:export", "circuit:check"],
  tags: ["circuit", "fault"],
  requires: ["tscircuit-node"],
  fixture: {
    from: "../../test/fixtures/imu-tile",
    recipe: (dir) => vendorParts(dir),
    steps: [
      { protoboard: ["run", "circuit:generate", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
      { protoboard: ["run", "circuit:export", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
      { remove: "operations" },
      {
        note: "the seeded fault: pins 13 and 14 of the BMI270 (u2) traced to each other's nets",
        replace: { file: SOURCE, find: SDA, with: "@@SDA@@", count: 1 },
      },
      { replace: { file: SOURCE, find: SCL, with: SDA.replace("pin14", "pin13"), count: 1 } },
      { replace: { file: SOURCE, find: "@@SDA@@", with: SCL.replace("pin13", "pin14"), count: 1 } },
    ],
  },
  instruction:
    "Someone hand-edited the tscircuit source of the IMU board (src/boards/imu, module imu-tile-board) after its last export. Rebuild the board's outputs from that source and check them: tell me exactly which nets the copper gets wrong and on which component. Then put the board back in agreement with its UHD model (the model is right) so that `npx protoboard check` reports no errors and nothing stale, with fresh standard outputs.",
  tools: { read: true, edit: true, commands: ["npx protoboard *"] },
  budget: { turns: 30, seconds: 1500, usd: 4 },
  graders: [
    { id: "fault-caught", kind: "fault", code: "CIRCUIT_STALE", seeded: ["CIRCUIT_STALE"], caught: "(sda[\\s\\S]{0,200}scl|scl[\\s\\S]{0,200}sda)", description: "the answer names the two nets (SDA and SCL)" },
    { id: "fault-located", kind: "text", matches: ["u2|bmi270|pin ?1[34]"], description: "and where: the BMI270 (u2), pins 13/14" },
    { id: "board-clean", kind: "check", maxErrors: 0, absent: ["CIRCUIT_NET_SHORT", "CIRCUIT_NET_OPEN", "CIRCUIT_STALE"], ran: ["ext:@protoboardai/ext-tscircuit/circuit:check"] },
    { id: "outputs-valid", kind: "outputs", module: "imu-tile-board" },
    {
      id: "netlist-matches-model",
      kind: "facts",
      file: "src/boards/imu/out/netlist.json",
      facts: [
        { path: "nets[id=sda].pins", includes: "u2:pin_14" },
        { path: "nets[id=scl].pins", includes: "u2:pin_13" },
        { path: "nets[id=scl+sda]", exists: false },
      ],
    },
    { id: "source-restored", kind: "text", file: SOURCE, matches: [SDA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), SCL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")] },
    { id: "model-untouched", kind: "digest", file: "src/boards/imu/imu.uhd.ts", changed: false },
    { id: "netlist-as-clean-export", kind: "digest", file: "src/boards/imu/out/netlist.json", changed: false, description: "the restored board's netlist is the clean export's, byte for byte" },
  ],
  solution: [
    { protoboard: ["check"] },
    { protoboard: ["run", "circuit:export", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
    { protoboard: ["check"], expect: { exit: 1 } },
    { protoboard: ["run", "circuit:generate", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
    { protoboard: ["run", "circuit:export", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
    { protoboard: ["check"] },
    { say: "Rebuilt from the edited source, the copper shorts SDA and SCL (net scl+sda) and splits both nets: the BMI270 (u2) pin 13 and pin 14 traces were swapped. Regenerated the source from the UHD board and exported again; check is clean." },
  ],
});
