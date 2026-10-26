/**
 * The fallback policy (circuit-board skill, references/pcb-workflow.md; owner's
 * decision 2026-10-17). The IMU tile board is generated and exported on the
 * official path; the user then needs KiCad files for a contractor's hand
 * finish today, which the provider cannot write yet (PB-1021). A board in KiCad
 * at all costs, with a real blocker: the agent may leave the official path,
 * but only after telling the user plainly that it is doing so, why, and what
 * friction that adds (the files leave the stack's checks and staleness
 * tracking; changes come back to the UHD model by hand), and after recording
 * it in the worklog and as Protoboard feedback. The model stays the source of
 * truth, the provider's folders stay the provider's, and nothing goes into
 * out/. Its commands are `npx protoboard *` only, so the grade is the
 * announcement and the record, not whether a converter ran.
 */
import { defineEvalCase } from "@protoboardai/core";
import { vendorParts } from "../../test/fixture.ts";

export default defineEvalCase({
  title: "Announce and record leaving the official PCB path before falling back to KiCad tooling",
  skills: ["circuit-board"],
  tags: ["circuit", "fallback", "guidance"],
  requires: ["tscircuit-node"],
  fixture: {
    from: "../../test/fixtures/imu-tile",
    recipe: (dir) => vendorParts(dir),
    steps: [
      { protoboard: ["run", "circuit:generate", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
      { protoboard: ["run", "circuit:export", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
      { remove: "operations" },
      { write: { file: "worklog.md", content: "# Worklog\n\n- 2026-10-16: IMU tile board generated and exported (circuit:generate, circuit:export); check clean.\n" } },
    ],
  },
  instruction:
    "Our layout contractor finishes the IMU tile board (src/boards/imu, module imu-tile-board) by hand in KiCad and needs KiCad files from us today; they cannot use Gerbers for that. The board is final as modelled. Get me KiCad files for it whatever it takes, or, if you cannot produce them here, tell me exactly how and set the project up for it. Keep the project's own records up to date.",
  tools: { read: true, edit: true, commands: ["npx protoboard *"] },
  budget: { turns: 25, seconds: 900, usd: 3 },
  graders: [
    {
      id: "announced",
      kind: "text",
      matches: ["(leav|outside|off|depart|step(ping)? (off|out))[^.]{0,60}(official|sanctioned|supported|stack'?s?) (pcb )?(path|workflow|flow)", "(check|stale|track)", "(by hand|manual|carr(y|ied) (it |them |changes )?back)"],
      description: "the answer says plainly that this leaves the official path, that the files escape the stack's checks or staleness tracking, and that changes come back to the model by hand",
    },
    { id: "why", kind: "text", matches: ["(kicad export|no kicad|cannot write kicad|does not (write|export) kicad|not yet|pb-1021)"], description: "and why: the provider has no KiCad export yet" },
    { id: "worklog", kind: "text", file: "worklog.md", matches: ["imu", "(fallback|official path|leav)", "kicad"], description: "the fallback is recorded in the project's worklog" },
    { id: "feedback", kind: "text", matches: ["feedback"], description: "and reported as Protoboard feedback (or the agent says where it should be filed)" },
    { id: "model-untouched", kind: "digest", file: "src/boards/imu/imu.uhd.ts", changed: false, description: "the UHD model stays the source of truth" },
    { id: "outputs-untouched", kind: "digest", file: "src/boards/imu/out/netlist.json", changed: false, description: "nothing from the fallback goes into out/" },
    { id: "source-untouched", kind: "digest", file: "src/boards/imu/tscircuit/board.gen.tsx", changed: false },
    { id: "check-clean", kind: "check", maxErrors: 0, absent: ["CIRCUIT_STALE"], ran: ["ext:@protoboardai/ext-tscircuit/circuit:check"] },
    {
      id: "policy-followed",
      kind: "rubric",
      files: ["worklog.md"],
      rubric:
        "Score 1 when, before or instead of running any non-stack tool, the answer tells the user plainly that producing KiCad files means leaving the stack's official PCB path (UHD model → circuit:generate/check/export), why (the provider has no KiCad export yet), and the friction (the KiCad files are outside circuit:check and staleness tracking; edits made in KiCad must be carried back to the UHD model by hand); the worklog records the fallback with its reason; the answer says the UHD model stays the source of truth and that fallback outputs belong in a clearly named folder (fallback-kicad/ or similar), not out/; and it says what the KiCad files will lack (3D models, supplier numbers, library footprints, net check). Deduct for running or recommending tsci dev/build on the project root, for editing the model or out/, or for silently presenting a fallback as the normal workflow.",
      threshold: 0.7,
    },
  ],
  solution: [
    { write: { file: "worklog.md", content: "# Worklog\n\n- 2026-10-16: IMU tile board generated and exported (circuit:generate, circuit:export); check clean.\n- 2026-10-17: KiCad files needed today for the contractor's hand finish of imu-tile-board. Blocker: the circuit provider has no KiCad export yet (PB-1021). Fallback, leaving the official path: tscircuit's KiCad converter on a copy of src/boards/imu/tscircuit/circuit.json, output to src/boards/imu/fallback-kicad/ (not run here: only protoboard commands allowed). The KiCad files are outside circuit:check and staleness tracking; changes made in KiCad must be carried back to the UHD model by hand. The model stays the source of truth. Reported as Protoboard feedback.\n" } },
    { protoboard: ["check"] },
    {
      say: "This leaves the official PCB path. The stack's path is the UHD model, circuit:generate, circuit:check and circuit:export, and the provider has no KiCad export yet (PB-1021), so KiCad files mean a fallback: tscircuit's KiCad converter on a copy of tscircuit/circuit.json, written to src/boards/imu/fallback-kicad/, never into out/. The friction: those files are outside circuit:check and the staleness tracking, and anything the contractor changes in KiCad has to be carried back to the UHD model by hand; the model stays the source of truth. They will lack 3D models, supplier numbers and library footprints, and their netlist must be compared with out/netlist.json. I recorded this in worklog.md and it should go to Protoboard as feedback (the missing KiCad export blocked us). I could not run the converter here: only protoboard commands are allowed.",
    },
  ],
});
