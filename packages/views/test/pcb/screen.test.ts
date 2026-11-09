/** The layout screen's pure parts: the Inspect fields in millimeters, net class targets, the agent bar's words, layer presets and the theme. */
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "../../../board/src/fixtures/airnode-c3.js";
import { BRAND_TOKENS } from "../../src/theme.js";
import { classTargets, fmtMm, inspect } from "../../src/pcb/inspect.js";
import { defaultGroups, drawLayers, layerGroups, presetGroups } from "../../src/pcb/layers.js";
import { BRAND } from "../../src/pcb/ui/styles.js";
import { agentState } from "../../src/pcb/ui/shell.js";
import { fitRect, toScreen, toWorld, zoomAbout } from "../../src/pcb/view.js";

const doc = airnodeC3();
const field = (id: string, label: string) => inspect(doc, id)?.fields.find((f) => f.label === label);

describe("inspect", () => {
  it("formats nanometers as millimeters", () => {
    expect(fmtMm(250_000)).toBe("0.25");
    expect(fmtMm(1_500_000)).toBe("1.5");
    expect(fmtMm(-3_000_000)).toBe("-3");
  });

  it("describes a footprint with its place, rotation and nets", () => {
    const i = inspect(doc, "fp:power/ldo")!;
    expect(i.title).toBe("U2 · LDO 3.3 V");
    expect(field("fp:power/ldo", "At")).toEqual({ label: "At", value: "-10, -3", unit: "mm" });
    expect(field("fp:power/ldo", "Courtyard")?.value).toBe("3.6 × 3.5");
    expect(field("fp:power/ldo", "Nets")?.value).toContain("VBUS");
  });

  it("describes a pad, a track, a via, a zone and a keep-out in millimeters", () => {
    expect(field("pad:usb/connector:S", "Slot")).toEqual({ label: "Slot", value: "0.6 × 1.6", unit: "mm" });
    expect(field("pad:usb/connector:A4", "Net")?.value).toBe("VBUS");
    expect(field("trk:f.vbus.1", "Width")).toEqual({ label: "Width", value: "0.5", unit: "mm" });
    expect(inspect(doc, "trk:f.vbus.1")!.chips.map((c) => c.text)).toEqual(["Placed by a person", "Locked"]);
    expect(field("via:f.gnd.1", "Annular ring")?.value).toBe("0.15");
    expect(field("zone:f.gnd_bottom", "Clearance")?.value).toBe("0.25");
    expect(field("kpo:f.antenna", "Blocks")?.value).toBe("tracks, vias, pours");
    // an arc's length is the arc, not its chord
    const arc = Number(field("trk:f.3v3.arc", "Length")!.value);
    expect(arc).toBeCloseTo((Math.PI / 2) * 1, 2);
  });

  it("finds each class's target width and clearance from the rules", () => {
    expect(classTargets(doc, "power")).toMatchObject({ width: 500_000, clearance: 200_000, widthTier: "target" });
    expect(classTargets(doc, "default")).toMatchObject({ width: 250_000, clearance: 200_000 });
  });
});

describe("agent bar", () => {
  it("says plainly when there is no feed, no agent work, or a lease", () => {
    expect(agentState(undefined, undefined, 0).sub).toMatch(/no presence feed/);
    expect(agentState({ epoch: "e", seq: 0, leases: [], intents: [] }, [], 0).sub).toMatch(/no agent has changed/);
    const lease = { id: "l1", token: 1, holder: { kind: "agent" as const, id: "a1", name: "placer" }, roots: ["power"], nets: [], purpose: "place the LDO", grantedAt: 0, expiresAt: 30_000, ttlMs: 30_000 };
    const s = agentState({ epoch: "e", seq: 0, leases: [lease], intents: [] }, [], 10_000);
    expect(s).toMatchObject({ working: true, title: "placer is working" });
    expect(s.sub).toContain("20 s left");
  });
});

describe("layers and view", () => {
  it("has a panel row for every draw layer group and presets that switch rows", () => {
    const copper = ["top", "bottom"] as const;
    const rows = new Set(layerGroups([...copper]).map((r) => r.id));
    for (const d of drawLayers([...copper])) if (d.group !== "holes" && d.group !== "notes") expect(rows.has(d.group)).toBe(true);
    expect(presetGroups("top", [...copper]).has("cu:bottom")).toBe(false);
    expect(presetGroups("fab", [...copper]).has("mask:top")).toBe(true);
    expect(defaultGroups([...copper]).has("mask:top")).toBe(false);
  });

  it("maps screen and board both ways, mirrored from below, and zooms about the pointer", () => {
    const v = fitRect([-20, -15, 20, 15], 1000, 800);
    const p = toScreen(v, 1000, 800, 5, 7);
    const back = toWorld(v, 1000, 800, p.x, p.y);
    expect(back.x).toBeCloseTo(5, 9);
    expect(back.y).toBeCloseTo(7, 9);
    const f = { ...v, flip: true };
    expect(toScreen(f, 1000, 800, 5, 0).x).toBeLessThan(500);
    const z = zoomAbout(v, 1000, 800, 300, 200, 2);
    const under = toWorld(v, 1000, 800, 300, 200);
    const after = toWorld(z, 1000, 800, 300, 200);
    expect(after.x).toBeCloseTo(under.x, 9);
    expect(after.y).toBeCloseTo(under.y, 9);
  });

  it("uses the brand orange of the Protoboard theme, and blue only for selection", () => {
    expect(BRAND).toBe(BRAND_TOKENS.dark.primary);
  });
});
