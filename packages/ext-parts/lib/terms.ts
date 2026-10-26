/**
 * Terms of a part's files (PB-863), checked by part verification
 * (lib/verify.ts). The record is `terms.json` beside the part's sources.json
 * (library: library/parts/<id>/terms.json; project:
 * parts/evidence/<id>/terms.json), in the format the cloud part library
 * defines (protoboard-cloud src/terms.ts, `protoboard.library-terms/v1`):
 *
 *   { "schema": "protoboard.library-terms/v1",
 *     "files": { "<file path as the definition writes it>": <terms> | { "preset": "<name>", ...overrides } },
 *     "links": [{ "title", "url", "kind", "access", "terms" }] }
 *
 * where <terms> is the UHD library protocol's file terms (docs/library-protocol.md
 * § 4.5): distribution (redistributable | internal | unknown), license,
 * licenseUrl, licensePath, attribution, summary, sourceUrl, sourceSha256,
 * retrieved. Record fields stay in the record and never reach the envelope:
 * `sha256` (the bytes the entry was written for), `note`, `verified` (false
 * when the terms were not confirmed at the source, e.g. a scraped photo; a
 * preset may set it) and `provenance` (how the file was obtained). Presets
 * come from the library's library/terms.json.
 *
 * Rules: a manufacturer or downloaded file (vendor CAD and what is converted
 * from it, anything under a `vendor/` folder, licence texts, photos) must have
 * an entry: an error otherwise. An entry must resolve to a valid
 * distribution class and, when it pins `sha256`, match the file. Files the
 * library made itself only draw a warning when a terms.json exists and
 * leaves them out.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactDef, ModuleDef } from "@deltarobotics/uhd";
import type { PartFiles } from "./layout.ts";

export const TERMS_SCHEMA = "protoboard.library-terms/v1";
export const DISTRIBUTION_CLASSES = ["redistributable", "internal", "unknown"] as const;
const FIELDS = new Set(["preset", "distribution", "license", "licenseUrl", "licensePath", "attribution", "summary", "sourceUrl", "sourceSha256", "retrieved", "sha256", "note", "verified", "provenance"]);
const POINTER_SUFFIX = ".blob.json";

export interface TermsFinding {
  level: "error" | "warning";
  message: string;
}

type Entry = Record<string, unknown>;

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const sha256File = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every file under `dir`, root-relative with forward slashes; a large-file pointer stands for its file. */
function listFiles(root: string, dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .sort()
    .flatMap((n) => (statSync(join(abs, n)).isDirectory() ? listFiles(root, `${dir}/${n}`) : [`${dir}/${n}`]))
    .map((p) => (p.endsWith(POINTER_SUFFIX) ? p.slice(0, -POINTER_SUFFIX.length) : p));
}

/** Whether a file came from outside: a vendor folder, a licence text, a photo. */
export function isDownloaded(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  return /(^|\/)vendor\//.test(path) || /^LICEN[CS]E/i.test(name) || /^thumbnail\.(png|jpe?g|webp)$/i.test(name) || /\.(jpe?g|webp)$/i.test(name);
}

/** Artifacts of the definition that are manufacturer files or made from one. */
export function vendorArtifacts(def: ModuleDef): ArtifactDef[] {
  const all = def.artifacts ?? [];
  // a file that also names where it was downloaded from is a download
  const vendor = new Set(all.filter((a) => a.provenance?.tool === "manufacturer" || (!!a.url && !!a.filePath) || (a.filePath ? isDownloaded(a.filePath) : false)).map((a) => a.id));
  // anything generated from a vendor file comes under its terms
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of all) if (!vendor.has(a.id) && a.provenance?.generatedFrom && vendor.has(a.provenance.generatedFrom) && a.format !== "json") {
      vendor.add(a.id);
      grew = true;
    }
  }
  return all.filter((a) => vendor.has(a.id) && a.filePath);
}

