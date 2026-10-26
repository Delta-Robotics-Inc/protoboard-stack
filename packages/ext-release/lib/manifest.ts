/**
 * The release manifest, `protoboard.release/v0` (release-package-and-evals.md
 * §3): what was released and from what. Everything in it is derived from
 * committed inputs, never from the clock or the machine, so rebuilding the
 * same release in a clean environment gives the same bytes.
 */
import { createHash } from "node:crypto";
import { FRAMEWORK_VERSION, stableStringify, uhdVersion, type Project } from "@protoboardai/core";
import type { Freshness } from "./preconditions.ts";
import { exportKey } from "./preconditions.ts";
import { RELEASE_SCHEMA, type PackageFile, type Unit } from "./types.ts";
import { byCode, sha256 } from "./util.ts";

export interface ManifestFile {
  path: string;
  digest: string;
  bytes: number;
  unit?: string;
  role: string;
  /** Project-relative source of a copied file. */
  from?: string;
}

export interface ReleaseManifest {
  schema: typeof RELEASE_SCHEMA;
  project: { name: string; root: string };
  version: string;
  /** Release date: SOURCE_DATE_EPOCH, else the source commit's date. */
  date: string;
  source: { commit: string; dirty: string[] } | null;
  framework: { protoboard: string; uhd: { version?: string; revision?: string } };
  extensions: { id: string; version: string }[];
  tools: { id: string; detail?: string }[];
  /** Font files the documents were printed with (they change the PDFs' bytes). */
  fonts: { file: string; digest: string }[];
  build: number;
  units: { id: string; folder: string; kind: Unit["kind"]; entry: string; definition: string; name: string; instances: string[]; perProduct: number; parents: string[] }[];
  model: { bundle: string; digest: string };
  parts: { id: string; tier: string; kind: string; source: string; provider?: string; service?: string; revision?: string | number; digest: string; envelopeDigest?: string; instances: number }[];
  outputs: {
    module: string;
    capability: string;
    provider: { id: string; version: string };
    config: string;
    configDigest: string;
    moduleDigest?: string;
    record: string;
    projectDigest: string;
    tools: { id: string; detail?: string }[];
    files: { path: string; digest: string }[];
    packaged: string[];
  }[];
  /** Project files other operations generated that the package carries (firmware configuration, …). */
  generated: { path: string; digest: string; operation: string; extension: string; record?: string; packaged: string[]; role: string }[];
  firmware: { path: string; digest: string; from?: string }[];
  check: { errors: number; warnings: number; info: number; findings: { code: string; severity: string; message: string; validator: string }[]; validators: { validator: string; subject?: string; status: string; reason?: string }[] };
  sections: { unit: string; section: string; contributors: string[] }[];
  /** Every file in the package except this manifest. */
  files: ManifestFile[];
  /** sha256 over the canonical `files` list. */
  packageDigest: string;
}

export interface ManifestInputs {
  p: Project;
  version: string;
  date: string;
  source: ReleaseManifest["source"];
  build: number;
  units: Unit[];
  bundle: PackageFile;
  fresh: Freshness;
  files: PackageFile[];
  tools: { id: string; detail?: string }[];
  fonts: { file: string; digest: string }[];
  sections: ReleaseManifest["sections"];
}

