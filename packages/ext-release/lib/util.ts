/** Small shared helpers: digests, CSV, file import, paths. */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export type { ReleaseConfig } from "@protoboardai/core";

export const sha256 = (bytes: string | Buffer) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
export const posix = (p: string) => p.split("\\").join("/");

/** Import a TypeScript file (the CLI runs under tsx), bypassing the module cache. */
export async function importTsFile(file: string): Promise<Record<string, unknown>> {
  return (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as Record<string, unknown>;
}

/** One RFC 4180 field. */
export function csvField(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a header row from `columns`; LF line ends, final newline. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.map(csvField).join(","), ...rows.map((r) => columns.map((c) => csvField(r[c])).join(","))].join("\n") + "\n";
}

/** Compare strings by code point (locale-independent, so sorting is the same on every machine). */
export const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Format a number with up to `digits` decimals, trailing zeros removed. */
export const num = (v: number, digits = 2) => String(Number(v.toFixed(digits)));
