/**
 * PB-869: UHD's board rules on the IMU tile fixture. The eval baseline seeded
 * three faults the system checks used to pass: a decoupling capacitor with
 * both pins on one net, the regulator's VOUT tied to its VIN, and the
 * BMI270's address strap (SDO) moved from GND onto SDA. Each must be a UHD
 * `net` error on the board, and the fixture as written must have none.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSystem, type InterfaceLink, type ModuleDef } from "@deltarobotics/uhd";
import { loadProject, type Project } from "@protoboardai/core";
import { makeProject } from "./fixture.ts";

const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-faults");
const BOARD = "imu-tile-board";
let p: Project;
let board: ModuleDef;

beforeAll(async () => {
  const root = await makeProject(join(TMP, "imu-tile"));
  p = await loadProject(root, { checks: false, extensions: false });
  board = p.lookup(BOARD)!;
});
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** The board with one pin moved from one net to another (the board's links are `<net>.<child>.<pin>`). */
const move = (pin: string, from: string, to: string): ModuleDef => {
  const [child, iface] = pin.split(":");
  const id = `${from}.${child}.${iface}`;
  expect(board.links!.some((l) => l.id === id)).toBe(true);
  const moved: InterfaceLink = { id: `${to}.${child}.${iface}`, a: { self: true, interfaceId: to }, b: { child, interfaceId: iface } };
  return { ...board, links: [...board.links!.filter((l) => l.id !== id), moved] };
};
const netErrors = (def: ModuleDef) => checkSystem(def, p.lookup).diagnostics.filter((d) => d.rule === "net" && d.severity === "error").map((d) => d.id);

describe("UHD board rules on the IMU tile (PB-869)", () => {
  it("the fixture as written has no net errors", () => {
    expect(netErrors(board)).toEqual([]);
  });

  it("a capacitor with both pins on one net", () => {
    expect(netErrors(move("c11:pin_2", "gnd", "v3v3"))).toContain("net:v3v3:shorted:c11");
  });

  it("VOUT tied to VIN on the regulator", () => {
    expect(netErrors(move("u3:pin_4", "v3v3", "vin"))).toContain("net:vin:feedback:u3");
  });

  it("the BMI270's SDO strap moved onto SDA", () => {
    expect(netErrors(move("u2:pin_1", "gnd", "sda"))).toContain("net:sda:strap:u2:pin_1");
  });
});
