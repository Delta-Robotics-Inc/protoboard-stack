/**
 * The top bar's depth switcher (System, Schematic, Layout, 3D) with the active depth given: a copy of the layout
 * screen's switcher markup (`pcb-switch`, ../pcb/ui/shell.tsx), which marks Layout as active always.
 */
import { Icon } from "../pcb/ui/icons.js";

export type Depth = "system" | "schematic" | "layout" | "3d";

export const DEPTHS: { id: Depth; label: string }[] = [
  { id: "system", label: "System" },
  { id: "schematic", label: "Schematic" },
  { id: "layout", label: "Layout" },
  { id: "3d", label: "3D" },
];

export function DepthSwitcher({ active, onNavigate, enabled }: { active: Depth; onNavigate?: (d: Depth) => void; enabled?: (d: Depth) => boolean }) {
  return (
    <div className="pcb-switch caps" role="tablist" aria-label="Depth">
      {DEPTHS.map((d, i) => (
        <span key={d.id} style={{ display: "contents" }}>
          {i > 0 && <span className="dash" />}
          <button className={d.id === active ? "on" : ""} disabled={d.id !== active && (!onNavigate || (enabled ? !enabled(d.id) : false))} onClick={() => d.id !== active && onNavigate?.(d.id)} title={`${d.label} (${i + 1})`} role="tab" aria-selected={d.id === active} data-depth={d.id}>
            <span className="key">{i + 1}</span>
            {d.label}
          </button>
        </span>
      ))}
    </div>
  );
}

export { Icon };
