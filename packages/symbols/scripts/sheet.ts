#!/usr/bin/env node
/**
 * Contact sheets for review: node packages/symbols/scripts/sheet.ts [outDir]
 *
 * Writes, for the dark (canvas) and light (paper) themes:
 *   pack-<theme>.png        every drawn symbol and drawn variant: the schematic rendering at 20 px per grid unit
 *                           (pin anchors ringed in the accent color, pin ids beside them, the lattice as dots),
 *                           and the icon at 16 px and 24 px, true size
 *   generated-<theme>.png   the code-built samples (src/generate/samples.ts) at 16 px per grid unit (zoom 1)
 *   *.svg                   the same sheets as SVG
 *
 * Rasterized with @resvg/resvg-js, which the stack already installs (ext-tscircuit); when it cannot be loaded the
 * SVGs are still written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPack } from "../src/pack.ts";
import { iconInner, schematicSvg } from "../src/render.ts";
import { SAMPLES } from "../src/generate/samples.ts";
import type { SymbolDef } from "../src/types.ts";

const OUT = process.argv[2] ?? fileURLToPath(new URL("../sheets/", import.meta.url));
mkdirSync(OUT, { recursive: true });

interface Theme {
  name: string;
  bg: string;
  panel: string;
  ink: string;
  muted: string;
  accent: string;
  lattice: string;
}
/** Close to the stack's tokens: the uhd-viewer dark canvas, and a paper print theme. */
const THEMES: Theme[] = [
  { name: "dark", bg: "#141414", panel: "#1c1c1c", ink: "#dcdcdc", muted: "#8b8b8b", accent: "#4ea1ff", lattice: "#3b3b3b" },
  { name: "light", bg: "#ffffff", panel: "#f5f4f0", ink: "#1b1b1b", muted: "#7c7c7c", accent: "#1f6feb", lattice: "#c9c9c9" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const FONT = "Consolas, 'DejaVu Sans Mono', monospace";

const files = readPack();
const byId = new Map(files.map((f) => [f.def.id, f.def]));
const lookup = (id: string) => byId.get(id);

/** Place an <svg> string at x, y with a color. */
const at = (svg: string, x: number, y: number, color: string) => svg.replace("<svg ", `<svg x="${x}" y="${y}" color="${color}" `);

function iconCell(def: SymbolDef, x: number, y: number, size: number, t: Theme): string {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${t.ink}" color="${t.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconInner(def, lookup)}</svg>`;
}

interface Cell {
  def: SymbolDef;
  variant?: string;
  label: string;
  sub: string;
}

function packSheet(t: Theme): { svg: string; w: number; h: number } {
  const cells: Cell[] = [];
  for (const f of files) {
    const d = f.def;
    cells.push({ def: d, label: d.id, sub: `${d.convention === "ieee" ? "US " : d.convention === "iec" ? "IEC " : ""}${d.refdes}` });
    for (const [name, v] of Object.entries(d.variants)) if (v.body && name !== "icon") cells.push({ def: d, variant: name, label: `${d.id}`, sub: `· ${name}` });
  }
  const perRow = 9;
  const cw = 150;
  const ch = 196;
  const head = 54;
  const W = perRow * cw + 20;
  const H = head + Math.ceil(cells.length / perRow) * ch + 16;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${t.bg}"/>`];
  parts.push(
    `<text x="14" y="26" font-family="${FONT}" font-size="15" fill="${t.ink}">Protoboard symbol pack · ${files.length} drawn symbols, ${cells.length - files.length} drawn variants · ${t.name}</text>`,
    `<text x="14" y="44" font-family="${FONT}" font-size="11" fill="${t.muted}">schematic at 20 px per grid unit (0.1-unit stroke), anchors ringed, lattice dotted · icons at 16 px and 24 px, true size, 2 px stroke · draft for review 2026-11-09</text>`,
  );
  cells.forEach((c, i) => {
    const x = 10 + (i % perRow) * cw;
    const y = head + Math.floor(i / perRow) * ch;
    parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${cw - 4}" height="${ch - 4}" rx="6" fill="${t.panel}"/>`);
    parts.push(`<text x="${x + 10}" y="${y + 18}" font-family="${FONT}" font-size="10.5" fill="${t.ink}">${esc(c.label)}</text>`);
    parts.push(`<text x="${x + 10}" y="${y + 31}" font-family="${FONT}" font-size="9.5" fill="${t.muted}">${esc(c.sub)}</text>`);
    const frame = c.variant ? (c.def.variants[c.variant].frame ?? c.def.frame) : c.def.frame;
    const unitPx = frame.w > 24 ? 20 * (24 / frame.w) * 1.15 : 20;
    const size = frame.w * (unitPx / 5);
    const sch = schematicSvg(c.def, { unitPx, variant: c.variant, anchors: true, pinIds: true, accent: t.accent, lattice: t.lattice });
    parts.push(at(sch, x + (cw - size) / 2, y + 36 + (112 - size) / 2, t.ink));
    if (!c.variant) {
      parts.push(iconCell(c.def, x + 14, y + 162, 16, t));
      parts.push(iconCell(c.def, x + 40, y + 158, 24, t));
      const from = c.def.icon.from;
      const note = from === "body" ? (c.def.icon.omitRoles.length ? `icon − ${c.def.icon.omitRoles.join(",")}` : "") : `icon ← ${from.replace("pack:", "")}`;
      if (note) parts.push(`<text x="${x + 72}" y="${y + 174}" font-family="${FONT}" font-size="8.5" fill="${t.muted}">${esc(note)}</text>`);
    }
  });
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`, w: W, h: H };
}

function generatedSheet(t: Theme): { svg: string; w: number; h: number } {
  const built = SAMPLES.map((s) => ({ s, def: s.build() }));
  const unitPx = 16;
  const W = 1400;
  const parts: string[] = [];
  let x = 14;
  let y = 64;
  let rowH = 0;
  const placed: string[] = [];
  for (const { s, def } of built) {
    const w = (def.frame.w * unitPx) / 5;
    const h = (def.frame.h * unitPx) / 5;
    const cellW = Math.max(w, 210) + 24;
    const cellH = h + 64;
    if (x + cellW > W - 10) {
      x = 14;
      y += rowH + 12;
      rowH = 0;
    }
    placed.push(`<rect x="${x}" y="${y}" width="${cellW - 8}" height="${cellH}" rx="6" fill="${t.panel}"/>`);
    placed.push(`<text x="${x + 10}" y="${y + 18}" font-family="${FONT}" font-size="11" fill="${t.ink}">${esc(s.title)}</text>`);
    placed.push(`<text x="${x + 10}" y="${y + 31}" font-family="${FONT}" font-size="9.5" fill="${t.muted}">${esc(s.generator)}</text>`);
    placed.push(at(schematicSvg(def, { unitPx, anchors: true, accent: t.accent }), x + 8, y + 38, t.ink));
    placed.push(iconCell(def, x + cellW - 66, y + 8, 16, t));
    placed.push(iconCell(def, x + cellW - 44, y + 4, 24, t));
    x += cellW;
    rowH = Math.max(rowH, cellH);
  }
  const H = y + rowH + 16;
  parts.push(`<rect width="${W}" height="${H}" fill="${t.bg}"/>`);
  parts.push(
    `<text x="14" y="26" font-family="${FONT}" font-size="15" fill="${t.ink}">Code-built symbols · ${built.length} samples from pin data · ${t.name}</text>`,
    `<text x="14" y="44" font-family="${FONT}" font-size="11" fill="${t.muted}">16 px per grid unit (canvas zoom 1) · pins on the lattice, one unit long · groups split by a blank row · icon computed per family (16 and 24 px)</text>`,
  );
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}${placed.join("")}</svg>`, w: W, h: H };
}

let Resvg: (new (svg: string, opts: object) => { render(): { asPng(): Uint8Array } }) | undefined;
try {
  ({ Resvg } = (await import("@resvg/resvg-js")) as unknown as { Resvg: typeof Resvg });
} catch {
  console.warn("@resvg/resvg-js not found: writing SVG sheets only");
}

const written: string[] = [];
for (const t of THEMES) {
  for (const [name, sheet] of [
    [`pack-${t.name}`, packSheet(t)],
    [`generated-${t.name}`, generatedSheet(t)],
  ] as const) {
    writeFileSync(join(OUT, `${name}.svg`), sheet.svg);
    if (Resvg) {
      const png = new Resvg(sheet.svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: true, defaultFontFamily: "Consolas" }, shapeRendering: 2 }).render().asPng();
      writeFileSync(join(OUT, `${name}.png`), png);
      written.push(join(OUT, `${name}.png`));
    }
  }
}
console.log(written.length ? written.join("\n") : `SVG sheets in ${OUT}`);
