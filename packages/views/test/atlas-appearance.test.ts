/**
 * The Atlas's appearance (atlas/appearance.ts) and what it remembers
 * (atlas/settings.ts): defaults, presets, per-kind changes, the palette they
 * give, and stored values validated on read (anything wrong is ignored).
 */
import { ATLAS_KIND_ORDER } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, SHAPE_PRESETS, SWATCH_TOKENS, kindColor, kindShape, lookOf, parseAppearance, presetOf, withKind, withPreset } from "../src/atlas/appearance.js";
import { KIND_STYLE, nodeColor, paletteFrom } from "../src/atlas/palette.js";
import { UI_DEFAULT, parseUi } from "../src/atlas/settings.js";

const color = (t: string) => `token:${t}`;

describe("Atlas appearance", () => {
  it("defaults: color by type, every kind a hexagon in its token, the All hexagons preset", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ colorByType: true, kinds: {} });
    for (const k of ATLAS_KIND_ORDER) {
      expect(kindShape(DEFAULT_APPEARANCE, k)).toBe("hex");
      expect(kindColor(DEFAULT_APPEARANCE, k)).toBe(KIND_STYLE[k].token);
    }
    expect(presetOf(DEFAULT_APPEARANCE)).toBe("hexagons");
    // the swatches never offer the accent
    for (const orange of ["accent", "signalPower", "domainElectrical", "signalPwm"]) expect(SWATCH_TOKENS as readonly string[]).not.toContain(orange);
    for (const k of ATLAS_KIND_ORDER) expect(SWATCH_TOKENS as readonly string[]).toContain(KIND_STYLE[k].token);
  });

  it("presets: Shapes by type is the earlier mapping (modules hexagons, images squares, board files diamonds, the rest dots); the colors stay", () => {
    const red = withKind(DEFAULT_APPEARANCE, "render", { color: "#ff0000" });
    const byType = withPreset(red, "by-type");
    expect(presetOf(byType)).toBe("by-type");
    expect(kindShape(byType, "module")).toBe("hex");
    for (const k of ["concept", "render", "photo", "image"] as const) expect(kindShape(byType, k)).toBe("square");
    expect(kindShape(byType, "board")).toBe("diamond");
    for (const k of ["part", "model", "cad", "doc", "data", "firmware", "other"] as const) expect(kindShape(byType, k)).toBe("dot");
    expect(kindColor(byType, "render")).toBe("#ff0000");
    // back to hexagons: only the color is left
    const back = withPreset(byType, "hexagons");
    expect(presetOf(back)).toBe("hexagons");
    expect(back.kinds).toEqual({ render: { color: "#ff0000" } });
    // a single change leaves both presets
    expect(presetOf(withKind(DEFAULT_APPEARANCE, "doc", { shape: "diamond" }))).toBeNull();
    expect(Object.keys(SHAPE_PRESETS["by-type"]).sort()).toEqual([...ATLAS_KIND_ORDER].sort());
  });

  it("a kind set back to its default is dropped, so Reset and a hand reset store the same", () => {
    const a = withKind(withKind(DEFAULT_APPEARANCE, "doc", { color: "signalRf", shape: "dot" }), "doc", { color: KIND_STYLE.doc.token, shape: "hex" });
    expect(a).toEqual(DEFAULT_APPEARANCE);
  });

  it("the palette follows it: chosen colors (tokens resolved, custom as they are) and shapes; Color by type off gives the neutral and the hub gray", () => {
    const a = withKind(withKind(DEFAULT_APPEARANCE, "render", { color: "#12ab34", shape: "diamond" }), "doc", { color: "signalRf" });
    const p = paletteFrom(color, "mono", false, lookOf(a));
    expect(p.kinds.render).toBe("#12ab34");
    expect(p.kinds.doc).toBe("token:signalRf");
    expect(p.kinds.module).toBe("token:text");
    expect(p.shapes.render).toBe("diamond");
    expect(nodeColor(p, { kind: "render", deg: 1 })).toBe("#12ab34");
    const gray = paletteFrom(color, "mono", false, lookOf({ ...a, colorByType: false }));
    expect(nodeColor(gray, { kind: "render", deg: 1 })).toBe("token:textFaint");
    expect(nodeColor(gray, { kind: "module", deg: 1 })).toBe("token:textMuted");
    expect(nodeColor(gray, { kind: "doc", deg: 30 })).toBe("token:textMuted");
  });

  it("stored values are validated: unknown kinds, shapes and colors, wrong types and junk are ignored", () => {
    expect(parseAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("hex")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance([1, 2])).toEqual(DEFAULT_APPEARANCE);
    const a = parseAppearance({
      colorByType: false,
      kinds: {
        render: { color: "#AABBCC", shape: "square" },
        doc: { color: "accent", shape: "star" },
        photo: { color: "red", shape: "dot" },
        model: { color: "#abc" },
        image: { color: "url(javascript:x)" },
        wizard: { color: "#000000", shape: "hex" },
        cad: "dot",
        board: null,
      },
    });
    expect(a).toEqual({ colorByType: false, kinds: { render: { color: "#aabbcc", shape: "square" }, photo: { shape: "dot" } } });
    // colorByType is on unless stored as false
    expect(parseAppearance({ colorByType: "no" }).colorByType).toBe(true);
  });

  it("the ui object: defaults on nothing or junk; allLinks only when true; appearance validated; the panels as before", () => {
    expect(parseUi(null)).toEqual(UI_DEFAULT);
    expect(parseUi("not json")).toEqual(UI_DEFAULT);
    expect(parseUi("[]")).toEqual(UI_DEFAULT);
    expect(UI_DEFAULT.allLinks).toBe(false);
    const ui = parseUi(JSON.stringify({ left: false, minimap: false, animations: false, allLinks: true, appearance: { kinds: { doc: { shape: "dot" } } } }));
    // a stored `animations` choice from an earlier build is dropped: animations always play
    expect(ui).toEqual({ left: false, right: true, minimap: false, allLinks: true, appearance: { colorByType: true, kinds: { doc: { shape: "dot" } } } });
    expect(parseUi(JSON.stringify({ allLinks: "yes" }))).toMatchObject({ allLinks: false });
  });
});
