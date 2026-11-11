/**
 * Vendor model files, fetched by the user's own client (PB-1174; Mark's
 * two-bucket decision of 2026-10-26; PB-1076's fetch links). This is the
 * only code in the resolver that reaches the network, and it runs only from
 * `protoboard parts fetch` or `protoboard build --fetch`: one part at a time
 * or the files the project already records, never a bulk crawl (several
 * vendors bar automated or bulk access: round-2 ownership note §5).
 *
 * Where the bytes go:
 *   - the machine cache (part-files.ts machineCacheDir), by sha256
 *   - the project's parts/files/<short>/model.<key>.<ext>, which .gitignore
 *     keeps out of git (DEFAULT, PB-1069 Q6 open), plus a numbers-only
 *     sidecar model.<key>.<ext>.json (source URL, sha256, terms) that may be
 *     committed
 *   - parts/sources.json: the link record (no bytes)
 *
 * Sources: `kicad` (KiCad's 3D library: the copy installed with KiCad
 * first, offline; else kicad-packages3D on GitLab), `lcsc` (EasyEDA's model
 * for a C-number; terms unknown, kept on this machine), and `url` (a direct
 * link the user gives, with the terms they state).
 *
 * Size cap (wave 1 gate, handoffs.md 2026-11-01; W4-A): every body is read as
 * a stream and the read stops at MAX_FETCH_BYTES (32 MB for EasyEDA's JSON
 * record), so a server that omits or understates content-length cannot make
 * the CLI buffer an unbounded body (readBodyCapped in update/sources.ts).
 *
 * Clean-room record for the EasyEDA request shape (W4-A, 2026-11-01): the two
 * URLs, `https://easyeda.com/api/products/<C-number>/components?version=6.4.19.5`
 * (the component record whose `SVGNODE~` shape names the 3D model's uuid)
 * and `https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/<uuid>` (the STEP),
 * are EasyEDA's public endpoints. They are the same URLs the AGPL
 * `easyeda2kicad` project requests; a URL is a fact, not code. No code was
 * copied from easyeda2kicad or any other project: the request, the parsing of
 * the record and the checks here were written for this file. UNVERIFIED: no
 * person has yet run one live `protoboard parts fetch --lcsc <C#>` against
 * EasyEDA; the tests use a stub. Remove this word only after one does.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cachedFile,
  ensurePartFilesIgnored,
  fileDigest,
  isoToday,
  modelSidecar,
  partFilesDir,
  putInCache,
  readPartSources,
  recordSourceEntry,
  vendorFileName,
  vendorKey,
  writePartSources,
  type PartFileTerms,
  type SourceEntry,
} from "./part-files.js";
import type { Project } from "./project.js";
import { readBodyCapped } from "./update/sources.js";

/** The largest vendor file a fetch accepts. */
export const MAX_FETCH_BYTES = 256 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export type FetchSource = { type: "kicad"; id: string } | { type: "lcsc"; id: string } | { type: "url"; url: string; format?: string; terms?: PartFileTerms };

/** What a fetch did for one file. */
export interface FetchOutcome {
  part: string;
  key: string;
  status: "fetched" | "copied" | "present" | "restored" | "failed" | "changed";
  entry?: SourceEntry;
  file?: string;
  message: string;
  /** Whether the network was used. */
  network: boolean;
}

export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  /** The body as a web stream (Node's fetch); read with a cap. Simple stubs may leave it out. */
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;
/** The largest EasyEDA component record read (JSON). */
const MAX_RECORD_BYTES = 32 * 1024 * 1024;

const KICAD_TERMS: PartFileTerms = {
  distribution: "redistributable",
  license: "CC-BY-SA-4.0",
  licenseUrl: "https://www.kicad.org/libraries/license/",
  summary: "KiCad library: CC-BY-SA 4.0 with the design exception; keep the licence beside redistributed models",
};
const LCSC_TERMS: PartFileTerms = {
  distribution: "unknown",
  summary: "EasyEDA/LCSC model: terms not established (spec Q1; EasyEDA legal page of 2026-09-21 limits downloads to personal, non-commercial use). Kept on this machine, never committed or redistributed",
};

