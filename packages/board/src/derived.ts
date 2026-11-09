/**
 * Derived data shared by importers, checks and renderers (contract section 4.3). Derived data is never stored in the
 * board files or the journal; it is cached under `<root>/.protoboard/build/board/<board key>/` (paths.ts) and keyed
 * by an input hash that says when it is stale.
 *
 * Zone fill (`protoboard.zone-fill/v1`): the copper each zone is filled with, one entry per zone and copper layer,
 * every length an integer nanometer in board coordinates (+Y up, the document's frame):
 *
 * ```json
 * { "schema": "protoboard.zone-fill/v1", "source": "kicad", "inputHash": "<sha256>", "units": { "length": "nm" },
 *   "fills": [ { "zone": "zone:g.0123456789ab", "source": "<source object id>", "net": "GND", "layer": "top",
 *                "polygons": [ { "outer": [x0, y0, x1, y1, ...], "holes": [[x0, y0, ...], ...] } ] } ] }
 * ```
 *
 * `outer` is counterclockwise and each hole clockwise; rings are implicitly closed (the first point is not
 * repeated) and have at least three points. `zone` is absent for fill without a zone record (a Circuit JSON pour);
 * such fill takes its entry's `net`. `source` on the file says who produced it: an importer that read the fill the
 * source tool saved (`kicad`, `easyeda-pro`, `circuit-json`) or a fill engine (`computed`). `inputHash` is
 * `zoneFillInputHash` of the document the fill belongs to: SHA-256 over the canonical JSON of every zone record,
 * sorted by id. A fill whose hash differs from the document's is stale. Imported fill is the source tool's last
 * fill, so it goes stale only when a zone record changes; copper moved under a zone leaves it current but out of
 * date, as in the source tool until it refills.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonical, sha256Hex } from "./canonical.js";
import { recordsOfKind, type BoardDocument } from "./document.js";
import { boardBuildDir, findProjectRoot } from "./paths.js";
import { CopperLayer, NetName, Nm } from "./schema.js";

export const ZONE_FILL_SCHEMA = "protoboard.zone-fill/v1";
/** The cache file's name inside a board's derived data folder. */
export const ZONE_FILL_FILE = "zone-fill.json";
/** Who produced a fill: an importer that read the source's saved fill, or a fill engine. */
export const ZONE_FILL_SOURCES = ["kicad", "easyeda-pro", "circuit-json", "computed"] as const;
export const ZoneFillSource = z.enum(ZONE_FILL_SOURCES);
export type ZoneFillSource = z.infer<typeof ZoneFillSource>;

/** A ring: x0, y0, x1, y1, ... in nanometers, at least three points. */
export const ZoneFillRing = z
  .array(Nm)
  .min(6)
  .refine((a) => a.length % 2 === 0, "a ring is x, y pairs");
export const ZoneFillPolygonSchema = z.object({ outer: ZoneFillRing, holes: z.array(ZoneFillRing) }).strict();
export const ZoneFillEntrySchema = z
  .object({
    /** The zone record this fill belongs to, when there is one. */
    zone: z.string().regex(/^zone:.+$/, "a zone id").optional(),
    /** The producer's own id for the filled object (a KiCad zone uuid or line, an EasyEDA record, a Circuit JSON pour). */
    source: z.string().min(1).max(500),
    net: NetName.optional(),
    layer: CopperLayer,
    polygons: z.array(ZoneFillPolygonSchema),
  })
  .strict();
export const DerivedZoneFillSchema = z
  .object({
    schema: z.literal(ZONE_FILL_SCHEMA),
    source: ZoneFillSource,
    inputHash: z.string().regex(/^[0-9a-f]{64}$/, "a SHA-256 in hex"),
    units: z.object({ length: z.literal("nm") }).strict(),
    fills: z.array(ZoneFillEntrySchema),
  })
  .strict();

