/**
 * Rendering through @protoboardai/ext-docs: one headless Chrome and one static
 * server for the whole release (FigureRenderer), serving a staging folder in
 * which every document is laid out as it is in the package.
 *
 *   - figures: each unit's assembled CAD (assemble() placements and fastener
 *     hardware, filtered to the unit's instances), line art from the GLBs;
 *   - documents: ext-docs' page shell and flow paginator, then printed to PDF.
 *
 * Chrome writes the print time into a PDF's /CreationDate and /ModDate; they
 * are replaced by the release date (same length, so the xref table stays
 * valid), which makes a rebuild byte-identical.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@protoboardai/core";
import { docFonts } from "@protoboardai/ext-docs/build";
import { shell, type DocMeta } from "@protoboardai/ext-docs/html";
import { buildScene, loadSystem, type SceneBody } from "@protoboardai/ext-docs/model";
import { ISO, renderBody } from "@protoboardai/ext-docs/figures";
import { FigureRenderer, type RenderResult, type RenderSpec } from "@protoboardai/ext-docs/renderer";
import type { Unit } from "./types.ts";

/** Fonts the package may carry: Kode Mono (SIL Open Font License). */
const SHIPPABLE_FONT = /^KodeMono-.*\.(ttf|woff2)$/;

export interface Fonts {
  /** Each font staged, with the file it was read from. */
  files: { file: string; path: string }[];
}

/** Copy the document fonts into the staging folder (assets/fonts): the bundled Kode Mono, or the files of the same name PROTOBOARD_DOC_FONTS gives. */
export function stageFonts(staging: string): Fonts {
  const dst = join(staging, "assets", "fonts");
  mkdirSync(dst, { recursive: true });
  const files = docFonts();
  for (const f of files) copyFileSync(f.path, join(dst, f.file));
  return { files };
}
export const shippableFont = (name: string) => SHIPPABLE_FONT.test(name);

export class Renderer {
  /** Pagination and printing: serves the staging folder. */
  private r: FigureRenderer;
  /** Figures: serves the project (GLBs resolve where they are), writing into staging/assets/images. */
  private fig?: FigureRenderer;
  private sys?: Awaited<ReturnType<typeof loadSystem>>;
  constructor(
    private p: Project,
    private staging: string,
  ) {
    this.r = new FigureRenderer(join(staging, "assets", "images"), { project: staging, packageRoot: () => undefined });
  }

  private async figures(): Promise<FigureRenderer> {
    this.sys ??= await loadSystem(this.p);
    this.fig ??= new FigureRenderer(join(this.staging, "assets", "images"), this.sys.roots);
    return this.fig;
  }

  /** Render one figure to assets/images/<name>.png in the staging folder. */
  async figure(name: string, spec: RenderSpec): Promise<RenderResult> {
    return (await this.figures()).render(name, spec);
  }

  /** A line-art figure of each unit with placed CAD bodies (`assets/images/unit-<id>.png`). */
  async unitFigures(units: Unit[]): Promise<Map<string, { file: string; width: number; height: number; bodies: number }>> {
    const out = new Map<string, { file: string; width: number; height: number; bodies: number }>();
    if (!this.p.rootDef) return out;
    const fig = await this.figures();
    let scene;
    try {
      scene = buildScene(this.sys!);
    } catch {
      return out;
    }
    for (const u of units) {
      const inUnit = (path: string) => u.kind === "root" || u.instances.some((i) => path === i || path.startsWith(i + "/"));
      const bodies: SceneBody[] = [...scene.bodies.filter((b) => !b.via?.startsWith("hint:") && inUnit(b.path.join("/"))), ...scene.hardware.filter((h) => inUnit(h.path.join("/")))];
      // one build: a module unit shows its representative instance only
      const rep = (path: string) => path === u.representative || path.startsWith(u.representative + "/");
      const shown = u.kind === "module" ? bodies.filter((b) => rep(b.path.join("/"))) : bodies;
      if (!shown.filter((b) => b.glb).length) continue;
      const res = await fig.render(`unit-${u.id}`, { width: 2000, height: 1180, mode: "lineart", bodies: shown.map((b) => renderBody(b, "normal")), camera: { dir: ISO, margin: 0.05 } });
      out.set(u.id, { file: `assets/images/unit-${u.id}.png`, width: res.width, height: res.height, bodies: shown.length });
    }
    return out;
  }

  /** Write a document into the staging folder, paginate it, print it; returns the PDF bytes (dates normalised) and page count. */
  async pdf(rel: string, meta: DocMeta, body: string, fontsHref: string, pdfDate: string): Promise<{ pdf: Buffer; pages: number; overflow: number[] }> {
    const htmlRel = rel.replace(/\.pdf$/, ".print.html");
    const abs = join(this.staging, htmlRel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, shell(meta, body, { fontsHref, extraCss: PRINT_CSS }));
    const pag = await this.r.paginate(`project/${htmlRel}`);
    writeFileSync(abs, pag.html);
    const pdf = normalisePdf(await this.r.printPdf(`project/${htmlRel}`), pdfDate);
    return { pdf, pages: pag.pages, overflow: pag.overflow };
  }

  /** Stop the figure renderer's Chrome (one Chrome at a time: the documents start their own). */
  async closeFigures() {
    await this.fig?.close();
    this.fig = undefined;
  }

