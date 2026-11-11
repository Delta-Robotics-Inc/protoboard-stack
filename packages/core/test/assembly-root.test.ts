/**
 * The one assembly-root rule (PB-1137), shared by `check` and the 3D viewer
 * (uhd-viewer `src/cad/state/view.ts` `assemblyRoot`): the display file's
 * root when it names an instance, else the system's own body, else the
 * top-level module (not a harness) with the most interface frames.
 */
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModuleDef } from "@deltarobotics/uhd";
import { describe, expect, it } from "vitest";
import { assemblyRoot, loadProject } from "../src/project.ts";

const here = dirname(fileURLToPath(import.meta.url));
const frame = (id: string) => ({ id, domain: "mechanical", protocols: [], geometry: { frame: { origin: [0, 0, 0], normal: [0, 0, 1] } } });
const def = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, interfaces: [], ...extra }) as unknown as ModuleDef;

describe("assemblyRoot", () => {
  const defs = new Map<string, ModuleDef>([
    ["small", def("small", { interfaces: [frame("a")] })],
    ["big", def("big", { interfaces: [frame("a"), frame("b"), frame("c")] })],
    ["big2", def("big2", { interfaces: [frame("a"), frame("b"), frame("c")] })],
    ["cable", def("cable", { kind: "harness", interfaces: [frame("a"), frame("b"), frame("c"), frame("d")] })],
  ]);
  const lookup = (id: string) => defs.get(id);
  const system = def("sys", { children: [{ id: "s", moduleDefId: "small" }, { id: "w", moduleDefId: "cable" }, { id: "b", moduleDefId: "big" }, { id: "b2", moduleDefId: "big2" }] });

  it("takes the most frames, the first declared on a tie, never a harness", () => {
    expect(assemblyRoot(system, lookup)).toEqual({ path: ["b"], rule: "most-frames" });
  });
  it("takes the display file's root when it names an instance, and ignores one that does not", () => {
    expect(assemblyRoot(system, lookup, "s")).toEqual({ path: ["s"], rule: "display" });
    expect(assemblyRoot(system, lookup, "nope")).toEqual({ path: ["b"], rule: "most-frames" });
  });
  it("takes the system itself when it has a body of its own", () => {
    const withBody = def("sys", { ...system, artifacts: [{ id: "body", role: "body", format: "glb", filePath: "out/body.glb" }] });
    expect(assemblyRoot(withBody, lookup)).toEqual({ path: [], rule: "own-body" });
  });
  it("says none when nothing qualifies", () => {
    expect(assemblyRoot(def("empty"), lookup)).toEqual({ path: [], rule: "none" });
  });
  it("is what check reports for the drone (frame)", async () => {
    const p = await loadProject(resolve(here, "../../../examples/quadcopter-5in"));
    const run = p.checks.find((c) => c.validator === "uhd/assemble");
    expect(run).toMatchObject({ status: "ran", root: "frame" });
  }, 60_000);
});
