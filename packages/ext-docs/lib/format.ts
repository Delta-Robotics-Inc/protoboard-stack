/**
 * Deterministic value formatting. The verifier re-formats every re-queried
 * value with the same spec and compares strings, so all formatting of
 * model values goes through `formatValue`.
 *
 * Format spec (the `f` string, `|`-separated):
 *   d<n>        exactly n decimals          (d1 -> 22.2)
 *   s<n>        n significant digits max    (s3 -> 171.9 -> 172)
 *   si          scale by SI prefix          (400000 Hz -> 400 kHz)
 *   u=<unit>    unit override               (u=g)
 *   nounit      value only
 *   pct         multiply by 100, unit %
 *   hex         integer as 0x..
 *   x           "×" join for arrays          ([45, 41, 6] -> 45 × 41 × 6)
 *   upper       upper-case a string          (ccw -> CCW)
 */

export const NBSP = " ";

const UNIT_DISPLAY: Record<string, string> = {
  dimensionless: "",
  C: "°C",
  degC: "°C",
  deg: "°",
  ohm: "ohm",
  mohm: "mohm",
  "kbit/s": "kbit/s",
  uF: "\u03bcF",
  uA: "\u03bcA",
};

/** Characters the document fonts lack, mapped to look-alikes they have (µ → Greek mu, Σ → n-ary sum, Φ → Ø, Ω → ohm). */
export function glyphSafe(s: string): string {
  return s
    .replace(/\u00b5/g, "\u03bc")
    .replace(/\u03a3/g, "\u2211")
    .replace(/[\u03a6\u03c6]/g, "\u00d8")
    .replace(/\u03a9/g, " ohm")
    .replace(/\u221d/g, "~")
    .replace(/\u202f|\u2009/g, NBSP);
}

export function unitLabel(unit?: string): string {
  if (!unit) return "";
  return UNIT_DISPLAY[unit] ?? unit;
}

function groupThousands(s: string): string {
  const [int, frac] = s.split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.length > 4 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ") : digits;
  return (neg ? "−" : "") + grouped + (frac ? "." + frac : "");
}

export function formatNumber(v: number, opts: { d?: number; s?: number } = {}): string {
  if (!Number.isFinite(v)) return String(v);
  let s: string;
  if (opts.d !== undefined) s = v.toFixed(opts.d);
  else if (opts.s !== undefined) {
    const p = Number(v.toPrecision(opts.s));
    s = String(p);
    if (s.includes("e")) s = p.toFixed(0);
  } else {
    // default: up to 3 decimals, trailing zeros trimmed
    s = String(Number(v.toFixed(3)));
  }
  return groupThousands(s);
}

const SI: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
];

export interface FormatOpts {
  d?: number;
  s?: number;
  si?: boolean;
  unit?: string;
  nounit?: boolean;
  pct?: boolean;
  hex?: boolean;
  x?: boolean;
  upper?: boolean;
}

export function parseFormat(f?: string): FormatOpts {
  const o: FormatOpts = {};
  for (const part of (f ?? "").split("|").filter(Boolean)) {
    if (/^d\d+$/.test(part)) o.d = Number(part.slice(1));
    else if (/^s\d+$/.test(part)) o.s = Number(part.slice(1));
    else if (part === "si") o.si = true;
    else if (part === "nounit") o.nounit = true;
    else if (part === "pct") o.pct = true;
    else if (part === "hex") o.hex = true;
    else if (part === "x") o.x = true;
    else if (part === "upper") o.upper = true;
    else if (part.startsWith("u=")) o.unit = part.slice(2);
    else throw new Error(`unknown format token "${part}"`);
  }
  return o;
}

/** Format a model value (number, [min,max] range, string, boolean, array) with its unit. */
export function formatValue(value: unknown, unit?: string, f?: string): string {
  const o = parseFormat(f);
  let u = o.unit ?? unit;
  const num = (n: number): string => {
    let x = n;
    if (o.pct) x = n * 100;
    if (o.hex) return "0x" + Math.round(x).toString(16).toUpperCase().padStart(2, "0");
    return formatNumber(x, o);
  };
  const withUnit = (s: string, unitStr = u) => {
    const label = o.pct ? "%" : unitLabel(unitStr);
    if (o.nounit || !label) return s;
    return label === "°" ? s + label : s + NBSP + label;
  };

  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return glyphSafe(o.upper ? value.toUpperCase() : value);
  if (typeof value === "number") {
    if (o.si && u && !o.pct) {
      for (const [k, p] of SI) {
        if (Math.abs(value) >= k) return withUnit(formatNumber(value / k, o), p + u);
      }
    }
    return withUnit(num(value));
  }
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((x) => typeof x === "number") && !o.x) {
      const [a, b] = value as number[];
      if (o.si && u) {
        for (const [k, p] of SI) {
          if (Math.abs(a) >= k) return withUnit(`${formatNumber(a / k, o)}–${formatNumber(b / k, o)}`, p + u);
        }
      }
      return withUnit(`${num(a)}–${num(b)}`);
    }
    if (value.every((x) => typeof x === "number")) return withUnit((value as number[]).map(num).join(" × "));
    return value.map((x) => (typeof x === "number" ? num(x) : String(x))).join(", ");
  }
  if (typeof value === "object") {
    const o2 = value as Record<string, unknown>;
    // {min, typ, max}: a range, or the typical value with its limits
    if (typeof o2.min === "number" && typeof o2.max === "number") {
      const r = withUnit(`${num(o2.min)}–${num(o2.max)}`);
      return typeof o2.typ === "number" ? `${withUnit(num(o2.typ))} (${r})` : r;
    }
    // {length, width, height} and other all-number records: a size
    const vals = Object.values(o2);
    if (vals.length > 1 && vals.length <= 4 && vals.every((x) => typeof x === "number")) return withUnit((vals as number[]).map(num).join(" × "));
  }
  return JSON.stringify(value);
}

