/**
 * Shared pieces of the document builders: build environment, cover page,
 * thumbnails, test-data helpers.
 */
import { existsSync } from "fs";
import { join } from "path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { esc, type Doc } from "../html.ts";
import type { FigureRenderer, RenderResult } from "../render/renderer.ts";
import type { BuiltContext } from "../context.ts";
import { category, featureNames, glbFor } from "../model.ts";
import { isolated, ISO } from "../figures.ts";
import type { TestData } from "../testdata.ts";

export interface BuildEnv {
  ctx: BuiltContext;
  doc: Doc;
  r: FigureRenderer;
  /** Absolute docs directory (the HTML's directory). */
  docDir: string;
  /** Project-relative docs directory. */
  docRel: string;
  /** Image path prefix relative to the HTML. */
  img: (name: string) => string;
  counters: { fig: number };
}

export const figNum = (env: BuildEnv) => String(++env.counters.fig);

/** A module's body GLB is declared but its file is not in this checkout (vendor CAD whose redistribution is not cleared). */
export function bodyFileMissing(env: BuildEnv, def: ModuleDef): boolean {
  const glb = glbFor(def);
  const file = glb?.filePath ? env.ctx.sys.file(def, glb.filePath) : undefined;
  return !!glb?.filePath && !(file && existsSync(file));
}

/** Thumbnail of a module on its own; undefined when it has no body GLB, or its file is not available. */
export async function thumbnail(env: BuildEnv, def: ModuleDef, size = 360): Promise<RenderResult | undefined> {
  const glb = glbFor(def);
  const served = glb?.filePath ? env.ctx.sys.served(def, glb.filePath) : undefined;
  if (!glb || !served || bodyFileMissing(env, def)) return undefined;
  return env.r.render(`part-${def.id}`, {
    width: size,
    height: size,
    mode: "lineart",
    lineScale: 1.25,
    bodies: isolated(def, served, featureNames(env.ctx.sys, def, glb), category(def), Boolean(glb.id.startsWith("cad_vendor"))),
    camera: { dir: category(def) === "prop" || category(def) === "frame" || category(def) === "top_plate" ? [0.8, -1, 1.4] : ISO, margin: 0.08 },
  });
}

export function coverPage(env: BuildEnv, o: { kicker: string; hero: RenderResult; heroCaption: string; bottom: string }): string {
  const m = env.doc.meta;
  const words = m.title.split(" ");
  const last = words.pop();
  return `<div class="coverpage" data-page="cover">
  <div class="cover-top"><div class="grid-bg"></div>
    <div class="cover-brand">PR<b>0</b>TOBOARD <span class="muted">·</span> UHD</div>
    <div class="cover-rev"><span>Rev ${esc(m.revision)}</span><span>${esc(m.date)}</span><span>${esc(m.docId)}</span></div>
    <div class="cover-kicker">${esc(o.kicker)}</div>
    <div class="cover-title">${esc(words.join(" "))} <span class="accent">${esc(last)}</span></div>
    <div class="cover-sub">${env.doc.v("sys:system.description", undefined, { cls: "wrap" })}</div>
    <div class="cover-hero"><img src="${esc(env.img(o.hero.file))}" width="${o.hero.width}" height="${o.hero.height}" alt="${esc(o.heroCaption)}"></div>
    <div class="cover-herocap">${esc(o.heroCaption)}</div>
  </div>
  <div class="cover-bottom">${o.bottom}</div>
  <div class="cover-foot"><span class="pg-brand">PR<b>0</b>TOBOARD · UHD</span><span>Generated from the UHD model of <code>${esc(env.ctx.sys.name)}</code> by @protoboardai/ext-docs</span><span class="right">${esc(m.docId)} · Rev ${esc(m.revision)} · ${esc(m.date)}</span></div>
</div>`;
}

export function testOf(env: BuildEnv, id: string): TestData | undefined {
  return env.ctx.tests.get(id);
}

/** "STAND-IN" / "MEASURED" tag for a test-data block. */
export function testTag(t: TestData | undefined): string {
  if (!t) return `<span class="tag err">no data</span>`;
  return t.status === "measured" ? `<span class="tag ok">measured</span>` : `<span class="tag warn standin-tag">stand-in · not measured</span>`;
}

export const imgPath = (docDir: string) => (file: string) => file.startsWith(docDir) ? file.slice(docDir.length + 1) : join("images", file);
