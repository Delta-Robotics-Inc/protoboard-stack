/** Tokens, theme files, the cascade, explanations and guard rails. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { airnodeC3 } from "@protoboardai/board/fixtures/airnode-c3";
import { checkTokenValue, explainToken, parseLayer, parseTheme, recordDecision, resolveStyle, serializeLayer, serializeTheme, shippedTheme, shippedThemeIds, SHIPPED_THEMES_DIR, stylePlaces, TOKENS, tokenGuards, defaultTokens, LAYER_SCHEMA } from "../src/index.js";
import { finePitchBoard } from "./boards.js";

const tmp = () => mkdtempSync(join(tmpdir(), "board-style-"));

describe("tokens", () => {
  it("every default fits its own type, and paths are unique", () => {
    expect(new Set(TOKENS.map((t) => t.path)).size).toBe(TOKENS.length);
    for (const t of TOKENS) expect(checkTokenValue(t.path, t.default), t.path).toBeUndefined();
  });
  it("every fab and electrical token states its guard rail", () => {
    for (const t of TOKENS.filter((x) => x.class === "fab" || x.class === "electrical" || x.class === "placement")) expect(t.guard, t.path).toBeTruthy();
  });
  it("refuses values outside a token's type", () => {
    expect(checkTokenValue("fab.mask.color.top", "teal")).toMatch(/one of/);
    expect(checkTokenValue("silk.line", -1)).toMatch(/below/);
    expect(checkTokenValue("frame.chamfer", [0.9, 0.2])).toMatch(/low above high/);
    expect(checkTokenValue("type.class.designator", { height: 1, width: 1, stroke: 0.15, case: "upper" })).toMatch(/exactly/);
    expect(checkTokenValue("nope.token", 1)).toMatch(/unknown/);
  });
});

describe("theme files", () => {
  it("the three shipped themes parse and their files are in canonical form", () => {
    expect(shippedThemeIds()).toEqual(["arcade", "hazard-protocol", "neutral"]);
    for (const id of shippedThemeIds()) {
      const text = readFileSync(join(SHIPPED_THEMES_DIR, id, "theme.json"), "utf8");
      expect(serializeTheme(parseTheme(text)), id).toBe(text);
    }
  });
  it("a layer file round-trips byte for byte and refuses unknown tokens", () => {
    const l = { schema: LAYER_SCHEMA, extends: "neutral", tokens: { "frame.style": "rect", "type.class.designator": { height: 1, width: 0.8, stroke: 0.15, case: "upper", knockout: false } } } as const;
    const text = serializeLayer(l as never);
    expect(serializeLayer(parseLayer(text))).toBe(text);
    expect(() => parseLayer(JSON.stringify({ schema: LAYER_SCHEMA, tokens: { "frame.colour": 1 } }))).toThrow(/unknown token/);
  });
});

describe("the cascade", () => {
  it("defaults, shipped, user, project and board layers, each value with its layer and decision", () => {
    const root = tmp();
    writeFileSync(join(root, "protoboard.config.ts"), "export default {};\n");
    const boardDir = join(root, "boards", "main");
    mkdirSync(boardDir, { recursive: true });
    const user = join(tmp(), "pcb-style");
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, "theme.json"), serializeLayer({ schema: LAYER_SCHEMA, extends: "arcade", tokens: { "silk.line": 0.2 } }));
    mkdirSync(join(root, "style", "pcb"), { recursive: true });
    writeFileSync(join(root, "style", "pcb", "theme.json"), serializeLayer({ schema: LAYER_SCHEMA, tokens: { "designator.policy": "benchNeeded" } }));
    const places = stylePlaces({ boardDir, userDir: user });
    recordDecision(places, { said: "put the name on the back", tokens: [{ path: "nameplate.side", to: "bottom" }], scope: "board", date: "2026-11-09" });
    const s = resolveStyle({ doc: airnodeC3(), dir: boardDir }, { userDir: user });
    expect(s.theme.chain).toEqual(["neutral", "arcade"]);
    expect(s.tokens["copper.teardrops"].layer).toBe("default");
    expect(s.tokens["frame.style"]).toMatchObject({ layer: "shipped", theme: "arcade", value: "round" });
    expect(s.tokens["fab.finish"]).toMatchObject({ layer: "shipped", theme: "arcade" });
    expect(s.tokens["silk.line"]).toMatchObject({ layer: "user", value: 0.2 });
    expect(s.tokens["designator.policy"]).toMatchObject({ layer: "project", value: "benchNeeded" });
    expect(s.tokens["nameplate.side"]).toMatchObject({ layer: "board", value: "bottom", decision: "D-PCB-0001" });
    const e = explainToken(s, "nameplate.side");
    expect(e.chain.map((c) => `${c.layer}:${String(c.value)}`)).toEqual(["default:top", "shipped:top", "board:bottom"]);
    expect(e.text).toContain("D-PCB-0001");
    expect(explainToken(s, "frame.style").chain.map((c) => `${c.layer}:${c.theme ?? ""}`)).toEqual(["default:", "shipped:neutral", "shipped:arcade"]);
  });
  it("a printable size under the fab floor keeps its value and gets an effective value at the floor", () => {
    const s = resolveStyle(airnodeC3(), { userDir: false, overrides: { "type.class.designator": { height: 0.8, width: 0.8, stroke: 0.1, case: "upper", knockout: false } } });
    const t = s.tokens["type.class.designator"];
    expect(t.value).toMatchObject({ height: 0.8, stroke: 0.1 });
    expect(t.effective).toMatchObject({ height: 1.0, stroke: 0.15 });
    expect(t.clamp?.reason).toMatch(/1 mm text floor/);
    expect(explainToken(s, "type.class.designator").text).toMatch(/Effective value 1 x 0.8 x 0.15 mm/);
  });
  it("the default theme is Hazard Protocol with the reference board's rulings", () => {
    const s = resolveStyle(airnodeC3(), { userDir: false });
    expect(s.theme.id).toBe("hazard-protocol");
    expect(s.tokens["nameplate.date"].value).toBe("off");
    expect(s.tokens["nameplate.side"].value).toBe("bottom");
    expect(s.tokens["fab.mask.color.top"].value).toBe("matteBlack");
    expect(s.derived.maskWeb).toEqual({ top: 0.13, bottom: 0.13 });
    expect(shippedTheme("hazard-protocol").tokens["marks.maker"]).toBe("placeholder-maker");
  });
});

describe("guard rails", () => {
  it("mask color, silk color, full-color silk and finish against the fab profile", () => {
    const v = { ...defaultTokens(), "fab.mask.color.top": "matteGreen", "fab.silk.color.bottom": "black", "fab.silk.color.top": "fullColor", "fab.finish": "ENEPIG" };
    const g = tokenGuards(v, { copperLayers: 6 }).results;
    expect(g.find((x) => x.guard === "mask_color")?.severity).toBe("error");
    expect(g.find((x) => x.guard === "silk_color" && x.token === "fab.silk.color.bottom")?.message).toMatch(/white mask/);
    expect(g.find((x) => x.guard === "silk_color" && x.severity === "error")?.message).toMatch(/white mask.*ENIG.*2 to 4 copper layers/);
    expect(g.find((x) => x.guard === "finish")?.severity).toBe("error");
  });
  it("a black mask needs a wider web than green between fine-pitch pads", () => {
    const doc = finePitchBoard();
    const black = resolveStyle(doc, { userDir: false, overrides: { "fab.mask.color.top": "black" } });
    const green = resolveStyle(doc, { userDir: false, overrides: { "fab.mask.color.top": "green", "fab.mask.color.bottom": "green" } });
    const web = black.guards.find((g) => g.guard === "mask_web" && g.token === "fab.mask.color.top");
    expect(web).toMatchObject({ severity: "error", measured: 0.1, required: 0.13 });
    expect(green.guards.some((g) => g.guard === "mask_web")).toBe(false);
  });
});
