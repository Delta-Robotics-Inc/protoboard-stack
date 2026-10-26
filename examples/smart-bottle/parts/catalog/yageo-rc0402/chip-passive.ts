/**
 * Parametric chip passives (PB-827): one catalog part per manufacturer
 * series and size (Yageo RC0402, Murata GRM155, …), whose value is chosen
 * per placement. Not a part: nothing here is exported from index.ts.
 *
 * The definition is an ordinary UHD passive (`pin_1`, `pin_2` passive
 * terminals, a `passive` trait). Its `passive` trait states the default
 * instance in UHD's own fields (`kind`, `value`, `unit`, `tolerance`), which
 * is what tools that do not know about overrides read, and adds the series:
 *
 *   parameters   UHD `Parameter`s of an instance, typed with units; `value`
 *                is the default instance's, `range` the series' limit where
 *                the source states one.
 *   choices      categorical parameters (an MLCC's dielectric).
 *   overridable  the keys a placement may set in `ChildModuleRef.overrides`
 *                (UHD's per-instance override record): parameter ids, choice
 *                ids and `part_number`.
 *   tolerances   the tolerance grades, each with its ordering code and the
 *                value range it is made in.
 *   part_number  the default MPN, the ordering-code pattern, and the code
 *                tables that decode an MPN into parameters.
 *
 * A board places one with
 *   { id: "r7", moduleDefId: "yageo-rc0402", overrides: { resistance: 4700, tolerance: 0.01 } }
 * and `resolvePassive(def, child.overrides)` gives that instance's value,
 * tolerance and part number, or the problems with the overrides.
 */
import type { InterfaceDef, ModuleDef, Parameter, PassiveTrait, TraitDef } from "@deltarobotics/uhd";
import { PassiveTerminal } from "@deltarobotics/uhd";

export interface ToleranceGrade {
  /** Fraction, as in `PassiveTrait.tolerance` (0.01 = ±1 %). */
  tolerance: number;
  /** Ordering-code letter. */
  code: string;
  /** Values this grade is made in, in the passive's unit. */
  range?: [number, number];
}

export interface PartNumberRule {
  /** The default instance's MPN. */
  default: string;
  /**
   * How the MPN is formed from the instance: `{value}` and `{tolerance}` are
   * replaced by their codes. Null when the MPN carries a manufacturer control
   * code that no parameter decides (Murata GRM): the placement names it.
   */
  pattern: string | null;
  /** How `{value}` is written: R/K/M as the decimal point (Yageo), or three EIA digits (significand and zeros) in pF or Ω. */
  value_code: "rkm" | "eia3_pf" | "eia3_ohm";
  /** Decodes an MPN: a regular expression whose named groups are code-table keys or `value`. */
  decode?: string;
  /** Code tables used by `decode`: group name -> code -> value. */
  codes?: Record<string, Record<string, number | string>>;
  source: string;
}

export interface PassiveSeriesParams {
  kind: PassiveTrait["params"]["kind"];
  value: number;
  unit: PassiveTrait["params"]["unit"];
  tolerance?: number;
  source?: string;
  series: string;
  parameters: Parameter[];
  choices?: Record<string, { values: string[]; default: string; source: string }>;
  overridable: string[];
  tolerances?: ToleranceGrade[];
  part_number: PartNumberRule;
  /** Only these values exist (a ferrite bead's impedance table), each with its own MPN code. */
  values?: { value: number; code: string; parameters?: Record<string, number> }[];
}

/** The two terminals; the chip has no polarity and its maker numbers neither end. */
export function chipTerminals(source: string): InterfaceDef[] {
  return [1, 2].map((n) => ({
    ...PassiveTerminal(n),
    traits: [
      {
        type: "pin_functions",
        params: {
          description: `Termination ${n} (${n === 1 ? "-X" : "+X"} end in the model). The part has no polarity and the manufacturer numbers neither end; the designator is this model's.`,
          source,
        },
      },
    ],
  }));
}

/** The soldered terminations onto the board. */
export function chipMount(name: string, note: string, source: string): InterfaceDef {
  return {
    id: "pcb_mount",
    name,
    domain: "mechanical",
    exposed: true,
    default_active: true,
    protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
    capabilities: ["surface_mount"],
    traits: [{ type: "connector", params: { connector_type: "smd_2_terminal", note, source } }],
  };
}

