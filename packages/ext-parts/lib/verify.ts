/**
 * Automated checks for one purchased part (the uhd-part-verify skill, stage
 * 1), in either layout (lib/layout.ts): metadata, categories (UHD's
 * taxonomy, with the library's extension, and every category that fits:
 * lib/categories.ts), citations, structure,
 * parameters, vocabulary, connectors, pin designators (parts with a package
 * fact), CAD, file terms (lib/terms.ts), and hygiene; and pair DRC
 * against mating parts. Moved from UHD's scripts/verify-part.ts (PB-801).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { InterfaceDef, ModuleDef, Taxonomy } from "@deltarobotics/uhd";
import { UHD_TAXONOMY, isConnector, partPackage, pinDesignatorIssues, validateCategories, validatePair } from "@deltarobotics/uhd";
import { checkCad, manifestLookup } from "./cad-checks.ts";
import { categoryHintMessages, type KitMembers } from "./categories.ts";
import { lintFreeText } from "./lint.ts";
import { checkTerms } from "./terms.ts";
import type { PartFiles, PartSet } from "./layout.ts";

/** Protocol types emitted by the UHD protocol builders. */
const BUILDER_PROTOCOLS = [
  "digital", "pwm", "interrupt", "analog", "power", "i2c", "spi", "uart",
  "bldc_phase", "bldc_3phase", "dshot", "oneshot125", "oneshot42", "multishot",
  "pwm_esc", "fc_esc_connector", "connector", "crsf", "sbus", "bolt_pattern", "shaft", "custom",
  // PB-824: passive terminals (pinTable "passive", Passive()); nets live on boards, not parts
  "passive",
  // PB-864: steppers, brushed motors, encoders, servos, CAN, fluid ports
  "stepper_phase", "bipolar_stepper_phases", "unipolar_stepper_phases", "step_dir",
  "dc_motor_terminal", "dc_motor", "quadrature_encoder", "rc_servo",
  "can", "can_signal", "can_logic", "pneumatic", "hydraulic",
  // PB-862: linear motion
  "linear_motion",
  // PB-866: links, buses and radios (UHD docs/links-and-buses.md)
  "pcie", "pcie_lane", "pcie_refclk", "m2", "mipi_csi2", "mipi_dsi", "mipi_dphy",
  "ethernet", "ethernet_mdi", "sfp", "i2s", "dvp", "sd_card", "usb", "usb_signal",
  "wifi", "bluetooth", "ieee802154", "led_drive",
  // PB-866 mechanical round: drive train, fastening, serial, IR, mains, coils (UHD docs/mechanical-interfaces.md)
  "gear_mesh", "bearing_fit", "thread", "t_slot", "axial_stop", "rolling_contact",
  "rs485", "rs485_signal", "rs232", "rs232_signal", "swd", "ppm", "ir_remote",
  "ac_power", "ac_terminal", "inductive_load", "inductive_terminal",
  // UHD 0.3.0: piezo drive and battery charge (docs/links-and-buses.md, "Piezo loads", "Battery charge ports")
  "piezo_drive", "piezo_terminal", "battery_charge",
];

/** Trait types new parts should use (the uhd-part-author skill). */
const CANONICAL_TRAITS = new Set([
  "pin_functions", "connector", "operating_conditions", "absolute_maximum",
  "performance", "assumption", "source_discrepancy", "data_gap", "usage_note",
  // PB-797: typed relations (src/types/trait.ts)
  "supplied_from", "handedness",
  // PB-824: passives and design requirements
  "passive", "design_envelope",
  // emitted by builders
  "phase_order", "esc_signal_protocols", "serial_rx_protocol", "bolt_pattern", "shaft",
  // PB-864 builders
  "stepper_winding", "step_dir", "motor_polarity", "encoder_output", "can_termination", "header_form", "fluid_joint", "fluid",
  // PB-862 builders
  "linear_motion",
  // PB-866 builders and traits
  "m2", "mipi", "ethernet", "poe", "sfp", "audio_port", "sd_card", "usb", "wireless", "led_drive", "led", "relay", "storage",
  // PB-866 mechanical round
  "gear_mesh", "bearing_fit", "thread", "t_slot", "axial_stop", "rolling_contact",
  "rs485", "rs232", "swd", "ppm", "ir_remote", "ac_power", "inductive_load", "inductive_drive",
  // UHD 0.3.0 builders
  "piezo_load", "piezo_drive", "battery_charge",
]);

