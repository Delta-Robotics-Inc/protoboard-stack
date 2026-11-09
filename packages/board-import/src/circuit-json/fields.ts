/**
 * The Circuit JSON element types and fields this adapter reads and writes. The conformance test checks every one
 * against the installed `circuit-json` package (its zod schemas at run time, its types at compile time), so an
 * upstream rename fails the test instead of being silently ignored.
 */
import type { AnyCircuitElement } from "circuit-json";

type ElementType = AnyCircuitElement["type"];
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
type FieldsOf<T extends ElementType> = KeysOfUnion<Extract<AnyCircuitElement, { type: T }>>;
type FieldTable = { readonly [T in ElementType]?: readonly FieldsOf<T>[] };

/** Every element type and field the importer reads. */
export const READ_FIELDS = {
  pcb_board: ["pcb_board_id", "center", "width", "height", "outline", "thickness", "num_layers", "min_trace_width", "min_via_hole_diameter", "min_via_pad_diameter", "min_board_edge_clearance", "min_trace_to_pad_edge_clearance", "min_pad_edge_to_pad_edge_clearance", "min_via_edge_to_pad_edge_clearance", "min_different_net_trace_edge_to_trace_edge_clearance", "min_trace_to_hole_edge_clearance", "min_via_hole_edge_to_via_hole_edge_clearance", "min_plated_hole_drill_edge_to_drill_edge_clearance", "min_same_net_trace_edge_to_trace_edge_clearance"],
  source_component: ["source_component_id", "name", "ftype", "manufacturer_part_number", "supplier_part_numbers", "display_value"],
  cad_component: ["pcb_component_id", "footprinter_string"],
  pcb_component: ["pcb_component_id", "source_component_id", "center", "rotation", "layer"],
  source_port: ["source_port_id", "source_component_id", "name", "pin_number", "port_hints", "subcircuit_connectivity_map_key"],
  pcb_port: ["pcb_port_id", "source_port_id"],
  source_net: ["source_net_id", "name", "subcircuit_connectivity_map_key"],
  source_trace: ["source_trace_id", "connected_source_port_ids", "connected_source_net_ids", "display_name", "subcircuit_connectivity_map_key"],
  pcb_smtpad: ["pcb_smtpad_id", "pcb_component_id", "pcb_port_id", "shape", "x", "y", "width", "height", "radius", "corner_radius", "rect_border_radius", "ccw_rotation", "points", "layer", "port_hints", "soldermask_margin", "solderpaste_margin", "is_covered_with_solder_mask"],
  pcb_plated_hole: ["pcb_plated_hole_id", "pcb_component_id", "pcb_port_id", "shape", "x", "y", "outer_diameter", "hole_diameter", "outer_width", "outer_height", "hole_width", "hole_height", "ccw_rotation", "rect_pad_width", "rect_pad_height", "rect_border_radius", "rect_ccw_rotation", "hole_ccw_rotation", "hole_offset_x", "hole_offset_y", "pad_outline", "port_hints", "soldermask_margin"],
  pcb_hole: ["pcb_hole_id", "pcb_component_id", "hole_shape", "hole_diameter", "hole_width", "hole_height", "x", "y"],
  pcb_trace: ["pcb_trace_id", "source_trace_id", "route"],
  pcb_via: ["pcb_via_id", "x", "y", "outer_diameter", "hole_diameter", "from_layer", "to_layer", "layers", "source_trace_id", "source_net_id", "pcb_trace_id", "subcircuit_connectivity_map_key", "tented_on_top", "tented_on_bottom"],
  pcb_keepout: ["pcb_keepout_id", "shape", "center", "width", "height", "radius", "outline", "layers", "description", "warning_only", "allow_traces", "allow_placements"],
  pcb_copper_pour: ["pcb_copper_pour_id", "shape", "layer", "source_net_id", "center", "width", "height", "rotation", "points", "brep_shape"],
  pcb_cutout: ["pcb_cutout_id", "shape", "center", "width", "height", "rotation", "radius", "points"],
  pcb_silkscreen_line: ["pcb_component_id", "layer", "x1", "y1", "x2", "y2", "stroke_width"],
  pcb_silkscreen_path: ["pcb_component_id", "layer", "route", "stroke_width"],
  pcb_silkscreen_rect: ["pcb_component_id", "layer", "center", "width", "height", "stroke_width", "is_filled", "ccw_rotation", "corner_radius"],
  pcb_silkscreen_circle: ["pcb_component_id", "layer", "center", "radius", "stroke_width", "is_filled"],
  pcb_silkscreen_text: ["pcb_component_id", "layer", "text", "anchor_position", "anchor_alignment", "font_size", "ccw_rotation", "is_mirrored"],
  pcb_text: ["text", "center", "layer", "height"],
  pcb_fabrication_note_path: ["pcb_component_id", "layer", "route", "stroke_width"],
  pcb_fabrication_note_text: ["pcb_component_id", "layer", "text", "anchor_position", "anchor_alignment", "font_size", "ccw_rotation"],
  pcb_courtyard_outline: ["pcb_component_id", "outline"],
  pcb_courtyard_rect: ["pcb_component_id", "center", "width", "height", "ccw_rotation"],
  pcb_courtyard_polygon: ["pcb_component_id", "points"],
  pcb_courtyard_circle: ["pcb_component_id", "center", "radius"],
} as const satisfies FieldTable;

