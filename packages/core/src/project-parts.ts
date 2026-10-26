/**
 * The project's parts as one list (PB-903, `protoboard parts list`): what the
 * Project parts view in VS Code and the web viewer show, the way Source
 * Control shows files.
 *
 * - **Library parts**: vendored from a library (parts/origins.json), pinned to
 *   a revision, like a package at `@library/part@rev`. A part whose vendored
 *   files no longer match the digests recorded when it was added has
 *   *diverged* (edited in the project); updates flow one way, from the
 *   library to the project, so a diverged part is restored or derived, never
 *   pushed back.
 * - **Researched parts**: `parts/local/`, researched in the project; they can
 *   be published to a library for verification later (`parts publish`).
 * - **Designed parts**: the project's own modules under `src/`, often made by
 *   a capability provider (a circuit, a CAD part, a harness).
 *
 * Offline: reads the loaded project and the vendored files. Whether a library
 * has a newer revision is `checkPartUpdates` (online), merged by `withUpdates`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readOrigins, revisionLabel, sha256, type OriginRecord } from "./load.js";
import type { Project } from "./project.js";
import type { UpdateReport } from "./parts.js";
import { isBlankBlock, parseVerificationRecord, partTrust, type PartTrust } from "./part-trust.js";
import type { Origin, PartTier } from "./types.js";

export type ProjectPartStatus =
  /** Pinned to a library revision, files intact; not compared with the library (offline). */
  | "pinned"
  /** Pinned at the library's recommended revision. */
  | "up-to-date"
  /** The library recommends a newer revision. */
  | "update-available"
  /** Vendored files were edited in the project: they no longer match the digests of the pinned revision. */
  | "diverged"
  /** Researched in the project (parts/local). */
  | "local"
  /** Designed in the project (src/). */
  | "designed";

export interface ProjectPart {
  id: string;
  name: string;
  tier: PartTier;
  status: ProjectPartStatus;
  /** Where it is written: the vendored JSON, or the local source (project-relative). */
  file: string;
  line?: number;
  /** Library parts: the library id and the pinned revision. */
  library?: string;
  revision?: number | string;
  /** The library's recommended revision, when checked and newer. */
  recommended?: number;
  /** Diverged: the vendored files that were edited or are missing (project-relative). */
  edited?: string[];
  /** Instances of it in the system. */
  instances: number;
  /** A designed part's capability and provider (`circuit`, `@protoboardai/ext-tscircuit`). */
  capability?: { capability: string; provider: string };
  /** A researched part already published to a library: the revision it became. */
  published?: { revision: number; service: string };
  manufacturer?: string;
  partNumber?: string;
  category?: string;
  description?: string;
  /** The part's status (part-trust.ts): local, unverified, verified or official, and why. */
  trust: PartTrust;
  trustBasis: string;
}

/**
 * A library part's status from what was vendored with its revision: the
 * verification record among its evidence files, read from the project
 * (offline). A revision vendored without its evidence reads as unverified.
 */
export function vendoredTrust(root: string, origin: Pick<Origin, "evidence"> | undefined): { trust: PartTrust; trustBasis: string } {
  const file = origin?.evidence?.find((e) => e.kind === "verification")?.file;
  let verification: ReturnType<typeof parseVerificationRecord> | undefined;
  if (file) {
    try {
      verification = parseVerificationRecord(readFileSync(join(root, file), "utf8"));
    } catch {
      verification = null;
    }
  }
  const r = partTrust({ inLibrary: true, ...(verification !== undefined ? { verification } : {}) });
  return { trust: r.trust, trustBasis: r.basis };
}

const LOCAL_TRUST = { trust: "local" as const, trustBasis: "not in a library" };

