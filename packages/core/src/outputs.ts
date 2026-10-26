/**
 * Standard outputs (tool-integrations.md §3): the files a capability provider
 * exports into a module's `out/` folder, and the only files anything
 * downstream reads. Each file is checked for presence and well-formedness
 * here, so a provider can be replaced without its consumers noticing.
 *
 * The checks are structural, not geometric: a Gerber file with a valid header
 * and terminator can still describe the wrong board. They catch missing,
 * truncated, mislabelled and wrongly keyed files; whether the design is right
 * is the provider's `check` and the model's validators.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { GeometryManifest, ModuleDef, ModuleLookup } from "@deltarobotics/uhd";
import type { CapabilityId } from "./extensions.js";
import type { Severity } from "./types.js";

/** A finding about one output file. `file` is relative to the module's `out/` folder. */
export interface OutputFinding {
  code: "PB_OUTPUT_MISSING" | "PB_OUTPUT_MALFORMED" | "PB_OUTPUT_UNKNOWN_INSTANCE" | "PB_OUTPUT_INCOMPLETE";
  severity: Severity;
  file: string;
  line?: number;
  message: string;
}

export type OutputFormat = "gerber" | "excellon" | "bom" | "pnp" | "glb" | "step" | "manifest" | "netlist" | "stl" | "3mf" | "dxf" | "firmware-config" | "firmware-manifest";

export interface StandardOutput {
  /** Path under `out/`; a trailing slash is a folder of files of this format. */
  path: string;
  format: OutputFormat;
  description: string;
}

/** Drill files inside `out/gerber/` are told from Gerber layers by extension. */
const DRILL_EXT = [".drl", ".xln"];

/** Required standard outputs per capability, under the module's `out/` folder. */
export const STANDARD_OUTPUTS: Record<CapabilityId, StandardOutput[]> = {
  circuit: [
    { path: "gerber/", format: "gerber", description: "Gerber RS-274X layers (every file in gerber/ that is not a drill file)" },
    { path: "gerber/", format: "excellon", description: `Excellon drill files (${DRILL_EXT.join(", ")} in gerber/)` },
    { path: "bom.csv", format: "bom", description: "bill of materials, one row per component, keyed by UHD instance path (column `instance`)" },
    { path: "pnp.csv", format: "pnp", description: "pick-and-place: instance, x_mm, y_mm, rotation_deg, side (top|bottom)" },
    { path: "board.glb", format: "glb", description: "board body (glTF 2.0 binary)" },
    { path: "board.step", format: "step", description: "board body (STEP, ISO 10303-21)" },
    { path: "board.manifest.json", format: "manifest", description: "UHD geometry manifest: outline, mounting holes, component and connector features" },
    { path: "netlist.json", format: "netlist", description: "nets as laid out, keyed by UHD instance path and interface (protoboard.netlist/v0)" },
  ],
  cad: [
    { path: "body.step", format: "step", description: "body (STEP, ISO 10303-21)" },
    { path: "body.glb", format: "glb", description: "body (glTF 2.0 binary)" },
    { path: "body.manifest.json", format: "manifest", description: "UHD geometry manifest naming the features that carry interfaces" },
  ],
  firmware: [
    { path: "config/", format: "firmware-config", description: "firmware configuration files (any layout under config/; subfolders allowed)" },
    { path: "firmware.manifest.json", format: "firmware-manifest", description: "firmware manifest: every file in config/ with its digest and the UHD facts each line cites (protoboard.firmware/v0)" },
  ],
};

/**
 * What each capability's export owns in a shared `out/` folder. `firmware`
 * owns exactly its standard output paths; `circuit` and `cad` own everything
 * else (their providers write extra files, such as interface GLBs), so a
 * board's circuit and firmware share one `out/` without either export
 * deleting the other's files. circuit and cad do not share a folder.
 */
export const OWNED_OUTPUTS: Partial<Record<CapabilityId, string[]>> = {
  firmware: ["config/", "firmware.manifest.json"],
};

/**
 * Top-level entries of `outDir` that belong to `capability`'s export, given
 * the other capabilities bound in the same directory. A folder entry ends
 * with `/`.
 */
export function ownedOutputs(outDir: string, capability: CapabilityId, neighbours: CapabilityId[]): string[] {
  if (!existsSync(outDir) || !statSync(outDir).isDirectory()) return [];
  const entries = readdirSync(outDir)
    .sort()
    .map((n) => (statSync(join(outDir, n)).isDirectory() ? `${n}/` : n));
  const own = OWNED_OUTPUTS[capability];
  if (own) return entries.filter((e) => own.includes(e));
  const others = new Set(neighbours.filter((c) => c !== capability).flatMap((c) => OWNED_OUTPUTS[c] ?? []));
  return entries.filter((e) => !others.has(e));
}

