/**
 * The package's documents: one per unit and section (PDF), the overview
 * (00-overview.pdf, with the traceability appendix) and index.html, which
 * holds all of it with navigation by unit and by section.
 */
import { readTemplate } from "@protoboardai/ext-docs/html";
import type { ProductStatement } from "@protoboardai/core";
import { blocksHtml, esc, sec, sub } from "./html.ts";
import { productBlocks } from "./product.ts";
import type { ReleaseManifest } from "./manifest.ts";
import { SECTION_DOCS, SECTIONS, type Block, type PackageFile, type SectionContribution, type SectionId, type Unit } from "./types.ts";

export interface Contributed extends SectionContribution {
  extension: string;
}

export interface DocSet {
  project: string;
  title: string;
  description?: string;
  /** What the product is, as the project states it (docs/product.json): the first page. */
  product: ProductStatement;
  version: string;
  date: string;
  units: Unit[];
  /** unit id → section → contributions in order. */
  content: Map<string, Map<SectionId, Contributed[]>>;
  /** unit id → figure (package path and size). */
  figures: Map<string, { file: string; width: number; height: number; bodies: number }>;
}

/** Package path of a unit's document. */
export const docPath = (u: Unit, s: SectionId) => `${u.folder}/${SECTION_DOCS[s].file}.pdf`;
/** Document id: PROJECT-UNIT-CODE; a unit named after the project's module ("quadcopter-5in-arm") drops the repeated project prefix. */
export const docId = (set: DocSet, u: Unit, s: SectionId | "overview") => {
  const project = set.project.toUpperCase();
  const unit = u.kind === "root" ? "SYS" : u.id.toUpperCase();
  const short = unit.startsWith(`${project}-`) && unit.length > project.length + 1 ? unit.slice(project.length + 1) : unit;
  return `${project}-${short}-${s === "overview" ? "OV" : SECTION_DOCS[s].code}`;
};

const heroBlock = (set: DocSet, u: Unit): Block[] => {
  const f = set.figures.get(u.id);
  return f ? [{ kind: "image", file: f.file, width: f.width, height: f.height, caption: `${u.name}, assembled from the model (${f.bodies} placed bodies${u.kind === "module" ? ", one build" : ""}).` }] : [];
};

/** The flow body of one unit document. */
export function unitDocBody(set: DocSet, u: Unit, s: SectionId, img: (p: string) => string): string {
  const parts = set.content.get(u.id)?.get(s) ?? [];
  const main = parts.filter((c) => !c.title);
  const titled = parts.filter((c) => c.title);
  const head = `<div class="doc-head block"><span><b>${esc(u.name)}</b></span><span>${esc(u.kind === "root" ? "system (final assembly)" : u.folder)}</span><span>release ${esc(set.version)}</span>${u.kind !== "root" ? `<span>× ${u.perProduct} per product</span>` : ""}</div>`;
  const out = [sec("1", SECTION_DOCS[s].title, esc(u.name)), head];
  const blocks = [...(s === "spec" ? heroBlock(set, u) : []), ...main.flatMap((c) => c.blocks)];
  out.push(blocks.length ? blocksHtml(blocks, img) : `<p class="muted block">No content was contributed to this section for this unit.</p>`);
  titled.forEach((c, i) => out.push(sec(String(i + 2), c.title!, `<span class="muted">${esc(c.extension)}</span>`, ' data-break="before"'), blocksHtml(c.blocks, img)));
  return out.join("\n");
}

const unitRow = (u: Unit) => ({ unit: u.id, name: u.name, qty: u.kind === "root" ? 1 : u.perProduct, into: u.parents.join(", ") || "—", folder: `${u.folder}/` });