/** Every definition's status by id (the diagram's module dots): a library part's from its vendored evidence, the project's own as local. */
export function definitionTrust(p: Project): Record<string, { trust: PartTrust; basis: string; blank?: true }> {
  const out: Record<string, { trust: PartTrust; basis: string; blank?: true }> = {};
  for (const [id, r] of p.definitions) {
    const catalog = r.origin.kind === "catalog";
    const t = catalog ? vendoredTrust(p.root, r.origin) : LOCAL_TRUST;
    // a module of the project with no part chosen (part-trust.ts, "A blank block"); the root system is never one
    const blank =
      id !== p.rootDef?.id &&
      isBlankBlock({
        inLibrary: catalog,
        kind: r.def.kind,
        manufacturer: r.def.manufacturer,
        partNumber: r.def.part_number,
        children: r.def.children?.length ?? 0,
        artifacts: r.def.artifacts?.length ?? 0,
        details: (r.def.domains?.length ?? 0) + (r.def.traits?.length ?? 0) + (r.def.requirements?.length ?? 0) + (r.def.constraints?.length ?? 0),
      });
    out[id] = { trust: t.trust, basis: blank ? "no part chosen" : t.trustBasis, ...(blank ? { blank: true as const } : {}) };
  }
  return out;
}

export interface ProjectPartsReport {
  parts: ProjectPart[];
  counts: { total: number; library: number; researched: number; designed: number; updates: number; diverged: number };
  /** Libraries asked for updates and what went wrong, when checked. */
  checked?: { at: string; problems: string[] };
}

/** Vendored files of a record that no longer match their digests (definition, files, source). */
export function editedFiles(root: string, rec: OriginRecord): string[] {
  const out: string[] = [];
  const def = join(root, rec.file);
  if (!existsSync(def) || sha256(readFileSync(def)) !== rec.digest) out.push(rec.file);
  if (rec.artifactBase?.kind === "vendored") {
    const dir = rec.artifactBase.dir;
    const check = (path: string, digest: string) => {
      const f = join(root, dir, ...path.split("/"));
      if (!existsSync(f) || sha256(readFileSync(f)) !== digest) out.push(`${dir}/${path}`);
    };
    for (const [path, digest] of Object.entries(rec.files ?? {})) check(path, digest);
    for (const [path, digest] of Object.entries(rec.source?.files ?? {})) check(path, digest);
  }
  return out;
}

const TIER_ORDER: Record<PartTier, number> = { catalog: 0, "project-researched": 1, "project-specific": 2 };

/**
 * Every part the project defines or vendors, the root system left out. A
 * designed part is listed when the system uses it or a capability provider
 * makes it; assemblies that only group others are left out unless a provider
 * makes them.
 */