/** cad: the manufacturing exports a process needs (any file name in `out/`). */
export const PROCESS_EXPORTS: Record<CadProcess, OutputFormat[]> = {
  print: ["stl", "3mf"],
  cut: ["dxf"],
  machine: [],
};
export type CadProcess = "print" | "cut" | "machine";

/** Manufacturing exports are recognised by extension wherever they appear in `out/`. */
const MANUFACTURING: Record<string, OutputFormat> = { ".stl": "stl", ".3mf": "3mf", ".dxf": "dxf" };

export const NETLIST_SCHEMA = "protoboard.netlist/v0";
export const FIRMWARE_MANIFEST_SCHEMA = "protoboard.firmware/v0";

/**
 * A fact a firmware configuration line is derived from, as `<kind>:<ref>`:
 *
 *   net:<net id>                    a net of the board (a Net interface)
 *   link:<link id>                  a link of the board
 *   pin:<instance>:<interface>      a component's pin (or interface), relative to the board
 *   part:<part id>:<fact>           a fact of a part used on the board (`i2c.i2c_address`, `metadata.soc`)
 *   module:<fact>                   a fact of the board module itself
 *   constraint:<key>                a design constraint in the module's firmware.config.ts
 */
export type FirmwareCite = string;

/** `out/firmware.manifest.json`: what the firmware export wrote and why each line says what it says. */
export interface FirmwareManifest {
  schema: typeof FIRMWARE_MANIFEST_SCHEMA;
  /** The board module id. */
  module: string;
  /** Extension id of the provider that wrote it. */
  provider: string;
  /** Firmware framework the files are for, e.g. "zephyr", "esp-idf". */
  framework: string;
  /** Framework release the files were checked against, e.g. "4.2.0". */
  frameworkVersion?: string;
  /** The controller the configuration is for: its instance path on the board and its part id. */
  controller: { instance: string; part: string };
  files: {
    /** Path under `out/`, inside `config/`. */
    path: string;
    /** `sha256:<hex>` of the file. */
    digest: string;
    /** What the file is for, in the provider's words ("board devicetree", "Kconfig fragment"). */
    role?: string;
    /** Every generated setting line (1-based) with the facts it is derived from. */
    lines: { line: number; cites: FirmwareCite[] }[];
  }[];
  /** What the provider could not decide from the model. */
  warnings?: string[];
}

/** The UHD-keyed netlist report a circuit provider exports. */
export interface NetlistReport {
  schema: typeof NETLIST_SCHEMA;
  nets: {
    /** The provider's net name. */
    id: string;
    /** The UHD link the net realises, when there is one. */
    link?: string;
    /** `<instance path>:<interface id>`, relative to the board; `:<interface id>` for the board's own. */
    pins: string[];
  }[];
}

// ---------------------------------------------------------------------------
// File formats
// ---------------------------------------------------------------------------

/** A problem found in a file, with its line when it has one. */
export interface FormatProblem {
  message: string;
  line?: number;
}

type Problem = FormatProblem & { code?: OutputFinding["code"]; severity?: Severity };

const text = (b: Buffer) => b.toString("latin1");
const lineOf = (s: string, index: number) => s.slice(0, index).split("\n").length;

/**
 * Gerber RS-274X (Ucamco, The Gerber Layer Format Specification): the
 * extended format carries its coordinate format (`%FS…*%`) and unit
 * (`%MOMM*%` / `%MOIN*%`) as parameters, and a file ends with `M02*`. The
 * specification deprecates trailing-zero and incremental notation; such
 * files are still RS-274X, so that is a warning.
 */
export function checkGerber(b: Buffer): Problem[] {
  const s = text(b);
  const problems: Problem[] = [];
  const fs = /%FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*%/.exec(s);
  if (!fs) problems.push({ message: "no coordinate format (%FSLAX..Y..*%): not an RS-274X file" });
  else if (fs[1] !== "L" || fs[2] !== "A") problems.push({ severity: "warning", message: `coordinate format %FS${fs[1]}${fs[2]}: trailing-zero and incremental notation are deprecated; use %FSLA`, line: lineOf(s, fs.index) });
  if (!/%MO(MM|IN)\*%/.test(s)) problems.push({ message: "no unit (%MOMM*% or %MOIN*%)" });
  if (!/M02\*\s*$/.test(s)) problems.push({ message: "does not end with M02* (truncated?)", line: s.trimEnd().split("\n").length });
  return problems;
}

