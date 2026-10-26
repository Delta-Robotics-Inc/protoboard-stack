/**
 * `protoboard release`: the Manufacturing Package (release-package-and-evals.md
 * §1–§3). Nothing is written unless every precondition holds; then the
 * package is built in a staging folder (a temporary directory) and
 * written to release/<version>/ through the operation's recorded writes.
 *
 * Order: configuration and units → preconditions → files collected from the
 * standard outputs → sections from every extension (package:<section>, the
 * release's own first) → figures, unit documents, overview, index.html →
 * manifest.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadEntry, probeTools, readProduct, stableStringify, uhdBundle, type LoadedExtension, type Project } from "@protoboardai/core";
import { readFx } from "@protoboardai/ext-sourcing/lib/cost.ts";
import { productDiagnostics } from "./product.ts";
import { orderingList, orderTotals } from "./bom.ts";
import { collectUnitFiles } from "./collect.ts";
import { readReleaseConfig } from "./config.ts";
import { docId, docPath, indexHtml, overviewBody, unitDocBody, type Contributed, type DocSet } from "./documents.ts";
import { buildManifest, type ReleaseManifest } from "./manifest.ts";
import { freshness, gitState, preconditions } from "./preconditions.ts";
import { pdfDate, Renderer, shippableFont, stageFonts } from "./render.ts";
import { SECTION_DOCS, SECTIONS, type PackageFile, type RenderedFigure, type SectionContext, type SectionDiagnostic, type SectionFn, type SectionId, type Unit } from "./types.ts";
import { resolveUnits } from "./units.ts";
import { byCode, posix, sha256 } from "./util.ts";

export const RELEASE_DIR = "release";
export const EXTENSION_ID = "@protoboardai/ext-release";

export interface ReleaseOptions {
  version?: string;
  allowDirty?: boolean;
  /** Write one package file (project-relative); the operation's recorded write. */
  write: (path: string, content: Buffer, description?: string) => void;
  log?: (line: string) => void;
  /** Stop after the checks, writing nothing (`--input check=true`). */
  checkOnly?: boolean;
}

export interface ReleaseResult {
  status: "succeeded" | "failed";
  summary: string;
  diagnostics: SectionDiagnostic[];
  version?: string;
  dir?: string;
  units?: { id: string; folder: string; perProduct: number }[];
  documents?: { path: string; pages: number }[];
  packageDigest?: string;
  manifestDigest?: string;
}

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The release date: SOURCE_DATE_EPOCH (seconds), else the source commit's date, else none. */
function releaseDate(git?: { date: string }): string | undefined {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number(epoch) * 1000).toISOString().replace(/\.000Z$/, "Z");
  return git ? new Date(git.date).toISOString().replace(/\.000Z$/, "Z") : undefined;
}

/** Section entries of every loaded extension: the release's own first, then in configuration order. */
function sectionEntries(p: Project, section: SectionId): { ext: LoadedExtension; entry: string }[] {
  const exts = [...p.extensions].sort((a, b) => Number(b.manifest.id === EXTENSION_ID) - Number(a.manifest.id === EXTENSION_ID));
  return exts.flatMap((ext) => (ext.manifest.operations ?? []).filter((o) => o.id === `package:${section}`).map((o) => ({ ext, entry: o.entry })));
}

const fail = (diagnostics: SectionDiagnostic[], summary?: string): ReleaseResult => {
  const errors = diagnostics.filter((d) => d.severity === "error");
  return { status: "failed", summary: summary ?? `release refused: ${errors.length} problem(s); first: ${errors[0]?.message ?? "?"}`, diagnostics };
};

