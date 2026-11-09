/** The Airnode C3 fixture from the board package: known connectivity, the status line, staleness through the service. */
import { describe, expect, it } from "vitest";
import { HUMAN, mm, openBoardService } from "@protoboardai/board";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { inputHash, isStale, runBoardChecks } from "../src/index.js";

describe("Airnode C3", () => {
  const r = runBoardChecks(airnodeC3());

  it("counts the ratsnest per net (no zone fill given: the bottom GND pour connects nothing)", () => {
    const missing = Object.fromEntries(r.connectivity.nets.map((n) => [n.net, n.missing]));
    // 22 GND pads and one free via; via f.gnd.2 lands on C1.2 and SW1.4, via f.gnd.3 on U1's pad 34
    expect(missing).toEqual({ "+3V3": 8, BOOT: 2, CC1: 1, CC2: 1, EN: 2, GND: 21, I2C_SCL: 3, I2C_SDA: 1, LED1: 1, LED1_A: 1, LED2: 1, LED2_A: 1, USB_DN: 1, USB_DP: 1, VBUS: 3 });
    expect(r.connectivity.unconnected).toBe(48);
    expect(r.connectivity.zoneFill).toBe("absent");
    expect(r.connectivity.zonesWithoutFill).toEqual(["zone:f.gnd_bottom"]);
    // the two hand-routed VBUS segments join J1.A4 to U2.1
    const vbus = r.connectivity.islands.filter((i) => i.net === "VBUS").map((i) => i.objects);
    expect(vbus).toContainEqual(["pad:power/ldo:1", "pad:usb/connector:A4", "trk:f.vbus.1", "trk:f.vbus.2"]);
  });

  it("finds the fixture's real defects", () => {
    // the straight USB data tracks run across the connector's neighboring pads
    const shorts = r.connectivity.shorts.map((s) => s.nets.join("/"));
    expect(shorts).toContain("USB_DN/USB_DP");
    expect(shorts).toContain("I2C_SCL/I2C_SDA");
    // the I2C_SCL track is on the bottom between two top pads: both ends dangle
    expect(r.connectivity.dangling.filter((d) => d.object === "trk:f.i2c_scl.1")).toHaveLength(2);
    // the unassigned spare track on the bottom touches nothing
    expect(r.connectivity.dangling.filter((d) => d.object === "trk:f.spare.1")).toHaveLength(2);
    // the USB shell's lower tabs cross the board edge
    expect(r.findings.filter((f) => f.check === "edge_clearance").map((f) => f.objects[1]).sort()).toEqual(["pad:usb/connector:S~3", "pad:usb/connector:S~4"].sort((a, b) => (a < b ? -1 : 1)));
    // the policy region over the module flags the via under it, with its cost
    const vuf = r.findings.filter((f) => f.check === "via_under_footprint");
    expect(vuf.map((f) => [f.objects, f.rule, f.severity])).toEqual([[["fp:mcu/module", "via:f.gnd.3"], "rule:policy.via_under_module", "warning"]]);
    // the no-go via-in-pad rule is for the usb class only; the GND via in U1's pad 34 is not flagged
    expect(r.findings.filter((f) => f.check === "via_in_pad")).toEqual([]);
  });

  it("gives the status line from our own counts, and says what it leaves out", () => {
    expect(r.summary.unconnected).toBe(48);
    expect(r.summary.errors).toBe(r.findings.filter((f) => f.severity === "error" && f.check !== "unconnected").length);
    expect(r.summary.line).toBe(`48 unconnected, ${r.summary.errors} errors, ${r.summary.warnings} warnings (incomplete: see caveats)`);
    expect(r.summary.caveats.join("\n")).toMatch(/zone without fill/);
    expect(r.summary.caveats.join("\n")).toMatch(/hole_clearance not checked/);
    expect(r.summary.inputHash).toBe(r.inputHash);
    expect(r.summary.timing!.totalMs).toBeGreaterThan(0);
  });

  it("marks results stale when a record they read changes", () => {
    const svc = openBoardService({ document: airnodeC3(), journal: false, ownerLock: false });
    const before = runBoardChecks(svc.snapshot());
    expect(before.seq).toBe(0);
    const reply = svc.apply({ batchId: "move-c5", label: "move the EN capacitor", ops: [{ op: "footprint.move", ids: ["fp:mcu/c_en"], dx: mm(0.5), dy: 0, tracks: "stay" }] }, HUMAN);
    expect(reply.status).toBe("applied");
    const snap = svc.snapshot();
    expect(isStale(before.inputHash, snap.doc)).toBe(true);
    const after = runBoardChecks(snap);
    expect(after.inputHash).toBe(inputHash(snap.doc));
    expect(after.inputHash).not.toBe(before.inputHash);
    expect(after.seq).toBe(1);
    expect(isStale(after.inputHash, snap.doc)).toBe(false);
    svc.close({ save: false });
  });
});
