/**
 * What the schematic and PCB views share with the diagram's canvas: the
 * pointer tools (Select, Pan) and the view buttons (Fit, zoom) with their
 * keys, and the selection box drawn while a Select drag is under way.
 */
import { IconButton, TOOL_OPTIONS } from "@deltarobotics/uhd-viewer/components";
import type { PanZoom } from "./usePanZoom.js";

export function DrawingTools({ pz }: { pz: PanZoom }) {
  return (
    <>
      <div role="group" aria-label="Pointer" className="flex items-center gap-0.5">
        {TOOL_OPTIONS.map((o) => (
          <IconButton key={o.id} icon={o.icon} label={o.label} shortcut={o.shortcut} pressed={o.id === pz.tool} tooltipSide="top" onClick={() => pz.setTool(o.id)} />
        ))}
      </div>
    </>
  );
}

export function DrawingViewButtons({ pz }: { pz: PanZoom }) {
  return (
    <>
      <IconButton icon="maximize" label="Fit" shortcut="F" tooltipSide="top" onClick={() => pz.fit()} />
      <IconButton icon="zoom-in" label="Zoom in" shortcut="+" tooltipSide="top" onClick={() => pz.zoomBy(1.4)} />
      <IconButton icon="zoom-out" label="Zoom out" shortcut="-" tooltipSide="top" onClick={() => pz.zoomBy(1 / 1.4)} />
    </>
  );
}

/** The selection box, over the drawing, while a Select drag draws it. */
export function SelectionBox({ pz }: { pz: PanZoom }) {
  const b = pz.selecting;
  if (!b) return null;
  return <div aria-hidden className="pointer-events-none absolute rounded-[2px] border border-accent bg-accent/10" data-pb-selecting style={{ left: b[0], top: b[1], width: b[2], height: b[3] }} />;
}

/** The host's cursor for the tool: a hand to pan (grabbing while it does), an arrow to pick and box-select. */
export const toolCursor = (pz: PanZoom) => (pz.panning ? "cursor-grab active:cursor-grabbing" : "cursor-default");