/**
 * Excellon drill (IPC-NC-349 as written by CAD tools): a header from `M48`
 * to `%` or `M95` stating the unit (METRIC or INCH) and tool sizes
 * (`T<n>C<diameter>`), then the drill body, ending with `M30`.
 */
export function checkExcellon(b: Buffer): FormatProblem[] {
  const s = text(b);
  const lines = s.split(/\r?\n/).map((l) => l.trim());
  const problems: FormatProblem[] = [];
  const first = lines.findIndex((l) => l && !l.startsWith(";"));
  if (lines[first] !== "M48") problems.push({ message: "does not start with the M48 header", line: first + 1 });
  const end = lines.findIndex((l) => l === "%" || l === "M95");
  if (end < 0) problems.push({ message: "header is not closed with % or M95" });
  const header = lines.slice(first, end < 0 ? undefined : end);
  if (!header.some((l) => /^(METRIC|INCH)\b/.test(l))) problems.push({ message: "header states no unit (METRIC or INCH)" });
  if (!header.some((l) => /^T\d+.*C\d*\.?\d+/.test(l))) problems.push({ message: "header defines no tool (T<n>C<diameter>)" });
  if (lines.filter(Boolean).pop() !== "M30") problems.push({ message: "does not end with M30 (truncated?)", line: lines.length });
  return problems;
}

/** glTF 2.0 binary (Khronos glTF 2.0 specification, GLB file format): magic `glTF`, version 2, total length, then a JSON chunk. */
export function checkGlb(b: Buffer): FormatProblem[] {
  if (b.length < 20) return [{ message: `${b.length} bytes: too short for a GLB header and JSON chunk` }];
  if (b.toString("latin1", 0, 4) !== "glTF") return [{ message: "magic is not glTF" }];
  const version = b.readUInt32LE(4);
  if (version !== 2) return [{ message: `GLB version ${version}; glTF 2.0 is required` }];
  const length = b.readUInt32LE(8);
  if (length !== b.length) return [{ message: `header length ${length} ≠ file size ${b.length} (truncated?)` }];
  const chunkLength = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) return [{ message: "first chunk is not JSON" }];
  if (20 + chunkLength > b.length) return [{ message: "JSON chunk runs past the end of the file" }];
  try {
    const gltf = JSON.parse(b.toString("utf8", 20, 20 + chunkLength).trimEnd());
    if (gltf?.asset?.version !== "2.0") return [{ message: `asset.version is ${JSON.stringify(gltf?.asset?.version)}, expected "2.0"` }];
  } catch (e) {
    return [{ message: `JSON chunk does not parse: ${(e as Error).message}` }];
  }
  return [];
}

