/**
 * The export commands as data for the CLI and MCP bindings: a name, a title, a one-paragraph description, the input
 * schema (zod; MCP uses `input.shape`), and the function. One command per export, with toggles; each returns the
 * files written, each file's paired image, and the pre-flight items.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { exportBom, exportDrill, exportDxf, exportFabPackage, exportGerbers, exportIpc2581, exportIpc356, exportPlacement, type ExportOptions, type ExportResult } from "./package.js";
import { PROFILES } from "./profiles.js";

const Nm = z.number().int().safe();

/** The input every export command takes (lengths in nm, as the board document). */
export const ExportInput = z
  .object({
    board: z.string().min(1).describe("Board folder (the folder holding board.jsonl)."),
    profile: z.enum(Object.keys(PROFILES) as [string, ...string[]]).default("jlcpcb").describe("Fab profile: jlcpcb, circuithub or generic."),
    out: z.string().min(1).describe("Output folder. A folder holding an earlier export is cleared of that export's files first; any other non-empty folder is refused."),
    name: z.string().min(1).max(80).optional().describe("File name stem (default: the board's name)."),
    revision: z.string().min(1).max(40).optional().describe("Board revision for the manifest and the Gerber project id."),
    origin: z.union([z.enum(["center", "lower-left"]), z.object({ x: Nm, y: Nm }).strict()]).default("center").describe("Origin of every file: the board center (default), the lower-left corner, or a board point in nm."),
    maskColor: z.string().min(1).max(30).optional().describe("Solder mask color (sets the mask web limit); default the profile's."),
    clipSilkToMask: z.boolean().optional().describe("Clear silkscreen from mask openings (default: the profile's choice)."),
    x2: z.enum(["attributes", "comments", "none"]).optional().describe("X2 attributes as extended commands, in comments, or none (default: the profile's)."),
    netAttributes: z.boolean().default(true).describe("Net, pin and component attributes on copper (the CAD netlist in the Gerbers)."),
    creationDate: z.string().optional().describe("Write this .CreationDate (ISO 8601); left out by default so output is byte-identical."),
    parts: z.string().optional().describe("JSON file of part data keyed by footprint id, UHD path or reference: lcsc, mpn, manufacturer, libraryClass, consigned, dnp, hand, rotation."),
    rotations: z.string().optional().describe("JSON file of rotation corrections [{ lcsc | package, rotation, offset?, source }], added to the profile's table."),
    fill: z.enum(["auto", "always", "never"]).default("auto").describe("Zone fill: use a current cached fill or compute (auto), always compute, or never compute."),
    dxfPads: z.boolean().default(false).describe("DXF: add pad outlines."),
    dxfHoles: z.boolean().default(false).describe("DXF: add drilled holes."),
    dxfCourtyards: z.boolean().default(false).describe("DXF: add courtyards."),
    kicadBoard: z.string().optional().describe("The .kicad_pcb the board was imported from: enables IPC-2581, ODB++ and the KiCad cross-check when it still matches the board."),
    png: z.boolean().default(true).describe("Write a PNG beside every SVG image."),
    override: z.object({ reason: z.string().min(3).max(500), by: z.string().min(1).max(80) }).strict().optional().describe("Call the package ready although checks fail; the reason and who gave it go into the manifest."),
    outputs: z
      .object({ gerber: z.boolean(), drill: z.boolean(), bom: z.boolean(), cpl: z.boolean(), ipc356: z.boolean(), dxf: z.boolean(), ipc2581: z.boolean(), odb: z.boolean(), crossCheck: z.boolean() })
      .partial()
      .strict()
      .optional()
      .describe("Package toggles (default: every output; IPC-2581 for CircuitHub; the KiCad cross-check when it can run)."),
  })
  .strict();
export type ExportInput = z.infer<typeof ExportInput>;

export interface ExportCommand {
  /** Command name for the CLI (`protoboard board export <name>`) and the MCP tool (`board_export_<name>`). */
  name: string;
  title: string;
  description: string;
  input: typeof ExportInput;
  run: (board: string, profile: string, options: ExportOptions) => Promise<ExportResult>;
}