export interface ZoneFillPolygon {
  /** Counterclockwise outer ring: x0, y0, x1, y1, ... (nanometers). */
  outer: number[];
  /** Clockwise hole rings, same encoding. */
  holes: number[][];
}
export interface ZoneFillEntry {
  zone?: string;
  source: string;
  net?: string;
  layer: CopperLayer;
  polygons: ZoneFillPolygon[];
}
export interface DerivedZoneFill {
  schema: typeof ZONE_FILL_SCHEMA;
  source: ZoneFillSource;
  /** `zoneFillInputHash` of the document the fill belongs to. */
  inputHash: string;
  units: { length: "nm" };
  fills: ZoneFillEntry[];
}

/** The hash a zone fill is keyed by: SHA-256 over the canonical JSON of every zone record, sorted by id. */
export const zoneFillInputHash = (doc: BoardDocument): string => sha256Hex(canonical(recordsOfKind(doc, "zone")));

/** Whether a fill still matches the document's zones. */
export const zoneFillIsCurrent = (fill: Pick<DerivedZoneFill, "inputHash">, doc: BoardDocument): boolean => fill.inputHash === zoneFillInputHash(doc);

/**
 * A zone fill for a document: drops rings with fewer than three points (and polygons whose outer ring is one) and
 * entries left with no polygon, and stamps the document's input hash. Returns what was dropped.
 */
export function createZoneFill(doc: BoardDocument, source: ZoneFillSource, fills: readonly ZoneFillEntry[]): { fill: DerivedZoneFill; droppedRings: number } {
  let droppedRings = 0;
  const ok = (r: readonly number[]) => r.length >= 6 && r.length % 2 === 0;
  const out: ZoneFillEntry[] = [];
  for (const f of fills) {
    const polygons: ZoneFillPolygon[] = [];
    for (const p of f.polygons) {
      if (!ok(p.outer)) {
        droppedRings += 1 + p.holes.length;
        continue;
      }
      const holes = p.holes.filter(ok);
      droppedRings += p.holes.length - holes.length;
      polygons.push({ outer: p.outer, holes });
    }
    if (polygons.length) out.push({ ...f, polygons });
  }
  return { fill: { schema: ZONE_FILL_SCHEMA, source, inputHash: zoneFillInputHash(doc), units: { length: "nm" }, fills: out }, droppedRings };
}

/** Validate a parsed zone fill file (throws with the first problems). */
export function parseZoneFill(value: unknown, where = "zone fill"): DerivedZoneFill {
  // caches written before the shared type named the KiCad importer `kicad_pcb`
  const v = value && typeof value === "object" && (value as { source?: unknown }).source === "kicad_pcb" ? { ...(value as object), source: "kicad" } : value;
  const r = DerivedZoneFillSchema.safeParse(v);
  if (!r.success) throw new Error(`${where} is not a valid ${ZONE_FILL_SCHEMA}: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ")}`);
  return r.data as DerivedZoneFill;
}

/** Where a board's zone fill is cached: `<root>/.protoboard/build/board/<board key>/zone-fill.json`. */
export const zoneFillPath = (boardDir: string, projectRoot: string = findProjectRoot(boardDir)): string => join(boardBuildDir(projectRoot, boardDir), ZONE_FILL_FILE);

/** Write a board's zone fill to its cache (validated, canonical JSON, through a temporary file); returns the path. */
export function writeZoneFill(boardDir: string, fill: DerivedZoneFill, projectRoot?: string): string {
  const path = zoneFillPath(boardDir, projectRoot);
  const text = `${canonical(parseZoneFill(fill))}\n`;
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return path;
}

/** Read and validate a zone fill file. */
export const readZoneFill = (path: string): DerivedZoneFill => parseZoneFill(JSON.parse(readFileSync(path, "utf8")) as unknown, path);

/** A board's cached zone fill and whether it is current for `doc`; undefined when there is none. */
export function loadZoneFill(boardDir: string, doc: BoardDocument, projectRoot?: string): { fill: DerivedZoneFill; current: boolean; path: string } | undefined {
  const path = zoneFillPath(boardDir, projectRoot);
  let fill: DerivedZoneFill;
  try {
    fill = readZoneFill(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  return { fill, current: zoneFillIsCurrent(fill, doc), path };
}
