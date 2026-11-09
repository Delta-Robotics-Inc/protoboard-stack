/**
 * Canonical JSON for the board files and for hashing: object keys in code-unit order (except that a record's
 * `kind` and `id` come first), arrays in their own order, no spaces. The same value always gives the same text.
 */
import { createHash } from "node:crypto";

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Code-unit order (what `Array.prototype.sort` does with no comparator), independent of locale. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function write(value: unknown, top: boolean): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => write(v, false)).join(",")}]`;
  if (isPlain(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    keys.sort(byCodeUnit);
    if (top) {
      for (const first of ["id", "kind"]) {
        const i = keys.indexOf(first);
        if (i >= 0) {
          keys.splice(i, 1);
          keys.unshift(first);
        }
      }
    }
    return `{${keys.map((k) => `${JSON.stringify(k)}:${write(value[k], false)}`).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  throw new Error(`cannot write ${typeof value} as canonical JSON`);
}

/** Canonical JSON of a record: `kind`, `id`, then the other keys sorted; nested keys sorted. */
export const canonicalRecord = (value: unknown): string => write(value, true);
/** Canonical JSON of any value: every object's keys sorted. */
export const canonical = (value: unknown): string => write(value, false);

export const sha1Hex = (text: string): string => createHash("sha1").update(text).digest("hex");
export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Structural equality through canonical JSON (records are small; this is the simplest exact test). */
export const sameValue = (a: unknown, b: unknown): boolean => (a === b ? true : a === undefined || b === undefined ? false : canonical(a) === canonical(b));

/** Freeze a value and everything inside it. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