export async function buildRelease(p: Project, opts: ReleaseOptions): Promise<ReleaseResult> {
  const log = opts.log ?? (() => {});
  const diagnostics: SectionDiagnostic[] = [];
  if (!p.rootDef) return fail([{ code: "REL_NO_ROOT", severity: "error", message: "the project has no root system" }]);

  // ---- configuration, units, preconditions
  const cfg = await readReleaseConfig(p);
  diagnostics.push(...cfg.diagnostics);
  const { units, diagnostics: unitDiags } = resolveUnits(p, cfg.config.units ?? []);
  diagnostics.push(...unitDiags);
  const fresh = freshness(p);
  diagnostics.push(...preconditions(p, fresh));
  const version = opts.version ?? p.rootDef.version;
  if (!version) diagnostics.push({ code: "REL_NO_VERSION", severity: "error", message: `no release version: pass --version <v> (the root module ${p.rootDef.id} states none)` });
  else if (!VERSION.test(version)) diagnostics.push({ code: "REL_NO_VERSION", severity: "error", message: `release version "${version}" must be letters, digits, ".", "_" or "-"` });
  // what the product is, as the project states it (docs/product.json): the first page reads it; what is missing is a warning
  const product = readProduct(p.root);
  diagnostics.push(...productDiagnostics(product));
  // the release folder (and `releases/`, its earlier name) is the output, not a design input
  const git = gitState(p.root, [RELEASE_DIR, "releases", "operations"]);
  if (git?.dirty.length && !opts.allowDirty)
    diagnostics.push({ code: "REL_DIRTY", severity: "error", message: `uncommitted changes in the project (${git.dirty.slice(0, 5).join(", ")}${git.dirty.length > 5 ? ", …" : ""}); commit them, or pass --allow-dirty (recorded in the manifest)` });
  if (diagnostics.some((d) => d.severity === "error") || opts.checkOnly) {
    return diagnostics.some((d) => d.severity === "error") ? fail(diagnostics) : { status: "succeeded", summary: `ready to release ${version}: ${units.length} unit(s), no blocking problems`, diagnostics };
  }
  const date = releaseDate(git);
  const day = date ? date.slice(0, 10) : "undated";
  const build = cfg.config.build ?? 1;
  const outDir = `${RELEASE_DIR}/${version}`;
  log(`release ${version}: ${units.map((u) => `${u.id}${u.kind !== "root" ? ` ×${u.perProduct}` : ""}`).join(", ")}`);

  // ---- files from the standard outputs, and the model
  const files: PackageFile[] = units.flatMap((u) => collectUnitFiles(p, u));
  const bundle = await uhdBundle(p);
  // machine-independent: artifact bases relative to the project
  bundle.artifactBases = Object.fromEntries(Object.entries(bundle.artifactBases ?? {}).map(([k, v]) => [k, posix(relative(p.root, v)) || "."]));
  const bundleFile: PackageFile = { path: "system/files/model/uhd-bundle.json", unit: "system", role: "model", content: Buffer.from(stableStringify(bundle)), description: "UHD bundle of the released system" };
  files.push(bundleFile);

  // ---- rendering: one Chrome for the figures (sections may ask for them) and the documents.
  // Staging is outside the project and laid out like the package, so relative links print correctly.
  const staging = mkdtempSync(join(tmpdir(), "protoboard-release-"));
  const renderer = new Renderer(p, staging);
  let manifest: ReleaseManifest;
  const documents: { path: string; pages: number }[] = [];
  try {
    const fonts = stageFonts(staging);
    const set: DocSet = { project: p.name, title: p.rootDef.name ?? p.rootDef.id, description: p.rootDef.description, product, version: version!, date: day, units, content: new Map(), figures: new Map() };
    set.figures = await renderer.unitFigures(units);
    for (const f of set.figures.values()) files.push({ path: f.file, role: "figure", content: readFileSync(join(staging, f.file)), description: "assembled unit, line art from the model's CAD" });
    const figure = figureFn(renderer, staging, files, new Set([...set.figures.values()].map((f) => f.file)));

    // ---- sections
    const sections: ReleaseManifest["sections"] = [];
    const releaseInfo = { version: version!, date: day, build, config: cfg.config };
    for (const u of units) {
      const bySection = new Map<SectionId, Contributed[]>();
      for (const s of SECTIONS) {
        const entries = sectionEntries(p, s);
        const contributors = [...new Set(entries.map((e) => e.ext.manifest.id))];
        // the release's own entry runs last, so its work order can number the operations the others contribute
        const byEntry: Contributed[][] = entries.map(() => []);
        const operations: SectionContext["operations"] = [];
        const runOrder = entries.map((e, i) => ({ ...e, i })).sort((a, b) => Number(a.ext.manifest.id === EXTENSION_ID) - Number(b.ext.manifest.id === EXTENSION_ID));
        for (const { ext, entry, i } of runOrder) {
          const parts = byEntry[i];
          const ctx: SectionContext = { project: p, section: s, unit: u, units, release: releaseInfo, files: files.filter((f) => f.unit === u.id), contributors, operations: ext.manifest.id === EXTENSION_ID ? operations : [], figure, log };
          let got;
          try {
            const fn = await loadEntry<SectionFn>(ext, entry);
            got = await fn(ctx);
          } catch (e) {
            diagnostics.push({ code: "REL_SECTION_FAILED", severity: "error", message: `${ext.manifest.id} package:${s} failed for unit ${u.id}: ${(e as Error).message.split("\n")[0]}` });
            continue;
          }
          for (const c of (Array.isArray(got) ? got : got ? [got] : []).filter((c) => c.blocks?.length || c.files?.length || c.operations?.length)) {
            for (const d of c.diagnostics ?? []) diagnostics.push({ ...d, message: `${ext.manifest.id} package:${s} (${u.id}): ${d.message}` });
            for (const f of c.files ?? []) {
              const problem = sectionFileProblem(p, u, f.path, f.from);
              if (problem) {
                diagnostics.push({ code: "REL_SECTION_FILE", severity: "error", message: `${ext.manifest.id} package:${s} (${u.id}): ${problem}` });
                continue;
              }
              const path = `${u.folder}/${f.path}`;
              if (files.some((x) => x.path === path)) {
                diagnostics.push({ code: "REL_SECTION_FILE", severity: "error", message: `${ext.manifest.id} package:${s} (${u.id}): ${path} is already in the package` });
                continue;
              }
              const bytes = f.from ? readFileSync(join(p.root, f.from)) : Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content ?? "");
              files.push({ path, unit: u.id, role: f.role ?? "data", ...(f.from ? { from: f.from } : {}), content: bytes, ...(f.description ? { description: f.description } : {}) });
            }
            if (s === "work-order") for (const o of c.operations ?? []) operations.push({ ...o, extension: ext.manifest.id });
            parts.push({ ...c, extension: ext.manifest.id });
          }
        }
        const parts = byEntry.flat();
        parts.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        bySection.set(s, parts);
        sections.push({ unit: u.id, section: s, contributors: [...new Set(parts.map((c) => c.extension))] });
      }
      set.content.set(u.id, bySection);
    }
    await renderer.closeFigures();
    if (diagnostics.some((d) => d.severity === "error")) return fail(diagnostics);

    // ---- documents
    const tools = toolDetails(p);
    const stamp = pdfDate(date ?? "1970-01-01T00:00:00Z");
    const overflow: string[] = [];
    for (const u of units) {
      for (const s of SECTIONS) {
        const rel = docPath(u, s);
        const up = "../".repeat(rel.split("/").length - 1);
        const meta = { title: u.kind === "root" ? set.title : `${set.title}: ${u.name}`, docType: SECTION_DOCS[s].title, docId: docId(set, u, s), revision: version!, date: day, system: p.rootDef.id };
        const r = await renderer.pdf(rel, meta, unitDocBody(set, u, s, (x) => up + x), `${up}assets/fonts`, stamp);
        if (r.overflow.length) overflow.push(`${rel} p${r.overflow.join(",")}`);
        files.push({ path: rel, unit: u.id, role: "document", content: r.pdf, description: SECTION_DOCS[s].title });
        documents.push({ path: rel, pages: r.pages });
        log(`${rel}: ${r.pages} page(s)`);
      }
    }
    const lines = orderingList(p, units, cfg.config);
    const t = orderTotals(lines, readFx(p.root).table);
    const totals = [
      { label: "Units", value: String(units.length), sub: units.map((u) => u.id).join(", ") },
      { label: "Parts", value: String(t.pieces), sub: `${t.lines} ordering lines (${t.buy} buy, ${t.fabricate} make, ${t.included} included)` },
      { label: "Cost estimate", value: t.costText || "—", sub: [`${t.priced} of ${t.buy} bought lines priced`, t.costNote].filter(Boolean).join("; ") },
      { label: "Lead time", value: t.leadTimeWeeks !== null ? `${t.leadTimeWeeks} wk` : "—", sub: t.leadTimeWeeks !== null ? "longest offer lead time" : "no offer states one" },
    ];
    for (const f of fonts.files.filter((x) => shippableFont(x.file))) files.push({ path: `assets/fonts/${f.file}`, role: "asset", content: readFileSync(f.path), description: "Kode Mono (SIL Open Font License)" });
    const draft = () => buildManifest({ p, version: version!, date: date ?? "", source: git ? { commit: git.commit, dirty: git.dirty } : null, build, units, bundle: bundleFile, fresh, files, tools, fonts: fonts.files.map((f) => ({ file: f.file, digest: sha256(readFileSync(f.path)) })), sections });
    const ov = await renderer.pdf("00-overview.pdf", { title: set.title, docType: "Manufacturing package", docId: docId(set, units.find((u) => u.kind === "root")!, "overview"), revision: version!, date: day, system: p.rootDef.id }, overviewBody(set, draft(), totals, (x) => x), "assets/fonts", stamp);
    if (ov.overflow.length) overflow.push(`00-overview.pdf p${ov.overflow.join(",")}`);
    files.push({ path: "00-overview.pdf", role: "document", content: ov.pdf, description: "overview, order of work, index and traceability" });
    documents.unshift({ path: "00-overview.pdf", pages: ov.pages });
    files.push({ path: "index.html", role: "document", content: Buffer.from(indexHtml(set, draft(), totals, files)), description: "the whole package, by unit and by section" });
    manifest = draft();
    if (overflow.length) diagnostics.push({ code: "REL_PAGE_OVERFLOW", severity: "warning", message: `content overflows a page in ${overflow.join("; ")}` });
  } finally {
    await renderer.close();
    rmSync(staging, { recursive: true, force: true });
  }

  // ---- write release/<version>/ (replacing an earlier build of the same version)
  rmSync(join(p.root, outDir), { recursive: true, force: true });
  const manifestBytes = Buffer.from(stableStringify(manifest));
  for (const f of [...files].sort((a, b) => byCode(a.path, b.path))) opts.write(`${outDir}/${f.path}`, f.content, f.description);
  opts.write(`${outDir}/manifest.json`, manifestBytes, "release manifest");
  return {
    status: "succeeded",
    summary: `${outDir}: ${units.length} unit(s), ${documents.length} documents (${documents.reduce((s, d) => s + d.pages, 0)} pages), ${files.length + 1} files; package ${manifest.packageDigest.slice(7, 19)}`,
    diagnostics,
    version,
    dir: outDir,
    units: units.map((u) => ({ id: u.id, folder: u.folder, perProduct: u.perProduct })),
    documents,
    packageDigest: manifest.packageDigest,
    manifestDigest: sha256(manifestBytes),
  };
}

