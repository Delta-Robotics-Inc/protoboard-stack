/**
 * Testing a section contributor without a release
 * (`@protoboardai/ext-release/testing`): the units of a project and the
 * context the release passes a `package:<section>` entry, with a figure
 * function that records the specs instead of rendering them.
 */
import type { Project, ReleaseConfig } from "@protoboardai/core";
import type { RenderSpec } from "@protoboardai/ext-docs/renderer";
import { collectUnitFiles } from "./collect.ts";
import { SECTIONS, type PackageFile, type RenderedFigure, type SectionContext, type SectionId, type Unit } from "./types.ts";
import { resolveUnits } from "./units.ts";

export interface TestContexts {
  units: Unit[];
  /** Figures asked for so far, by name. */
  figures: Map<string, RenderSpec>;
  files: PackageFile[];
  /** The context for one unit (by id) and section; `operations` as other extensions would contribute them to its work order. */
  context: (unit: string, section: SectionId, contributors?: string[], operations?: SectionContext["operations"]) => SectionContext;
}

export function testContexts(p: Project, config: ReleaseConfig = {}, version = "0.0.0-test"): TestContexts {
  const { units, diagnostics } = resolveUnits(p, config.units ?? []);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length) throw new Error(errors.map((d) => d.message).join("; "));
  const files = units.flatMap((u) => collectUnitFiles(p, u));
  const figures = new Map<string, RenderSpec>();
  const figure = async (name: string, spec: RenderSpec): Promise<RenderedFigure> => {
    figures.set(name, spec);
    return { file: `assets/images/${name}.png`, width: spec.width, height: spec.height, anchors: Object.fromEntries((spec.anchors ?? []).map((a, i) => [a.id, { x: 10 + i, y: 20 + i }])) };
  };
  return {
    units,
    figures,
    files,
    context: (id, section, contributors = ["@protoboardai/ext-release"], operations = []) => {
      const unit = units.find((u) => u.id === id);
      if (!unit) throw new Error(`no unit ${id} (units: ${units.map((u) => u.id).join(", ")})`);
      if (!SECTIONS.includes(section)) throw new Error(`no section ${section}`);
      return { project: p, section, unit, units, release: { version, date: "2026-01-01", build: config.build ?? 1, config }, files: files.filter((f) => f.unit === unit.id), contributors, operations, figure, log: () => {} };
    },
  };
}