const ARTIFACT_TYPES = new Set([
  "datasheet", "schematic", "pcb", "3d_model", "firmware", "simulation",
  "documentation", "cad", "custom",
]);

export interface Finding {
  level: "error" | "warning";
  check: string;
  message: string;
}

/** Builder protocols plus every protocol a peer part uses (the library, or the project's definitions). */
function knownProtocols(peers: Iterable<ModuleDef>, exclude: string): Set<string> {
  const known = new Set(BUILDER_PROTOCOLS);
  for (const def of peers) {
    if (def.id === exclude) continue;
    for (const iface of def.interfaces) for (const p of iface.protocols) known.add(p.type);
  }
  return known;
}

/** Every interface is mechanical: nothing electrical, fluid or thermal to rate. */
export function isPassiveMechanical(def: ModuleDef): boolean {
  return def.interfaces.length > 0 && def.interfaces.every((i) => i.domain === "mechanical") && !(def.domains ?? []).some((d) => d.domain !== "mechanical");
}

/** A FluidPort whose joint is a thread (UHD fluid_joint trait, kind "thread"): the fitting is mounted by it. */
export function hasThreadJoint(i: InterfaceDef): boolean {
  return (i.traits ?? []).some((t) => t.type === "fluid_joint" && (t.params as { kind?: string } | undefined)?.kind === "thread");
}

/** The CAD generator manifests the part's artifacts point at (format json, generated from a CAD artifact). */
function readManifests(def: ModuleDef, f: PartFiles): { artifact: string; manifest: Record<string, any> }[] {
  return (def.artifacts ?? []).flatMap((a) => {
    if (a.format !== "json" || !a.provenance?.generatedFrom || !a.filePath) return [];
    const file = join(f.root, a.filePath);
    try {
      return existsSync(file) ? [{ artifact: a.provenance.generatedFrom, manifest: JSON.parse(readFileSync(file, "utf8")) }] : [];
    } catch {
      return [];
    }
  });
}

/** A file kept outside git (the library's `npm run large-files`) is committed as `<file>.blob.json`. */
const BLOB_POINTER = ".blob.json";

/**
 * Artifact files that do not exist (PB-866): every artifact with a
 * `filePath` (a body, a source, a manifest, or an interface's own geometry
 * file) must have that file, or its large-file pointer, under `root`.
 * Otherwise the envelope carries a dangling path and a bound interface draws
 * nothing. Each message says which interfaces bind the artifact.
 */
export function artifactFileIssues(def: ModuleDef, root: string): string[] {
  const out: string[] = [];
  for (const a of def.artifacts ?? []) {
    if (!a.filePath || existsSync(join(root, a.filePath)) || existsSync(join(root, a.filePath + BLOB_POINTER))) continue;
    const bound = def.interfaces.filter((i) => i.id === a.interfaceId || (i.geometry?.refs ?? []).some((r) => r.kind !== "procedural" && r.artifact === a.id)).map((i) => i.id);
    out.push(`artifact ${a.id}: file ${a.filePath} does not exist${bound.length ? ` (bound by interface ${bound.join(", ")})` : ""}`);
  }
  return out;
}

function readGaps(f: PartFiles): string[] {
  const file = join(f.root, f.research, "gaps.json");
  if (!existsSync(file)) return [];
  try {
    const gaps = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
    return gaps.map((g) => JSON.stringify(g));
  } catch {
    return [];
  }
}

/**
 * Every finding for `def`, whose files are `f`; `peers` are the other parts
 * (vocabulary); `taxonomy` checks its categories (UHD's by default); `kits`
 * are the library's kit manifests, for kit membership.
 */