const FIGURE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The figure callback sections get (SectionContext.figure): renders into
 * staging/assets/images/<name>.png once per name and adds the file to the
 * package. A name reused with another spec is a contributor's bug.
 */
function figureFn(renderer: Renderer, staging: string, files: PackageFile[], taken: Set<string>): SectionContext["figure"] {
  const done = new Map<string, { spec: string; fig: RenderedFigure }>();
  return async (name, spec) => {
    if (!FIGURE_NAME.test(name)) throw new Error(`figure name "${name}" must be letters, digits, ".", "_" or "-"`);
    const file = `assets/images/${name}.png`;
    const key = stableStringify(spec);
    const hit = done.get(name);
    if (hit) {
      if (hit.spec !== key) throw new Error(`figure "${name}" was already rendered from another spec`);
      return hit.fig;
    }
    if (taken.has(file)) throw new Error(`figure "${name}" is taken by the release`);
    const r = await renderer.figure(name, spec);
    const fig: RenderedFigure = { file, width: r.width, height: r.height, anchors: r.anchors };
    done.set(name, { spec: key, fig });
    files.push({ path: file, role: "figure", content: readFileSync(join(staging, file)), description: "figure rendered from the model's CAD" });
    return fig;
  };
}

/** A contributed file must stay inside its unit folder and not take a document's name. */
function sectionFileProblem(p: Project, u: Unit, path: string, from?: string): string | undefined {
  const norm = posix(path);
  if (!norm || norm.startsWith("/") || norm.split("/").includes("..")) return `file path ${path} must be relative to the unit folder`;
  if (/\.pdf$/i.test(norm) && !norm.startsWith("files/")) return `${path}: PDFs at the unit level are the release's documents; put contributed files under files/`;
  if (from && !existsSync(join(p.root, from))) return `${from} does not exist`;
  return undefined;
}

/** Versions of the tools the release itself ran (Chrome for figures and PDFs). */
function toolDetails(p: Project): { id: string; detail?: string }[] {
  const ext = p.extensions.find((e) => e.manifest.id === EXTENSION_ID);
  return ext ? probeTools([ext], { root: p.root }).map((t) => ({ id: t.id, ...(t.detail ? { detail: t.detail } : {}) })) : [];
}

/** Files under a directory, for tests and the CLI summary. */
export const listTree = (abs: string, base = abs): string[] =>
  !existsSync(abs) ? [] : readdirSync(abs, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listTree(join(abs, d.name), base) : [posix(relative(base, join(abs, d.name)))])).sort(byCode);
