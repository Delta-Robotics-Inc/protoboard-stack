/**
 * ext-docs reading the build's assembly sequence (PB-1183): the automatic step
 * groups `planSteps` makes for mates a doc spec leaves out come out the same
 * from `sequence.json`, and an out-of-date sequence (a link it lacks, another
 * harness) is not used. Checked on the uno-motor-bench example, whose doc spec
 * has no steps (so every mate is an automatic step).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MateEdge } from "@deltarobotics/uhd";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import { buildSequence } from "@protoboardai/core/sequence";
import { buildContext } from "../lib/context.ts";
import { planSteps } from "../lib/docs/assembly.ts";
import { autoStepsFromSequence, readSequence, sequenceLinks, type SequenceSteps } from "../lib/figures.ts";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const tmp = mkdtempSync(join(tmpdir(), "pb-docs-seq-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const mate = (linkId: string, harness?: string) => ({ linkId, harness }) as unknown as MateEdge;
const seq: SequenceSteps = {
  schema: "protoboard.sequence/v0",
  main: "main",
  sequences: [
    { id: "main", steps: [{ id: "fit:a_mount", title: "", kind: "place", links: ["a_mount"], harness: "a_hw" }, { id: "fasten:a_mount", title: "", kind: "fasten", links: ["a_mount"], harness: "a_hw" }, { id: "fit:b", title: "", kind: "subassembly", links: ["b"], sequence: "arm" }] },
    { id: "arm", steps: [{ id: "fit:arm/c", title: "", kind: "insert", links: ["arm/c"], harness: "c_hw" }] },
  ],
};

describe("docs steps from the assembly sequence", () => {
  it("groups the left mates by harness in their own order, as planSteps does", () => {
    expect([...sequenceLinks(seq)]).toEqual([["a_mount", "a_hw"], ["b", undefined], ["arm/c", "c_hw"]]);
    expect(autoStepsFromSequence(seq, [mate("arm/c", "c_hw"), mate("a_mount", "a_hw"), mate("b")])).toEqual([
      { id: "auto-c_hw", title: "Assemble c_hw", mates: ["arm/c"] },
      { id: "auto-a_hw", title: "Assemble a_hw", mates: ["a_mount"] },
      { id: "auto-b", title: "Assemble b", mates: ["b"] },
    ]);
  });

  it("is not used when it is not a strict superset of the mates (a stale file)", () => {
    expect(autoStepsFromSequence(seq, [mate("new_link")])).toBeUndefined();
    expect(autoStepsFromSequence(seq, [mate("a_mount", "other_hw")])).toBeUndefined();
    expect(autoStepsFromSequence(undefined, [])).toBeUndefined();
  });

  it("reads the build's sequence.json, and nothing else", () => {
    mkdirSync(join(tmp, ".protoboard", "build"), { recursive: true });
    expect(readSequence(join(tmp, "none"))).toBeUndefined();
    writeFileSync(join(tmp, ".protoboard", "build", "sequence.json"), JSON.stringify({ schema: "other" }));
    expect(readSequence(tmp)).toBeUndefined();
    writeFileSync(join(tmp, ".protoboard", "build", "sequence.json"), JSON.stringify(seq));
    expect(readSequence(tmp)?.sequences).toHaveLength(2);
  });

  it("gives the same automatic steps as planSteps on the uno-motor-bench example", async () => {
    const p = await loadProject(join(REPO, "examples", "uno-motor-bench"), { checks: false });
    const ctx = await buildContext(p);
    const plans = planSteps({ ctx } as Parameters<typeof planSteps>[0]);
    const auto = plans.filter((x) => x.spec.id.startsWith("auto-") && !x.spec.id.startsWith("auto-wire-")).map((x) => x.spec);
    expect(auto.length).toBeGreaterThan(0);
    const generated = (await buildSequence(p))!.file as unknown as SequenceSteps;
    expect(autoStepsFromSequence(generated, ctx.scene.assembly.mates)).toEqual(auto);
  }, 60_000);
});
