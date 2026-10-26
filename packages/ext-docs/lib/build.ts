/**
 * Build technical documents for a Protoboard project's system (the
 * uhd-tech-docs skill; `protoboard run tech-docs`). Moved from UHD's
 * scripts/docs/build.ts (PB-801) and made to read a project instead of a
 * library system folder.
 *
 * Writes into the project's docs/:
 *   <system-id>-datasheet.html / .pdf / .values.json
 *   <system-id>-assembly-guide.html / .pdf / .values.json
 *   <system-id>-bom.json   the BOM the documents publish (bom.ts)
 *   images/                figures rendered from the GLB artifacts (cached by content)
 *   test-data/             stand-in (and measured) test data
 *   .review/<doc>/         page PNGs for visual review (gitignored)
 *   assets/fonts/          fonts copied at build time (gitignored)
 *
 * Every value is a query into the model (values.ts); run verify.ts afterwards.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { fileURLToPath } from "url";
import type { Project } from "@protoboardai/core";
import { bomFile, buildContext, type BuiltContext } from "./context.ts";
import { Doc, shell, type DocMeta } from "./html.ts";
import { FigureRenderer } from "./render/renderer.ts";
import { projectPath } from "./render/server.ts";
import { buildDatasheet, provenanceSection } from "./docs/datasheet.ts";
import { buildAssemblyGuide, assemblyProvenance } from "./docs/assembly.ts";
import { imgPath, type BuildEnv } from "./docs/common.ts";
import { writeStandins } from "./standin.ts";

export const DOC_TYPES = {
  datasheet: { suffix: "datasheet", title: "Datasheet", code: "DS" },
  assembly: { suffix: "assembly-guide", title: "Assembly guide", code: "AG" },
} as const;
export type DocType = keyof typeof DOC_TYPES;

/** Kode Mono (SIL Open Font License 1.1), shipped in this package: `fonts/`, with its licence. */
export const BUNDLED_FONTS = fileURLToPath(new URL("../fonts/", import.meta.url));

/** The font files documents use: Kode Mono, its Bold for display text. */
export const DOC_FONT = /^KodeMono-.*\.ttf$/;

/**
 * The folder named by $PROTOBOARD_DOC_FONTS (or the older $UHD_DOC_FONTS), if
 * any: a file there replaces the bundled Kode Mono file of the same name.
 * Documents need none of it.
 */
export const fontsDir = (): string | undefined => process.env.PROTOBOARD_DOC_FONTS || process.env.UHD_DOC_FONTS || undefined;

/**
 * The document font files, by name, each with where it is read from: the
 * bundled Kode Mono, with any file of the same name in $PROTOBOARD_DOC_FONTS
 * taking its place. The default never depends on
 * another checkout, so every machine without the variable renders the same
 * documents (PB-809).
 */
export function docFonts(): { file: string; path: string }[] {
  const byName = new Map<string, string>();
  for (const dir of [BUNDLED_FONTS, fontsDir()]) {
    if (!dir || !existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) if (DOC_FONT.test(f)) byName.set(f, join(dir, f));
  }
  return [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([file, path]) => ({ file, path }));
}

/** Fonts are copied next to the documents at build time (not committed). */
function copyFonts(docDir: string): boolean {
  const dst = join(docDir, "assets", "fonts");
  mkdirSync(dst, { recursive: true });
  writeFileSync(join(docDir, "assets", ".gitignore"), "# Fonts are copied in at build time: Kode Mono from @protoboardai/ext-docs.\nfonts/\n");
  const env = fontsDir();
  if (env && !existsSync(env)) console.warn(`fonts: PROTOBOARD_DOC_FONTS=${env} not found; using the bundled Kode Mono only`);
  const fonts = docFonts();
  for (const f of fonts) copyFileSync(f.path, join(dst, f.file));
  return fonts.length > 0;
}

export interface BuildResult {
  type: DocType;
  /** Project-relative files. */
  html: string;
  pdf?: string;
  values: string;
  pages: number;
  overflow: number[];
  boundValues: number;
}

export interface BuildReport {
  docs: BuildResult[];
  /** Project-relative files this build wrote and the documents use (images, test data, BOM). */
  files: string[];
  standins: { written: string[]; kept: string[] };
  figures: { rendered: number; reused: number };
  fonts: boolean;
}