/** STEP physical file (ISO 10303-21): `ISO-10303-21;`, a HEADER with FILE_SCHEMA, a DATA section, `END-ISO-10303-21;`. */
export function checkStep(b: Buffer): FormatProblem[] {
  const s = text(b);
  const problems: FormatProblem[] = [];
  if (!/^\s*ISO-10303-21;/.test(s)) problems.push({ message: "does not start with ISO-10303-21;", line: 1 });
  const header = s.indexOf("HEADER;");
  if (header < 0) problems.push({ message: "no HEADER section" });
  else if (!/FILE_SCHEMA\s*\(/.test(s.slice(header))) problems.push({ message: "header has no FILE_SCHEMA" });
  const data = s.indexOf("DATA;");
  if (data < 0) problems.push({ message: "no DATA section" });
  else if (!/#\d+\s*=/.test(s.slice(data))) problems.push({ message: "DATA section has no entity instances", line: lineOf(s, data) });
  if (!/END-ISO-10303-21;\s*$/.test(s)) problems.push({ message: "does not end with END-ISO-10303-21; (truncated?)", line: s.trimEnd().split("\n").length });
  return problems;
}

/** STL (3D Systems' StereoLithography format): binary (80-byte header, triangle count, 50 bytes per triangle) or ASCII (`solid` … `facet` … `endsolid`). */
export function checkStl(b: Buffer): FormatProblem[] {
  if (b.length >= 84) {
    const n = b.readUInt32LE(80);
    if (b.length === 84 + 50 * n) return n > 0 ? [] : [{ message: "binary STL with no triangles" }];
  }
  const s = text(b).trim();
  if (!s.startsWith("solid")) return [{ message: "neither a binary STL (size ≠ 84 + 50 × triangles) nor ASCII (no leading solid)" }];
  if (!/\bfacet normal\b/.test(s)) return [{ message: "ASCII STL with no facets" }];
  if (!/\bendsolid\b[^\n]*$/.test(s)) return [{ message: "ASCII STL does not end with endsolid (truncated?)" }];
  return [];
}

/**
 * 3MF (3MF Consortium, 3MF Core Specification): an OPC package, which is a
 * ZIP archive with root relationships (`_rels/.rels`) and a 3D model part
 * (conventionally `3D/3dmodel.model`). This checks that both parts exist;
 * it does not decompress the relationships to follow their target.
 */
export function checkThreeMf(b: Buffer): FormatProblem[] {
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return [{ message: "not a ZIP package (3MF is an OPC/ZIP container)" }];
  // end of central directory: the last signature within the final 64 KiB + 22 bytes (the comment's maximum)
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [{ message: "ZIP has no end-of-central-directory record (truncated?)" }];
  const entries = b.readUInt16LE(eocd + 10);
  let at = b.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < entries && at + 46 <= b.length && b.readUInt32LE(at) === 0x02014b50; i++) {
    const nameLength = b.readUInt16LE(at + 28);
    names.push(b.toString("utf8", at + 46, at + 46 + nameLength).toLowerCase());
    at += 46 + nameLength + b.readUInt16LE(at + 30) + b.readUInt16LE(at + 32);
  }
  if (names.length !== entries) return [{ message: `central directory lists ${entries} entries but ${names.length} could be read` }];
  const problems: FormatProblem[] = [];
  if (!names.includes("_rels/.rels")) problems.push({ message: "no _rels/.rels (package root relationships)" });
  if (!names.some((n) => n.endsWith(".model"))) problems.push({ message: `no 3D model part (*.model; has ${names.join(", ") || "nothing"})` });
  return problems;
}

/** DXF: ASCII group-code pairs starting with `0 / SECTION` and ending with `0 / EOF`, or the binary DXF sentinel. */
export function checkDxf(b: Buffer): FormatProblem[] {
  if (b.toString("latin1", 0, 22) === "AutoCAD Binary DXF\r\n\x1a\0") return [];
  const lines = text(b).split(/\r?\n/).map((l) => l.trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines[0] !== "0" || lines[1] !== "SECTION") return [{ message: "does not start with the group pair 0 / SECTION", line: 1 }];
  if (lines[lines.length - 2] !== "0" || lines[lines.length - 1] !== "EOF") return [{ message: "does not end with 0 / EOF (truncated?)", line: lines.length }];
  return [];
}

/** RFC 4180 CSV: rows of fields, quoted fields may hold commas, quotes ("") and newlines. Records the line each row starts on. */
export function parseCsv(s: string): { rows: string[][]; lines: number[]; error?: FormatProblem } {
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") (rows.push(row), lines.push(rowLine));
      row = [];
      field = "";
      line++;
      rowLine = line;
    } else field += c;
  }
  if (quoted) return { rows, lines, error: { message: "unterminated quoted field", line: rowLine } };
  row.push(field);
  if (row.length > 1 || row[0] !== "") (rows.push(row), lines.push(rowLine));
  return { rows, lines };
}

