/**
 * Shared pieces of ext-docs' Manufacturing Package sections (the spec sheet
 * and assembly guide of each unit, @protoboardai/ext-release section
 * contract): the document context of the project, plain-text model values,
 * what one unit covers, and part thumbnails rendered through the release.
 */
import { existsSync } from "node:fs";
import type { ModuleDef } from "@deltarobotics/uhd";
import type { Project } from "@protoboardai/core";
import type { RenderedFigure, SectionContext, Unit } from "@protoboardai/ext-release";
import { buildContext, type BuiltContext } from "../context.ts";
import { ISO, isolated } from "../figures.ts";
import { formatValue } from "../format.ts";
import { category, featureNames, glbFor } from "../model.ts";
import type { StepScope } from "../docs/assembly.ts";

const contexts = new WeakMap<Project, Promise<BuiltContext>>();

/** The document context of the project (model, assembly, wiring, values), built once per loaded project. */
export function docContext(p: Project): Promise<BuiltContext> {
  let c = contexts.get(p);
  if (!c) {
    c = buildContext(p);
    contexts.set(p, c);
  }
  return c;
}

/** A model value as plain text, formatted as the technical documents format it. */
export const textValue = (ctx: BuiltContext) => (q: string, f?: string) => {
  const r = ctx.resolve(q);
  const text = r.status === "gap" && (r.value === undefined || r.value === null) ? "—" : formatValue(r.value, r.unit, f);
  return text.replace(/ /g, " ");
};

const parentOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");

export interface UnitScope extends StepScope {
  /** The representative instance path of one build ("" for the root). */
  own: string;
  /** An instance path in one build of the unit (sub-units included: they arrive built). */
  inBuild: (path: string) => boolean;
  /** An instance path inside a sub-unit (built in its own folder). */
  inSub: (path: string) => boolean;
  /** The sub-unit instance a path is in. */
  subOf: (path: string) => string | undefined;
}

/**
 * What one unit covers: the links declared by its own module and by the
 * members folded into it (not those of sub-units, which are built first),
 * and placements inside one build. A module unit built several times is
 * described by its representative build. Links a board declares (its nets)
 * are made by its copper, so they are not steps.
 */
export function unitScope(u: Unit, p?: Project): UnitScope {
  const own = u.kind === "root" ? "" : u.representative;
  // a board's links are its nets: the copper makes them, not an assembly step
  const board = (def: string) => !!p?.capabilities.some((b) => b.capability === "circuit" && b.module === def && !b.problem);
  const declarers = new Set([...(board(u.definition) ? [] : [own]), ...u.members.filter((m) => !m.unit && !board(m.definition)).map((m) => m.instance)]);
  const subs = u.members.filter((m) => m.unit).map((m) => m.instance);
  const under = (path: string, at: string) => at === "" || path === at || path.startsWith(at + "/");
  const subOf = (path: string) => subs.find((s) => under(path, s));
  const inBuild = (path: string) => under(path, own);
  return {
    own,
    inBuild,
    inSub: (path) => subOf(path) !== undefined,
    subOf,
    link: (id) => declarers.has(parentOf(id)),
    // a unit is placed by the unit it goes into (a board seated in the case), not in its own build
    place: (path) => inBuild(path) && path !== own && (subOf(path) === undefined || subs.includes(path)),
  };
}

/** A module's body GLB as a served path, when its file is in this checkout. */
export function bodyGlb(ctx: BuiltContext, def: ModuleDef): string | undefined {
  const glb = glbFor(def);
  const file = glb?.filePath ? ctx.sys.file(def, glb.filePath) : undefined;
  if (!glb?.filePath || !file || !existsSync(file)) return undefined;
  return ctx.sys.served(def, glb.filePath);
}

/** A thumbnail of a module on its own (line art), rendered once per release; undefined without a body file. */
export async function thumbnail(ctx: BuiltContext, s: SectionContext, def: ModuleDef): Promise<RenderedFigure | undefined> {
  const served = bodyGlb(ctx, def);
  if (!served) return undefined;
  const glb = glbFor(def)!;
  const cat = category(def);
  return s.figure(`part-${def.id}`, {
    width: 360,
    height: 360,
    mode: "lineart",
    lineScale: 1.25,
    bodies: isolated(def, served, featureNames(ctx.sys, def, glb), cat, glb.id.startsWith("cad_vendor")),
    camera: { dir: cat === "prop" || cat === "frame" || cat === "top_plate" ? [0.8, -1, 1.4] : ISO, margin: 0.08 },
  });
}

/** Why a module has no thumbnail (shown in its place). */
export function noImage(ctx: BuiltContext, def: ModuleDef): string {
  const glb = glbFor(def);
  if (def.kind === "harness") return "cable / lead";
  if (glb?.filePath) return "CAD file not available";
  return "no CAD";
}

/** Safe figure-name fragment from an id. */
export const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