/** The overview's body: cover, product, units, order of work, totals, index of files, traceability appendix. */
export function overviewBody(set: DocSet, m: ReleaseManifest, totals: { label: string; value: string; sub?: string }[], img: (p: string) => string): string {
  const root = set.units.find((u) => u.kind === "root")!;
  const hero = set.figures.get(root.id);
  const words = set.title.split(" ");
  const last = words.pop();
  const cover = `<div class="coverpage" data-page="cover">
  <div class="cover-top"><div class="grid-bg"></div>
    <div class="cover-brand">PR<b>0</b>TOBOARD <span class="muted">·</span> UHD</div>
    <div class="cover-rev"><span>Release ${esc(set.version)}</span><span>${esc(set.date)}</span><span>${esc(docId(set, root, "overview"))}</span></div>
    <div class="cover-kicker">Manufacturing package · Overview</div>
    <div class="cover-title">${esc(words.join(" "))} <span class="accent">${esc(last)}</span></div>
    <div class="cover-sub">${esc(set.product.summary ?? set.description ?? "")}</div>
    ${hero ? `<div class="cover-hero"><img src="${esc(img(hero.file))}" width="${hero.width}" height="${hero.height}" alt="${esc(set.title)}"></div><div class="cover-herocap">Assembled from the model: ${hero.bodies} placed bodies</div>` : ""}
  </div>
  <div class="cover-bottom">${blocksHtml([{ kind: "figures", items: totals }], img)}
    <p class="small">Everything needed to order, make, assemble and check this product, laid out by unit. Start with the order of work below; index.html holds the whole package in one place.</p></div>
  <div class="cover-foot"><span class="pg-brand">PR<b>0</b>TOBOARD · UHD</span><span>Generated from the UHD model of <code>${esc(set.project)}</code> by @protoboardai/ext-release</span><span class="right">Release ${esc(set.version)} · ${esc(set.date)}</span></div>
</div>`;
  const order: Block[] = [
    {
      kind: "list",
      ordered: true,
      items: [
        "Order everything on system/ordering-list.csv (system/bom.pdf: ordering list) and place the fabrication orders in each unit's work order.",
        ...set.units.filter((u) => u.kind !== "root").map((u) => `Build ${u.perProduct} × ${u.name} (${u.folder}/): work order, assembly guide, then the test plan.`),
        `Final assembly (system/): assemble ${set.units.length > 1 ? "the units into the " : "the "}${root.name} and test it, in the order of the system work order's operations; it says where each check of the system test plan runs (the bench test and any configuration come before the steps that must follow them, such as fitting propellers).`,
      ],
    },
  ];
  const files: Block[] = [
    {
      kind: "table",
      columns: [{ key: "path", label: "File" }, { key: "unit", label: "Unit" }, { key: "role", label: "Role" }, { key: "bytes", label: "Bytes", align: "right" }],
      rows: [
        ...[["00-overview.pdf", "this overview"], ["index.html", "the whole package, by unit and by section"], ["manifest.json", "release manifest: every file's digest"]].map(([path, role]) => ({ path, unit: "", role, bytes: "" })),
        ...m.files.filter((f) => !f.path.startsWith("assets/")).map((f) => ({ path: f.path, unit: f.unit ?? "", role: f.role, bytes: f.bytes })),
        // figures and fonts the documents use, one line per folder
        ...[...new Set(m.files.filter((f) => f.path.startsWith("assets/")).map((f) => f.path.slice(0, f.path.lastIndexOf("/") + 1)))].map((dir) => {
          const these = m.files.filter((f) => f.path.startsWith(dir) && !f.path.slice(dir.length).includes("/"));
          return { path: `${dir} (${these.length} files)`, unit: "", role: [...new Set(these.map((f) => f.role))].join(", "), bytes: these.reduce((t, f) => t + f.bytes, 0) };
        }),
      ],
      caption: "Files",
      note: "Digests of every file are in manifest.json; the documents' own digests are only there, since a document cannot list its own.",
    },
  ];
  return [
    cover,
    // the first page after the cover: what it is, its features, what it does, what it must meet (PB-935)
    sec("1", "The product", esc(set.title)),
    blocksHtml(productBlocks(set.product, set.description), img),
    sec("2", "Units and how they fit", "", ' data-break="before"'),
    blocksHtml(
      [
        { kind: "paragraph", text: "Each unit has its own folder with a spec sheet, bill of materials, work order, assembly guide and test plan. A unit is built separately and assembled into the unit above it; the system folder is final assembly." },
        { kind: "table", columns: [{ key: "unit", label: "Unit" }, { key: "name", label: "Module" }, { key: "qty", label: "Per product", align: "right" }, { key: "into", label: "Assembled into" }, { key: "folder", label: "Folder" }], rows: set.units.map(unitRow) },
      ],
      img,
    ),
    sec("3", "Order of work"),
    blocksHtml(order, img),
    sec("4", "Index", "", ' data-break="before"'),
    blocksHtml(files, img),
    sec("A", "Traceability", "", ' data-break="before"'),
    blocksHtml(traceability(m), img),
  ].join("\n");
}

