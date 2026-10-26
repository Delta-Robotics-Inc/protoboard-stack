/**
 * The release configuration: `release` in protoboard.config.ts, or the
 * default export of release.config.ts beside it (not both).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { importTsFile, type ReleaseConfig } from "./util.ts";
import type { SectionDiagnostic } from "./types.ts";
import type { Project } from "@protoboardai/core";

export const RELEASE_CONFIG_FILE = "release.config.ts";

export function defineReleaseConfig(config: ReleaseConfig): ReleaseConfig {
  return config;
}

/** The project's release configuration, with problems that stop a release. */
export async function readReleaseConfig(p: Project): Promise<{ config: ReleaseConfig; source: string; diagnostics: SectionDiagnostic[] }> {
  const diagnostics: SectionDiagnostic[] = [];
  const bad = (message: string) => diagnostics.push({ code: "REL_CONFIG_INVALID", severity: "error", message });
  let config: ReleaseConfig = p.config.release ?? {};
  let source = p.config.release ? "protoboard.config.ts" : "(default: the root system only)";
  const file = join(p.root, RELEASE_CONFIG_FILE);
  if (existsSync(file)) {
    if (p.config.release) bad(`both protoboard.config.ts (release) and ${RELEASE_CONFIG_FILE} configure the release; keep one`);
    try {
      config = ((await importTsFile(file)) as { default?: ReleaseConfig }).default ?? {};
      source = RELEASE_CONFIG_FILE;
    } catch (e) {
      bad(`${RELEASE_CONFIG_FILE} does not evaluate: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  if (config.units !== undefined && !(Array.isArray(config.units) && config.units.every((u) => typeof u === "string"))) bad(`${source}: release.units must be a list of instance paths or module ids`);
  if (config.build !== undefined && !(Number.isInteger(config.build) && config.build >= 1)) bad(`${source}: release.build must be a whole number ≥ 1 (products to build)`);
  for (const [k, v] of Object.entries(config.spares ?? {})) {
    const ok = v && typeof v === "object" && (v.percent === undefined || (typeof v.percent === "number" && v.percent >= 0)) && (v.min === undefined || (Number.isInteger(v.min) && v.min >= 0));
    if (!ok) bad(`${source}: release.spares.${k} must be { percent?: number ≥ 0, min?: whole number ≥ 0 }`);
  }
  if (p.config.currency !== undefined && !(typeof p.config.currency === "string" && /^[A-Z]{3}$/.test(p.config.currency))) bad(`protoboard.config.ts: currency must be an ISO 4217 code such as "USD" (the supplier comparison quotes in it; the bill of materials and a release are in USD)`);
  (config.checks ?? []).forEach((c, i) => {
    const ok = c && ["check", "subject", "how", "pass", "record"].every((k) => typeof (c as unknown as Record<string, unknown>)[k] === "string" && (c as unknown as Record<string, string>)[k].trim()) && (c.group === undefined || c.group === "bringup" || c.group === "function") && (c.phase === undefined || c.phase === "power" || c.phase === "running");
    if (!ok) bad(`${source}: release.checks[${i}] needs check, subject, how, pass and record (strings); group "bringup" | "function"; phase "power" | "running"`);
  });
  return { config, source, diagnostics };
}