/** Problems with a GeometryManifest (the UHD type, `@deltarobotics/uhd` src/system/geometry.ts). */
export function checkManifest(value: unknown): FormatProblem[] {
  const problems: FormatProblem[] = [];
  const m = value as Partial<GeometryManifest> | null;
  const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!m || typeof m !== "object" || Array.isArray(m)) return [{ message: "is not a JSON object" }];
  if (typeof m.artifact !== "string" || !m.artifact) problems.push({ message: "artifact must name the artifact the manifest describes" });
  if (m.units !== "mm") problems.push({ message: `units is ${JSON.stringify(m.units)}; UHD geometry is in "mm"` });
  for (const k of ["tool", "toolVersion", "sourceDigest"] as const) if (m[k] !== undefined && typeof m[k] !== "string") problems.push({ message: `${k} must be a string` });
  if (m.volume_mm3 !== undefined && !(num(m.volume_mm3) && m.volume_mm3 >= 0)) problems.push({ message: "volume_mm3 must be a non-negative number" });
  if (m.bodies !== undefined && (typeof m.bodies !== "object" || Object.values(m.bodies).some((v) => !num(v)))) problems.push({ message: "bodies must map body names to volumes (mm³)" });
  if (!m.features || typeof m.features !== "object" || Array.isArray(m.features)) problems.push({ message: "features must be an object of named signatures" });
  else {
    for (const [name, f] of Object.entries(m.features)) {
      const bad = [
        !(num(f?.area_mm2) && f.area_mm2 >= 0) && "area_mm2",
        !isVec3(f?.centroid) && "centroid",
        f?.normal !== undefined && !isVec3(f.normal) && "normal",
        f?.faces !== undefined && !(Number.isInteger(f.faces) && f.faces >= 0) && "faces",
        f?.tolerance !== undefined && !num(f.tolerance) && "tolerance",
      ].filter(Boolean);
      if (bad.length) problems.push({ message: `feature "${name}": invalid ${bad.join(", ")}` });
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// A module's out/ folder
// ---------------------------------------------------------------------------

/** Instance paths below a module, relative to it ("u1", "u1/ldo"), with their definitions. */
export function moduleInstances(def: ModuleDef, lookup: ModuleLookup): Map<string, ModuleDef | undefined> {
  const out = new Map<string, ModuleDef | undefined>();
  const walk = (d: ModuleDef, prefix: string, depth: number) => {
    for (const c of d.children ?? []) {
      const path = prefix ? `${prefix}/${c.id}` : c.id;
      const child = lookup(c.moduleDefId);
      out.set(path, child);
      if (child && depth < 32) walk(child, path, depth + 1);
    }
  };
  walk(def, "", 0);
  return out;
}

export interface OutputContext {
  capability: CapabilityId;
  /** Absolute path of the module's `out/` folder. */
  outDir: string;
  module: ModuleDef;
  lookup: ModuleLookup;
  /** cad: the module config's process. */
  process?: CadProcess;
  /** circuit: the board's components (instance paths, sub-modules expanded: core boardNetlist); default its children. */
  components?: string[];
}

/** Validate a module's standard outputs. Findings name files relative to `out/`. */
export function validateOutputs(ctx: OutputContext): OutputFinding[] {
  const findings: OutputFinding[] = [];
  const add = (code: OutputFinding["code"], file: string, message: string, line?: number, severity: Severity = "error") =>
    findings.push({ code, severity, file, message, ...(line ? { line } : {}) });
  const instances = moduleInstances(ctx.module, ctx.lookup);
  const read = (rel: string) => readFileSync(join(ctx.outDir, rel));
  const listDir = (rel: string) => {
    const dir = join(ctx.outDir, rel);
    return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort() : [];
  };
  const listTree = (rel: string): string[] => {
    const dir = join(ctx.outDir, rel);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .sort()
      .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? listTree(`${rel}${n}/`).map((f) => `${n}/${f}`) : [n]));
  };
  const keyed: Record<string, Map<string, number>> = {};

  for (const spec of STANDARD_OUTPUTS[ctx.capability]) {
    let files: string[];
    if (spec.path.endsWith("/")) {
      const all = listDir(spec.path);
      const drill = (n: string) => DRILL_EXT.includes(extname(n).toLowerCase());
      files = spec.format === "firmware-config" ? listTree(spec.path).map((n) => spec.path + n) : all.filter((n) => (spec.format === "excellon" ? drill(n) : !drill(n))).map((n) => spec.path + n);
    } else files = existsSync(join(ctx.outDir, spec.path)) ? [spec.path] : [];
    if (!files.length) {
      add("PB_OUTPUT_MISSING", spec.path, `missing ${spec.description}`);
      continue;
    }
    for (const file of files) {
      const bytes = read(file);
      const problems = checkFile(spec.format, bytes, file, ctx, instances, keyed);
      for (const p of problems) add(p.code ?? "PB_OUTPUT_MALFORMED", file, p.message, p.line, p.severity);
    }
  }

  if (ctx.capability === "circuit") {
    // every component the board declares is on the BOM; every placed part has a manifest feature
    const bom = keyed["bom.csv"];
    if (bom) {
      const parts = ctx.components ? ctx.components.map((id) => ({ id, moduleDefId: instances.get(id)?.id ?? "?" })) : (ctx.module.children ?? []);
      for (const c of parts) if (!bom.has(c.id)) add("PB_OUTPUT_INCOMPLETE", "bom.csv", `no row for component ${c.id} (${c.moduleDefId})`, undefined, "warning");
    }
    const placed = keyed["pnp.csv"];
    const manifestFile = join(ctx.outDir, "board.manifest.json");
    if (placed && existsSync(manifestFile)) {
      try {
        const m = JSON.parse(readFileSync(manifestFile, "utf8")) as GeometryManifest;
        if (m.features && typeof m.features === "object") {
          if (!m.features.outline) add("PB_OUTPUT_MALFORMED", "board.manifest.json", 'no "outline" feature (the board outline)');
          for (const inst of placed.keys()) {
            if (!m.features[inst]) add("PB_OUTPUT_INCOMPLETE", "board.manifest.json", `no feature for placed component ${inst}; viewers cannot locate it`, undefined, "warning");
          }
        }
      } catch {
        // reported by the manifest check
      }
    }
  }

  if (ctx.capability === "firmware") findings.push(...checkFirmwareFiles(ctx, listTree("config/").map((n) => `config/${n}`)));

  // manufacturing exports: validated wherever present; the cad process decides which are required
  const exports = listDir("").filter((n) => MANUFACTURING[extname(n).toLowerCase()]);
  for (const file of exports) {
    for (const p of checkFile(MANUFACTURING[extname(file).toLowerCase()], read(file), file, ctx, instances, keyed)) add("PB_OUTPUT_MALFORMED", file, p.message, p.line, p.severity);
  }
  if (ctx.capability === "cad" && ctx.process) {
    const need = PROCESS_EXPORTS[ctx.process];
    if (need.length && !exports.some((f) => need.includes(MANUFACTURING[extname(f).toLowerCase()]))) {
      add("PB_OUTPUT_MISSING", "", `process "${ctx.process}" needs a manufacturing export (${need.map((f) => "." + f).join(" or ")}) in out/`);
    }
  }
  return findings;
}

