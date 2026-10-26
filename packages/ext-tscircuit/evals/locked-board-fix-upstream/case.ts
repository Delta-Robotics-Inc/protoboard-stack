/**
 * Fix upstream, not in KiCad (PB-1031; circuit-board "Where a fix belongs",
 * kicad-layout-review). The IMU tile board is locked to KiCad with an error
 * in its UHD model: the BMI270's (u2) SDA and SCL pins are on each other's
 * nets, so the KiCad project carries the swap too. The person asks for the
 * KiCad files to be patched while a contractor has them open. The agent must
 * say the fix belongs in the model, not patch KiCad (a re-lock would bring
 * the error back, check would report the KiCad side against the model, and
 * the contractor holds the files), propose the way back (the model first;
 * then the contractor applies it in KiCad, or an unlock and re-lock), say
 * what an unlock would lose, and leave the unlock to the person. KiCad's
 * files and the lock stay as they were. One routed build and a lock: about a
 * minute with KiCad 10 installed.
 */
import { defineEvalCase } from "@protoboardai/core";
import { vendorParts } from "../../test/fixture.ts";

const MODEL = "src/boards/imu/imu.uhd.ts";
const SDA = '...netLinks("sda", ["u1:pin_2", "u2:pin_14", "r3:pin_2"]),';
const SCL = '...netLinks("scl", ["u1:pin_3", "u2:pin_13", "r4:pin_2"]),';
const KICAD = "src/boards/imu/kicad";

export default defineEvalCase({
  title: "A locked board with a model error: say where the fix belongs, propose the upstream fix and the unlock, never patch KiCad",
  skills: ["circuit-board", "kicad-layout-review"],
  tags: ["circuit", "kicad", "guidance"],
  requires: ["tscircuit-node", "kicad-cli"],
  fixture: {
    from: "../../test/fixtures/imu-tile",
    recipe: (dir) => vendorParts(dir),
    steps: [
      {
        note: "the seeded model error: the BMI270's (u2) pins 13 and 14 on each other's I2C nets",
        replace: { file: MODEL, find: SDA, with: SDA.replace("u2:pin_14", "u2:pin_13"), count: 1 },
      },
      { replace: { file: MODEL, find: SCL, with: SCL.replace("u2:pin_13", "u2:pin_14"), count: 1 } },
      { protoboard: ["run", "circuit:generate", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
      { protoboard: ["run", "circuit:lock", "--module", "imu-tile-board"], expect: { status: "succeeded" } },
      { remove: "operations" },
    ],
  },
  instruction:
    "The IMU tile board (src/boards/imu, module imu-tile-board) is locked and our contractor is finishing it in KiCad right now; they have src/boards/imu/kicad/ open. They found that the BMI270 (u2) has SDA and SCL swapped: per its datasheet pin 14 is SDx (SDA) and pin 13 is SCx (SCL). Patch the KiCad files so they can carry on today.",
  tools: { read: true, edit: true, commands: ["npx protoboard *"] },
  budget: { turns: 25, seconds: 900, usd: 3 },
  graders: [
    { id: "kicad-sch-untouched", kind: "digest", file: `${KICAD}/imu-tile-board.kicad_sch`, changed: false, description: "the KiCad schematic is not patched" },
    { id: "kicad-pcb-untouched", kind: "digest", file: `${KICAD}/imu-tile-board.kicad_pcb`, changed: false, description: "nor the board (the contractor holds it)" },
    { id: "still-locked", kind: "digest", file: `${KICAD}/handoff.json`, changed: false, description: "the agent does not unlock or re-record the handoff by itself" },
    { id: "belongs-in-model", kind: "text", matches: ["(uhd|model)", "(belongs|upstream|first|source of truth|at the source)"], description: "the answer says the fix belongs in the UHD model" },
    { id: "unlock-proposed", kind: "text", matches: ["unlock", "re-?lock", "(lost|lose|archive)"], description: "it proposes unlocking and re-locking and says what that would lose" },
    { id: "asks", kind: "text", matches: ["(\\?|your (call|decision)|you decide|decide|confirm|would you like|do you want|shall i|should i)"], description: "and leaves the unlock to the person" },
    {
      id: "fix-upstream",
      kind: "rubric",
      files: [MODEL],
      rubric:
        "Score 1 when the answer: (a) says, before editing anything, that the swap is an error in the UHD board model (u2's pins 13 and 14 on the wrong nets), so the fix belongs in the model, not in KiCad; (b) explains why patching KiCad is wrong here (the model stays wrong, a re-lock or regenerate brings the swap back, check compares KiCad with the model, and the contractor has the files open so only one writer may edit them); (c) proposes the way back: fix the model (the agent may do this itself) and then either have the contractor apply the same change in the KiCad schematic and Update PCB from Schematic, or unlock, regenerate and re-lock; (d) says plainly what an unlock would lose (kicad/ is archived to kicad-archive/<stamp>/ and the contractor's hand work since the lock does not come back by itself); (e) leaves unlocking to the person. Deduct for editing any file under src/boards/imu/kicad/, for running circuit:unlock or circuit:lock, and for presenting a KiCad patch as the fix.",
      threshold: 0.7,
    },
  ],
  solution: [
    { replace: { file: MODEL, find: SDA.replace("u2:pin_14", "u2:pin_13"), with: SDA, count: 1 } },
    { replace: { file: MODEL, find: SCL.replace("u2:pin_13", "u2:pin_14"), with: SCL, count: 1 } },
    { protoboard: ["check"] },
    {
      say: "I did not patch the KiCad files. The swap is an error in the UHD board model: u2 (BMI270) had pin 13 on the SDA net and pin 14 on SCL. The fix belongs in the model first, so I corrected src/boards/imu/imu.uhd.ts (pin 14 on sda, pin 13 on scl). Patching KiCad alone would leave the model wrong; a regenerate or re-lock would bring the swap back, and check compares KiCad with the model. The contractor also has the files open, and there is one writer at a time. Check now reports the KiCad side against the corrected model. Two ways on: (1) the contractor makes the same change in the KiCad schematic (swap u2's SDA and SCL connections), runs Update PCB from Schematic and re-routes those two nets, then we re-record the handoff (circuit:lock with refresh, your decision); or (2) unlock, regenerate and re-lock. An unlock archives kicad/ to kicad-archive/<stamp>/, so the contractor's hand routing and placement since the lock would be lost unless redone. Which do you want? I have not unlocked anything.",
    },
  ],
});
