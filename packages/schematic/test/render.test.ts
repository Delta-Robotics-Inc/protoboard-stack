/**
 * Renderer overlays: a proposal's ghost (dashed before and after states drawn on top of the sheet) and print
 * pagination (whole cards per paper sheet, each page with its own frame and "n of N" title block). Outputs go to
 * test/.tmp/ (Git-ignored) for a look by eye.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { airnodeSchematic } from "../src/fixtures/airnode-c3.ts";
import { withChanges, type SchematicDocument } from "../src/document.ts";
import { ghostDiff, paginateSchematic, renderSchematicPages, renderSchematicSvg, THEMES } from "../src/render/svg.ts";
import type { OpCall } from "@protoboardai/board";

const TMP = join(dirname(fileURLToPath(import.meta.url)), ".tmp", "render");
const save = (name: string, svg: string) => {
  mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, name), svg);
};

let ok: SchematicDocument;
let withProposal: SchematicDocument;
let ops: OpCall[];

beforeAll(async () => {
  ok = await airnodeSchematic("ok");
  const card = ok.records.get("card:sensor");
  if (card?.kind !== "card") throw new Error("the Airnode sheet has no sensor card");
  ops = [
    { op: "item.move", ids: ["sym:sensor/r_sda"], dx: 2, dy: 1 },
    { op: "label.add", labels: [{ net: "I2C_SDA", card: "card:sensor", x: card.x + 4, y: card.y + card.h - 3, side: "right", scope: "local" }] },
  ];
  withProposal = withChanges(ok, [{ kind: "proposal", id: "prop:test", title: "Move R3 and name SDA", ops, provenance: { by: "agent", actor: "agent:test" } }]);
});

describe("proposal ghosts", () => {
  it("diff the proposal: one symbol changed, one label added, nothing removed", () => {
    const d = ghostDiff(withProposal, { proposal: "prop:test" });
    expect(d.changed).toEqual(["sym:sensor/r_sda"]);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toMatch(/^lbl:ghost\.\d+$/);
    expect(d.removed).toEqual([]);
  });

  for (const theme of ["dark", "paper"] as const) {
    it(`draw the ghost colors on top of the ${theme} sheet, deterministically, and add nothing else`, () => {
      const plain = renderSchematicSvg(withProposal, { theme });
      const ghost = renderSchematicSvg(withProposal, { theme, ghost: { proposal: "prop:test" } });
      save(`ghost-${theme}.svg`, ghost);
      expect(ghost).toBe(renderSchematicSvg(withProposal, { theme, ghost: { proposal: "prop:test" } }));
      expect(ghost).toContain(THEMES[theme].ghost.after);
      expect(ghost).toContain(THEMES[theme].ghost.before);
      expect(ghost).toContain(`stroke-dasharray="${THEMES[theme].ghost.dash}"`);
      expect(plain).not.toContain("data-ghost");
      // the ghost is one group inserted into the plain render
      const i = ghost.indexOf('<g data-ghost="prop:test">');
      expect(i).toBeGreaterThan(0);
      expect(ghost.slice(0, i)).toBe(plain.slice(0, i));
      const tail = plain.slice(i);
      expect(ghost.endsWith(tail)).toBe(true);
      const inserted = ghost.slice(i, ghost.length - tail.length);
      expect(inserted.startsWith('<g data-ghost="prop:test">')).toBe(true);
      expect(inserted.endsWith("</g></g>")).toBe(true);
      expect(inserted).toContain('data-ghost-layer="before"');
      expect(inserted).toContain('data-ghost-layer="after"');
    });
  }

  it("draws the same ghost from the calls themselves", () => {
    const a = renderSchematicSvg(ok, { ghost: { ops } });
    const b = renderSchematicSvg(withProposal, { ghost: { proposal: "prop:test" } });
    expect(a.replace('data-ghost="ops"', "")).toBe(b.replace('data-ghost="prop:test"', ""));
  });

  it("refuses a missing proposal", () => {
    expect(() => renderSchematicSvg(ok, { ghost: { proposal: "prop:nothing" } })).toThrow(/no proposal/);
  });
});

describe("pagination", () => {
  it("covers every card exactly once on A4 landscape, each crop holding its cards", () => {
    const pages = paginateSchematic(ok, { paper: "A4", orientation: "landscape" });
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const cards = [...ok.records.values()].filter((r) => r.kind === "card").map((r) => r.id).sort();
    expect(pages.flatMap((p) => p.cards).sort()).toEqual(cards);
    const w = 297 / 2.54;
    const h = 210 / 2.54;
    for (const [i, p] of pages.entries()) {
      expect(p.n).toBe(i + 1);
      expect(p.of).toBe(pages.length);
      if (!p.oversize) {
        expect(p.crop.x1 - p.crop.x0).toBeCloseTo(w, 2);
        expect(p.crop.y1 - p.crop.y0).toBeCloseTo(h, 2);
      }
      for (const id of p.cards) {
        const c = ok.records.get(id);
        if (c?.kind !== "card") throw new Error(id);
        expect(c.x).toBeGreaterThanOrEqual(p.crop.x0);
        expect(c.y).toBeGreaterThanOrEqual(p.crop.y0);
        expect(c.x + c.w).toBeLessThanOrEqual(p.crop.x1);
        expect(c.y + c.h).toBeLessThanOrEqual(p.crop.y1);
      }
    }
  });

  it("gives a card larger than the paper its own page at its own size", () => {
    const pages = paginateSchematic(ok, { paper: "A4", margin: 40 });
    const cards = [...ok.records.values()].filter((r) => r.kind === "card");
    expect(pages.length).toBe(cards.length);
    for (const p of pages) {
      expect(p.oversize).toBe(true);
      expect(p.cards).toHaveLength(1);
      const c = ok.records.get(p.cards[0]);
      if (c?.kind !== "card") throw new Error(p.cards[0]);
      expect(p.crop.x0).toBeLessThanOrEqual(c.x - 40);
      expect(p.crop.x1).toBeGreaterThanOrEqual(c.x + c.w + 40);
    }
  });

  it("renders one framed SVG per page with its sheet number in the title block", () => {
    const pages = paginateSchematic(ok, { paper: "A4" });
    const svgs = renderSchematicPages(ok, { paper: "A4" });
    expect(svgs).toHaveLength(pages.length);
    expect(svgs).toEqual(renderSchematicPages(ok, { paper: "A4" }));
    for (const [i, svg] of svgs.entries()) {
      save(`page-a4-${i + 1}.svg`, svg);
      const n = pages.length;
      expect(svg).toContain(`data-page="${i + 1}" data-pages="${n}"`);
      expect(svg).toContain(`data-sheet="${i + 1} of ${n}"`);
      expect(svg.match(/data-title-block/g)).toHaveLength(1);
      expect(svg).not.toMatch(/<text/);
      const c = pages[i].crop;
      const vb = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
      expect(vb[0]).toBeCloseTo(c.x0, 3);
      expect(vb[1]).toBeCloseTo(c.y0, 3);
      expect(vb[2]).toBeCloseTo(c.x1 - c.x0, 3);
      expect(vb[3]).toBeCloseTo(c.y1 - c.y0, 3);
    }
    expect(svgs[0]).toContain(`data-sheet="1 of ${pages.length}"`);
  });

  it("keeps plain crops frameless", () => {
    const svg = renderSchematicSvg(ok, { theme: "paper", crop: { x0: 0, y0: 0, x1: 40, y1: 30 } });
    expect(svg).not.toContain("data-title-block");
    expect(renderSchematicSvg(ok, { theme: "paper" })).toContain('data-sheet="1 of 1"');
  });
});
