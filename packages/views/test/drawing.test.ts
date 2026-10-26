/** Board drawings: made safe for the page and themed by role (PB-898). */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { affineOf, canonicalColour, readableAngle, textReading, themeSvg, tokens, type Affine } from "../src/drawing/svg.js";
import { PCB_PALETTE, SCHEMATIC_PALETTE } from "../src/drawing/palettes.js";

const BOTTLE = new URL("../../../examples/smart-bottle/src/boards/bottle-cap/out/", import.meta.url);
const WATCH = new URL("../../../examples/wearable-watch/src/boards/watch-main/out/", import.meta.url);

const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

/** How every text of the markup reads on screen, with its ancestors' transforms. */
function textsOf(markup: string): { text: string; mirrored: boolean; angle: number; transform?: string }[] {
  const out: { text: string; mirrored: boolean; angle: number; transform?: string }[] = [];
  const stack: Affine[] = [[1, 0, 0, 1, 0, 0]];
  let open: (typeof out)[number] | undefined;
  for (const t of tokens(markup)) {
    if (t.kind === "open") {
      const tr = new Map(t.attrs).get("transform");
      const m = mul(stack[stack.length - 1], affineOf(tr));
      if (t.name === "text") out.push((open = { text: "", ...textReading(m), transform: tr }));
      if (!t.selfClosing) stack.push(m);
    } else if (t.kind === "close") {
      stack.pop();
      if (t.name === "text") open = undefined;
    } else if (open) open.text += t.text;
  }
  return out;
}