/** Check the part's terms record against the files it carries. */
export function checkTerms(def: ModuleDef, f: PartFiles): TermsFinding[] {
  const out: TermsFinding[] = [];
  const err = (message: string) => out.push({ level: "error", message });
  const warn = (message: string) => out.push({ level: "warning", message });
  const recordPath = `${f.evidence}/terms.json`;
  const recordFile = join(f.root, recordPath);
  const presetsFile = join(f.root, "library", "terms.json");
  let record: { schema?: unknown; files?: Record<string, Entry>; links?: unknown[] } | undefined;
  if (existsSync(recordFile)) {
    try {
      record = readJson(recordFile) as typeof record;
    } catch (e) {
      err(`${recordPath} is not valid JSON: ${(e as Error).message}`);
      return out;
    }
    if (record?.schema !== TERMS_SCHEMA) err(`${recordPath}: schema must be "${TERMS_SCHEMA}"`);
  }
  let presets: Record<string, Entry> = {};
  if (f.layout === "library" && existsSync(presetsFile)) presets = ((readJson(presetsFile) as { presets?: Record<string, Entry> }).presets ?? {});
  const files = record?.files ?? {};

  const exists = (path: string) => existsSync(join(f.root, path)) || existsSync(join(f.root, path + POINTER_SUFFIX));
  const referenced = (def.artifacts ?? []).flatMap((a) => (a.filePath && !a.filePath.startsWith("./") && exists(a.filePath) ? [a.filePath] : []));
  const carried = [...new Set([...referenced, ...listFiles(f.root, f.artifacts)])];
  const downloaded = new Set([...vendorArtifacts(def).map((a) => a.filePath!).filter(exists), ...carried.filter(isDownloaded)]);

  for (const path of [...downloaded].sort()) {
    if (!files[path]) err(`${path}: manufacturer or downloaded file with no terms record in ${recordPath} (distribution, licence or what was found, source URL, retrieval date)`);
  }
  for (const [path, entry] of Object.entries(files)) {
    const unknownFields = Object.keys(entry).filter((k) => !FIELDS.has(k));
    if (unknownFields.length) err(`${recordPath}: ${path}: unknown field(s) ${unknownFields.join(", ")}`);
    let terms: Entry = entry;
    if (typeof entry.preset === "string") {
      if (!presets[entry.preset]) {
        err(`${recordPath}: ${path}: preset "${entry.preset}" is not in library/terms.json`);
        continue;
      }
      terms = { ...presets[entry.preset], ...entry };
    }
    if (!(DISTRIBUTION_CLASSES as readonly unknown[]).includes(terms.distribution)) err(`${recordPath}: ${path}: distribution must be one of ${DISTRIBUTION_CLASSES.join(", ")}`);
    if (terms.verified !== undefined && typeof terms.verified !== "boolean") err(`${recordPath}: ${path}: verified must be true or false`);
    else if (terms.distribution === "redistributable" && terms.verified === false) err(`${recordPath}: ${path}: an unverified entry cannot be redistributable`);
    if (entry.provenance !== undefined && !(entry.provenance && typeof entry.provenance === "object" && typeof (entry.provenance as { method?: unknown }).method === "string")) err(`${recordPath}: ${path}: provenance must be an object with a method`);
    if (!exists(path)) {
      warn(`${recordPath}: ${path} is not a file of this part`);
      continue;
    }
    if (typeof entry.sha256 === "string" && existsSync(join(f.root, path)) && sha256File(join(f.root, path)) !== entry.sha256)
      err(`${path}: the terms were recorded for other bytes (sha256 ${String(entry.sha256).slice(0, 12)}…); check the new file's terms and update the entry`);
    // a render the library drew from a body was not downloaded: its provenance names the body instead of a source
    const rendered = (entry.provenance as { method?: unknown } | undefined)?.method === "cad-render";
    if (downloaded.has(path) && entry.preset === undefined && !rendered) {
      const missing = ["sourceUrl", "retrieved", "summary"].filter((k) => !terms[k]);
      if (missing.length) warn(`${path}: terms record no ${missing.join(", ")}`);
    }
    if (typeof terms.licensePath === "string" && !exists(terms.licensePath)) err(`${path}: licensePath ${terms.licensePath} is not a file`);
  }
  if (record) for (const path of carried.filter((p) => !downloaded.has(p) && !files[p]).sort()) warn(`${path}: no terms in ${recordPath} (the catalog treats it as unknown)`);
  (record?.links ?? []).forEach((l, i) => {
    const link = l as { title?: unknown; url?: unknown; terms?: { distribution?: unknown } };
    if (typeof link.url !== "string" || !/^https?:\/\//.test(link.url) || typeof link.title !== "string" || !(DISTRIBUTION_CLASSES as readonly unknown[]).includes(link.terms?.distribution))
      warn(`${recordPath}: links[${i}] needs a title, an http(s) url and terms with a distribution class`);
  });
  return out;
}
