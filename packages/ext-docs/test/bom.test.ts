/**
 * The documents' BOM with a series passive (the catalog's Yageo RC0402, a
 * test copy) placed at two values: one row per value, each with the
 * placement's MPN.
 */
import { describe, expect, it } from "vitest";
import type { ModuleDef } from "@deltarobotics/uhd";
import { buildBom } from "../lib/bom.ts";
import { catalogPart } from "../../core/test/catalog.ts";

describe("buildBom with per-placement passive values", () => {
  const RC0402 = catalogPart("yageo-rc0402");
  const BOARD: ModuleDef = {
    id: "fx-board",
    name: "Board",
    interfaces: [],
    children: [
      { id: "r1", moduleDefId: "yageo-rc0402", overrides: { resistance: 4700 } },
      { id: "r2", moduleDefId: "yageo-rc0402", overrides: { resistance: 4700 } },
      { id: "r3", moduleDefId: "yageo-rc0402" },
    ],
  };
  const SYSTEM: ModuleDef = { id: "sys", name: "System", interfaces: [], children: [{ id: "board", moduleDefId: "fx-board", quantity: 2 }] };
  const lookup = (id: string) => [RC0402, BOARD, SYSTEM].find((d) => d.id === id);

  it("lists each value on its own row with its MPN and quantity", () => {
    const rows = buildBom(SYSTEM, lookup, () => []);
    expect(rows.map((r) => [r.line, r.partId, r.partNumber, r.value, r.quantity, r.usedBy.join(" ")])).toEqual([
      [1, "yageo-rc0402", "RC0402FR-0710KL", "10 kΩ ±1 %", 2, "board/r3"],
      [2, "yageo-rc0402", "RC0402FR-074K7L", "4.7 kΩ ±1 %", 4, "board/r1 board/r2"],
    ]);
  });
});