export function projectParts(p: Project): ProjectPartsReport {
  const origins = readOrigins(p.root, p.config.catalog);
  const uses = new Map<string, number>();
  for (const i of p.instances) if (i.path !== "") uses.set(i.definition, (uses.get(i.definition) ?? 0) + 1);
  const caps = new Map<string, { capability: string; provider: string }>();
  for (const b of p.capabilities) if (b.module && !b.problem && !caps.has(b.module)) caps.set(b.module, { capability: b.capability, provider: b.provider });
  const rootId = p.rootDef?.id;
  const parts: ProjectPart[] = [];
  for (const [id, r] of p.definitions) {
    if (id === rootId) continue;
    const def = r.def as typeof r.def & { manufacturer?: string; part_number?: string; category?: string; categories?: string[] };
    const base = {
      id,
      name: def.name ?? id,
      tier: r.origin.tier,
      // a catalog part vendored with its .uhd.ts (PB-910): that readable source, not the pinned JSON
      file: (r.origin.definitionSource ?? r.origin.source).file,
      ...((r.origin.definitionSource ?? r.origin.source).line ? { line: (r.origin.definitionSource ?? r.origin.source).line } : {}),
      instances: uses.get(id) ?? 0,
      ...(def.manufacturer ? { manufacturer: def.manufacturer } : {}),
      ...(def.part_number ? { partNumber: def.part_number } : {}),
      ...((def.category ?? def.categories?.[0]) ? { category: def.category ?? def.categories![0] } : {}),
      ...(typeof def.description === "string" && def.description ? { description: def.description } : {}),
    };
    if (r.origin.kind === "catalog") {
      const rec = origins.definitions[id];
      const edited = rec ? editedFiles(p.root, rec) : [];
      parts.push({
        ...base,
        ...vendoredTrust(p.root, r.origin),
        status: edited.length ? "diverged" : "pinned",
        ...(r.origin.library ? { library: r.origin.library } : r.origin.provider ? { library: r.origin.provider } : {}),
        ...(r.origin.revision !== undefined ? { revision: typeof r.origin.revision === "number" ? r.origin.revision : (revisionLabel(r.origin.revision) ?? r.origin.revision) } : {}),
        ...(edited.length ? { edited } : {}),
      });
      continue;
    }
    const cap = caps.get(id);
    if (r.origin.tier === "project-researched") {
      const pub = origins.published?.[id];
      parts.push({ ...base, ...LOCAL_TRUST, status: "local", ...(pub ? { published: { revision: pub.revision, service: pub.service } } : {}) });
      continue;
    }
    // designed: used leaf modules and anything a provider makes; pure groupings are the diagram's, not parts
    if (!cap && (!base.instances || (def.children?.length ?? 0) > 0)) continue;
    parts.push({ ...base, ...LOCAL_TRUST, status: "designed", ...(cap ? { capability: cap } : {}) });
  }
  // a vendored definition edited so that it no longer loads (its digest pin fails) is still the project's part
  for (const [id, rec] of Object.entries(origins.definitions)) {
    if (p.definitions.has(id) || id === rootId) continue;
    let def: { name?: string; manufacturer?: string; part_number?: string } = {};
    try {
      def = JSON.parse(readFileSync(join(p.root, rec.file), "utf8"));
    } catch {
      // missing or unreadable: listed by id
    }
    const edited = editedFiles(p.root, rec);
    const dir = rec.artifactBase?.kind === "vendored" ? rec.artifactBase.dir : undefined;
    parts.push({
      id,
      name: typeof def.name === "string" ? def.name : id,
      tier: "catalog",
      ...vendoredTrust(p.root, dir && rec.evidence?.length ? { evidence: rec.evidence.map((e) => ({ kind: e.kind, file: join(dir, e.path) })) } : undefined),
      status: edited.length ? "diverged" : "pinned",
      file: rec.file,
      library: rec.library ?? (rec.provider === "protoboard-cloud" ? "protoboard" : rec.provider),
      ...(rec.revision !== undefined ? { revision: typeof rec.revision === "number" ? rec.revision : (revisionLabel(rec.revision) ?? rec.revision) } : {}),
      ...(edited.length ? { edited } : {}),
      instances: uses.get(id) ?? 0,
      ...(typeof def.manufacturer === "string" ? { manufacturer: def.manufacturer } : {}),
      ...(typeof def.part_number === "string" ? { partNumber: def.part_number } : {}),
    });
  }
  parts.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.library ?? "").localeCompare(b.library ?? "") || a.name.localeCompare(b.name));
  return { parts, counts: countParts(parts) };
}

function countParts(parts: ProjectPart[]): ProjectPartsReport["counts"] {
  return {
    total: parts.length,
    library: parts.filter((x) => x.tier === "catalog").length,
    researched: parts.filter((x) => x.tier === "project-researched").length,
    designed: parts.filter((x) => x.tier === "project-specific").length,
    updates: parts.filter((x) => x.status === "update-available").length,
    diverged: parts.filter((x) => x.status === "diverged").length,
  };
}

/**
 * The report with what the libraries said (`checkPartUpdates`): a pinned
 * part becomes up to date or has an update; a diverged part stays diverged
 * (its edits come first) but carries the recommended revision.
 */
export function withUpdates(report: ProjectPartsReport, updates: UpdateReport[], at: string, problems: string[] = []): ProjectPartsReport {
  const byId = new Map(updates.map((u) => [u.id, u]));
  const parts = report.parts.map((x): ProjectPart => {
    const u = byId.get(x.id);
    if (!u || x.tier !== "catalog") return x;
    const newer = u.status === "update-available" && u.recommended !== undefined ? { recommended: u.recommended } : {};
    if (x.status === "diverged") return { ...x, ...newer };
    if (u.status === "update-available") return { ...x, status: "update-available", ...newer };
    if (u.status === "up-to-date" || u.status === "renumbered") return { ...x, status: "up-to-date" };
    return x;
  });
  return { parts, counts: countParts(parts), checked: { at, problems } };
}
