/**
 * Validator for `protoboard.reference-tool/v0` records (PB-1191). Hand-written
 * (no schema library): every rule says what is wrong in words a person can act
 * on. A record that fails is reported and left out of the registry; it never
 * stops a command that does not use it.
 */
import { REFERENCE_TOOL_KINDS, REFERENCE_TOOL_SCHEMA, UNITS, type ReferenceTool } from "./types.js";

/** File-name safe ids (no `< > : " / \ | ? *`, no trailing dot or space, never a Windows device name). */
export const REFERENCE_TOOL_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const EXACT_NPM_PIN = /@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A relative path that stays where it is put: no absolute path, no drive, no `..`, no characters Windows forbids. */
export function safeRelativePath(p: string): boolean {
  if (!p || p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return parts.every((s) => s !== "" && s !== "." && s !== ".." && !/[<>:"|?*\u0000-\u001f]/.test(s) && !/[. ]$/.test(s) && !RESERVED.test(s.replace(/\..*$/, "")));
}

/** Problems with a record (empty: valid). */
export function validateReferenceTool(x: unknown): string[] {
  const e: string[] = [];
  if (!isObj(x)) return ["not a JSON object"];
  if (x.schema !== REFERENCE_TOOL_SCHEMA) e.push(`schema must be "${REFERENCE_TOOL_SCHEMA}"`);
  if (!isStr(x.id) || !REFERENCE_TOOL_ID.test(x.id) || RESERVED.test(x.id)) e.push(`id must be 2-64 lower-case letters, digits and hyphens (it names evidence folders)`);
  if (!isStr(x.name)) e.push("name is required");
  if (!REFERENCE_TOOL_KINDS.includes(x.kind as never)) e.push(`kind must be one of ${REFERENCE_TOOL_KINDS.join(", ")}`);
  const physical = x.kind !== "software";
  if (!Array.isArray(x.nominal)) e.push("nominal must be a list (empty for software)");
  else {
    if (physical && !x.nominal.length) e.push("a physical reference needs at least one nominal dimension");
    const names = new Set<string>();
    x.nominal.forEach((d, i) => {
      const at = `nominal[${i}]`;
      if (!isObj(d)) return e.push(`${at} must be an object`);
      if (!isStr(d.name)) e.push(`${at}.name is required`);
      else if (names.has(d.name)) e.push(`${at}.name "${d.name}" is repeated`);
      else names.add(d.name);
      if (!finite(d.value) || d.value <= 0) e.push(`${at}.value must be a positive number`);
      if (!UNITS.includes(d.unit as never)) e.push(`${at}.unit must be one of ${UNITS.join(", ")}`);
      const t = d.tolerance;
      if (!isObj(t) || !finite(t.plus) || !finite(t.minus) || t.plus < 0 || t.minus < 0) e.push(`${at}.tolerance must be { plus, minus }, both >= 0 in the same unit`);
      if (!isStr(d.source) && d.assumption !== true) e.push(`${at} needs a source (a certificate, datasheet or the model file), or assumption: true with a note`);
    });
  }
  if (!isObj(x.source)) e.push("source is required ({ maker, url, certificate, ... })");
  else if (x.source.lcsc !== undefined && (!isStr(x.source.lcsc) || !/^C\d+$/.test(x.source.lcsc))) e.push("source.lcsc must be an LCSC C number (C12345)");
  if (x.model !== undefined) {
    const m = x.model;
    if (!isObj(m)) e.push("model must be an object");
    else {
      if (!isStr(m.path) || !safeRelativePath(m.path)) e.push("model.path must be a relative path inside the registry's folder (no `..`, no absolute path)");
      if (!isStr(m.sha256) || !SHA256.test(m.sha256)) e.push("model.sha256 must be sha256:<64 hex>");
      if (!["step", "stl", "3mf", "glb"].includes(m.format as string)) e.push("model.format must be step, stl, 3mf or glb");
      if (m.units !== "mm" && m.units !== "m") e.push("model.units must be mm or m");
    }
  }
  if (!isObj(x.evidence)) e.push("evidence is required ({ layout, photos })");
  else {
    if (!isStr(x.evidence.layout) || !x.evidence.layout.includes("<part>") || !x.evidence.layout.includes("<date>") || !x.evidence.layout.includes("<tool>")) e.push("evidence.layout must name <part>, <date> and <tool>");
    if (typeof x.evidence.photos !== "boolean") e.push("evidence.photos must be true or false");
  }
  if (x.kind === "software") {
    const s = x.software;
    if (!isObj(s)) e.push("a software reference needs software ({ homepage, license, relationship, ... })");
    else {
      if (!isStr(s.homepage) || !/^https:\/\//.test(s.homepage)) e.push("software.homepage must be an https URL");
      if (!isStr(s.license)) e.push("software.license is required");
      if (s.relationship !== "reference") e.push(`software.relationship must be "reference": Protoboard never bundles or hosts a reference tool`);
      if (!["browser", "desktop", "docker"].includes(s.runs as string)) e.push("software.runs must be browser, desktop or docker");
      if (!isStr(s.provenanceMethod)) e.push("software.provenanceMethod is required");
      for (const k of ["reads", "writes", "handoffs", "testedVersions"] as const) if (!Array.isArray(s[k])) e.push(`software.${k} must be a list`);
      if (s.mcp !== undefined) {
        const mcp = s.mcp;
        if (!isObj(mcp) || !isStr(mcp.command) || !Array.isArray(mcp.args) || mcp.transport !== "stdio") e.push("software.mcp must be { command, args, transport: stdio }");
        // supply chain: a server run through npx is pinned to an exact version
        else if (/^(npx|pnpm|bunx)$/.test(mcp.command) && !(mcp.args as unknown[]).some((a) => typeof a === "string" && /^[@a-z]/.test(a) && EXACT_NPM_PIN.test(a))) e.push("software.mcp runs a package through npx: pin it to an exact version (name@1.2.3)");
      }
    }
  } else if (x.software !== undefined) e.push("software is only for kind software");
  return e;
}

/** The record, or the problems. */
export function parseReferenceTool(x: unknown): { tool: ReferenceTool; errors: [] } | { tool?: undefined; errors: string[] } {
  const errors = validateReferenceTool(x);
  return errors.length ? { errors } : { tool: x as ReferenceTool, errors: [] };
}
