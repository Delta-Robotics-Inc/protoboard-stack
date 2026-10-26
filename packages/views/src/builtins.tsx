/**
 * The built-in views: the UHD diagram and the 3D assembly (both the
/**
 * The built-in views: the UHD diagram and the 3D assembly (both the
 * uhd-viewer's, sharing one viewer state in a shell), the board drawings
 * (schematic and PCB, PB-898), the pair comparator (PB-905), and the parts
 * views' BOM and library (parts/views.tsx, PB-912, with data from the
 * shell's PartsDataProvider). A planned view has its tab and placeholder
 * until its track replaces the registration with the working component.
 */
import { DiagramCanvas, EmptyState, Scene3D } from "@deltarobotics/uhd-viewer/components";
import { ViewIcon } from "./icons.js";
import { BUILTIN_TABS } from "./tabs.js";
import { PcbView, SchematicView } from "./drawing/BoardDrawingView.js";
import { PairView } from "./pair/PairView.js";
import { BomView, LibraryView } from "./parts/views.js";
import { Button } from "./parts/ui.js";
import { ViewRegistry } from "./registry.js";
import type { HostAdapter, ViewDefinition, ViewProps } from "./types.js";

/**
 * What the diagram's notice adds when the project names parts it does not
 * hold (a template made while signed out, or with the part library out of
 * reach): how they are fetched. The viewer itself only says they are missing.
 * The commands are `.cmd` spans, not <code>: a VS Code webview styles <code>
 * for the editor's background, which the notice does not have.
 */
export function MissingPartsHint({ host }: { host?: HostAdapter }) {
  // a host with a Fetch Parts of its own (VS Code, B6): its button, not a command to type
  if (host?.fetchParts) {
    const fetch = host.fetchParts;
    return (
      <>
        These are library parts the project has not fetched: Fetch Parts adds them from the Protoboard library.
        <span className="mt-1.5 flex">
          <Button size="sm" kind="primary" icon="download" onClick={() => fetch()}>
            Fetch Parts
          </Button>
        </span>
      </>
    );
  }
  return (
    <>
      These are library parts the project has not fetched. Sign in (<span className="cmd">protoboard login</span>), then run <span className="cmd">npx --no-install protoboard parts add</span> with their ids in the project; the check lists each one.
    </>
  );
}

/** The diagram of the focused level (the shell drills the shared viewer to the view's module). */
export function DiagramView({ host }: Partial<ViewProps>) {
  return <DiagramCanvas missingHint={<MissingPartsHint host={host} />} />;
}

/** The assembled 3D model (the whole system at any level), with its inspector while the shell's panel is open. */
export function AssemblyView() {
  return <Scene3D />;
}

/** What a planned view shows until its track lands. */
export function PlannedView({ view, module }: ViewProps) {
  return (
    <div className="grid size-full place-items-center bg-canvas">
      <EmptyState icon={<ViewIcon name={view.icon} size={28} strokeWidth={1.25} />} title={view.title}>
        {view.description ?? `The ${view.title.toLowerCase()} view is planned.`} It will show {module.name}.
      </EmptyState>
    </div>
  );
}

/** Each built-in tab's component (tabs.ts holds their registrations, which the command line reads too). */
const COMPONENTS: Record<string, ViewDefinition["component"]> = {
  diagram: DiagramView,
  "3d": AssemblyView,
  schematic: SchematicView,
  pcb: PcbView,
  bom: BomView,
  pair: PairView,
  library: LibraryView,
};

export const BUILTIN_VIEWS: readonly ViewDefinition[] = BUILTIN_TABS.map((t) => ({ ...t, component: COMPONENTS[t.id] }));

/** A registry with the built-in views. */
export function createViewRegistry(): ViewRegistry {
  const r = new ViewRegistry();
  for (const v of BUILTIN_VIEWS) r.register(v);
  return r;
}