/** The release manifest in readable form (overview appendix and index.html page). */
export function traceability(m: ReleaseManifest): Block[] {
  const short = (d?: string) => (d ? d.replace(/^sha256:/, "").slice(0, 16) : "");
  return [
    {
      kind: "keyvalues",
      rows: [
        { label: "Project", value: `${m.project.name} (root ${m.project.root})` },
        { label: "Release", value: `${m.version} · ${m.date}` },
        { label: "Source", value: m.source ? `git ${m.source.commit.slice(0, 12)}${m.source.dirty.length ? ` with ${m.source.dirty.length} uncommitted change(s)` : ""}` : "not a git work tree" },
        { label: "Model", value: `${m.model.bundle} · ${short(m.model.digest)}` },
        { label: "Framework", value: `@protoboardai/core ${m.framework.protoboard} · @deltarobotics/uhd ${m.framework.uhd.version ?? "?"}${m.framework.uhd.revision ? ` (${m.framework.uhd.revision.slice(0, 12)})` : ""}` },
        { label: "Check", value: `${m.check.errors} errors, ${m.check.warnings} warnings, ${m.check.info} info at release time` },
      ],
    },
    { kind: "heading", text: "Parts" },
    {
      kind: "table",
      columns: [{ key: "id", label: "Part" }, { key: "tier", label: "Tier" }, { key: "rev", label: "Revision / source" }, { key: "digest", label: "Digest" }],
      rows: m.parts.map((x) => ({ id: x.id, tier: x.tier, rev: x.revision !== undefined ? `${x.service ?? x.provider ?? "catalog"} rev ${x.revision}` : x.source, digest: short(x.digest) })),
    },
    { kind: "heading", text: "Provider outputs" },
    {
      kind: "table",
      columns: [{ key: "module", label: "Module" }, { key: "cap", label: "Capability" }, { key: "provider", label: "Provider" }, { key: "tools", label: "Tools" }, { key: "record", label: "Operation record" }],
      rows: m.outputs.map((o) => ({ module: o.module, cap: o.capability, provider: `${o.provider.id}@${o.provider.version}`, tools: o.tools.map((t) => t.detail ?? t.id).join(", "), record: o.record })),
    },
    ...(m.generated.length
      ? ([
          { kind: "heading", text: "Other generated files" },
          { kind: "table", columns: [{ key: "path", label: "File" }, { key: "op", label: "Operation" }, { key: "record", label: "Record" }, { key: "digest", label: "Digest" }], rows: m.generated.map((g) => ({ path: g.path, op: `${g.extension} ${g.operation}`, record: g.record ?? "", digest: short(g.digest) })) },
        ] as Block[])
      : []),
    ...(m.check.findings.length
      ? ([
          { kind: "heading", text: "Warnings at release time" },
          { kind: "table", columns: [{ key: "code", label: "Code" }, { key: "message", label: "Finding" }], rows: m.check.findings.map((f) => ({ code: f.code, message: f.message })) },
        ] as Block[])
      : []),
  ];
}

// ---------------------------------------------------------------------------
// index.html
// ---------------------------------------------------------------------------

const anchor = (u: Unit, s?: SectionId) => `u-${u.id}${s ? `-${s}` : ""}`;

