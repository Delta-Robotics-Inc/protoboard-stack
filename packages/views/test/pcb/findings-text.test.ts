/** Findings in plain language: every check kind, on the Airnode C3 sample's own findings and on synthetic ones. */
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { runBoardChecks } from "@protoboardai/board-checks";
import { withChanges, type BoardRecord } from "../../src/pcb/board.js";
import { checkWords, describeFinding, describeOpenNet, layerWords, mmPair, mmText, nameObject, type FindingLike } from "../../src/pcb/findings-text.js";

const doc = airnodeC3();
const RAW_ID = /\b(pad|trk|via|fp|rule|zone|kpo|gfx|txt):[\w./~+-]/;

let n = 0;
const F = (check: string, objects: string[], extra: Partial<FindingLike> = {}): FindingLike => ({ id: `f:${check}:${++n}`, check, severity: "error", objects, location: { x: 0, y: 0, layer: "top" }, message: "", ...extra });
const say = (f: FindingLike, d = doc) => describeFinding(f, d).sentence;

describe("numbers and words", () => {
  it("rounds millimeters sensibly and never shows a measure equal to its limit when they differ", () => {
    expect(mmText(22_800)).toBe("0.023");
    expect(mmText(127_000)).toBe("0.127");
    expect(mmText(300_000)).toBe("0.3");
    expect(mmText(2_272_200)).toBe("2.27");
    expect(mmText(26_697_000)).toBe("26.7");
    expect(mmText(0)).toBe("0");
    expect(mmText(40)).toBe("under 0.0001");
    expect(mmPair(126_900, 127_000)).toEqual(["0.1269", "0.127"]);
    expect(mmPair(199_999, 200_000)).toEqual(["0.199999", "0.2"]);
  });

  it("says layers and checks in words", () => {
    expect(layerWords("top")).toBe("the top layer");
    expect(layerWords("inner2")).toBe("inner layer 2");
    expect(layerWords("bottom_silkscreen")).toBe("the bottom silkscreen");
    expect(layerWords("top_courtyard")).toBe("the top side");
    expect(checkWords("edge_clearance")).toBe("edge clearance");
    expect(checkWords("some_new_check")).toBe("some new check");
  });

  it("names objects by reference, pad number and net", () => {
    expect(nameObject(doc, "pad:mcu/module:11").phrase).toBe("U1 pad 11 (no net)");
    expect(nameObject(doc, "pad:usb/connector:S~3").short).toBe("J1 pad S");
    expect(nameObject(doc, "trk:f.i2c_sda.2").phrase).toBe("the I2C_SDA track");
    expect(nameObject(doc, "via:f.gnd.1").phrase).toBe("a GND via");
    expect(nameObject(doc, "zone:f.gnd_bottom").phrase).toBe("the GND bottom zone");
    expect(nameObject(doc, "kpo:f.antenna").phrase).toBe("the antenna clearance keep-out");
    expect(nameObject(doc, "fp:power/ldo").phrase).toBe("U2");
    expect(nameObject(doc, "outline").phrase).toBe("the board edge");
  });
});