// ---------------------------------------------------------------------------
// Value codes
// ---------------------------------------------------------------------------

const trim = (n: number) => String(Number(n.toPrecision(3)));

/** Yageo RC: R, K or M as the decimal point (97R6, 9K76, 10K, 1M). */
export function rkmCode(ohms: number): string {
  const [div, letter] = ohms >= 1e6 ? [1e6, "M"] : ohms >= 1e3 ? [1e3, "K"] : [1, "R"];
  const [whole, frac = ""] = trim(ohms / div).split(".");
  return `${whole}${letter}${frac}`;
}

/** Three EIA digits: two significant figures and the number of zeros (104 = 10 × 10⁴). */
export function eia3Code(value: number): string | undefined {
  if (value < 10) return undefined;
  const zeros = Math.floor(Math.log10(value)) - 1;
  const sig = Math.round(value / 10 ** zeros);
  if (Math.abs(sig * 10 ** zeros - value) > 1e-9 * value || sig >= 100) return undefined;
  return `${sig}${zeros}`;
}

const eia3Value = (code: string) => Number(code.slice(0, 2)) * 10 ** Number(code[2]);

/** Inverse of `rkmCode`: 4K7 = 4700. */
export function rkmValue(code: string): number | undefined {
  const m = /^(\d*)([RKM])(\d*)$/.exec(code);
  if (!m || !(m[1] || m[3])) return undefined;
  return Number(`${m[1] || "0"}.${m[3] || "0"}`) * { R: 1, K: 1e3, M: 1e6 }[m[2] as "R" | "K" | "M"];
}

function decodeValue(rule: PartNumberRule, code: string): number | undefined {
  if (rule.value_code === "rkm") return rkmValue(code);
  if (!/^\d{3}$/.test(code)) return undefined;
  return rule.value_code === "eia3_pf" ? eia3Value(code) * 1e-12 : eia3Value(code);
}

function valueCode(rule: PartNumberRule, value: number): string | undefined {
  if (rule.value_code === "rkm") return rkmCode(value);
  if (rule.value_code === "eia3_pf") return eia3Code(Math.round(value * 1e12 * 1e6) / 1e6);
  return eia3Code(value);
}

// ---------------------------------------------------------------------------
// Resolving one placement
// ---------------------------------------------------------------------------

export interface ResolvedPassive {
  kind: PassiveTrait["params"]["kind"];
  value: number;
  unit: PassiveTrait["params"]["unit"];
  tolerance?: number;
  part_number: string;
  /** Every parameter and choice of the instance, by id. */
  parameters: Record<string, number | string>;
  problems: string[];
}

/** The `passive` trait of a series part, or undefined for a fixed passive or any other part. */
export function passiveSeries(def: ModuleDef): PassiveSeriesParams | undefined {
  const t = def.traits?.find((x: TraitDef) => x.type === "passive");
  const p = t?.params as Partial<PassiveSeriesParams> | undefined;
  return p?.parameters && p.overridable && p.part_number ? (p as PassiveSeriesParams) : undefined;
}

const VALUE_PARAMETER: Record<PassiveTrait["params"]["kind"], string> = {
  resistor: "resistance",
  capacitor: "capacitance",
  inductor: "inductance",
  ferrite_bead: "impedance_100mhz",
};

/**
 * One placement of a series part: the default instance with
 * `ChildModuleRef.overrides` applied and checked against the series.
 */