function checkFile(
  format: OutputFormat,
  bytes: Buffer,
  file: string,
  ctx: OutputContext,
  instances: Map<string, ModuleDef | undefined>,
  keyed: Record<string, Map<string, number>>,
): Problem[] {
  switch (format) {
    case "gerber":
      return checkGerber(bytes);
    case "excellon":
      return checkExcellon(bytes);
    case "glb":
      return checkGlb(bytes);
    case "step":
      return checkStep(bytes);
    case "stl":
      return checkStl(bytes);
    case "3mf":
      return checkThreeMf(bytes);
    case "dxf":
      return checkDxf(bytes);
    case "manifest":
      try {
        return checkManifest(JSON.parse(bytes.toString("utf8")));
      } catch (e) {
        return [{ message: `does not parse as JSON: ${(e as Error).message}` }];
      }
    case "bom":
    case "pnp": {
      const { problems, keys } = checkKeyedCsv(bytes.toString("utf8"), format, instances);
      keyed[file] = keys;
      return problems;
    }
    case "netlist":
      return checkNetlist(bytes, ctx.module, instances);
    case "firmware-config":
      return bytes.length ? [] : [{ message: "is empty" }];
    case "firmware-manifest":
      return checkFirmwareManifest(bytes, ctx, instances);
  }
}

const fileDigest = (b: Buffer) => "sha256:" + createHash("sha256").update(b).digest("hex");

/** Problems with one cite against the board: the net, link, pin or part it names must exist. */
export function firmwareCiteProblem(cite: unknown, module: ModuleDef, instances: Map<string, ModuleDef | undefined>): string | undefined {
  if (typeof cite !== "string") return `cite ${JSON.stringify(cite)} is not a string`;
  const m = /^(net|link|pin|part|module|constraint):(.+)$/.exec(cite);
  if (!m) return `cite "${cite}" is not <net|link|pin|part|module|constraint>:<ref>`;
  const [, kind, ref] = m;
  if (kind === "net") return module.interfaces.some((i) => i.id === ref) ? undefined : `cite "${cite}": ${module.id} has no net ${ref}`;
  if (kind === "link") return (module.links ?? []).some((l) => l.id === ref) ? undefined : `cite "${cite}": ${module.id} has no link ${ref}`;
  if (kind === "pin") {
    const at = ref.lastIndexOf(":");
    const inst = ref.slice(0, at);
    const iface = ref.slice(at + 1);
    if (at <= 0 || !iface) return `cite "${cite}" is not pin:<instance>:<interface>`;
    if (!instances.has(inst)) return `cite "${cite}": ${inst} is not a component of ${module.id}`;
    const def = instances.get(inst);
    return !def || def.interfaces.some((i) => i.id === iface) ? undefined : `cite "${cite}": ${def.id} has no interface ${iface}`;
  }
  if (kind === "part") {
    const at = ref.indexOf(":");
    const part = at < 0 ? ref : ref.slice(0, at);
    if (at < 0 || !ref.slice(at + 1)) return `cite "${cite}" is not part:<part id>:<fact>`;
    return [...instances.values()].some((d) => d?.id === part) ? undefined : `cite "${cite}": no component of ${module.id} is part ${part}`;
  }
  return undefined; // module and constraint facts are free text
}