/** Folders where KiCad installs its 3D library on this machine, newest version first. */
export function kicadModelDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) if (/^KICAD\d+_3DMODEL_DIR$/.test(k) && v) out.push(v);
  const versions = (dir: string) => {
    try {
      return readdirSync(dir).filter((d) => /^\d+(\.\d+)*$/.test(d)).sort((a, b) => parseFloat(b) - parseFloat(a));
    } catch {
      return [];
    }
  };
  if (platform === "win32") {
    const pf = env.ProgramFiles || "C:\\Program Files";
    for (const v of versions(join(pf, "KiCad"))) out.push(join(pf, "KiCad", v, "share", "kicad", "3dmodels"));
  } else if (platform === "darwin") out.push("/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels");
  else out.push("/usr/share/kicad/3dmodels", "/usr/local/share/kicad/3dmodels");
  return [...new Set(out)].filter((d) => existsSync(d));
}

/** `Package_TO_SOT_SMD:SOT-23` → `Package_TO_SOT_SMD.3dshapes/SOT-23.step`, refusing anything that could leave the library. */
export function kicadModelPath(id: string): string {
  const m = /^([A-Za-z0-9_.+-]+):([A-Za-z0-9_.,+()\- ]+?)(\.step|\.stp)?$/.exec(id);
  if (!m || m[1].includes("..") || m[2].includes("..")) throw new Error(`a KiCad model is <library>:<name> (Package_TO_SOT_SMD:SOT-23), not ${JSON.stringify(id)}`);
  return `${m[1]}.3dshapes/${m[2]}.step`;
}

const STEP_HEADER = "ISO-10303-21";
const looksLikeStep = (b: Buffer) => b.subarray(0, 64).toString("latin1").trimStart().startsWith(STEP_HEADER);