export function checkPart(def: ModuleDef, f: PartFiles, peers: Iterable<ModuleDef>, taxonomy: Taxonomy = UHD_TAXONOMY, kits?: KitMembers): Finding[] {
  const id = f.id;
  const out: Finding[] = [];
  const err = (checkName: string, message: string) => out.push({ level: "error", check: checkName, message });
  const warn = (checkName: string, message: string) => out.push({ level: "warning", check: checkName, message });

  // Identity / metadata
  for (const field of ["name", "version", "manufacturer", "part_number", "description"] as const) {
    if (!def[field]) err("metadata", `missing ${field}`);
  }
  if (!def.tags?.length && !def.categories?.length) warn("metadata", "no tags or categories");
  // Categories are taxonomy paths (UHD docs/taxonomy.md); the catalog refuses a part with an unknown one
  for (const issue of validateCategories(def.categories, taxonomy)) err("categories", issue.message);
  // PB-864: a part is filed under every category that fits; warn when its tags or interfaces point at one it lacks
  for (const message of categoryHintMessages(def, taxonomy, { kits })) warn("categories", message);

  // Citation
  if (def.id !== id) err("metadata", `the exported ModuleDef id is ${def.id}, not ${id}`);
  const source = readFileSync(join(f.root, f.definition), "utf8");
  const header = source.slice(0, source.indexOf("*/") + 2);
  if (!/https?:\/\//.test(header) && !/sources\.json/.test(header)) {
    err("citation", "file header cites no sources");
  }
  if (/\b(TODO|TBD|FIXME)\b/.test(source)) err("hygiene", "file contains TODO/TBD/FIXME");

  const sourcesFile = join(f.root, f.evidence, "sources.json");
  let sourceUrls = new Set<string>();
  let sourceRows: Array<Record<string, unknown>> = [];
  if (!existsSync(sourcesFile)) {
    err("citation", `missing ${f.evidence}/sources.json`);
  } else {
    try {
      const rows = JSON.parse(readFileSync(sourcesFile, "utf8")) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length === 0) err("citation", "sources.json is empty");
      rows.forEach((row, i) => {
        for (const field of ["id", "title", "url", "type", "authority", "supports"]) {
          if (row[field] === undefined) err("citation", `sources.json[${i}] missing ${field}`);
        }
        if (typeof row.type === "string" && !ARTIFACT_TYPES.has(row.type)) {
          err("citation", `sources.json[${i}] type "${row.type}" is not an ArtifactType`);
        }
      });
      const standardPart = def.tags?.includes("standard-part");
      if (!rows.some((r) => r.authority === "manufacturer")) {
        // standard parts (ISO/DIN fasteners) are defined by the standard; a supplier drawing suffices
        (standardPart ? warn : err)("citation", "no manufacturer-authority source in sources.json" + (standardPart ? " (standard part: supplier drawing of the cited standard accepted)" : ""));
      }
      sourceUrls = new Set(rows.map((r) => String(r.url)));
      sourceRows = rows;
    } catch (e) {
      err("citation", `sources.json is not valid JSON: ${(e as Error).message}`);
    }
  }
  if (!def.artifacts?.length) err("citation", "no artifacts[] on the module");
  for (const artifact of def.artifacts ?? []) {
    if (artifact.url && !sourceUrls.has(artifact.url)) {
      warn("citation", `artifact ${artifact.id} url is not listed in sources.json`);
    }
  }

  // Structure
  const byId = new Map(def.interfaces.map((i) => [i.id, i]));
  const known = knownProtocols(peers, id);
  const gaps = readGaps(f).join("\n");
  const traitTypes = new Set<string>();
  const collectTraits = (traits?: { type: string }[]) => traits?.forEach((t) => traitTypes.add(t.type));
  collectTraits(def.traits);

  for (const iface of def.interfaces) {
    const where = `interface ${iface.id}`;
    if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(iface.id)) warn("structure", `${where}: id is not snake_case`);
    if (!iface.domain) err("structure", `${where}: missing domain`);
    if (!iface.protocols?.length) err("structure", `${where}: no protocols`);
    for (const p of iface.protocols ?? []) {
      if (!p.roles?.length) err("structure", `${where}: protocol ${p.type} has no roles`);
      if (!known.has(p.type)) {
        (gaps.includes(p.type) ? warn : err)(
          "vocabulary",
          `${where}: protocol type "${p.type}" is not in the vocabulary${gaps.includes(p.type) ? " (recorded in gaps.json)" : " — record it in .research/gaps.json or use an existing type"}`,
        );
      }
    }
    if (isConnector(iface)) {
      // PB-805: positions mate by position, so slots carry no protocol match
      const params = iface.traits?.find((t) => t.type === "connector")?.params as { positions?: number } | undefined;
      if (!params) err("connectors", `${where}: connector composite has no connector trait`);
      if (params?.positions !== undefined && params.positions !== iface.slots?.length) {
        err("connectors", `${where}: connector trait says ${params.positions} positions but it has ${iface.slots?.length ?? 0} slots`);
      }
      for (const [slot, leaf] of Object.entries(iface.profiles?.[0]?.bindings ?? {})) {
        for (const id of Array.isArray(leaf) ? leaf : [leaf]) {
          if (!byId.has(id)) err("connectors", `${where}: position ${slot} binds unknown interface ${id}`);
          else if (isConnector(byId.get(id)!)) err("connectors", `${where}: position ${slot} binds another connector (${id})`);
        }
      }
    } else if (iface.slots?.length) {
      if (!iface.profiles?.length) err("structure", `${where}: composed interface has slots but no profile`);
      for (const slot of iface.slots) {
        if (!slot.match.protocol) {
          warn("structure", `${where}: slot ${slot.id} has no match.protocol, so it will not pair in DRC`);
        }
      }
    }
    for (const param of iface.parameters ?? []) {
      if (!param.unit) err("parameters", `${where}: parameter ${param.id} has no unit`);
      if (param.value === undefined && param.range === undefined) {
        err("parameters", `${where}: parameter ${param.id} has neither value nor range`);
      }
      if (param.range && param.range[0] > param.range[1]) {
        err("parameters", `${where}: parameter ${param.id} range is reversed`);
      }
    }
    for (const target of iface.bridgesTo ?? []) {
      if (!byId.has(target)) err("structure", `${where}: bridgesTo unknown interface ${target}`);
    }
    if (!isConnector(iface)) {
      for (const t of iface.traits ?? []) {
        const c = t.params as { connector_type?: string; positions?: number } | undefined;
        if (t.type === "connector" && (c?.positions ?? 0) > 1 && iface.pin !== undefined) {
          warn("connectors", `${where}: carries a ${c?.positions}-position ${c?.connector_type} trait; declare the connector as a Connector() composite and keep only the pad's own trait here (UHD docs/connectors-and-harnesses.md)`);
        }
      }
    }
    collectTraits(iface.traits);
  }

  if (!def.interfaces.some((i) => i.exposed)) err("structure", "no exposed interfaces");

  const nonCanonical = [...traitTypes].filter((t) => !CANONICAL_TRAITS.has(t));
  if (nonCanonical.length) {
    warn("traits", `non-canonical trait types: ${nonCanonical.join(", ")} (see the uhd-part-author skill)`);
  }

  const domains = new Set(def.interfaces.map((i: InterfaceDef) => i.domain));
  // a passive mechanical part (fastener, bracket, shaft, spacer) has no operating temperature to look for
  if (!isPassiveMechanical(def) && !(def.domains ?? []).some((d) => d.domain === "thermal") && !traitTypes.has("operating_conditions")) {
    warn("coverage", "no thermal domain or operating_conditions trait — confirm the sources give no operating temperature");
  }
  // a fluid port's thread is how a fitting is mounted
  if (!domains.has("mechanical") && !def.interfaces.some(hasThreadJoint)) warn("coverage", "no mechanical interfaces (mounting, shaft) — confirm this is intended");

  // Package and pin designators (PB-824): a chip states its package and every pad carries `pin`
  for (const issue of pinDesignatorIssues(def)) warn("pins", issue);
  const pkg = partPackage(def);
  if (pkg && !pkg.source && !pkg.assumption) warn("pins", `package ${pkg.name} cites no source`);

  // Files (PB-866): every artifact file the part declares, bound interface geometry included, exists
  for (const issue of artifactFileIssues(def, f.root)) err("files", issue);

  // CAD (PB-796): a body, bindings, frames, frame plausibility, vendor licence
  for (const issue of checkCad(def, manifestLookup(def, f.root))) {
    (issue.severity === "error" ? err : warn)("cad", `${issue.interfaceId ? `interface ${issue.interfaceId}: ` : ""}${issue.message}`);
  }
  const vendorCad = (def.artifacts ?? []).filter((a) => a.type === "3d_model" && a.role === "source" && a.url);
  for (const a of vendorCad) {
    const row = sourceRows.find((r) => r.url === a.url);
    if (!row) err("cad", `vendor CAD ${a.id} (${a.url}) is not in sources.json`);
    else {
      if (row.type !== "cad") err("cad", `sources.json row for ${a.url} should have type "cad"`);
      if (!row.sha256) err("cad", `sources.json row for ${a.url} has no sha256`);
      if (!row.licence) err("cad", `sources.json row for ${a.url} records no licence/terms ("licence")`);
    }
  }
  // Terms (PB-863): every manufacturer or downloaded file says who may receive it
  for (const t of checkTerms(def, f)) (t.level === "error" ? err : warn)("terms", t.message);

  // Free text (PB-862): vendor-CAD wording on generated geometry, generator references that are not this part's
  for (const l of lintFreeText(def, sourceRows, readManifests(def, f))) warn("text", l.message);

  const hasBody = (def.artifacts ?? []).some((a) => a.role === "body");
  const cadGap = (def.traits ?? []).some((t) => t.type === "data_gap" && /manufacturer CAD/i.test(JSON.stringify(t.params ?? {})));
  if (hasBody && !vendorCad.length && !cadGap) {
    warn("cad", 'generated geometry without a data_gap trait for "manufacturer CAD" (say where you looked)');
  }

  return out;
}

