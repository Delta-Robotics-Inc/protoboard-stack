/**
 * Which tabs a module gets, without any view's component: the built-in
 * views' registrations (id, title, order, `applies`) and the registry
 * built from them plus the views extensions declare. No React and no DOM,
 * so the command line answers the same question the shells do
 * (`protoboard views check`, PB-1030); builtins.tsx adds the components.
 */
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import type { ResolvedView } from "@protoboardai/core";
import { VIEW_FILES, isModelFile } from "@protoboardai/core/views";
import { appliesFromDecl, hasArtifact, hasFile } from "./applies.js";

/** A view's registration without its component (types.ts ViewDefinition, which adds it). */
export interface TabRule {
  id: string;
  title: string;
  icon: string;
  applies(module: ModuleDef, bundle: UhdBundle, at?: { path: string }): boolean;
  order?: number;
  description?: string;
  source?: string;
  uhd?: boolean;
}

/** The schematic view's icon (drawn by icons.tsx: Lucide has no schematic symbol). */
export const SCHEMATIC_ICON = "pb-schematic";

export const BUILTIN_TABS: readonly TabRule[] = [
  {
    id: "diagram",
    title: "Diagram",
    icon: "workflow",
    order: 0,
    uhd: true,
    source: "builtin",
    description: "Modules, interfaces, links and harnesses of this level.",
    applies: () => true,
  },
  {
    id: "3d",
    title: "3D",
    icon: "box",
    order: 10,
    uhd: true,
    source: "builtin",
    description: "The assembled model, placed by its mates.",
    applies: (module, bundle) => hasArtifact(module, bundle, isModelFile),
  },
  {
    id: "schematic",
    title: "Schematic",
    icon: SCHEMATIC_ICON,
    order: 20,
    source: "builtin",
    description: "The board's schematic, from its circuit tool's native drawing, in the host's theme.",
    // scoped to the module being viewed (the 2026-10-05 review): the board that has the drawing, never a level above it
    applies: (module, bundle) => hasFile(module, bundle, VIEW_FILES.schematic),
  },
  {
    id: "pcb",
    title: "PCB",
    icon: "circuit-board",
    order: 30,
    source: "builtin",
    description: "The board's layout, top and bottom, in the host's theme; a pad lights its net.",
    applies: (module, bundle) => hasFile(module, bundle, VIEW_FILES.pcb),
  },
  {
    id: "bom",
    title: "BOM",
    icon: "sheet",
    order: 40,
    source: "builtin",
    description: "Every part below this module, with quantities, sources and prices.",
    applies: (module, bundle, at) => (at ? at.path === "" : module.id === bundle.root) || hasFile(module, bundle, VIEW_FILES.bom),
  },
  {
    id: "pair",
    title: "Pair",
    icon: "git-compare-arrows",
    order: 50,
    source: "builtin",
    description: "Two linked modules side by side, link by link, with every interface of both.",
    // a level whose stored links join two different modules (a link back to the same one is no pair)
    applies: (module) => (module.links ?? []).some((l) => ("child" in l.a ? l.a.child : "") !== ("child" in l.b ? l.b.child : "")),
  },
  {
    id: "library",
    title: "Library",
    icon: "library-big",
    order: 60,
    source: "builtin",
    description: "The project's parts and the libraries they come from.",
    applies: (module, bundle, at) => (at ? at.path === "" : module.id === bundle.root),
  },
];

const byOrder = (a: TabRule, b: TabRule) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id);

/**
 * The tabs a module gets at an instance path, in tab order, as the shells'
 * registry offers them (registry.ts: the built-in views, and each view an
 * extension declares whose id is not taken; a predicate that throws leaves
 * its tab out).
 */
export function tabsFor(module: ModuleDef, bundle: UhdBundle, path: string, contributed: readonly ResolvedView[] = []): TabRule[] {
  const all: TabRule[] = [...BUILTIN_TABS];
  for (const v of contributed) if (!all.some((t) => t.id === v.id)) all.push({ id: v.id, title: v.title, icon: v.icon, order: v.order, applies: appliesFromDecl(v.appliesTo), source: v.extension });
  return all
    .filter((t) => {
      try {
        return t.applies(module, bundle, { path });
      } catch {
        return false;
      }
    })
    .sort(byOrder);
}