export function indexHtml(set: DocSet, m: ReleaseManifest, totals: { label: string; value: string; sub?: string }[], files: PackageFile[]): string {
  const img = (p: string) => p;
  const css = readTemplate("doc.css").replace(/__FONTS__/g, "assets/fonts");
  const nav = [
    `<a href="#overview">Overview</a>`,
    `<div class="nav-h">By unit</div>`,
    ...set.units.map((u) => `<a href="#${anchor(u)}">${esc(u.kind === "root" ? `system · ${u.name}` : `${u.id} · ${u.name}`)}</a><div class="nav-sub">${SECTIONS.map((s) => `<a href="#${anchor(u, s)}">${esc(SECTION_DOCS[s].title)}</a>`).join("")}</div>`),
    `<div class="nav-h">By section</div>`,
    ...SECTIONS.map((s) => `<a href="#s-${s}">${esc(SECTION_DOCS[s].title)}</a><div class="nav-sub">${set.units.map((u) => `<a href="#${anchor(u, s)}">${esc(u.id)}</a>`).join("")}</div>`),
    `<div class="nav-h">Package</div>`,
    `<a href="#files">Files</a>`,
    `<a href="#traceability">Traceability</a>`,
  ].join("\n");
  const units = set.units
    .map((u) => {
      const unitFiles = files.filter((f) => f.unit === u.id && f.path.startsWith(`${u.folder}/files/`));
      return `<section class="unit" id="${anchor(u)}">
<h1 class="unit-h">${esc(u.name)} <span class="muted">${esc(u.kind === "root" ? "system/" : `${u.folder}/`)}${u.kind !== "root" ? ` · × ${u.perProduct} per product` : ""}</span></h1>
<div class="doclinks">${SECTIONS.map((s) => `<a href="${docPath(u, s)}">${esc(SECTION_DOCS[s].file)}.pdf</a>`).join("")}<a href="${u.folder}/bom.csv">bom.csv</a>${u.kind === "root" ? `<a href="system/ordering-list.csv">ordering-list.csv</a>` : ""}</div>
${SECTIONS.map((s) => `<article class="doc" id="${anchor(u, s)}"><h2 class="doc-h">${esc(SECTION_DOCS[s].title)}</h2>${docInner(set, u, s, img)}</article>`).join("\n")}
<article class="doc"><h2 class="doc-h">Files</h2>${unitFiles.length ? `<ul class="plain">${unitFiles.map((f) => `<li><a href="${esc(f.path)}">${esc(f.path.slice(u.folder.length + 1))}</a> <span class="muted">${esc(f.description ?? f.role)}</span></li>`).join("")}</ul>` : `<p class="muted">No manufacturing files for this unit.</p>`}</article>
</section>`;
    })
    .join("\n");
  const bySection = SECTIONS.map((s) => `<p id="s-${s}" class="sec-index"><b>${esc(SECTION_DOCS[s].title)}:</b> ${set.units.map((u) => `<a href="#${anchor(u, s)}">${esc(u.id)}</a>`).join(" · ")}</p>`).join("");
  const root = set.units.find((u) => u.kind === "root")!;
  const hero = set.figures.get(root.id);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="@protoboardai/ext-release">
<title>${esc(set.title)} — Manufacturing package ${esc(set.version)}</title>
<style>${css}${INDEX_CSS}</style>
</head>
<body class="index">
<header class="top"><span class="pg-mark"></span><span class="brand">PR<b>0</b>TOBOARD</span><span class="t">${esc(set.title)}</span><span class="muted">Manufacturing package · release ${esc(set.version)} · ${esc(set.date)}</span></header>
<nav class="side">${nav}</nav>
<main class="main">
<section id="overview">
<h1 class="unit-h">${esc(set.title)} <span class="muted">overview</span></h1>
<div class="doclinks"><a href="00-overview.pdf">00-overview.pdf</a><a href="manifest.json">manifest.json</a></div>
${hero ? `<img class="hero" src="${esc(hero.file)}" alt="${esc(set.title)}">` : ""}
${blocksHtml(productBlocks(set.product, set.description), img)}
${blocksHtml([{ kind: "figures", items: totals }], img)}
${sub("Units")}
${blocksHtml([{ kind: "table", columns: [{ key: "unit", label: "Unit" }, { key: "name", label: "Module" }, { key: "qty", label: "Per product", align: "right" }, { key: "into", label: "Assembled into" }, { key: "folder", label: "Folder" }], rows: set.units.map(unitRow) }], img)}
${sub("By section")}
${bySection}
</section>
${units}
<section id="files"><h1 class="unit-h">Files</h1>${filesTable(m)}</section>
<section id="traceability"><h1 class="unit-h">Traceability</h1>${blocksHtml(traceability(m), img)}</section>
</main>
</body>
</html>
`;
}

function docInner(set: DocSet, u: Unit, s: SectionId, img: (p: string) => string): string {
  const parts = set.content.get(u.id)?.get(s) ?? [];
  const blocks = [...parts.filter((c) => !c.title).flatMap((c) => c.blocks)];
  return [
    blocks.length ? blocksHtml(blocks, img) : `<p class="muted">No content was contributed to this section for this unit.</p>`,
    ...parts.filter((c) => c.title).map((c) => `${sub(c.title!)}${blocksHtml(c.blocks, img)}`),
  ].join("\n");
}

/** Screen layout for index.html over ext-docs' print theme. */
const INDEX_CSS = `
body.index { background: #fff; font-size: 9pt; }
body.index .top { position: sticky; top: 0; z-index: 2; display: flex; align-items: baseline; gap: 4mm; padding: 3mm 6mm; background: #fff; border-bottom: 0.5pt solid var(--ink); }
body.index .top .brand { font-family: var(--display); letter-spacing: .08em; }
body.index .top .brand b { color: var(--accent); font-weight: 400; }
body.index .top .t { font-family: var(--display); font-size: 11pt; }
body.index .pg-mark { width: 2.4mm; height: 2.4mm; background: var(--accent); display: inline-block; align-self: center; }
body.index nav.side { position: fixed; top: 13mm; bottom: 0; left: 0; width: 62mm; overflow-y: auto; padding: 4mm 5mm; border-right: 0.35pt solid var(--rule); font-size: 8pt; }
body.index nav.side a { display: block; color: var(--ink); text-decoration: none; padding: .5mm 0; }
body.index nav.side a:hover { color: var(--accent-ink); }
body.index .nav-h { margin-top: 4mm; font-size: 6.8pt; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
body.index .nav-sub { padding-left: 3mm; border-left: 0.35pt solid var(--rule); margin-bottom: 1.5mm; }
body.index .nav-sub a { color: var(--muted); }
body.index main.main { margin-left: 66mm; padding: 6mm 8mm 30mm; max-width: 200mm; }
body.index section { margin-bottom: 10mm; }
body.index .unit-h { font-family: var(--display); font-weight: 400; font-size: 16pt; border-bottom: 0.6pt solid var(--ink); padding-bottom: 1.5mm; margin: 6mm 0 3mm; }
body.index .unit-h .muted { font-family: var(--mono); font-size: 8pt; }
body.index .doc-h { font-family: var(--display); font-weight: 400; font-size: 12pt; margin: 6mm 0 2mm; color: var(--ink); }
body.index .doc-h::before { content: ""; display: inline-block; width: 2mm; height: 2mm; background: var(--accent); margin-right: 2mm; vertical-align: middle; }
body.index .doclinks { display: flex; flex-wrap: wrap; gap: 2mm; margin-bottom: 3mm; }
body.index .doclinks a { font-size: 7pt; border: 0.4pt solid var(--rule); padding: .4mm 1.6mm; color: var(--ink); text-decoration: none; }
body.index .doclinks a:hover { border-color: var(--accent); }
body.index img.hero { width: 100%; max-height: 110mm; object-fit: contain; margin: 2mm 0 4mm; }
body.index .sec-index { margin: 1mm 0; }
body.index main a { color: var(--accent-ink); }
body.index table { font-size: 7.6pt; }
body.index .cont-note { display: none; }
body.index .step { break-inside: avoid; }
body.index td.nw { white-space: nowrap; }
body.index .part.noimg { grid-template-columns: auto; min-width: 0; }
body.index .part.noimg .p-name { grid-column: 1; }
body.index .step-no.wide { width: auto; min-width: 8.5mm; padding: 0 2.2mm; border-radius: 4.25mm; font-size: 9.5pt; }
@media (max-width: 900px) { body.index nav.side { display: none; } body.index main.main { margin-left: 0; } }
`;

function filesTable(m: ReleaseManifest): string {
  const rows = m.files.map((f) => `<tr><td><a href="${esc(f.path)}">${esc(f.path)}</a></td><td>${esc(f.unit ?? "")}</td><td>${esc(f.role)}</td><td class="num">${f.bytes}</td></tr>`).join("");
  return `<table class="dense"><thead><tr><th>File</th><th>Unit</th><th>Role</th><th class="num">Bytes</th></tr></thead><tbody>${rows}</tbody></table>`;
}
