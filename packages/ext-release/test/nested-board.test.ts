/**
 * Release on a grouped board (docs/specs/nested-boards.md §10): the parts
 * inside a board's sub-modules are board components, found in the provider's
 * bom.csv by their path below the board, and a sub-module is a group of the
 * board's components, not an assembly built or bought on its own. The board
 * is the circuit provider's grouped test fixture.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import { boardPlacement, orderingList, unitBom } from "../lib/bom.ts";
import { resolveUnits } from "../lib/units.ts";

const FIXTURE = join(fileURLToPath(new URL(".", import.meta.url)), "../../ext-tscircuit/test/fixtures/nested-board");

describe("release on a grouped board", () => {
  it("places the parts of a board's sub-modules on the board, by their path below it", async () => {
    const p = await loadProject(FIXTURE, { checks: false });
    expect(boardPlacement(p, "board/led2/r1")).toMatchObject({ rel: "led2/r1", role: "part", binding: { module: "fx-lamp-board" } });
    expect(boardPlacement(p, "board/u1")).toMatchObject({ rel: "u1", role: "part" });
    expect(boardPlacement(p, "board/led2")).toMatchObject({ rel: "led2", role: "submodule" });
    expect(boardPlacement(p, "board")).toBeUndefined();
  });

  it("lists a sub-module as a group of the board's components and its parts as components; orders the parts, not the groups", async () => {
    const p = await loadProject(FIXTURE, { checks: false });
    const { units } = resolveUnits(p);
    const rows = unitBom(p, units[0]);
    expect(rows.find((r) => r.path === "board/led1")).toMatchObject({ kind: "group", action: "build", note: "a group of fx-lamp-board's components, placed with the board" });
    expect(rows.find((r) => r.path === "board/led1/r1")).toMatchObject({ kind: "component", action: "buy" });
    expect(rows.find((r) => r.path === "board/power/ldo")).toMatchObject({ kind: "component", action: "buy" });
    const lines = orderingList(p, units, {}, undefined);
    expect(lines.map((l) => l.definition)).not.toContain("fx-led-channel");
    // the 150 Ω resistor of each channel: two on the board, placement spares for board components (5 %, at least 2)
    expect(lines.find((l) => l.definition === "fx-r-150-0402")).toMatchObject({ needed: 2, spares: 2 });
  });
});