export async function buildDocs(p: Project, opts: { only?: DocType; pdf?: boolean; standins?: boolean; log?: (line: string) => void } = {}): Promise<BuildReport> {
  const log = opts.log ?? ((l: string) => console.log(l));
  let ctx: BuiltContext = await buildContext(p);
  let standins = { written: [] as string[], kept: [] as string[] };
  if (opts.standins !== false) {
    standins = await writeStandins(ctx);
    if (standins.written.length || standins.kept.length) log(`test data: stand-ins ${standins.written.join(", ") || "none"}; measured ${standins.kept.join(", ") || "none"}`);
    ctx = await buildContext(p);
  }
  if (ctx.testErrors.length) throw new Error(`test data invalid:\n  ${ctx.testErrors.join("\n  ")}`);
  const docDir = ctx.sys.absDocs;
  mkdirSync(docDir, { recursive: true });
  // the BOM the documents publish is the live model's; verify compares the committed file with the model again
  // (the context is rebuilt from the written file: its value resolver reads the BOM it was built with, and a stale file
  // would leave the document's bound BOM values one model behind its tables)
  const bomPath = join(ctx.sys.root, bomFile(ctx.sys));
  const liveJson = JSON.stringify(ctx.liveBom, null, 2) + "\n";
  const stale = !existsSync(bomPath) || readFileSync(bomPath, "utf8") !== liveJson;
  writeFileSync(bomPath, liveJson);
  if (stale) ctx = await buildContext(p);
  ctx = { ...ctx, generatedBom: ctx.liveBom, bom: ctx.liveBom };
  const imgDir = join(docDir, "images");
  mkdirSync(imgDir, { recursive: true });
  writeFileSync(join(docDir, ".gitignore"), "# build byproducts (@protoboardai/ext-docs)\n.review/\nimages/.render-cache.json\n");
  const fonts = copyFonts(docDir);
  const r = new FigureRenderer(imgDir, ctx.sys.roots);
  const date = new Date().toISOString().slice(0, 10);
  const results: BuildResult[] = [];
  const docServed = projectPath(ctx.sys.docsDir);
  try {
    for (const type of Object.keys(DOC_TYPES) as DocType[]) {
      if (opts.only && opts.only !== type) continue;
      const t = DOC_TYPES[type];
      const meta: DocMeta = {
        title: ctx.sys.config.title ?? ctx.sys.system.name,
        docType: t.title,
        docId: `${ctx.sys.config.docId ?? ctx.sys.system.id.toUpperCase()}-${t.code}`,
        revision: ctx.sys.config.revision ?? "A",
        date,
        system: ctx.sys.name,
      };
      const doc = new Doc(ctx, meta);
      const env: BuildEnv = { ctx, doc, r, docDir, docRel: ctx.sys.docsDir, img: imgPath(docDir), counters: { fig: 0 } };
      const body = type === "datasheet" ? (await buildDatasheet(env)) + provenanceSection(env) : (await buildAssemblyGuide(env)) + assemblyProvenance(env);
      const name = `${ctx.sys.system.id}-${t.suffix}`;
      const html = doc.fillLegends(shell(meta, body, { fontsHref: "assets/fonts" }));
      const htmlPath = join(docDir, `${name}.html`);
      writeFileSync(htmlPath, html);
      const pag = await r.paginate(`${docServed}/${name}.html`);
      writeFileSync(htmlPath, pag.html);
      writeFileSync(
        join(docDir, `${name}.values.json`),
        JSON.stringify(
          {
            document: `${name}.html`,
            system: ctx.sys.system.id,
            project: ctx.sys.name,
            docId: meta.docId,
            generated: date,
            values: [...doc.values.values()].map((v) => ({ q: v.q, f: v.f, text: v.text, status: v.status, unit: v.unit, source: v.source, formula: v.formula, inputs: v.inputs, note: v.note })),
          },
          null,
          1,
        ) + "\n",
      );
      let pdfRel: string | undefined;
      if (opts.pdf !== false) {
        const pdfPath = join(docDir, `${name}.pdf`);
        writeFileSync(pdfPath, await r.printPdf(`${docServed}/${name}.html`));
        pdfRel = `${ctx.sys.docsDir}/${name}.pdf`;
        const review = join(docDir, ".review", name);
        rmSync(review, { recursive: true, force: true });
        mkdirSync(review, { recursive: true });
        try {
          execFileSync("pdftoppm", ["-r", "70", "-png", pdfPath, join(review, "page")]);
        } catch {
          console.warn("pdftoppm not available: no review PNGs");
        }
      }
      results.push({
        type,
        html: `${ctx.sys.docsDir}/${name}.html`,
        pdf: pdfRel,
        values: `${ctx.sys.docsDir}/${name}.values.json`,
        pages: pag.pages,
        overflow: pag.overflow,
        boundValues: doc.values.size,
      });
      log(`${name}: ${pag.pages} pages, ${doc.values.size} bound values${pag.overflow.length ? `, OVERFLOW on pages ${pag.overflow.join(", ")}` : ""}`);
    }
  } finally {
    log(`figures: ${r.rendered} rendered, ${r.reused} reused`);
    await r.close();
  }
  // files only: a project may keep its own pictures in a subfolder (docs/images/viewer)
  const rel = (dir: string) => (existsSync(join(docDir, dir)) ? readdirSync(join(docDir, dir), { withFileTypes: true }).filter((f) => f.isFile() && !f.name.startsWith(".")).map((f) => f.name).sort().map((f) => `${ctx.sys.docsDir}/${dir}/${f}`) : []);
  return {
    docs: results,
    files: [bomFile(ctx.sys), ...rel("images"), ...rel("test-data")],
    standins,
    figures: { rendered: r.rendered, reused: r.reused },
    fonts,
  };
}