describe("drawing SVG", () => {
  it("drops scripts, handlers, foreign content, styles and external references", () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="10" height="20" onload="alert(1)">
      <script>alert(1)</script><style>rect{fill:red}</style>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
      <a href="javascript:alert(1)"><rect width="1" height="1"/></a>
      <rect id="r" width="2" height="2" fill="url(http://x/y)" style="fill: url(https://x); stroke: rgb(0, 150, 0); behavior: url(x.htc)" onclick="x()"/>
      <use href="https://evil/x.svg#a"/><use xlink:href="#r"/>
      <image href="x.png"/>
      <text x="1" y="2">a &lt;b&gt;</text>
    </svg>`;
    const { markup, viewBox } = themeSvg(evil, { palette: SCHEMATIC_PALETTE, idPrefix: "d1-" });
    expect(markup).not.toMatch(/script|onload|onclick|alert|foreignObject|<style|<a |<image|http|behavior/);
    expect(markup).toContain('<use href="#d1-r"/>');
    expect(markup).toContain('id="d1-r"');
    expect(markup).toContain("stroke: var(--pb-d-wire)");
    expect(markup).toContain("a &lt;b&gt;");
    expect(viewBox).toEqual([0, 0, 10, 20]);
  });

  it("reads colours however the tool writes them", () => {
    expect(canonicalColour("rgb(0, 150, 0)")).toBe("#009600");
    expect(canonicalColour("#FF6B6B")).toBe("#ff6b6b");
    expect(canonicalColour("#fff")).toBe("#ffffff");
    expect(canonicalColour("rgba(255, 255, 255, 0.6)")).toBe("#ffffff/0.6");
    expect(canonicalColour("red")).toBe("#ff0000");
  });

  it("tokenizes quoted > and self-closing tags", () => {
    const t = [...tokens(`<svg a="x>y"><g/><path d='M 0 0'/></svg>`)];
    expect(t.map((x) => x.kind + (x.name ?? ""))).toEqual(["opensvg", "openg", "openpath", "closesvg"]);
    expect(t[0].attrs).toEqual([["a", "x>y"]]);
  });

  it.skipIf(!existsSync(new URL("schematic.svg", BOTTLE)))("themes every colour of the smart bottle's schematic and PCB", () => {
    for (const [file, palette] of [["schematic.svg", SCHEMATIC_PALETTE], ["pcb-top.svg", PCB_PALETTE], ["pcb-bottom.svg", PCB_PALETTE]] as const) {
      const { markup, colours, viewBox } = themeSvg(readFileSync(new URL(file, BOTTLE), "utf8"), { palette, idPrefix: "b-" });
      const unknown = [...colours].filter(([, role]) => !role).map(([c]) => c);
      expect(unknown, file).toEqual([]);
      expect(viewBox, file).toBeDefined();
      expect(markup.startsWith("<svg")).toBe(true);
      // component and pad data survive for the view's interactions
      expect(markup).toMatch(file === "schematic.svg" ? /data-schematic-component-id="schematic_component_0"/ : /data-pad-name="u1\.GND"|data-pad-name=/);
      // text stays upright or reads bottom to top (rotate(-90)), never top to bottom
      expect(markup).not.toMatch(/<text[^>]*rotate\((90|270)[ ,]/);
    }
  });

  it("draws a mirrored bottom side seen from below, its text readable", () => {
    const src = `<svg viewBox="10 0 100 50"><rect x="20" y="5" width="10" height="10"/>
      <text x="0" y="0" text-anchor="start" transform="matrix(-1,0,0,1,40,20)">j3</text>
      <text x="5" y="6" transform="rotate(180)">up</text>
      <text x="0" y="0" transform="translate(5 5)">ok</text></svg>`;
    for (const mirror of [false, true]) {
      const { markup } = themeSvg(src, { palette: PCB_PALETTE, idPrefix: "m-", mirror });
      expect(markup.includes('data-pb-mirror="120"'), String(mirror)).toBe(mirror);
      for (const t of textsOf(markup)) {
        expect(t.mirrored, `${t.text} mirror=${mirror}`).toBe(false);
        expect(readableAngle(t.angle), `${t.text} ${t.angle}`).toBe(true);
      }
    }
    // unmirrored in place, its anchor turned so it covers the same ground
    const plain = themeSvg(src, { palette: PCB_PALETTE, idPrefix: "m-" }).markup;
    expect(plain).toMatch(/<text x="0" y="0" text-anchor="end" transform="matrix\(1,0,0,1,40,20\)"/);
    // a text the tool wrote the right way round stays exactly as it was, unless the side is mirrored
    expect(plain).toContain('transform="translate(5 5)"');
  });

  for (const [name, dir] of [["smart bottle", BOTTLE], ["watch", WATCH]] as const) {
    it.skipIf(!existsSync(new URL("pcb-bottom.svg", dir)))(`every PCB text of the ${name} reads upright, the bottom seen from below`, () => {
      for (const [file, mirror] of [["pcb-top.svg", false], ["pcb-bottom.svg", true]] as const) {
        const { markup } = themeSvg(readFileSync(new URL(file, dir), "utf8"), { palette: PCB_PALETTE, idPrefix: "p-", mirror });
        const texts = textsOf(markup);
        expect(texts.length, file).toBeGreaterThan(0);
        for (const t of texts) {
          expect(t.mirrored, `${file} ${t.text}`).toBe(false);
          expect(readableAngle(t.angle), `${file} ${t.text} ${t.angle}`).toBe(true);
          // a side drawn as it is: the text's own transform says so plainly
          if (!mirror) expect(t.transform ?? "", `${file} ${t.text}`).not.toMatch(/matrix\(-1|rotate\((-?180|-?270|90)[ ,)]/);
        }
      }
    });
  }
});

describe("a KiCad export (a locked board's drawings)", () => {
  const kicad = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">
<title>SVG Image created as b.svg</title>
<desc>Image generated by Eeschema-SVG </desc>
<g style="fill:#F5F4EF; stroke:#F5F4EF; stroke-width:0.0001;"><rect x="0" y="0" width="297" height="210" /></g>
<g style="fill:none; stroke:#009600; stroke-width:0.2540;"><path d="M 10,10 20,10" /></g>
<g style="fill:#FFFFC2; stroke:#840000;"><rect x="30" y="30" width="10" height="10" /></g>
<g style="fill:none; stroke:#006464;"><text x="30" y="28" opacity="0">U1</text></g>
</svg>`;
  const t = themeSvg(kicad, { palette: SCHEMATIC_PALETTE, idPrefix: "k-" });
  it("is known as KiCad's, by its description", () => {
    expect(t.generator).toBe("kicad");
    expect(themeSvg('<svg data-software-used-string="@tscircuit/core@0.0.1"></svg>', { palette: SCHEMATIC_PALETTE, idPrefix: "x-" }).generator).toBe("tscircuit");
  });
  it("draws KiCad's sheet, wires, bodies and fields in the theme's roles", () => {
    expect(t.colours.get("#f5f4ef")).toBe("paper");
    expect(t.colours.get("#009600")).toBe("wire");
    expect(t.colours.get("#ffffc2")).toBe("body");
    expect(t.colours.get("#006464")).toBe("label");
    const pcb = themeSvg('<svg viewBox="0 0 10 10"><g style="fill:#D864FF; stroke:#E8B2A7"><rect x="1" y="1" width="1" height="1"/></g><path style="stroke:#D0D2CD" d="M0 0 L1 1"/></svg>', { palette: PCB_PALETTE, idPrefix: "p-" });
    expect([pcb.colours.get("#d864ff"), pcb.colours.get("#e8b2a7"), pcb.colours.get("#d0d2cd")]).toEqual(["pad", "silk", "edge"]);
  });
  it("marks the sheet behind the drawing, so a fit shows what is drawn, not the page", () => {
    expect(t.markup).toMatch(/<rect[^>]*data-pb-page=""/);
    expect(t.markup.match(/data-pb-page/g)).toHaveLength(1);
  });
  it("says which role each element's own stroke and fill play (the view finds wires and bodies by them)", () => {
    expect(t.markup).toMatch(/<g data-pb-stroke="wire"/);
    expect(t.markup).toMatch(/data-pb-stroke="ink" data-pb-fill="body"/);
  });
});