export const EXPORT_COMMANDS: readonly ExportCommand[] = [
  {
    name: "package",
    title: "Export a fab package",
    description:
      "Write every manufacturing output of a board for one fab profile into one folder: Gerber X2 files, Excellon drill files, BOM and placement files in the fab's columns plus generic ones, an IPC-D-356 netlist, a DXF outline, IPC-2581 through KiCad when available, an image beside every file, a manifest with hashes, and a pre-flight report. Everything written is read back and checked; the package is called ready only when no check fails, unless an override with a reason is given.",
    input: ExportInput,
    run: exportFabPackage,
  },
  { name: "gerbers", title: "Export Gerber files", description: "Write the Gerber X2 files of every fab layer (copper, solder mask, paste, silkscreen, profile) with pads flashed and net attributes, each with an image of the file as read back, and check them against the board.", input: ExportInput, run: exportGerbers },
  { name: "drill", title: "Export drill files", description: "Write Excellon drill files (plated, non-plated, and one per blind or buried span) with slots, tool tables and X2 drill attributes, and drill map images; read them back and compare every hole with the board.", input: ExportInput, run: exportDrill },
  { name: "bom", title: "Export the BOM", description: "Write the bill of materials in the fab profile's format and a generic designator-grouped one, with a table image. Lines without an LCSC part number are flagged, never guessed; parts you supply are marked consigned.", input: ExportInput, run: exportBom },
  { name: "placement", title: "Export the placement file", description: "Write the pick-and-place file in the fab profile's format and a generic one, positions relative to the chosen origin, rotations with the profile's corrections, and an overlay image colored by whether each rotation is verified.", input: ExportInput, run: exportPlacement },
  { name: "ipc356", title: "Export the IPC-D-356 netlist", description: "Write the IPC-D-356A netlist for bare-board electrical test, with an image of the test points, and read it back.", input: ExportInput, run: exportIpc356 },
  { name: "dxf", title: "Export a DXF", description: "Write a DXF of the board outline and cutouts (optionally pads, holes and courtyards) for mechanical CAD, with an image, and read it back.", input: ExportInput, run: exportDxf },
  { name: "ipc2581", title: "Export IPC-2581 and ODB++", description: "Write IPC-2581 (revision C) and ODB++ through kicad-cli. Needs KiCad installed and the KiCad board file the document was imported from, unchanged since; otherwise it reports what is missing.", input: ExportInput, run: exportIpc2581 },
];

/** A command by name. */
export const exportCommand = (name: string): ExportCommand | undefined => EXPORT_COMMANDS.find((c) => c.name === name);

/** Turn a parsed command input into the export call: the board folder, the profile, and `ExportOptions` (part data and rotation files read here). */
export function optionsFromInput(raw: unknown): { board: string; profile: string; options: ExportOptions } {
  const i = ExportInput.parse(raw);
  const json = (p: string | undefined) => (p ? (JSON.parse(readFileSync(p, "utf8")) as unknown) : undefined);
  const options: ExportOptions = {
    outDir: i.out,
    ...(i.name ? { name: i.name } : {}),
    ...(i.revision ? { revision: i.revision } : {}),
    origin: i.origin,
    ...(i.maskColor ? { maskColor: i.maskColor } : {}),
    ...(i.clipSilkToMask !== undefined ? { clipSilkToMask: i.clipSilkToMask } : {}),
    ...(i.x2 ? { x2: i.x2 } : {}),
    netAttributes: i.netAttributes,
    ...(i.creationDate ? { creationDate: i.creationDate } : {}),
    ...(i.parts ? { parts: json(i.parts) as ExportOptions["parts"] } : {}),
    ...(i.rotations ? { rotations: json(i.rotations) as ExportOptions["rotations"] } : {}),
    fill: { compute: i.fill },
    dxf: { pads: i.dxfPads, holes: i.dxfHoles, courtyards: i.dxfCourtyards },
    ...(i.kicadBoard ? { kicad: { board: i.kicadBoard } } : {}),
    png: i.png,
    ...(i.override ? { override: i.override } : {}),
    ...(i.outputs ? { outputs: i.outputs } : {}),
  };
  return { board: i.board, profile: i.profile, options };
}