export function buildManifest(m: ManifestInputs): ReleaseManifest {
  const { p } = m;
  const uhd = uhdVersion(p.root);
  const used = new Map<string, number>();
  for (const i of p.instances) used.set(i.definition, (used.get(i.definition) ?? 0) + 1);
  const files: ManifestFile[] = m.files
    .map((f) => ({ path: f.path, digest: sha256(f.content), bytes: f.content.length, ...(f.unit ? { unit: f.unit } : {}), role: f.role, ...(f.from ? { from: f.from } : {}) }))
    .sort((a, b) => byCode(a.path, b.path));
  const packagedFrom = (from: string) => files.filter((f) => f.from === from).map((f) => f.path);
  const outputs: ReleaseManifest["outputs"] = [];
  for (const b of [...p.capabilities].filter((b) => b.module && !b.problem).sort((a, b) => byCode(a.module!, b.module!))) {
    const rec = m.fresh.exports.get(exportKey(b));
    if (!rec) continue;
    const own = rec.record.outputs.filter((o) => o.path.startsWith(b.out + "/")).sort((x, y) => byCode(x.path, y.path));
    outputs.push({
      module: b.module!,
      capability: b.capability,
      provider: rec.record.extension,
      config: b.config,
      configDigest: b.configDigest,
      ...(rec.record.capability?.moduleDigest ? { moduleDigest: rec.record.capability.moduleDigest } : {}),
      record: rec.file,
      projectDigest: rec.record.projectDigest,
      tools: rec.record.tools.map((t) => ({ id: t.id, ...(t.detail ? { detail: t.detail } : {}) })),
      files: own.map((o) => ({ path: o.path, digest: o.digest })),
      packaged: own.flatMap((o) => packagedFrom(o.path)),
    });
  }
  const capOut = new Set(outputs.flatMap((o) => o.files.map((f) => f.path)));
  const generated: ReleaseManifest["generated"] = [];
  for (const from of [...new Set(files.filter((f) => f.from && !capOut.has(f.from)).map((f) => f.from!))].sort(byCode)) {
    const w = m.fresh.writers.get(from);
    const f = files.find((x) => x.from === from)!;
    generated.push({ path: from, digest: f.digest, operation: w?.record.operation ?? "", extension: w?.record.extension.id ?? "", ...(w ? { record: w.file } : {}), packaged: packagedFrom(from), role: f.role });
  }
  const findings = p.diagnostics.filter((d) => d.severity !== "info").map((d) => ({ code: d.code, severity: d.severity, message: d.message, validator: d.validator }));
  const count = (s: string) => p.diagnostics.filter((d) => d.severity === s).length;
  const manifest: Omit<ReleaseManifest, "packageDigest"> = {
    schema: RELEASE_SCHEMA,
    project: { name: p.name, root: p.rootDef!.id },
    version: m.version,
    date: m.date,
    source: m.source,
    framework: { protoboard: FRAMEWORK_VERSION, uhd: { ...(uhd.version ? { version: uhd.version } : {}), ...(uhd.revision ? { revision: uhd.revision } : {}) } },
    extensions: p.extensions.map((e) => ({ id: e.manifest.id, version: e.manifest.version })).sort((a, b) => byCode(a.id, b.id)),
    tools: m.tools,
    fonts: m.fonts,
    build: m.build,
    units: m.units.map((u) => ({ id: u.id, folder: u.folder, kind: u.kind, entry: u.entry, definition: u.definition, name: u.name, instances: u.instances, perProduct: u.perProduct, parents: u.parents })),
    model: { bundle: m.bundle.path, digest: sha256(m.bundle.content) },
    parts: [...used.keys()]
      .sort(byCode)
      .map((id) => p.definitions.get(id))
      .filter((r) => !!r)
      .map((r) => ({
        id: r!.def.id,
        tier: r!.origin.tier,
        kind: r!.def.kind ?? "module",
        source: r!.origin.source.file,
        ...(r!.origin.provider ? { provider: r!.origin.provider } : {}),
        ...(r!.origin.service ? { service: r!.origin.service } : {}),
        ...(r!.origin.revision !== undefined ? { revision: r!.origin.revision } : {}),
        digest: r!.origin.digest ?? sha256(stableStringify(r!.def)),
        ...(r!.origin.envelopeDigest ? { envelopeDigest: r!.origin.envelopeDigest } : {}),
        instances: used.get(r!.def.id)!,
      })),
    outputs,
    generated,
    firmware: files.filter((f) => f.role === "firmware-config").map((f) => ({ path: f.path, digest: f.digest, ...(f.from ? { from: f.from } : {}) })),
    check: {
      errors: count("error"),
      warnings: count("warning"),
      info: count("info"),
      findings,
      validators: p.checks.map((c) => ({ validator: c.validator, ...(c.subject ? { subject: c.subject } : {}), status: c.status, ...(c.reason ? { reason: c.reason } : {}) })),
    },
    sections: m.sections,
    files,
  };
  return { ...manifest, packageDigest: "sha256:" + createHash("sha256").update(stableStringify(files)).digest("hex") };
}