/** Pair DRC against a mating part: one line per connection. */
export function summarizeMate(def: ModuleDef, mate: ModuleDef, result = validatePair(def, mate)): string[] {
  const lines = [`mate ${mate.id}: verdict ${result.verdict.state}, ${result.connections.length} connection(s)`];
  for (const c of result.connections) {
    const unresolved = c.unresolvedSlots.map((u) => `${u.moduleId}:${u.slotId}`).join(", ");
    lines.push(
      `  ${c.protocol.padEnd(18)} ${c.state.padEnd(22)} ${c.subLinks.length} sub-link(s)` +
        (unresolved ? `  unresolved: ${unresolved}` : "") +
        (c.diagnostics.length ? `  diagnostics: ${c.diagnostics.map((d) => d.message).join("; ")}` : ""),
    );
  }
  return lines;
}


export interface VerifyReport {
  partId: string;
  layout: PartFiles["layout"];
  definition: string;
  /** In the order the checks found them. */
  findings: Finding[];
  errors: Finding[];
  warnings: Finding[];
  /** Assumption traits on the module and its interfaces. */
  assumptions: number;
  mates: string[];
}

/** `--mate a,b --mate c` → [a, b, c]. */
export const mateList = (values: string[] = []): string[] => [...new Set(values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean))];

