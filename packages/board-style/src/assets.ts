/**
 * The asset registry: every logo, mark or easter egg a theme may draw, with its file, the file's SHA-256, where it
 * came from and its license. Assets are polygon files (`protoboard.board-style.asset/v1`: filled polygons with
 * holes, normalized to a height of 1, y up). The shipped registry holds placeholders only; a user registers their own
 * marks in their user or project layer (`assets/registry.json` beside the files), and those stay on their machine or
 * in their project. An asset whose license is not settled is `unresolved` and is never drawn unless the call says so.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { StylePlaces } from "./paths.js";
import type { AssetSlot } from "./tokens.js";

export const ASSET_SCHEMA = "protoboard.board-style.asset/v1";
export const REGISTRY_SCHEMA = "protoboard.board-style.assets/v1";
export const SHIPPED_ASSETS_DIR = fileURLToPath(new URL("./assets/", import.meta.url));

export interface AssetFile {
  schema: typeof ASSET_SCHEMA;
  id: string;
  /** Width over height. */
  aspect: number;
  /** Filled polygons, coordinates in units of the height (x from 0 to aspect, y from 0 to 1, y up). */
  polygons: { outer: number[]; holes?: number[][] }[];
}

export type AssetStatus = "placeholder" | "ok" | "unresolved" | "traced";

export interface AssetEntry {
  id: string;
  /** Which mark slot it may fill. */
  kind: AssetSlot | "icon";
  file: string;
  sha256: string;
  /** Where it came from: a vector file and its origin, "drawn for this package", "traced from an image". */
  source: string;
  /** SPDX id, "proprietary (owner's own mark)", or "unknown". */
  license: string;
  status: AssetStatus;
  /** Traced from a raster image rather than taken from a vector file (flagged in the check). */
  traced: boolean;
  /** Printed height limits (mm) and the smallest feature as a share of the height (strokes stay at or above the silk line). */
  minHeight: number;
  maxHeight: number;
  minFeature: number;
  notes?: string;
}

export interface Registry {
  schema: typeof REGISTRY_SCHEMA;
  assets: AssetEntry[];
}

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

export function readRegistry(dir: string): Registry {
  const file = join(dir, "registry.json");
  if (!existsSync(file)) return { schema: REGISTRY_SCHEMA, assets: [] };
  const r = JSON.parse(readFileSync(file, "utf8")) as Registry;
  if (r.schema !== REGISTRY_SCHEMA || !Array.isArray(r.assets)) throw new Error(`${file}: not an asset registry (${REGISTRY_SCHEMA})`);
  return r;
}

export interface LoadedAsset {
  entry: AssetEntry;
  dir: string;
  layer: "shipped" | "user" | "project";
  /** Whether the file's hash matches the registry. */
  verified: boolean;
}

/** Every registered asset of the places' layers (project over user over shipped, by id). */
export function loadAssets(places?: StylePlaces): Map<string, LoadedAsset> {
  const out = new Map<string, LoadedAsset>();
  const layers: [LoadedAsset["layer"], string | undefined][] = [
    ["shipped", SHIPPED_ASSETS_DIR],
    ["user", places?.user?.assets],
    ["project", places?.project?.assets],
  ];
  for (const [layer, dir] of layers) {
    if (!dir) continue;
    for (const e of readRegistry(dir).assets) {
      const f = join(dir, e.file);
      out.set(e.id, { entry: e, dir, layer, verified: existsSync(f) && sha256(f) === e.sha256 });
    }
  }
  return out;
}

/** An asset's polygons. */
export function readAsset(a: LoadedAsset): AssetFile {
  const f = JSON.parse(readFileSync(join(a.dir, a.entry.file), "utf8")) as AssetFile;
  if (f.schema !== ASSET_SCHEMA || !Array.isArray(f.polygons) || !(f.aspect > 0)) throw new Error(`${a.entry.file}: not a board style asset (${ASSET_SCHEMA})`);
  return f;
}

/** Whether a tool may draw it, and why not. */
export function assetUsable(a: LoadedAsset | undefined, o: { allowUnresolved?: boolean } = {}): string | undefined {
  if (!a) return "not in the asset registry";
  if (!a.verified) return `its file does not match the registry's hash (${a.entry.file})`;
  if (a.entry.status === "unresolved" && !o.allowUnresolved) return `its license is unresolved (${a.entry.license}); register it with a settled license, or allow it explicitly`;
  return undefined;
}

export interface RegisterInput {
  id: string;
  kind: AssetEntry["kind"];
  /** A polygon asset file to copy into the registry folder. */
  path: string;
  source: string;
  license: string;
  traced?: boolean;
  minHeight?: number;
  maxHeight?: number;
  minFeature?: number;
  notes?: string;
}

/**
 * Register an asset in a layer's asset folder: copy the file, record its hash, source and license. A missing or
 * unknown license makes it `unresolved`; a traced asset is flagged.
 */
export function registerAsset(dir: string, input: RegisterInput): AssetEntry {
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(input.id)) throw new Error("id: lowercase letters, digits, dots and hyphens");
  const parsed = JSON.parse(readFileSync(input.path, "utf8")) as AssetFile;
  if (parsed.schema !== ASSET_SCHEMA || !Array.isArray(parsed.polygons) || !(parsed.aspect > 0)) throw new Error(`${input.path}: not a board style asset (${ASSET_SCHEMA})`);
  mkdirSync(dir, { recursive: true });
  const file = `${input.id}.json`;
  if (basename(input.path) !== file || dirname(input.path) !== dir) copyFileSync(input.path, join(dir, file));
  const lic = input.license.trim();
  const unresolved = !lic || /^(unknown|unresolved|tbd|\?)$/i.test(lic);
  const entry: AssetEntry = {
    id: input.id,
    kind: input.kind,
    file,
    sha256: sha256(join(dir, file)),
    source: input.source,
    license: lic || "unknown",
    status: unresolved ? "unresolved" : input.traced ? "traced" : "ok",
    traced: !!input.traced,
    minHeight: input.minHeight ?? 2,
    maxHeight: input.maxHeight ?? 12,
    minFeature: input.minFeature ?? 0.06,
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const reg = readRegistry(dir);
  const assets = [...reg.assets.filter((a) => a.id !== entry.id), entry].sort((a, b) => (a.id < b.id ? -1 : 1));
  const tmp = join(dir, `registry.json.tmp-${process.pid}`);
  writeFileSync(tmp, `${JSON.stringify({ schema: REGISTRY_SCHEMA, assets }, null, 2)}\n`);
  renameSync(tmp, join(dir, "registry.json"));
  return entry;
}
