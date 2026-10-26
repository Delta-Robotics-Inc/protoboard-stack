/**
 * The `firmware` capability's four operations, shared by every firmware
 * provider (tool-integrations.md §2–§4, PB-847). A provider supplies only
 * what is specific to its framework: how a board's firmware map becomes
 * files (`design`), how to read pins back out of those files (`readPins`),
 * and its own rules. Everything else is here, so a Zephyr and an ESP-IDF
 * provider behave the same way:
 *
 *   generate  board → firmware map → rules → files in <native>/, plus
 *             <native>/protoboard.lines.json: each file's digest and the
 *             UHD facts each setting line cites. Refuses a board with errors.
 *   export    copies the native files into out/config/ and writes
 *             out/firmware.manifest.json. Refuses native files edited since
 *             generate: the cites would no longer describe them.
 *   extract   the artifacts (manifest, native folder) and the pin assignment
 *             read back from the native files.
 *   check     the board rules, the provider's rules, and drift: native files
 *             edited or stale against the model, pins that are not on the
 *             controller's pin table, setting lines that cite nothing.
 *
 * Generated files are not edited by hand. Project-specific settings go in
 * the application's own files, which the framework merges with these.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactDef, InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { boardFirmware, checkBoardFirmware, type BoardFirmware, type FirmwareFinding, type FirmwareRuleOptions } from "./board-firmware.js";
import { boardOptions } from "./board-netlist.js";
import type { CapabilityContext, CapabilityOperationFn, CapabilityResult } from "./capabilities.js";
import { locateId } from "./load.js";
import { FORMER_PACKAGE_SCOPE, PACKAGE_SCOPE } from "./scope.js";
import { FIRMWARE_MANIFEST_SCHEMA, type FirmwareCite, type FirmwareManifest } from "./outputs.js";
import type { ProjectDiagnostic, SourceLocation } from "./types.js";

/** One line of a generated file: its text, and the facts and reason behind it. */
export interface CitedLine {
  text: string;
  cites?: FirmwareCite[];
  /** A short reason, written into the file as a comment. */
  why?: string;
}

/**
 * How a file format writes comments and which of its lines are settings:
 * `c-block` devicetree and C (`/* … *\/` after the line), `c-line` C
 * (`// …`), `conf` Kconfig fragments (`# …` on the line above: a value may
 * not carry a comment), `kconfig` Kconfig definitions, `yaml`.
 */
export type CommentStyle = "c-block" | "c-line" | "conf" | "kconfig" | "yaml";

export interface FirmwareFile {
  /** Path relative to the native folder (and to out/config/). */
  path: string;
  role: string;
  style: CommentStyle;
  /** Fixed header comment lines (without comment markers). */
  header?: string[];
  /** Write the design's warnings into this file's header (the main file of a design). */
  warnings?: boolean;
  lines: CitedLine[];
}

/** What a provider's `design` returns. */
export interface FirmwareDesign {
  files: FirmwareFile[];
  /** What the model cannot decide; written into each file's header and returned to the agent. */
  warnings: string[];
  /** The provider's own rule findings (bus instances, SoC limits). */
  findings: FirmwareFinding[];
}

export interface RenderedFile {
  path: string;
  role: string;
  text: string;
  digest: string;
  lines: { line: number; cites: FirmwareCite[] }[];
}

/** A pin named in a generated file, as the file names it, mapped back to the controller's leaf when it is one. */
export interface PinRef {
  file: string;
  line: number;
  /** As written: "P0.13", "GPIO4". */
  ref: string;
  /** Controller leaf interface id, undefined when no pin of the controller has that name. */
  pin?: string;
}

export interface FirmwareProviderSpec {
  /** Extension id, written into the manifest. */
  provider: string;
  framework: string;
  frameworkVersion: string;
  /** Turn the firmware map into files. Called only when the board has a controller. */
  design: (fw: BoardFirmware, board: ModuleDef, controller: ModuleDef, ctx: Pick<CapabilityContext, "constraints" | "module" | "project">) => FirmwareDesign;
  /** Read the pins a set of files names (native files, by path relative to the native folder). */
  readPins: (files: Record<string, string>, controller: ModuleDef) => PinRef[];
  /** Options for the shared rules: which pins can wake the chip, and what its sleep is called. */
  rules?: (controller: ModuleDef) => Omit<FirmwareRuleOptions, "wake" | "i2cFrequencyHz">;
}