export interface VerifyOptions {
  /** Pair DRC against every other part of the set; only pairs that form a connection are reported. */
  allMates?: boolean;
  /** Findings from steps run outside checkPart (typecheck, refetch), merged into the report. */
  extra?: Finding[];
}

/** Verify one part of a part set, optionally against mating parts from the same set. */
export function verifyPart(set: PartSet, def: ModuleDef, mates: string[] = [], options: VerifyOptions = {}): VerifyReport {
  const f = set.files(def.id);
  const findings = [...(options.extra ?? []), ...checkPart(def, f, [...set.defs.values()], set.taxonomy, set.kits)];
  const mateLines: string[] = [];
  for (const mateId of mateList(mates)) {
    const mate = set.defs.get(mateId);
    if (!mate) findings.push({ level: "error", check: "mate", message: `no part "${mateId}" to mate with` });
    else mateLines.push(...summarizeMate(def, mate));
  }
  if (options.allMates) {
    const named = new Set(mateList(mates));
    let tried = 0;
    let paired = 0;
    for (const mate of [...set.defs.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (mate.id === def.id || named.has(mate.id)) continue;
      tried++;
      const result = validatePair(def, mate);
      if (!result.connections.length) continue;
      paired++;
      mateLines.push(...summarizeMate(def, mate, result));
    }
    mateLines.push(`all mates: ${tried} part(s) tried, ${paired} form at least one connection`);
  }
  return {
    partId: def.id,
    layout: f.layout,
    definition: f.definition,
    findings,
    errors: findings.filter((x) => x.level === "error"),
    warnings: findings.filter((x) => x.level === "warning"),
    assumptions: [def, ...def.interfaces].flatMap((x) => x.traits ?? []).filter((t) => t.type === "assumption").length,
    mates: mateLines,
  };
}

/** The text report the script prints. */
export function formatReport(r: VerifyReport, def: ModuleDef): string[] {
  return [
    `${r.partId}: ${def.interfaces.length} interfaces, ${r.assumptions} assumption(s) (${r.layout} layout, ${r.definition})`,
    ...r.findings.map((f) => `${f.level.padEnd(7)} [${f.check}] ${f.message}`),
    ...r.mates,
    r.errors.length ? `FAIL: ${r.errors.length} error(s), ${r.warnings.length} warning(s)` : `PASS: 0 errors, ${r.warnings.length} warning(s)`,
  ];
}