  async close() {
    await this.fig?.close();
    await this.r.close();
  }
}

/** D:YYYYMMDDHHmmSS+00'00' from an ISO date-time. */
export function pdfDate(iso: string): string {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) ? new Date(0) : d;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(t.getUTCFullYear(), 4)}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}+00'00'`;
}

/**
 * Make Chrome's PDF depend only on the document: the creation and
 * modification dates become the release date, and the tagged-PDF element ids
 * (`nodeNNNNNNNN`) are renumbered in document order. Chrome takes them from
 * a DOM node counter that depends on what the tab did before, and their
 * relative order can change from run to run (the table header cells of a
 * smart-bottle BOM came out in another order once, PB-809), so neither the
 * numbers nor their ranks are stable; the order of the structure elements in
 * the file is. The ID tree's name arrays are then sorted again and their
 * limits reset. Every replacement keeps its length, so the xref offsets stay
 * valid. A PDF whose ID tree cannot be rewritten in place falls back to
 * renumbering the ids by rank, as before PB-809.
 */
export function normalisePdf(pdf: Buffer, date: string): Buffer {
  let text = pdf.toString("latin1");
  text = text.replace(/\/(CreationDate|ModDate) \(D:[0-9]{14}[^)]*\)/g, (m, key: string) => {
    const value = `/${key} (${date})`;
    return value.length === m.length ? value : m;
  });
  return Buffer.from(renumberElementIds(text), "latin1");
}

const ELEMENT_ID = /\/ID \((node\d+)\)/g;
const ANY_ID = /\((node\d+)\)/g;
const NAMES_LEAF = /\/Limits \[\((node\d+)\) \((node\d+)\)\]\n\/Names \[((?:\(node\d+\) \d+ \d+ R ?)+)\]/g;

/**
 * The fallback: ids renumbered by the rank of Chrome's number, which keeps the
 * ID tree sorted and every id its length. Stable unless Chrome changes the
 * relative order of its node counter, which document order also covers.
 */
export function renumberByRank(text: string): string {
  const ids = [...new Set(text.match(/\(node\d+\)/g) ?? [])].sort((a, b) => Number(a.slice(5, -1)) - Number(b.slice(5, -1)));
  const rank = new Map(ids.map((id, i) => [id, `(node${String(i + 1).padStart(id.length - 6, "0")})`]));
  return text.replace(/\(node\d+\)/g, (m) => (rank.get(m)!.length === m.length ? rank.get(m)! : m));
}

function renumberElementIds(text: string): string {
  const order: string[] = [];
  for (const m of text.matchAll(ELEMENT_ID)) if (!order.includes(m[1])) order.push(m[1]);
  if (!order.length) return renumberByRank(text);
  const renamed = new Map(order.map((id, i) => [id, `node${String(i + 1).padStart(id.length - 4, "0")}`]));
  if ([...renamed].some(([a, b]) => a.length !== b.length)) return renumberByRank(text);
  // every reference (the ID tree, a table cell's /Headers) must name an element the file defines
  if ([...text.matchAll(ANY_ID)].some((m) => !renamed.has(m[1]))) return renumberByRank(text);
  const name = (id: string) => renamed.get(id)!;
  const rename = (part: string) => part.replace(ANY_ID, (_m, id: string) => `(${name(id)})`);

  // the ID tree's leaves, in file order: rename every entry, sort them all, and refill each leaf with as many as it had
  const leaves = [...text.matchAll(NAMES_LEAF)];
  const entries = leaves.flatMap((l) => [...l[3].matchAll(/\((node\d+)\) (\d+ \d+ R)/g)].map((e) => ({ id: name(e[1]), ref: e[2] })));
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let next = 0;
  const rewritten = leaves.map((l) => {
    const n = [...l[3].matchAll(/\(node\d+\)/g)].length;
    const mine = entries.slice(next, (next += n));
    const body = mine.map((e) => `(${e.id}) ${e.ref}`).join(" ") + (l[3].endsWith(" ") ? " " : "");
    return { at: l.index!, from: l[0], to: `/Limits [(${mine[0].id}) (${mine[mine.length - 1].id})]\n/Names [${body}]` };
  });
  // a leaf that would change length (entries moved between leaves) would move bytes: renumber by rank then
  if (rewritten.some((r) => r.to.length !== r.from.length)) return renumberByRank(text);
  let out = "";
  let last = 0;
  for (const r of rewritten) {
    out += rename(text.slice(last, r.at)) + r.to;
    last = r.at + r.from.length;
  }
  return out + rename(text.slice(last));
}

/** Rules the release documents add to ext-docs' print theme. */
export const PRINT_CSS = `
table.kv td:first-child { width: 42mm; }
.doc-head { display: flex; gap: 4mm; align-items: baseline; font-size: 6.4pt; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin: -1mm 0 4mm; }
.doc-head b { color: var(--ink); font-weight: 600; }
.part .p-name { grid-column: 2; }
td.nw, th.nw { white-space: nowrap; }
.part.noimg { grid-template-columns: auto; min-width: 0; }
.part.noimg .p-name { grid-column: 1; }
.step-no.wide { width: auto; min-width: 8.5mm; padding: 0 2.2mm; border-radius: 4.25mm; font-size: 9.5pt; }
.step .figwrap { margin-top: 1mm; }
`;
