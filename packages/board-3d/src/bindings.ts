/**
 * Names, descriptions and input schemas for CLI commands and MCP tools, ready for the CLI track to bind (this package
 * registers nothing itself). Each entry's `input` is a zod object whose `.shape` an MCP server can expose directly.
 */
import { z } from "zod";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const PartOverrideSchema = z
  .object({
    height: z.number().positive().optional().describe("Body height above the board face, mm"),
    offset: Vec3.optional().describe("Move the body in the footprint frame, mm"),
    rotate: Vec3.optional().describe("Turn the body in the footprint frame, degrees about X, Y, Z"),
    body: z.enum(["none", "box"]).optional().describe("none: no body; box: a box from the courtyard and height"),
    midMountMm: z.number().nonnegative().optional().describe("Depth the part sits below the board face in a cutout, mm"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    note: z.string().max(200).optional(),
  })
  .strict();

export const Export3dInput = z
  .object({
    board: z.string().describe("Board folder (holds board.jsonl)"),
    out: z.string().optional().describe("Output folder (default: <board>/../out/3d)"),
    tier: z.enum(["full", "mechanical", "envelope", "board"]).default("full").describe("full: board, every part its own named solid, drilled holes; mechanical: mounting and large holes, parts as envelope boxes, connectors kept; envelope: board plus a keep-out slab per side and a height map; board: the board only"),
    render: z.boolean().default(false).describe("Add copper, solder mask openings and silkscreen as thin colored bodies (for marketing renders; off for the mechanical model)"),
    formats: z.array(z.enum(["step", "stl", "3mf", "glb"])).default(["step", "stl", "3mf", "glb"]),
    stl: z.enum(["single", "per-body", "both"]).default("both"),
    instances: z.enum(["unique", "shared"]).default("unique").describe("STEP: a product per component (named by reference designator) or shared products for identical bodies"),
    vias: z.boolean().default(true).describe("Drill via holes (full and board tiers)"),
    minHoleMm: z.number().positive().default(1.5).describe("mechanical and envelope tiers: plated holes at least this wide are kept"),
    origin: z.enum(["board-center", "document"]).default("board-center"),
    overrides: z.record(z.string(), PartOverrideSchema).optional().describe("Per-part overrides by reference designator, footprint id or UHD instance path"),
    images: z.boolean().default(true),
    validate: z.union([z.boolean(), z.literal("occt")]).default(true).describe("Read every file back and check it; occt also re-reads STEP through the CAD runtime"),
  })
  .strict();

export const Seating3dInput = z
  .object({
    board: z.string().describe("Board folder"),
    refs: z.array(z.string()).optional().describe("Only these reference designators"),
    overrides: z.record(z.string(), PartOverrideSchema).optional(),
  })
  .strict();

export const Inspect3dInput = z
  .object({
    file: z.string().describe("A STEP, STL, STL ZIP, 3MF or GLB file written by board export3d, with its .board3d.json beside it"),
    occt: z.boolean().default(false).describe("Also read a STEP file through OCCT (the CAD runtime)"),
  })
  .strict();

export interface Binding {
  /** MCP tool name. */
  tool: string;
  /** CLI command. */
  cli: string;
  title: string;
  description: string;
  input: z.ZodObject<z.ZodRawShape>;
  /** The package function that does the work. */
  implementation: string;
}

export const BOARD_3D_BINDINGS: Binding[] = [
  {
    tool: "board_export_3d",
    cli: "protoboard board export3d <board> [--tier full|mechanical|envelope|board] [--render] [--formats step,stl,3mf,glb] [--out <dir>]",
    title: "Export the board in 3D",
    description:
      "Write the board's 3D model for mechanical CAD and renders: STEP AP214 (one named, colored solid per component in an assembly), STL (one mesh and one file per body), 3MF (named objects with colors) and GLB (for the 3D viewer), with a sidecar JSON (frame, transforms, body sources, seating, mating points, holes) and an isometric and top PNG. Origin at the board center, z = 0 on the board's bottom face, millimeters. Copper and silkscreen are off unless render is set. Every file is read back and checked; the result lists counts, findings and timings.",
    input: Export3dInput as unknown as z.ZodObject<z.ZodRawShape>,
    implementation: "exportBoard3d",
  },
  {
    tool: "board_seating_check",
    cli: "protoboard board seating <board> [--ref U1 ...]",
    title: "Check how part bodies sit on their footprints",
    description:
      "Measure each part's 3D body against its footprint: the seating plane against the board face (floating or sunk), contacts against pads (offset), a better fit turned 90, 180 or 270 degrees or mirrored (wrong model axes or pin 1), and the body against the courtyard. Reports where each body came from (supplied model, parametric package body, or a courtyard box with a default height). Writes nothing.",
    input: Seating3dInput as unknown as z.ZodObject<z.ZodRawShape>,
    implementation: "buildBoard3d (components[].seating, findings)",
  },
  {
    tool: "board_inspect_3d",
    cli: "protoboard board inspect3d <file> [--occt]",
    title: "Check a 3D export",
    description: "Read a board 3D export back and compare it with its sidecar: solids or objects counted, names, colors, bounding box; with occt, the STEP file is also read by OCCT and its solids checked for validity.",
    input: Inspect3dInput as unknown as z.ZodObject<z.ZodRawShape>,
    implementation: "validateFile (readStepText, readStl, read3mf, readGlb)",
  },
];