describe("the Airnode C3 sample's findings", () => {
  const r = runBoardChecks(doc);
  it("has findings of several kinds to read", () => {
    expect(new Set(r.findings.map((f) => f.check)).size).toBeGreaterThanOrEqual(6);
  });

  it("reads every finding without raw ids, as a sentence, and keeps the ids aside", () => {
    for (const f of r.findings) {
      const d = describeFinding(f, doc);
      expect(d.sentence, f.message).not.toMatch(RAW_ID);
      expect(d.title, f.message).not.toMatch(RAW_ID);
      expect(d.sentence).toMatch(/^[A-Z+0-9].*\.$/);
      expect(d.title.length).toBeLessThanOrEqual(60);
      expect(d.ids[0]).toBe(f.id);
      for (const o of f.objects) expect(d.ids).toContain(o);
    }
  });

  it("says the U1 pad 11 clearance as a person would", () => {
    const f = r.findings.find((x) => x.check === "clearance" && x.objects.includes("pad:mcu/module:11"))!;
    const d = describeFinding(f, doc);
    expect(d.sentence).toBe("U1 pad 11 (no net) is 0.023 mm from the I2C_SDA track on the top layer; the fab minimum is 0.127 mm (illustrative fab limit).");
    expect(d.title).toBe("U1 pad 11 too close to I2C_SDA track");
    expect(d.source).toBe("the fab minimum");
    expect(d.ids).toContain("rule:floor.clearance");
  });

  it("says a design-target clearance, a short, an open link, a dangling end, silk on pads and copper with no net", () => {
    const of = (check: string, has?: string) => r.findings.find((x) => x.check === check && (!has || x.objects.includes(has)))!;
    expect(say(of("clearance", "pad:mcu/c_en:1"))).toBe("C5 pad 1 (EN) is 0.181 mm from the USB_DP track on the top layer; the design target is 0.2 mm.");
    expect(say(of("short"))).toMatch(/^J1 pad \w+ \((VBUS|GND)\) touches the USB_D[NP] track on the top layer, joining \w+ and \w+\.$/);
    expect(say(of("unconnected"))).toMatch(/^[\w+]+ is not joined between \w+ pad \w+ and \w+ pad \w+, [\d.]+ mm apart\.$/);
    expect(say(of("dangling"))).toMatch(/^An end of the [\w+]+ track touches no other copper on the top layer\.$/);
    expect(say(of("silk_to_pad", "fp:mcu/module"))).toBe("The silkscreen of U1 overlaps 22 pads of U1 on the top silkscreen.");
    expect(say(of("unassigned_copper"))).toMatch(/^U1 pad \d+ \(no net\) touches the I2C_SDA track on the top layer\.$/);
    expect(say(of("via_under_footprint"))).toBe("A GND via is under U1 on the top layer; a policy rule in its area discourages it.");
    expect(say(of("edge_clearance"))).toBe("J1 pad S (GND) crosses the board edge on the top layer; the fab minimum is 0.3 mm.");
  });

  it("groups an open net's links in one sentence", () => {
    const gnd = r.findings.filter((f) => f.check === "unconnected" && f.message.startsWith("Net GND "));
    expect(gnd.length).toBeGreaterThan(1);
    const d = describeOpenNet(doc, "GND", gnd);
    expect(d.title).toBe("GND is not joined");
    expect(d.sentence).toMatch(new RegExp(`^GND has ${gnd.length} open connections between `));
    expect(d.sentence).not.toMatch(RAW_ID);
  });
});