export function resolvePassive(def: ModuleDef, overrides: Record<string, unknown> = {}): ResolvedPassive {
  const s = passiveSeries(def);
  if (!s) throw new Error(`${def.id} is not a parametric passive`);
  const problems: string[] = [];
  const valueId = VALUE_PARAMETER[s.kind];
  const parameters: Record<string, number | string> = {};
  for (const p of s.parameters) if (p.value !== undefined) parameters[p.id] = p.value;
  for (const [id, c] of Object.entries(s.choices ?? {})) parameters[id] = c.default;
  if (s.tolerance !== undefined) parameters.tolerance = s.tolerance;

  for (const [key, v] of Object.entries(overrides)) {
    if (!s.overridable.includes(key)) {
      problems.push(`${key} is not an instance parameter of ${def.id} (overridable: ${s.overridable.join(", ")})`);
      continue;
    }
    if (key === "part_number") {
      if (typeof v !== "string" || !v) problems.push("part_number must be a non-empty string");
      continue;
    }
    const choice = s.choices?.[key];
    if (choice) {
      if (typeof v !== "string" || !choice.values.includes(v)) problems.push(`${key} ${JSON.stringify(v)} is not one of ${choice.values.join(", ")}`);
      else parameters[key] = v;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      problems.push(`${key} must be a number`);
      continue;
    }
    const param = s.parameters.find((p) => p.id === key);
    if (param?.range && (v < param.range[0] || v > param.range[1])) {
      problems.push(`${key} ${v} ${param.unit} is outside the series range ${param.range[0]}–${param.range[1]} ${param.unit}`);
    }
    parameters[key] = v;
  }

  // tolerance grade, and the value range it is made in
  const value = Number(parameters[valueId] ?? s.value);
  const tolerance = parameters.tolerance as number | undefined;
  const grade = s.tolerances?.find((g) => Math.abs(g.tolerance - (tolerance ?? NaN)) < 1e-12);
  if (s.tolerances && !grade) problems.push(`tolerance ${tolerance} is not a grade of the series (${s.tolerances.map((g) => g.tolerance).join(", ")})`);
  if (grade?.range && (value < grade.range[0] || value > grade.range[1])) {
    problems.push(`${valueId} ${value} ${s.unit} is not made at ±${(grade.tolerance * 100).toPrecision(2).replace(/\.?0+$/, "")} % (${grade.range[0]}–${grade.range[1]} ${s.unit})`);
  }

  // a table series: the value must be a row, which fixes its other parameters
  const row = s.values?.find((r) => Math.abs(r.value - value) < 1e-9 * Math.max(1, value));
  if (s.values && !row) problems.push(`${valueId} ${value} ${s.unit} is not made in this series (${s.values.map((r) => r.value).join(", ")})`);
  if (row?.parameters) Object.assign(parameters, row.parameters);

  // part number: named, or formed from the pattern
  const rule = s.part_number;
  let partNumber = typeof overrides.part_number === "string" ? overrides.part_number : undefined;
  const changed = Object.keys(overrides).some((k) => k !== "part_number");
  if (!partNumber) {
    if (!changed) partNumber = rule.default;
    else if (rule.pattern) {
      const code = row?.code ?? valueCode(rule, value);
      if (!code) problems.push(`no ordering code for ${valueId} ${value} ${s.unit}`);
      partNumber = rule.pattern.replace("{value}", code ?? "?").replace("{tolerance}", grade?.code ?? "?");
    } else {
      problems.push(`${def.id}: name the exact part_number for a non-default instance (the MPN carries a manufacturer control code no parameter decides)`);
      partNumber = "";
    }
  }

  // a named or formed MPN must agree with the parameters
  if (partNumber && rule.decode) {
    const m = new RegExp(rule.decode).exec(partNumber);
    if (!m?.groups) problems.push(`part_number ${partNumber} is not a ${s.series} ordering code`);
    else {
      for (const [group, code] of Object.entries(m.groups)) {
        if (code === undefined) continue;
        const decoded = group === "value" ? decodeValue(rule, code) : rule.codes?.[group]?.[code];
        const id = group === "value" ? valueId : group;
        if (decoded === undefined) continue;
        const have = parameters[id];
        const same = typeof decoded === "number" && typeof have === "number" ? Math.abs(decoded - have) <= 1e-6 * Math.max(Math.abs(decoded), 1e-15) : decoded === have;
        if (!same) problems.push(`part_number ${partNumber} says ${id} ${decoded}, the instance has ${have}`);
      }
    }
  }

  return {
    kind: s.kind,
    value,
    unit: s.unit,
    ...(tolerance !== undefined ? { tolerance } : {}),
    part_number: partNumber,
    parameters,
    problems,
  };
}

/** The `passive` trait of a series part. */
export function seriesTrait(params: PassiveSeriesParams): TraitDef {
  return { type: "passive", params: { ...params } as Record<string, unknown> };
}
