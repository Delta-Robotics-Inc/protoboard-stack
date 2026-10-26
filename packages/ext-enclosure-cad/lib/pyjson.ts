/**
 * Python's `json.dumps(value, sort_keys=True)` with its defaults
 * (`ensure_ascii=True`, separators `", "` and `": "`), for a value that came
 * from JSON. The generator's `sourceDigest` hashes this text, so the check can
 * recompute it without running Python (PB-809).
 *
 * Numbers: JSON integers stay integers in Python (`5`); every other number is
 * a float, written as Python's `repr` (shortest round-trip digits, exponent
 * form below 1e-4 and from 1e16, `.0` on a whole float). A value parsed by
 * JavaScript has lost whether `5.0` was written with a point: the job files
 * are written by JavaScript, which never writes one.
 */
export function pyJsonDumps(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return pyNumber(value);
  if (typeof value === "string") return pyString(value);
  if (Array.isArray(value)) return `[${value.map(pyJsonDumps).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${pyString(k)}: ${pyJsonDumps((value as Record<string, unknown>)[k])}`).join(", ")}}`;
  }
  throw new Error(`pyJsonDumps: cannot write ${typeof value}`);
}

function pyString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

function pyNumber(n: number): string {
  if (!Number.isFinite(n)) return Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity";
  // JSON.stringify writes whole numbers below 1e21 without a point or exponent: Python reads those as int
  const js = JSON.stringify(n);
  if (/^-?\d+$/.test(js)) return js;
  // a float: shortest digits and exponent, then Python's repr layout
  const [mant, expText] = n.toExponential().split("e");
  const exp = Number(expText);
  const neg = mant.startsWith("-");
  const digits = mant.replace("-", "").replace(".", "");
  let body: string;
  if (exp < -4 || exp >= 16) {
    body = digits[0] + (digits.length > 1 ? "." + digits.slice(1) : "") + "e" + (exp < 0 ? "-" : "+") + String(Math.abs(exp)).padStart(2, "0");
  } else if (exp < 0) {
    body = "0." + "0".repeat(-exp - 1) + digits;
  } else {
    const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
    const frac = digits.slice(exp + 1);
    body = intPart + "." + (frac || "0");
  }
  return (neg ? "-" : "") + body;
}