describe("every other check kind", () => {
  it("track width against a net class target, and a maximum", () => {
    const f = F("track_width", ["trk:f.vbus.1"], { rule: "rule:target.power_track_width", tier: "target", measured: 300_000, required: 400_000 });
    expect(say(f)).toBe("The VBUS track on the top layer is 0.3 mm wide; the design target for net class power is 0.4 mm.");
    expect(describeFinding(f, doc).title).toBe("VBUS track too narrow");
    const wide = F("track_width", ["trk:f.vbus.1"], { tier: "floor", measured: 3_000_000, required: 2_000_000 });
    expect(say(wide)).toBe("The VBUS track on the top layer is 3 mm wide; the fab maximum is 2 mm.");
  });

  it("via size, via hole, hole size and annular ring", () => {
    expect(say(F("via_hole", ["via:f.gnd.1"], { rule: "rule:floor.via_hole", tier: "floor", measured: 250_000, required: 300_000 }))).toBe("A GND via has a 0.25 mm hole; the fab minimum is 0.3 mm.");
    expect(say(F("via_diameter", ["via:f.gnd.1"], { tier: "floor", measured: 450_000, required: 500_000 }))).toBe("A GND via is 0.45 mm across; the fab minimum is 0.5 mm.");
    expect(say(F("hole_size", ["pad:usb/connector:S"], { tier: "floor", measured: 600_000, required: 6_350_000 / 10 }))).toBe("J1 pad S (GND) has a 0.6 mm hole; the fab minimum is 0.635 mm.");
    expect(describeFinding(F("hole_size", ["via:f.gnd.1"], { tier: "floor", measured: 7_000_000, required: 6_000_000 }), doc).title).toBe("GND via hole too large");
    expect(say(F("annular_ring", ["via:f.gnd.1"], { tier: "floor", measured: 100_000, required: 125_000 }))).toBe("A GND via has a 0.1 mm annular ring; the fab minimum is 0.125 mm.");
  });

  it("hole to hole and hole clearance (the hole's owner taken from the message)", () => {
    expect(say(F("hole_to_hole", ["via:f.gnd.1", "via:f.gnd.2"], { tier: "floor", measured: 200_000, required: 250_000 }))).toBe("The holes of a GND via and a GND via are 0.2 mm apart; the fab minimum is 0.25 mm.");
    const hc = F("hole_clearance", ["trk:f.vbus.1", "via:f.gnd.1"], { tier: "floor", measured: 100_000, required: 200_000, message: "Hole of via:f.gnd.1 is 0.1000 mm from trk:f.vbus.1 (net VBUS) on top, below 0.2000 mm (floor)." });
    expect(say(hc)).toBe("The hole of a GND via is 0.1 mm from the VBUS track on the top layer; the fab minimum is 0.2 mm.");
  });

  it("physical clearance and an implicit zone clearance", () => {
    expect(say(F("physical_clearance", ["trk:f.vbus.1", "pad:power/ldo:1"], { tier: "floor", measured: 50_000, required: 100_000 }))).toMatch(/^U2 pad 1 \([\w+]+\) is 0\.05 mm from the VBUS track on the top layer; the fab minimum is 0\.1 mm\.$/);
    expect(say(F("clearance", ["trk:f.vbus.1", "zone:f.gnd_bottom"], { tier: "floor", measured: 150_000, required: 250_000, location: { x: 0, y: 0, layer: "bottom" } }))).toBe("The VBUS track is 0.15 mm from the GND bottom zone on the bottom layer; the zone's own clearance is 0.25 mm.");
  });

  it("edge clearance: near the edge, outside the outline, a cutout", () => {
    expect(say(F("edge_clearance", ["outline", "trk:f.vbus.1"], { rule: "rule:floor.edge_clearance", tier: "floor", measured: 210_000, required: 300_000 }))).toBe("The VBUS track is 0.21 mm from the board edge on the top layer; the fab minimum is 0.3 mm.");
    const out = F("edge_clearance", ["outline", "via:f.gnd.1"], { measured: 0, required: 0, message: "via:f.gnd.1 (net GND) on top lies outside the board outline (built-in default: copper must stay inside the board)." });
    expect(say(out)).toBe("A GND via lies outside the board outline on the top layer; copper must stay inside the board.");
    expect(describeFinding(out, doc).title).toBe("GND via outside the board");
  });

  it("a short bridged through copper with no net", () => {
    const d = withChanges(doc, [{ kind: "track", id: "trk:x.bridge", layer: "top", width: 200_000, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 }, provenance: { by: "hand" } } as BoardRecord]);
    const f = F("short", ["trk:f.vbus.1", "trk:f.usb_dp.1", "trk:x.bridge"], { measured: 0 });
    expect(say(f, d)).toBe("VBUS and USB_DP are joined through copper with no net (a track with no net) on the top layer.");
    expect(describeFinding(f, d).title).toBe("Short: VBUS and USB_DP");
  });

  it("isolated fill and a via that connects on one side", () => {
    expect(say(F("isolated_copper", ["zone:f.gnd_bottom"], { severity: "warning", location: { x: 0, y: 0, layer: "bottom" } }))).toBe("An island of the GND bottom zone fill on the bottom layer touches no GND pad, track or via.");
    expect(say(F("dangling", ["via:f.gnd.2"], { severity: "warning", message: "Via via:f.gnd.2 (net GND) at (1, 2) mm meets other copper on 1 of its layers." }))).toBe("A GND via meets other copper on only 1 of its layers.");
  });

  it("courtyards, silkscreen near a pad, via in pad, keep-out and disallow", () => {
    expect(say(F("courtyard_overlap", ["fp:power/c_in", "fp:power/ldo"], { location: { x: 0, y: 0, layer: "top_courtyard" } }))).toMatch(/^The courtyards of C\d and U2 overlap on the top side\.$/);
    expect(say(F("silk_to_pad", ["gfx:f.logo_box", "pad:power/ldo:1"], { severity: "warning", tier: "target", measured: 50_000, required: 100_000, location: { x: 0, y: 0, layer: "top_silkscreen" } }))).toBe("A silkscreen rect is 0.05 mm from U2 pad 1 on the top silkscreen; the design target is 0.1 mm.");
    expect(say(F("via_in_pad", ["pad:usb/connector:A6", "via:f.gnd.1"], { rule: "rule:no_go.via_in_pad_usb", tier: "no_go" }))).toMatch(/^A GND via sits in J1 pad A6 \(\w+\) on the top layer; a no-go rule for net class usb forbids it\.$/);
    const k = F("keepout", ["kpo:f.antenna", "trk:f.vbus.1"], { tier: "no_go", message: "Track trk:f.vbus.1 (net VBUS) on top is inside keep-out kpo:f.antenna, which blocks tracks (no_go)." });
    expect(say(k)).toBe("The VBUS track on the top layer is inside the antenna clearance keep-out, which blocks tracks (a no-go area).");
    expect(describeFinding(k, doc).title).toBe("VBUS track in the antenna clearance keep-out");
    const withNote = withChanges(doc, [{ kind: "rule", id: "rule:kicad.dru.1.no_vias.disallow", tier: "no_go", check: "disallow", applies: {}, note: "KiCad rule no_vias" } as BoardRecord]);
    expect(say(F("disallow", ["via:f.gnd.1"], { rule: "rule:kicad.dru.1.no_vias.disallow", tier: "no_go" }), withNote)).toBe("A GND via on the top layer is not allowed here; a no-go rule forbids it (KiCad rule no_vias).");
  });

  it("a rule's note and its net class, as an imported KiCad board has them", () => {
    const d = withChanges(doc, [{ kind: "rule", id: "rule:kicad.class.power.clearance", tier: "floor", check: "clearance", applies: { classes: ["Power"] }, min: 300_000, note: "KiCad net class Power: clearance" } as BoardRecord]);
    const f = F("clearance", ["trk:f.vbus.1", "trk:f.usb_dp.1"], { rule: "rule:kicad.class.power.clearance", tier: "floor", measured: 254_000, required: 300_000 });
    expect(say(f, d)).toBe("The VBUS track is 0.254 mm from the USB_DP track on the top layer; the fab minimum for net class Power is 0.3 mm (KiCad net class Power: clearance).");
  });

  it("quotes a net name with spaces (an imported board's generated names)", () => {
    const d = withChanges(doc, [{ kind: "track", id: "trk:x.gen", net: "Net (J1 CC1)", layer: "top", width: 200_000, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 }, provenance: { by: "hand" } } as BoardRecord]);
    expect(say(F("unconnected", ["trk:x.gen", "pad:usb/connector:A4"], { measured: 1_500_000 }), d)).toBe('"Net (J1 CC1)" is not joined between "Net (J1 CC1)" track and J1 pad A4, 1.5 mm apart.');
  });

  it("a check it does not know keeps its own message, with names in the title", () => {
    const f = F("diff_pair_gap", ["trk:f.usb_dp.1", "trk:f.usb_dn.1"], { message: "The pair's gap varies." });
    const d = describeFinding(f, doc);
    expect(d.sentence).toBe("The pair's gap varies.");
    expect(d.title).toBe("Diff pair gap: USB_DP track, USB_DN track");
  });
});