export const LINES_INDEX = "protoboard.lines.json";
const INDEX_SCHEMA = "protoboard.firmware-lines/v0";

interface LinesIndex {
  schema: typeof INDEX_SCHEMA;
  provider: string;
  framework: string;
  frameworkVersion: string;
  module: string;
  controller: { instance: string; part: string };
  files: { path: string; role: string; digest: string; lines: { line: number; cites: FirmwareCite[] }[] }[];
  warnings: string[];
}

const digestOf = (s: string | Buffer) => "sha256:" + createHash("sha256").update(s).digest("hex");

const SETTING: Record<CommentStyle, RegExp> = {
  // devicetree: a property assignment or a boolean property; C: a #define
  "c-block": /^\s*(#define\s|[\w#,.+-]+\s*=|[a-z][\w,.+-]*;)/,
  "c-line": /^\s*#define\s/,
  // Kconfig fragments: CONFIG_X=…
  conf: /^\s*CONFIG_\w+=/,
  kconfig: /^\s*(config|select|default|depends on)\s/,
  yaml: /^\s*(-\s+)?[\w-]+:\s*\S/,
};

/** Is this rendered line a setting (which must cite a fact)? */
export function isSettingLine(style: CommentStyle, text: string): boolean {
  return SETTING[style].test(text);
}

/** Render a file: comments carry the reasons, the returned `lines` carry the cites by line number. */
export function renderFile(file: FirmwareFile, warnings: string[] = []): RenderedFile {
  const out: string[] = [];
  const lines: RenderedFile["lines"] = [];
  const hash = file.style === "conf" || file.style === "kconfig" || file.style === "yaml";
  const comment = (s: string) => (hash ? `# ${s}` : file.style === "c-line" ? `// ${s}` : `/* ${s} */`);
  const shown = file.warnings ? warnings : [];
  for (const h of file.header ?? []) out.push(comment(h));
  for (const w of shown) out.push(comment(`WARNING: ${w}`));
  if (file.header?.length || shown.length) out.push("");
  for (const l of file.lines) {
    if (hash && l.why) out.push(/^\s*/.exec(l.text)![0] + comment(l.why));
    out.push(!hash && l.why ? `${l.text} ${comment(l.why)}` : l.text);
    if (l.cites?.length) lines.push({ line: out.length, cites: [...new Set(l.cites)] });
  }
  const text = out.join("\n") + "\n";
  return { path: file.path, role: file.role, text, digest: digestOf(text), lines };
}

/** Setting lines that cite nothing: a provider bug, reported by check. */
export function uncitedLines(file: FirmwareFile): string[] {
  return file.lines.filter((l) => !l.cites?.length && isSettingLine(file.style, l.text)).map((l) => l.text.trim());
}

type Ctx = Pick<CapabilityContext, "constraints" | "module" | "project">;

interface Plan {
  fw: BoardFirmware;
  controller?: ModuleDef;
  design?: FirmwareDesign;
  rendered: RenderedFile[];
  findings: FirmwareFinding[];
}

function plan(spec: FirmwareProviderSpec, ctx: Ctx): Plan {
  const board = ctx.module.definition;
  const lookup = ctx.project.lookup;
  const controllerRef = typeof ctx.constraints.controller === "string" ? ctx.constraints.controller : undefined;
  const fw = boardFirmware(board, lookup, { ...(controllerRef ? { controller: controllerRef } : {}), board: boardOptions(ctx.project) });
  const controller = fw.controller ? lookup(fw.controller.part) : undefined;
  const i2c = ctx.constraints.i2c_frequency_hz;
  const findings = checkBoardFirmware(fw, lookup, {
    ...(controller && spec.rules ? spec.rules(controller) : {}),
    wake: ctx.constraints.wake,
    ...(typeof i2c === "number" ? { i2cFrequencyHz: i2c } : {}),
  });
  if (!controller) return { fw, rendered: [], findings };
  const design = spec.design(fw, board, controller, ctx);
  findings.push(...design.findings);
  for (const f of design.files) {
    for (const t of uncitedLines(f)) findings.push({ code: "FW_LINE_UNCITED", severity: "error", message: `${f.path}: "${t}" cites no UHD fact (provider defect)` });
  }
  return { fw, controller, design, rendered: design.files.map((f) => renderFile(f, design.warnings)), findings };
}

function toDiagnostics(ctx: Ctx, findings: FirmwareFinding[], config: string): Omit<ProjectDiagnostic, "validator">[] {
  const rec = ctx.project.definitions.get(ctx.module.id);
  const file = rec?.origin.kind === "local" ? join(ctx.project.root, rec.origin.source.file) : undefined;
  return findings.map((f) => {
    // a finding about a constraint points at the config; one about a component, at it in the board source
    let source: SourceLocation = { file: config };
    if (!f.cites?.some((c) => c.startsWith("constraint:")) && file) source = f.instance ? locateId(file, f.instance, ctx.project.root) : { file: rec!.origin.source.file };
    return { code: f.code, severity: f.severity, entity: { kind: "definition" as const, id: ctx.module.id }, message: f.instance ? `${f.instance}: ${f.message}` : f.message, source };
  });
}

const configOf = (ctx: CapabilityContext) => `${ctx.module.dir}/firmware.config.ts`;
const nativeAbs = (ctx: Ctx, rel = "") => join(ctx.project.root, ctx.module.native, rel);

function readIndex(ctx: Ctx): LinesIndex | undefined {
  const f = nativeAbs(ctx, LINES_INDEX);
  if (!existsSync(f)) return undefined;
  try {
    const j = JSON.parse(readFileSync(f, "utf8")) as LinesIndex;
    return j.schema === INDEX_SCHEMA ? j : undefined;
  } catch {
    return undefined;
  }
}

/** Native files whose content is not what generate wrote. */
function editedFiles(ctx: Ctx, index: LinesIndex): string[] {
  return index.files.filter((f) => !existsSync(nativeAbs(ctx, f.path)) || digestOf(readFileSync(nativeAbs(ctx, f.path))) !== f.digest).map((f) => f.path);
}

/**
 * Native files that no longer match what the board gives now (the model
 * changed since generate), as `[path, why]`. Edited files are left to
 * `editedFiles`. A file generated under the provider's former package name
 * from the same board is current (`underFormerScope`).
 */
/**
 * The digest a file had when stack 0.1.0 generated it: the same text, naming
 * the provider under the packages' former npm scope in its header (PB-941).
 * A native file that differs from today's only in that name was generated
 * from the same board: it is not stale, and export ships it as it is.
 */
const underFormerScope = (text: string): string => digestOf(text.replaceAll(`${PACKAGE_SCOPE}/`, `${FORMER_PACKAGE_SCOPE}/`));

function staleFiles(p: Plan, index: LinesIndex, edited: string[]): [string, string][] {
  const now = new Map(p.rendered.map((f) => [f.path, f]));
  const stale: [string, string][] = [];
  for (const f of index.files) {
    if (edited.includes(f.path)) continue;
    const want = now.get(f.path);
    if (!want) stale.push([f.path, "is no longer generated from the board"]);
    else if (want.digest !== f.digest && underFormerScope(want.text) !== f.digest) stale.push([f.path, "does not match the board any more (the model changed since generate)"]);
  }
  for (const f of p.rendered) if (!index.files.some((x) => x.path === f.path)) stale.push([f.path, "is missing"]);
  return stale;
}

const errorsOf = (fs: FirmwareFinding[]) => fs.filter((f) => f.severity === "error");

/** The four capability operations for a firmware provider. */
export function firmwareOperations(spec: FirmwareProviderSpec): Record<"generate" | "exportOutputs" | "extract" | "check", CapabilityOperationFn> {
  const generate: CapabilityOperationFn = (ctx) => {
    const p = plan(spec, ctx);
    const errors = errorsOf(p.findings);
    if (errors.length || !p.design || !p.fw.controller) {
      return {
        status: "failed",
        summary: `${errors.length} error(s) in the board's firmware facts; nothing written. First: ${errors[0]?.instance ? `${errors[0].instance}: ` : ""}${errors[0]?.message}`,
        data: { findings: p.findings },
        diagnostics: toDiagnostics(ctx, p.findings, configOf(ctx)),
      };
    }
    for (const f of p.rendered) ctx.writeOutput(`${ctx.module.native}/${f.path}`, f.text, f.role);
    const index: LinesIndex = {
      schema: INDEX_SCHEMA,
      provider: spec.provider,
      framework: spec.framework,
      frameworkVersion: spec.frameworkVersion,
      module: ctx.module.id,
      controller: { instance: p.fw.controller.instance, part: p.fw.controller.part },
      files: p.rendered.map((f) => ({ path: f.path, role: f.role, digest: f.digest, lines: f.lines })),
      warnings: p.design.warnings,
    };
    ctx.writeOutput(`${ctx.module.native}/${LINES_INDEX}`, JSON.stringify(index, null, 2) + "\n", "line → UHD fact index");
    const cited = p.rendered.reduce((n, f) => n + f.lines.length, 0);
    return {
      status: "succeeded",
      summary: `${spec.framework} configuration for ${p.fw.controller.instance} (${p.fw.controller.part}): ${p.rendered.length} files, ${cited} cited settings, ${p.fw.buses.length} bus(es), ${p.fw.gpios.length} GPIO(s)${p.design.warnings.length ? `, ${p.design.warnings.length} warning(s)` : ""}`,
      data: { files: p.rendered.map((f) => f.path), warnings: p.design.warnings, findings: p.findings.filter((f) => f.severity !== "info") },
    };
  };

  const exportOutputs: CapabilityOperationFn = (ctx) => {
    const index = readIndex(ctx);
    if (!index) return { status: "failed", summary: `no generated configuration in ${ctx.module.native}/; run firmware:generate first` };
    const edited = editedFiles(ctx, index);
    if (edited.length) {
      return { status: "failed", summary: `${edited.join(", ")} changed since generate, so its line cites no longer hold; run firmware:generate (put project-specific settings in the application's own files)` };
    }
    // the board changed since generate: exporting the old files would ship settings the board no longer has
    const p = plan(spec, ctx);
    const stale = staleFiles(p, index, edited);
    if (stale.length) {
      const errors = errorsOf(p.findings);
      return {
        status: "failed",
        summary: `${stale.map(([f, why]) => `${f} ${why}`).join("; ")}; run firmware:generate${errors.length ? ` (the board now has ${errors.length} error(s), first: ${errors[0].message})` : ""}`,
      };
    }
    for (const f of index.files) ctx.writeOutput(`${ctx.module.out}/config/${f.path}`, readFileSync(nativeAbs(ctx, f.path)), f.role);
    const manifest: FirmwareManifest = {
      schema: FIRMWARE_MANIFEST_SCHEMA,
      module: ctx.module.id,
      provider: index.provider,
      framework: index.framework,
      frameworkVersion: index.frameworkVersion,
      controller: index.controller,
      files: index.files.map((f) => ({ path: `config/${f.path}`, digest: f.digest, role: f.role, lines: f.lines })),
      ...(index.warnings.length ? { warnings: index.warnings } : {}),
    };
    ctx.writeOutput(`${ctx.module.out}/firmware.manifest.json`, JSON.stringify(manifest, null, 2) + "\n", "firmware manifest");
    return { status: "succeeded", summary: `${index.files.length} files in ${ctx.module.out}/config/ and firmware.manifest.json` };
  };

  const extract: CapabilityOperationFn = (ctx) => {
    const index = readIndex(ctx);
    if (!index) return { status: "failed", summary: `no generated configuration in ${ctx.module.native}/; run firmware:generate first` };
    const controller = ctx.project.lookup(index.controller.part);
    const files = Object.fromEntries(index.files.filter((f) => existsSync(nativeAbs(ctx, f.path))).map((f) => [f.path, readFileSync(nativeAbs(ctx, f.path), "utf8")]));
    const pins = controller ? spec.readPins(files, controller) : [];
    const manifest = `${ctx.module.out}/firmware.manifest.json`;
    const artifacts: ArtifactDef[] = [
      { id: "firmware_source", name: `${spec.framework} configuration (generated)`, type: "firmware", filePath: ctx.module.native, format: spec.framework, role: "source" },
      ...(existsSync(join(ctx.project.root, manifest)) ? [{ id: "firmware_manifest", name: "Firmware manifest", type: "firmware" as const, filePath: manifest, format: "json", mimeType: "application/json" }] : []),
    ];
    return { status: "succeeded", summary: `${pins.length} pin reference(s) read from ${Object.keys(files).length} files`, data: { artifacts, pins } };
  };

  const check: CapabilityOperationFn = (ctx): CapabilityResult => {
    const config = configOf(ctx);
    const p = plan(spec, ctx);
    const findings = [...p.findings];
    const index = readIndex(ctx);
    if (!index) {
      findings.push({ code: "FW_NOT_GENERATED", severity: "info", message: `no generated configuration in ${ctx.module.native}/ yet; run \`protoboard run firmware:generate --module ${ctx.module.id}\`` });
    } else if (p.controller) {
      const edited = editedFiles(ctx, index);
      for (const f of edited) findings.push({ code: "FW_NATIVE_EDITED", severity: "warning", message: `${ctx.module.native}/${f} was edited after generate; regenerate it (and move project settings into the application's own files)` });
      // stale: the model now gives different files; export refuses them, so this is an error
      for (const [f, why] of staleFiles(p, index, edited)) findings.push({ code: "FW_NATIVE_STALE", severity: "error", message: `${ctx.module.native}/${f} ${why}; run firmware:generate` });
      // pins named in the native files: on the pin table, and the ones the board wires
      const files = Object.fromEntries(index.files.filter((f) => existsSync(nativeAbs(ctx, f.path))).map((f) => [f.path, readFileSync(nativeAbs(ctx, f.path), "utf8")]));
      const refs = spec.readPins(files, p.controller);
      for (const r of refs.filter((r) => !r.pin)) {
        findings.push({ code: "FW_PIN_UNKNOWN", severity: "error", message: `${ctx.module.native}/${r.file}:${r.line} names ${r.ref}, which is not a pin of ${p.controller.id} (its pin table has no such GPIO)` });
      }
      // crystal and USB pins are fixed functions the files configure by name, not by pin
      const wanted = new Set(Object.entries(p.fw.uses).filter(([, u]) => u.some((x) => !/^(usb|crystal) /.test(x))).map(([pin]) => pin));
      const named = new Set(refs.filter((r) => r.pin).map((r) => r.pin!));
      const leafName = (id: string) => p.controller!.interfaces.find((i: InterfaceDef) => i.id === id)?.name ?? id;
      for (const pin of named) if (!wanted.has(pin)) findings.push({ code: "FW_PIN_DRIFT", severity: "error", message: `the native files use ${pin} (${leafName(pin)}), which no net of the board gives a firmware function` });
      for (const pin of wanted) if (!named.has(pin) && refs.length) findings.push({ code: "FW_PIN_DRIFT", severity: "error", message: `the board wires ${pin} (${leafName(pin)}) for ${p.fw.uses[pin].join(", ")}, but the native files do not configure it` });
    }
    return { status: "succeeded", summary: `${findings.filter((f) => f.severity === "error").length} error(s), ${findings.filter((f) => f.severity === "warning").length} warning(s)`, diagnostics: toDiagnostics(ctx, findings, config) };
  };

  return { generate, exportOutputs, extract, check };
}

/** For tests and tools: the files a provider would generate for a board, without writing them. */
export function previewFirmware(spec: FirmwareProviderSpec, ctx: Ctx): { files: RenderedFile[]; findings: FirmwareFinding[]; warnings: string[]; firmware: BoardFirmware } {
  const p = plan(spec, ctx);
  return { files: p.rendered, findings: p.findings, warnings: p.design?.warnings ?? [], firmware: p.fw };
}