/**
 * Firmware manifest (FIRMWARE_MANIFEST_SCHEMA): it names the module and its
 * controller, lists files under config/ with digests that match, and every
 * cited line exists and cites facts the board has.
 */
function checkFirmwareManifest(bytes: Buffer, ctx: OutputContext, instances: Map<string, ModuleDef | undefined>): Problem[] {
  let m: Partial<FirmwareManifest>;
  try {
    m = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return [{ message: `does not parse as JSON: ${(e as Error).message}` }];
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return [{ message: "is not a JSON object" }];
  if (m.schema !== FIRMWARE_MANIFEST_SCHEMA) return [{ message: `schema is ${JSON.stringify(m.schema)}, expected ${FIRMWARE_MANIFEST_SCHEMA}` }];
  const problems: Problem[] = [];
  if (m.module !== ctx.module.id) problems.push({ message: `module is ${JSON.stringify(m.module)}, but this is ${ctx.module.id}` });
  for (const k of ["provider", "framework"] as const) if (typeof m[k] !== "string" || !m[k]) problems.push({ message: `${k} must name the ${k === "provider" ? "provider extension" : "firmware framework"}` });
  const c = m.controller;
  if (!c || typeof c.instance !== "string" || typeof c.part !== "string") problems.push({ message: "controller must be { instance, part }" });
  else if (!instances.has(c.instance)) problems.push({ code: "PB_OUTPUT_UNKNOWN_INSTANCE", message: `controller ${c.instance} is not a component of ${ctx.module.id}` });
  else if (instances.get(c.instance)?.id !== c.part) problems.push({ message: `controller ${c.instance} is ${instances.get(c.instance)?.id}, not ${c.part}` });
  if (!Array.isArray(m.files) || !m.files.length) return [...problems, { message: "files must list the files in config/" }];
  const seen = new Set<string>();
  for (const f of m.files) {
    if (!f || typeof f.path !== "string" || !f.path.startsWith("config/") || f.path.includes("..")) {
      problems.push({ message: `file ${JSON.stringify(f?.path)}: paths are under config/` });
      continue;
    }
    if (seen.has(f.path)) problems.push({ message: `file ${f.path} is listed twice` });
    seen.add(f.path);
    const abs = join(ctx.outDir, f.path);
    if (!existsSync(abs)) {
      problems.push({ code: "PB_OUTPUT_MISSING", message: `lists ${f.path}, which is not in out/` });
      continue;
    }
    const content = readFileSync(abs);
    if (f.digest !== fileDigest(content)) problems.push({ message: `${f.path}: digest ${String(f.digest).slice(0, 19)}… does not match the file (${fileDigest(content).slice(0, 19)}…); the file changed after export` });
    const count = content.toString("utf8").split("\n").length;
    if (!Array.isArray(f.lines)) {
      problems.push({ message: `${f.path}: lines must be an array of { line, cites }` });
      continue;
    }
    if (!f.lines.length) problems.push({ severity: "warning", message: `${f.path} cites no facts on any line` });
    for (const l of f.lines) {
      if (!l || !Number.isInteger(l.line) || l.line < 1 || l.line > count) {
        problems.push({ message: `${f.path}: line ${JSON.stringify(l?.line)} is not a line of the file (1-${count})` });
        continue;
      }
      if (!Array.isArray(l.cites) || !l.cites.length) {
        problems.push({ message: `${f.path}:${l.line} cites nothing` });
        continue;
      }
      for (const cite of l.cites) {
        const problem = firmwareCiteProblem(cite, ctx.module, instances);
        if (problem) problems.push({ code: "PB_OUTPUT_UNKNOWN_INSTANCE", message: `${f.path}:${l.line}: ${problem}` });
      }
    }
  }
  return problems;
}

/** Every file in config/ is listed in the manifest. */
function checkFirmwareFiles(ctx: OutputContext, files: string[]): OutputFinding[] {
  const manifestFile = join(ctx.outDir, "firmware.manifest.json");
  if (!existsSync(manifestFile)) return [];
  let listed: Set<string>;
  try {
    const m = JSON.parse(readFileSync(manifestFile, "utf8")) as FirmwareManifest;
    listed = new Set((Array.isArray(m.files) ? m.files : []).map((f) => f?.path));
  } catch {
    return []; // reported by the manifest check
  }
  return files
    .filter((f) => !listed.has(f))
    .map((f) => ({ code: "PB_OUTPUT_INCOMPLETE" as const, severity: "error" as const, file: f, message: "is not listed in firmware.manifest.json: every configuration file names the facts it is derived from" }));
}

const PNP_COLUMNS = ["instance", "x_mm", "y_mm", "rotation_deg", "side"];

/** BOM and pick-and-place CSV: a header row with an `instance` column; every row names a distinct, known UHD instance. */
function checkKeyedCsv(s: string, format: "bom" | "pnp", instances: Map<string, ModuleDef | undefined>): { problems: Problem[]; keys: Map<string, number> } {
  const keys = new Map<string, number>();
  const { rows, lines, error } = parseCsv(s);
  if (error) return { problems: [error], keys };
  if (!rows.length) return { problems: [{ message: "empty: no header row" }], keys };
  const header = rows[0].map((h) => h.trim());
  const required = format === "pnp" ? PNP_COLUMNS : ["instance"];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) return { problems: [{ message: `header lacks column(s) ${missing.join(", ")} (has ${header.join(", ")})`, line: 1 }], keys };
  const col = (name: string) => header.indexOf(name);
  const problems: Problem[] = [];
  if (rows.length === 1) problems.push({ message: "has a header but no rows", line: 1 });
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const line = lines[r];
    if (row.length !== header.length) {
      problems.push({ message: `row has ${row.length} fields, header has ${header.length}`, line });
      continue;
    }
    const inst = row[col("instance")].trim();
    if (!inst) {
      problems.push({ message: "row has an empty instance", line });
      continue;
    }
    if (keys.has(inst)) problems.push({ message: `instance ${inst} appears twice (first on line ${keys.get(inst)})`, line });
    else keys.set(inst, line);
    if (!instances.has(inst)) problems.push({ code: "PB_OUTPUT_UNKNOWN_INSTANCE", message: `instance ${inst} is not a component of the module (known: ${[...instances.keys()].join(", ") || "none"})`, line });
    if (format === "pnp") {
      for (const c of ["x_mm", "y_mm", "rotation_deg"]) {
        const v = row[col(c)].trim();
        if (v === "" || !Number.isFinite(Number(v))) problems.push({ message: `${c} "${v}" is not a number`, line });
      }
      const side = row[col("side")].trim();
      if (side !== "top" && side !== "bottom") problems.push({ message: `side "${side}" is not top or bottom`, line });
    }
  }
  return { problems, keys };
}