/** Unit symbols a key may end with (`weight_g`, `supply_V`), and how they are shown. */
const KEY_UNITS = /_(mAh|Wh|mm|mm2|cm|m|g|kg|V|A|mA|uA|W|mW|ms|us|s|min|h|Hz|kHz|MHz|GHz|dBm|dB|C|degC|deg|ohm|mohm|uF|nF|pF|uH|in|pct|rpm|Nm|N|Bd|bps|kbps|Mbps|Gbps|ml|mL|l|L)$/;
const KEY_UNIT_DISPLAY: Record<string, string> = { pct: "%", mm2: "mm²", Nm: "N·m", bps: "bit/s", kbps: "kbit/s", Mbps: "Mbit/s", Gbps: "Gbit/s", degC: "C", ml: "mL", l: "L" };

/**
 * Unit from a metadata key: its suffix (weight_g -> g, supply_V -> V,
 * operating_temperature_C -> C), a ratio (kv_rpm_per_V -> rpm/V,
 * density_g_cm3 -> g/cm³), a camel-case suffix (torqueNm -> N·m), or a key
 * that names its quantity (rpm, baud_rate -> Bd, hole_count -> count).
 */
export function unitFromKey(key: string): string | undefined {
  const per = key.match(/_([A-Za-z0-9]+)_per_([A-Za-z0-9]+)$/);
  if (per) return `${unitFromKey(`_${per[1]}`) ?? per[1]}/${unitFromKey(`_${per[2]}`) ?? per[2]}`;
  if (/_g_cm3$/.test(key)) return "g/cm³";
  if (/[a-z]Nm$/.test(key)) return "N·m";
  if (/^rpm$/i.test(key)) return "rpm";
  if (/(^|_)baud(_rate)?$/i.test(key)) return "Bd";
  if (/(^|_)count$|[a-z]Count$/.test(key)) return "count";
  const m = key.match(KEY_UNITS);
  if (!m) return undefined;
  return KEY_UNIT_DISPLAY[m[1]] ?? m[1];
}

/** The nearest unit along a path of keys, last key first (`lowest_latency_ms.goggles_3` -> ms). */
export function unitFromKeys(keys: string[]): string | undefined {
  for (let i = keys.length - 1; i >= 0; i--) {
    const u = unitFromKey(keys[i]);
    if (u) return u;
  }
  return undefined;
}

const isNumeric = (value: unknown): boolean =>
  typeof value === "number" ||
  (Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === "number")) ||
  (!!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).length > 0 && Object.values(value).every((x) => typeof x === "number"));

/**
 * The unit a formatted value shows, as its values.json records it: the
 * format's override (u=), its SI prefix (si: 6300 g shows as 6.3 kg) and %
 * (pct) applied to the model's unit; "count" for a whole number with no unit
 * (a count of mates, UARTs, props in a pack) and "dimensionless" for a
 * fraction with none (a ratio). Undefined for text. A value
 * shown without its unit (nounit, a table whose header names it) keeps it.
 */
export function displayUnit(value: unknown, unit?: string, f?: string): string | undefined {
  if (!isNumeric(value)) return undefined;
  const o = parseFormat(f);
  if (o.pct) return "%";
  if (o.hex) return unit ?? "dimensionless";
  const u = o.unit ?? unit;
  if (!u || u === "dimensionless") {
    const whole = (typeof value === "number" ? [value] : Array.isArray(value) ? value : Object.values(value as object)) as number[];
    // a whole number with no unit counts something; a fraction with none is a ratio (thrust-to-weight)
    return whole.every((x) => Number.isInteger(x)) ? (u ?? "count") : "dimensionless";
  }
  if (o.si) {
    const first = typeof value === "number" ? value : Array.isArray(value) ? (value[0] as number) : undefined;
    if (first !== undefined) for (const [k, p] of SI) if (Math.abs(first) >= k) return unitLabel(p + u) || p + u;
  }
  return unitLabel(u) || u;
}