/** Every element type and field the exporter writes. */
export const WRITE_FIELDS = {
  source_component: ["source_component_id", "name", "ftype", "supplier_part_numbers"],
  pcb_component: ["pcb_component_id", "source_component_id", "center", "rotation", "layer", "width", "height"],
  source_port: ["source_port_id", "source_component_id", "name", "pin_number", "port_hints"],
  pcb_port: ["pcb_port_id", "source_port_id", "pcb_component_id", "x", "y", "layers"],
  source_net: ["source_net_id", "name", "member_source_group_ids"],
  source_trace: ["source_trace_id", "connected_source_port_ids", "connected_source_net_ids", "display_name"],
  pcb_smtpad: ["pcb_smtpad_id", "pcb_component_id", "pcb_port_id", "shape", "x", "y", "width", "height", "radius", "corner_radius", "ccw_rotation", "points", "layer", "port_hints", "soldermask_margin", "solderpaste_margin"],
  pcb_plated_hole: ["pcb_plated_hole_id", "pcb_component_id", "pcb_port_id", "shape", "x", "y", "outer_diameter", "hole_diameter", "outer_width", "outer_height", "hole_width", "hole_height", "ccw_rotation", "hole_shape", "pad_shape", "rect_pad_width", "rect_pad_height", "rect_border_radius", "rect_ccw_rotation", "hole_ccw_rotation", "hole_offset_x", "hole_offset_y", "pad_outline", "layers", "port_hints"],
  pcb_hole: ["pcb_hole_id", "pcb_component_id", "hole_shape", "hole_diameter", "x", "y"],
  pcb_trace: ["pcb_trace_id", "source_trace_id", "route"],
  pcb_via: ["pcb_via_id", "x", "y", "outer_diameter", "hole_diameter", "from_layer", "to_layer", "layers", "source_trace_id"],
  pcb_keepout: ["pcb_keepout_id", "shape", "center", "width", "height", "outline", "layers", "description", "warning_only", "allow_traces", "allow_placements"],
  pcb_board: ["pcb_board_id", "center", "width", "height", "outline", "thickness", "num_layers"],
  pcb_cutout: ["pcb_cutout_id", "shape", "points"],
  pcb_silkscreen_line: ["pcb_silkscreen_line_id", "pcb_component_id", "layer", "x1", "y1", "x2", "y2", "stroke_width"],
  pcb_silkscreen_path: ["pcb_silkscreen_path_id", "pcb_component_id", "layer", "route", "stroke_width"],
  pcb_silkscreen_rect: ["pcb_silkscreen_rect_id", "pcb_component_id", "layer", "center", "width", "height", "stroke_width", "is_filled", "ccw_rotation"],
  pcb_silkscreen_circle: ["pcb_silkscreen_circle_id", "pcb_component_id", "layer", "center", "radius", "stroke_width", "is_filled"],
  pcb_silkscreen_text: ["pcb_silkscreen_text_id", "pcb_component_id", "layer", "text", "anchor_position", "anchor_alignment", "font", "font_size", "ccw_rotation", "is_mirrored"],
} as const satisfies FieldTable;

/** Route point fields read and written (`pcb_trace.route[]`). */
export const ROUTE_POINT_FIELDS = ["route_type", "x", "y", "width", "start_width", "end_width", "start_pcb_port_id", "end_pcb_port_id", "layer", "from_layer", "to_layer", "hole_diameter", "outer_diameter", "start", "end", "start_layer", "end_layer"] as const;