/** Netlist report: every pin is `<instance>:<interface>` on a known instance and interface of the module. */
function checkNetlist(bytes: Buffer, module: ModuleDef, instances: Map<string, ModuleDef | undefined>): Problem[] {
  let n: Partial<NetlistReport>;
  try {
    n = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    return [{ message: `does not parse as JSON: ${(e as Error).message}` }];
  }
  if (!n || typeof n !== "object") return [{ message: "is not a JSON object" }];
  if (n.schema !== NETLIST_SCHEMA) return [{ message: `schema is ${JSON.stringify(n.schema)}, expected ${NETLIST_SCHEMA}` }];
  if (!Array.isArray(n.nets)) return [{ message: "nets must be an array" }];
  const problems: Problem[] = [];
  const ids = new Set<string>();
  for (const net of n.nets) {
    if (!net || typeof net.id !== "string" || !Array.isArray(net.pins)) {
      problems.push({ message: `net ${JSON.stringify(net?.id ?? net)} needs an id and a pins array` });
      continue;
    }
    if (ids.has(net.id)) problems.push({ message: `net ${net.id} appears twice` });
    ids.add(net.id);
    if (net.link !== undefined && !(module.links ?? []).some((l) => l.id === net.link)) {
      problems.push({ code: "PB_OUTPUT_UNKNOWN_INSTANCE", message: `net ${net.id} names link ${net.link}, which ${module.id} does not have` });
    }
    for (const pin of net.pins) {
      const m = typeof pin === "string" ? /^([^:]*):(.+)$/.exec(pin) : null;
      if (!m) {
        problems.push({ message: `net ${net.id}: pin ${JSON.stringify(pin)} is not <instance>:<interface>` });
        continue;
      }
      const owner = m[1] === "" ? module : instances.get(m[1]);
      if (m[1] !== "" && !instances.has(m[1])) problems.push({ code: "PB_OUTPUT_UNKNOWN_INSTANCE", message: `net ${net.id}: ${pin} names instance ${m[1]}, which is not a component of ${module.id}` });
      else if (owner && !owner.interfaces.some((i) => i.id === m[2])) problems.push({ code: "PB_OUTPUT_UNKNOWN_INSTANCE", message: `net ${net.id}: ${pin}: ${owner.id} has no interface ${m[2]}` });
    }
  }
  return problems;
}
