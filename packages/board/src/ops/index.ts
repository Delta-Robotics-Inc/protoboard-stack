/** Registers every Phase 1 operation and names the Phase 2 ones (contract section 8.2). */
import "./footprint.js";
import "./copper.js";
import "./areas.js";
import "./meta.js";
import "./edit.js";
import "./drawing.js";
import "./placement.js";
import "./rework.js";
import "./outline-dxf.js";
import "./netlist.js";

import { getOperation } from "./registry.js";

export { change, distinct, edited, getOperation, listOperations, need, OpError, registerOperation, type Actor, type ApplyContext, type ApplyResult, type OperationDef, type OpCall } from "./registry.js";

/** Operations the contracts name that are not registered yet (empty once Phase 2 is built). Bindings may list them as "coming". */
export const PLANNED_OPERATIONS: readonly { name: string; description: string }[] = ([
  { name: "footprint.move", description: 'tracks: "attached" (then the default): copper on the moved pads follows, with a local reroute of what no longer fits' },
  { name: "track.drag", description: "drag a segment or via; connected copper follows (walk-around, then push and shove)" },
  { name: "track.route", description: "commit an interactive route: a chain of segments and vias from a start pad to an end, in one operation" },
  { name: "track.set_width", description: "change the width of segments or of a whole net, with necking at pad entries" },
  { name: "copper.rip", description: "remove unlocked copper of nets, or inside a region" },
  { name: "text.add", description: "add board text" },
  { name: "text.edit", description: "edit board text" },
  { name: "text.delete", description: "remove board text" },
  { name: "graphic.add", description: "add a board graphic (silkscreen, fabrication, user layers)" },
  { name: "graphic.edit", description: "edit a board graphic" },
  { name: "graphic.delete", description: "remove a board graphic" },
  { name: "outline.import_dxf", description: "set the outline from a DXF file's closed contour" },
  { name: "footprint.add", description: "place a new footprint (from the netlist or the library)" },
  { name: "footprint.remove", description: "remove a footprint no longer in the netlist" },
  { name: "netlist.sync", description: "system: apply a new netlist; renamed nets are mapped by pin membership; footprints added and removed" },
] as const).filter((p) => !getOperation(p.name));
