/**
 * Small text helpers shared by every writer: exact decimal millimeters from integer nanometers, CSV quoting, hashes.
 * Every writer builds its text from integers and these helpers only, so the same board gives the same bytes on every
 * machine (no float formatting of lengths, no locale, no clock).
 */
import { createHash } from "node:crypto";

/** Integer nanometers as millimeters with up to `decimals` digits (rounded half away from zero), trailing zeros trimmed. */
export function mmText(nm: number, decimals = 6): string {
  if (!Number.isFinite(nm)) throw new Error(`not a finite length: ${nm}`);
  const scale = 10 ** (6 - decimals);
  let v = Math.round(Math.abs(nm) / scale);
  if (Math.abs(nm) / scale - Math.floor(Math.abs(nm) / scale) === 0.5) v = Math.floor(Math.abs(nm) / scale) + 1;
  const neg = nm < 0 && v !== 0;
  const s = String(v).padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Like `mmText` with exactly `decimals` digits (no trimming): CSV columns that read better aligned. */
export function mmFixed(nm: number, decimals: number): string {
  const t = mmText(nm, decimals);
  const [i, f = ""] = t.split(".");
  return decimals ? `${i}.${f.padEnd(decimals, "0")}` : i;
}

/** Millidegrees as degrees with up to three decimals, trailing zeros trimmed. */
export function degText(mdeg: number): string {
  return mmText(mdeg * 1000, 3);
}

/** A CSV field: quoted when it holds a comma, quote, or line break. */
export function csvField(v: string | number | undefined): string {
  const s = v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (fields: (string | number | undefined)[]): string => fields.map(csvField).join(",");
export const tsvLine = (fields: (string | number | undefined)[]): string => fields.map((f) => String(f ?? "").replace(/[\t\r\n]/g, " ")).join("\t");

/** Parse one CSV line (quotes, doubled quotes); enough for reading back what `csvLine` wrote. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Text as UTF-8 bytes. */
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Natural order for designators: C2 before C10, then plain code-unit order. */
export function byDesignator(a: string, b: string): number {
  const ma = /^([A-Za-z_]*)(\d*)(.*)$/.exec(a)!;
  const mb = /^([A-Za-z_]*)(\d*)(.*)$/.exec(b)!;
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1;
  const na = ma[2] === "" ? -1 : Number(ma[2]);
  const nb = mb[2] === "" ? -1 : Number(mb[2]);
  if (na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A file name part with only letters, digits and `-_.` (no Windows-forbidden characters). */
export function safeName(s: string): string {
  const t = s
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return t || "board";
}