async function download(fetcher: Fetcher, url: string, maxBytes = MAX_FETCH_BYTES): Promise<Buffer> {
  if (!/^https:\/\//i.test(url)) throw new Error(`only https links are fetched (${url})`);
  const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "protoboard-parts-fetch (user-initiated, one part)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // streamed and cut at the cap; a declared content-length over it is refused before reading
  return readBodyCapped(res, maxBytes, url);
}

/**
 * EasyEDA's STEP for an LCSC C-number: the component record names the 3D
 * model's uuid, and the model service serves the STEP by it. UNVERIFIED
 * against the live service in the overnight build (no network fetch was run;
 * tests use a stub): the request shape is EasyEDA's public component API
 * (clean-room record in the file header).
 */
async function lcscStep(fetcher: Fetcher, c: string, maxBytes = MAX_FETCH_BYTES): Promise<{ bytes: Buffer; url: string; title?: string }> {
  if (!/^C\d{3,9}$/.test(c)) throw new Error(`an LCSC part number is C followed by digits (C393939), not ${JSON.stringify(c)}`);
  const api = `https://easyeda.com/api/products/${c}/components?version=6.4.19.5`;
  const res = await fetcher(api, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${api}: HTTP ${res.status}`);
  const text = (await readBodyCapped(res, Math.min(MAX_RECORD_BYTES, maxBytes), api)).toString("utf8");
  const data = JSON.parse(text) as { result?: { packageDetail?: { dataStr?: { shape?: string[] } } } };
  const node = data.result?.packageDetail?.dataStr?.shape?.find((s) => s.startsWith("SVGNODE~"));
  if (!node) throw new Error(`${c}: EasyEDA's component record has no 3D model`);
  const attrs = (JSON.parse(node.slice("SVGNODE~".length)) as { attrs?: { uuid?: string; title?: string } }).attrs;
  if (!attrs?.uuid || !/^[0-9a-f]{16,64}$/i.test(attrs.uuid)) throw new Error(`${c}: EasyEDA's 3D model has no usable id`);
  const url = `https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/${attrs.uuid}`;
  return { bytes: await download(fetcher, url, maxBytes), url, ...(attrs.title ? { title: attrs.title } : {}) };
}

/** Keep a fetched or copied file: machine cache, the project's gitignored copy, its sidecar, and the record. */
function keep(p: Project, part: string, key: string, format: string, bytes: Buffer, source: SourceEntry["source"], terms: PartFileTerms, tier?: SourceEntry["tier"]): { entry: SourceEntry; file: string } {
  const cached = putInCache(bytes, `${source.type}:${source.id ?? source.url}`, { part, source, terms, fetched: new Date().toISOString() });
  const rel = `${partFilesDir(part)}/${vendorFileName(key, format)}`;
  const abs = join(p.root, rel);
  mkdirSync(join(p.root, partFilesDir(part)), { recursive: true });
  writeFileSync(abs, bytes);
  const entry: SourceEntry = { id: key, kind: "model", format, sha256: cached.sha256, size: bytes.length, units: format === "glb" ? "m" : "mm", source, terms, path: rel, ...(tier ? { tier } : {}), chosenBy: { kind: "person", at: new Date().toISOString() } };
  writeFileSync(`${abs}.json`, JSON.stringify(modelSidecar(entry, part), null, 2) + "\n");
  ensurePartFilesIgnored(p.root);
  const data = recordSourceEntry(readPartSources(p.root), part, entry);
  writePartSources(p.root, data);
  return { entry, file: abs };
}

/** Fetch (or copy from KiCad's installed library) one model for a part, and record it. */
export async function fetchPartModel(p: Project, part: string, source: FetchSource, options: { fetcher?: Fetcher; offline?: boolean; kicadDirs?: string[]; /** Below MAX_FETCH_BYTES only (tests); never above it. */ maxBytes?: number } = {}): Promise<FetchOutcome> {
  const maxBytes = Math.min(options.maxBytes ?? MAX_FETCH_BYTES, MAX_FETCH_BYTES);
  if (!p.definitions.has(part)) return { part, key: "", status: "failed", message: `no definition "${part}" in the project`, network: false };
  const fetcher = options.fetcher ?? (globalThis.fetch as unknown as Fetcher);
  try {
    if (source.type === "kicad") {
      const rel = kicadModelPath(source.id);
      const key = vendorKey({ type: "kicad-lib", id: source.id.replace(/\.(step|stp)$/i, "") });
      for (const dir of options.kicadDirs ?? kicadModelDirs()) {
        const f = join(dir, rel);
        if (!existsSync(f)) continue;
        if (statSync(f).size > MAX_FETCH_BYTES) throw new Error(`${f} is over the ${MAX_FETCH_BYTES}-byte limit`);
        const bytes = readFileSync(f);
        if (!looksLikeStep(bytes)) throw new Error(`${f} is not a STEP file`);
        const kept = keep(p, part, key, "step", bytes, { type: "kicad-lib", id: source.id, url: `file:${rel}`, retrieved: isoToday() }, KICAD_TERMS, "M5");
        return { part, key, status: "copied", entry: kept.entry, file: kept.file, message: `${part}: ${source.id} copied from KiCad's installed library (${dir})`, network: false };
      }
      if (options.offline) return { part, key, status: "failed", message: `${part}: ${source.id} is not in KiCad's installed 3D library on this machine, and the fetch is offline`, network: false };
      const url = `https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/${rel.split("/").map(encodeURIComponent).join("/")}`;
      const bytes = await download(fetcher, url, maxBytes);
      if (!looksLikeStep(bytes)) throw new Error(`${url} did not return a STEP file`);
      const kept = keep(p, part, key, "step", bytes, { type: "kicad-lib", id: source.id, url, retrieved: isoToday() }, KICAD_TERMS, "M5");
      return { part, key, status: "fetched", entry: kept.entry, file: kept.file, message: `${part}: ${source.id} fetched from kicad-packages3D`, network: true };
    }
    if (options.offline) return { part, key: "", status: "failed", message: `${part}: fetching ${source.type === "lcsc" ? source.id : source.url} needs the network; the fetch is offline`, network: false };
    if (source.type === "lcsc") {
      const id = source.id.toUpperCase();
      const key = vendorKey({ type: "lcsc", id });
      const got = await lcscStep(fetcher, id, maxBytes);
      if (!looksLikeStep(got.bytes)) throw new Error(`${got.url} did not return a STEP file`);
      const kept = keep(p, part, key, "step", got.bytes, { type: "lcsc", id, url: got.url, retrieved: isoToday() }, LCSC_TERMS, "M2");
      return { part, key, status: "fetched", entry: kept.entry, file: kept.file, message: `${part}: EasyEDA's model for ${id}${got.title ? ` (${got.title})` : ""}; terms unknown, kept on this machine only`, network: true };
    }
    const format = (source.format ?? /\.(step|stp|glb|stl|3mf)(?:$|\?)/i.exec(source.url)?.[1] ?? "").toLowerCase().replace("stp", "step");
    if (!format) throw new Error(`say the file's format (--format step|glb|stl|3mf) for ${source.url}`);
    const key = vendorKey({ type: "url", url: source.url });
    const bytes = await download(fetcher, source.url, maxBytes);
    if (format === "step" && !looksLikeStep(bytes)) throw new Error(`${source.url} did not return a STEP file`);
    const kept = keep(p, part, key, format, bytes, { type: "url", url: source.url, retrieved: isoToday() }, source.terms ?? { distribution: "unknown" });
    return { part, key, status: "fetched", entry: kept.entry, file: kept.file, message: `${part}: ${source.url}`, network: true };
  } catch (e) {
    return { part, key: "", status: "failed", message: `${part}: ${(e as Error).message}`, network: source.type !== "kicad" };
  }
}

/**
 * Restore the files parts/sources.json records that are not on this
 * machine (a fresh clone): from the machine cache, else from KiCad's
 * installed library, else (not offline) from the recorded URL. A source that
 * now serves other bytes than the record pins is not taken
 * (PB_FILE_UPSTREAM_CHANGED): the record decides.
 */
export async function restorePartFiles(p: Project, options: { part?: string; offline?: boolean; fetcher?: Fetcher; kicadDirs?: string[] } = {}): Promise<FetchOutcome[]> {
  const data = readPartSources(p.root);
  const out: FetchOutcome[] = [];
  const fetcher = options.fetcher ?? (globalThis.fetch as unknown as Fetcher);
  for (const [part, rec] of Object.entries(data.parts)) {
    if (options.part && part !== options.part) continue;
    for (const e of rec.files) {
      if (e.source.type === "imported" || !e.path) continue;
      const abs = join(p.root, e.path);
      if (existsSync(abs) && fileDigest(abs)?.sha256 === e.sha256) {
        out.push({ part, key: e.id, status: "present", message: `${part}: ${e.path} present`, network: false });
        continue;
      }
      let bytes: Buffer | undefined;
      let network = false;
      const cached = cachedFile(e.sha256);
      if (cached) bytes = readFileSync(cached);
      else if (e.source.type === "kicad-lib" && e.source.id) {
        for (const dir of options.kicadDirs ?? kicadModelDirs()) {
          const f = join(dir, kicadModelPath(e.source.id));
          if (existsSync(f)) {
            bytes = readFileSync(f);
            break;
          }
        }
      }
      if (!bytes && e.source.url?.startsWith("https://") && !options.offline) {
        try {
          bytes = await download(fetcher, e.source.url);
          network = true;
        } catch (err) {
          out.push({ part, key: e.id, status: "failed", message: `${part}: ${e.id}: ${(err as Error).message}`, network: true });
          continue;
        }
      }
      if (!bytes) {
        out.push({ part, key: e.id, status: "failed", message: `${part}: ${e.id} is not in this machine's cache${options.offline ? " (offline)" : " and has no link to fetch it from"}`, network: false });
        continue;
      }
      const got = putInCache(bytes, `${e.source.type}:${e.source.id ?? e.source.url}`, { part, source: e.source, terms: e.terms });
      if (got.sha256 !== e.sha256) {
        out.push({ part, key: e.id, status: "changed", message: `PB_FILE_UPSTREAM_CHANGED ${part}: ${e.id} now serves other bytes (${got.sha256.slice(0, 19)}…) than ${"parts/sources.json"} pins (${e.sha256.slice(0, 19)}…); review it, then fetch it again to record the new file`, network });
        continue;
      }
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, bytes);
      writeFileSync(`${abs}.json`, JSON.stringify(modelSidecar(e, part), null, 2) + "\n");
      ensurePartFilesIgnored(p.root);
      out.push({ part, key: e.id, status: "restored", file: abs, message: `${part}: ${e.path} restored${network ? " from its link" : " from the machine cache"}`, network });
    }
  }
  return out;
}

/** Record a mesh made from a fetched STEP (STEP → GLB through the CAD runtime) as the entry's derived file. */
export function recordDerived(p: Project, part: string, entryId: string, derived: { format: string; path: string }): SourceEntry | undefined {
  const data = readPartSources(p.root);
  const e = data.parts[part]?.files.find((f) => f.id === entryId);
  const abs = join(p.root, derived.path);
  const d = fileDigest(abs);
  if (!e || !d) return undefined;
  putInCache(readFileSync(abs), `derived:${entryId}:${derived.format}`, { part, generatedFrom: e.sha256 });
  e.derived = [...(e.derived ?? []).filter((x) => x.format !== derived.format), { format: derived.format, path: derived.path, sha256: d.sha256, generatedFrom: e.sha256 }];
  writePartSources(p.root, data);
  return e;
}
