/**
 * Net classes and design rules from the files beside a KiCad board: the project file (`.kicad_pro`, JSON:
 * `net_settings`, `board.design_settings.rules` and `rule_severities`) and the custom rules file (`.kicad_dru`,
 * S-expressions). The mapping follows how KiCad 10 evaluates constraints, as confirmed by running `kicad-cli pcb drc`
 * on small boards (the precedence model is in packages/board-checks/README.md):
 *
 * - for one constraint type on one object or pair, the LAST matching custom rule in the file wins, over earlier
 *   custom rules and over every net class value and board setup minimum; a later rule with a smaller minimum relaxes
 *   an earlier, larger one. Custom rules become rules with `priority` 1000 plus their position in the file;
 * - with no matching custom rule, the largest of the board setup minimum, the net class clearance of each object and
 *   a zone's own clearance applies. Board setup minimums and net class clearances become `floor` rules at priority 0
 *   (provenance `from`: `board setup`, `net class <name>`); a zone's clearance stays on the zone (an implicit floor
 *   at priority 0 in the checks);
 * - board setup values absent from the project take KiCad 10's defaults (copper to edge 0.5 mm, track width 0.2 mm,
 *   via diameter 0.5 mm, hole 0.3 mm, annular ring 0.1 mm, hole clearance 0.25 mm, hole to hole 0.25 mm);
 * - net class track widths, via sizes and diff pair gaps are routing defaults, not checked by KiCad's DRC: they become
 *   `target` rules with only `preferred`, as does a custom rule's `opt`;
 * - severity: the rule's own `(severity)`, else the project's `rule_severities` for the KiCad violation type, else
 *   KiCad's default for that type;
 * - keep-out rule areas are keep-out records (a disallow at priority 0); a custom `disallow` rule overrides them.
 *
 * Anything else is reported by name as not evaluated (`notEvaluated`), never guessed.
 */
import type { CopperLayer, NetclassRec, RuleCondition, RuleRec } from "@protoboardai/board";
import type { Reporter } from "../report.js";
import { isList, parseSexprAll, str, type SList } from "../sexpr.js";
import { kicadCondition, UnsupportedCondition } from "./condition.js";

const prov = (from: string) => ({ by: "imported" as const, tool: "kicad", from: from.slice(0, 200) });

export interface MappedRules {
  netclasses: NetclassRec[];
  rules: RuleRec[];
  /** net name -> our class name, for the netlist. */
  netClass: Map<string, string>;
  /** Rules and settings of the source that no rule can express: by name, with the reason. Never evaluated. */
  notEvaluated: { name: string; reason: string }[];
}

const nm = (mmValue: number) => Math.round(mmValue * 1_000_000);
const ruleKey = (s: string) => s.replace(/[^A-Za-z0-9_.\-/+~]+/g, "_").replace(/^_+|_+$/g, "") || "rule";
const className = (s: string) => s.replace(/[^A-Za-z0-9_.\-+]+/g, "_") || "class";

/** KiCad wildcard to a RegExp (`*` any run, `?` one character). */
const wildcard = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
/** Whether a pattern uses only wildcards (anything else may be a regular expression, which is not mapped). */
const isWildcard = (p: string) => !/[[\]()|^$\\{}]/.test(p);

interface KicadClass {
  name: string;
  priority?: number;
  clearance?: number | null;
  track_width?: number | null;
  via_diameter?: number | null;
  via_drill?: number | null;
  diff_pair_gap?: number | null;
  [k: string]: unknown;
}

/** The KiCad violation type each check is reported under (for its severity). */
export const KICAD_VIOLATION_TYPE: Partial<Record<RuleRec["check"], string>> = {
  clearance: "clearance",
  physical_clearance: "clearance",
  track_width: "track_width",
  via_diameter: "via_diameter",
  via_hole: "drill_out_of_range",
  hole_size: "drill_out_of_range",
  annular_ring: "annular_width",
  hole_clearance: "hole_clearance",
  hole_to_hole: "hole_to_hole",
  edge_clearance: "copper_edge_clearance",
  disallow: "items_not_allowed",
  diff_pair_gap: "diff_pair_gap_out_of_range",
  length: "length_out_of_range",
};
/**
 * KiCad 10's default severity of a violation type when the project does not set one: observed with kicad-cli on
 * boards with no `rule_severities` (hole_to_hole a warning, the rest errors); diff pair and length assumed errors.
 */
const KICAD_DEFAULT_SEVERITY: Record<string, "error" | "warning"> = {
  clearance: "error",
  track_width: "error",
  via_diameter: "error",
  drill_out_of_range: "error",
  annular_width: "error",
  hole_clearance: "error",
  hole_to_hole: "warning",
  copper_edge_clearance: "error",
  items_not_allowed: "error",
  diff_pair_gap_out_of_range: "error",
  length_out_of_range: "error",
};

/** Net class values that DRC checks (floors) and those that are routing defaults only (preferred). */
const CLASS_FLOORS: Record<string, RuleRec["check"]> = { clearance: "clearance" };
const CLASS_PREFERRED: Record<string, RuleRec["check"]> = { track_width: "track_width", via_diameter: "via_diameter", via_drill: "via_hole", diff_pair_gap: "diff_pair_gap" };
/** Class fields that are rules we cannot express (microvia sizes, diff pair width and via gap). */
const CLASS_UNMAPPED = ["uvia_diameter", "uvia_drill", "microvia_diameter", "microvia_drill", "diff_pair_width", "diff_pair_via_gap"];

/** Board setup constraints that map to floor rules, with KiCad 10's default when the project leaves one out. */
const BOARD_FIELDS: Record<string, { check: RuleRec["check"]; kicadDefault: number }> = {
  min_clearance: { check: "clearance", kicadDefault: 0 },
  min_track_width: { check: "track_width", kicadDefault: 0.2 },
  min_via_diameter: { check: "via_diameter", kicadDefault: 0.5 },
  min_through_hole_diameter: { check: "hole_size", kicadDefault: 0.3 },
  min_via_annular_width: { check: "annular_ring", kicadDefault: 0.1 },
  min_hole_clearance: { check: "hole_clearance", kicadDefault: 0.25 },
  min_hole_to_hole: { check: "hole_to_hole", kicadDefault: 0.25 },
  min_copper_edge_clearance: { check: "edge_clearance", kicadDefault: 0.5 },
};
/** Board setup values that are not rules at all. */
const BOARD_NOT_RULES = new Set(["max_error", "use_height_for_length_calcs", "solder_mask_to_copper_clearance", "allow_microvias", "allow_blind_buried_vias"]);

/** Custom rule constraints that map one to one, and the checks they become. */
const DRU_CONSTRAINTS: Record<string, RuleRec["check"]> = {
  clearance: "clearance",
  physical_clearance: "physical_clearance",
  track_width: "track_width",
  via_diameter: "via_diameter",
  hole_size: "hole_size",
  annular_width: "annular_ring",
  edge_clearance: "edge_clearance",
  hole_clearance: "hole_clearance",
  hole_to_hole: "hole_to_hole",
  diff_pair_gap: "diff_pair_gap",
  length: "length",
};
/** `disallow` item types and the object kinds they disallow. */
const DISALLOW_KINDS: Record<string, "track" | "via" | "pad" | "zone" | "footprint"> = { track: "track", via: "via", through_via: "via", blind_via: "via", buried_via: "via", micro_via: "via", pad: "pad", zone: "zone", footprint: "footprint" };

/** A length with a unit (`0.2mm`, `8mil`, `0.1in`, `100um`); a bare number is millimeters. Returns nanometers. */
export function parseLength(s: string): number | undefined {
  const m = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*(mm|mil|mils|in|um|nm)?\s*$/i.exec(s);
  if (!m) return undefined;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return undefined;
  const unit = (m[2] ?? "mm").toLowerCase();
  const perMm = unit === "mm" ? 1 : unit === "mil" || unit === "mils" ? 0.0254 : unit === "in" ? 25.4 : unit === "um" ? 0.001 : 0.000001;
  return Math.round(v * perMm * 1_000_000);
}

type KicadSeverity = "error" | "warning" | "ignore";

export function mapKicadRules(input: { project?: string; dru?: string; nets: readonly string[]; copper: readonly CopperLayer[]; copperOf?: (kicadLayer: string) => CopperLayer | undefined }, rep: Reporter): MappedRules {
  const out: MappedRules = { netclasses: [], rules: [], netClass: new Map(), notEvaluated: [] };
  const usedRuleIds = new Set<string>();
  let severities: Record<string, unknown> = {};
  /** The severity a rule of a check gets with no `(severity)` of its own, as our field (undefined: the tier's default). */
  const severityFor = (check: RuleRec["check"], tier: RuleRec["tier"], own?: KicadSeverity): RuleRec["severity"] | undefined => {
    const type = KICAD_VIOLATION_TYPE[check];
    const projectSev = type ? severities[type] : undefined;
    const s: KicadSeverity = own ?? (projectSev === "error" || projectSev === "warning" || projectSev === "ignore" ? projectSev : type ? (KICAD_DEFAULT_SEVERITY[type] ?? "error") : "error");
    const tierDefault = tier === "floor" || tier === "no_go" ? "error" : "warning";
    return s === tierDefault ? undefined : s;
  };
  const addRule = (r: Omit<RuleRec, "kind" | "id" | "provenance">, key: string, from: string) => {
    let id = `rule:${ruleKey(key)}`;
    for (let n = 2; usedRuleIds.has(id); n++) id = `rule:${ruleKey(key)}~${n}`;
    usedRuleIds.add(id);
    out.rules.push({ kind: "rule", id, ...r, provenance: prov(from) });
  };
  const notEvaluated = (name: string, reason: string, source?: string) => {
    out.notEvaluated.push({ name, reason });
    rep.dropped("rule not evaluated", `${name}: ${reason}`, source ? { source } : undefined);
  };
  const classNames = new Map<string, string>(); // KiCad name -> ours

  let pro: { net_settings?: { classes?: KicadClass[]; netclass_patterns?: { netclass: string; pattern: string }[]; netclass_assignments?: Record<string, string | string[]> | null }; board?: { design_settings?: { rules?: Record<string, unknown>; rule_severities?: Record<string, unknown> } } } | undefined;
  if (input.project !== undefined) {
    try {
      pro = JSON.parse(input.project);
    } catch (e) {
      rep.dropped("project file", `not JSON (${(e as Error).message}); net classes and rules not read, KiCad's default board constraints used`);
    }
  }
  severities = pro?.board?.design_settings?.rule_severities ?? {};
  if (pro) {
    // ---- net classes
    const classes = pro.net_settings?.classes ?? [];
    const used = new Set<string>();
    for (const c of classes) {
      if (typeof c?.name !== "string") continue;
      let ours = c.name === "Default" ? "default" : className(c.name);
      for (let n = 2; used.has(ours); n++) ours = `${className(c.name)}_${n}`;
      used.add(ours);
      classNames.set(c.name, ours);
      if (ours !== c.name && c.name !== "Default") rep.approximated("net class renamed", "class names use letters, digits and _ . - +", { source: `${c.name} -> ${ours}` });
    }
    // net -> KiCad class: explicit assignment, else the matching pattern of the highest-priority class (lowest number)
    const priority = (name: string) => classes.find((c) => c.name === name)?.priority ?? Number.MAX_SAFE_INTEGER;
    const patterns = (pro.net_settings?.netclass_patterns ?? []).filter((p) => typeof p?.pattern === "string" && typeof p?.netclass === "string");
    const assignments = pro.net_settings?.netclass_assignments ?? {};
    const patternsByClass = new Map<string, string[]>();
    for (const p of patterns) {
      if (!classNames.has(p.netclass)) {
        rep.dropped("net class pattern", "names a class the project does not define", { source: p.netclass });
        continue;
      }
      if (!isWildcard(p.pattern)) {
        rep.dropped("net class pattern", "looks like a regular expression; only * and ? wildcards are mapped", { source: p.pattern });
        continue;
      }
      const l = patternsByClass.get(p.netclass) ?? [];
      l.push(p.pattern);
      patternsByClass.set(p.netclass, l);
    }
    let multi = 0;
    for (const net of input.nets) {
      const explicit = assignments?.[net];
      let cls: string | undefined;
      if (explicit !== undefined) {
        const list = Array.isArray(explicit) ? explicit : [explicit];
        if (list.length > 1) multi++;
        cls = list.find((x) => classNames.has(x));
      }
      if (!cls) {
        const matching = [...patternsByClass.entries()].filter(([, ps]) => ps.some((p) => wildcard(p).test(net))).map(([c]) => c);
        if (matching.length > 1) multi++;
        cls = matching.sort((a, b) => priority(a) - priority(b))[0];
      }
      if (cls && cls !== "Default") out.netClass.set(net, classNames.get(cls)!);
    }
    if (multi) rep.approximated("net in several net classes", "KiCad merges the values of every class a net is in; here the net takes its highest-priority class", { count: multi });
    for (const c of classes) {
      const ours = classNames.get(c.name);
      if (!ours) continue;
      if (c.name !== "Default") {
        const nets = [...out.netClass.entries()].filter(([, k]) => k === ours).map(([n]) => n).sort();
        const pats = patternsByClass.get(c.name) ?? [];
        out.netclasses.push({ kind: "netclass", id: `class:${ours}`, name: ours, ...(nets.length ? { nets } : {}), ...(pats.length ? { patterns: pats.slice(0, 100) } : {}), provenance: prov(`net class ${c.name}`) });
        if (pats.length > 100) rep.dropped("net class pattern", "more than 100 patterns in one class", { count: pats.length - 100, source: ours });
      }
      // a class value applies to the nets of that class (the Default class's to nets of no other class)
      const applies = { classes: [ours] };
      for (const [field, check] of Object.entries(CLASS_FLOORS)) {
        const v = c[field];
        if (typeof v !== "number" || !(v > 0)) continue;
        const severity = severityFor(check, "floor");
        addRule({ tier: "floor", check, priority: 0, applies, min: nm(v), ...(severity ? { severity } : {}), note: `KiCad net class ${c.name}: ${field}` }, `kicad.class.${ours}.${check}`, `net class ${c.name}`);
      }
      for (const [field, check] of Object.entries(CLASS_PREFERRED)) {
        const v = c[field];
        if (typeof v !== "number" || !(v > 0)) continue;
        addRule({ tier: "target", check, priority: 0, applies, preferred: nm(v), note: `KiCad net class ${c.name}: ${field} (a routing default; KiCad's DRC does not check it)` }, `kicad.class.${ours}.${check}`, `net class ${c.name}`);
      }
      for (const field of CLASS_UNMAPPED)
        if (typeof c[field] === "number" && (c[field] as number) > 0) rep.dropped("net class value", "no rule check expresses it (microvia sizes, diff pair width and via gap)", { source: `${ours}.${field}` });
      if (typeof c.tuning_profile === "string" && c.tuning_profile) rep.dropped("net class value", "tuning profiles are not modeled", { source: `${ours}.tuning_profile` });
    }
    if (patternsByClass.size) rep.info("net class pattern", "kept for nets added later; the nets the board has now are listed in each class explicitly (KiCad's priority order applied)", { count: [...patternsByClass.values()].reduce((s, l) => s + l.length, 0) });
  }

  // ---- board setup constraints (KiCad's defaults where the project leaves a value out, or there is no project)
  const setup = pro?.board?.design_settings?.rules ?? {};
  for (const [k, map] of Object.entries(BOARD_FIELDS)) {
    const given = setup[k];
    const v = typeof given === "number" ? given : map.kicadDefault;
    if (typeof given !== "number") rep.info("board setup value", `absent from the project; KiCad 10's default ${map.kicadDefault} mm used`, { source: k });
    if (!(v > 0)) continue;
    const severity = severityFor(map.check, "floor");
    addRule({ tier: "floor", check: map.check, priority: 0, applies: {}, min: nm(v), ...(severity ? { severity } : {}), note: `KiCad board setup ${k}${typeof given === "number" ? "" : " (KiCad's default)"}` }, `kicad.board.${k}`, typeof given === "number" ? "board setup" : "board setup (KiCad default)");
  }
  for (const [k, v] of Object.entries(setup)) {
    if (BOARD_FIELDS[k] || BOARD_NOT_RULES.has(k)) continue;
    if ((typeof v === "number" && v !== 0) || v === true) notEvaluated(`board setup ${k}`, "no rule check expresses it", k);
  }

  if (input.dru !== undefined) mapDru(input.dru, { classNames, copper: input.copper, copperOf: input.copperOf, addRule, severityFor, notEvaluated }, rep);
  return out;
}

interface DruCtx {
  classNames: Map<string, string>;
  copper: readonly CopperLayer[];
  copperOf?: (kicadLayer: string) => CopperLayer | undefined;
  addRule: (r: Omit<RuleRec, "kind" | "id" | "provenance">, key: string, from: string) => void;
  severityFor: (check: RuleRec["check"], tier: RuleRec["tier"], own?: KicadSeverity) => RuleRec["severity"] | undefined;
  notEvaluated: (name: string, reason: string, source?: string) => void;
}

/** Custom rules come after every net class and board setup rule: priority 1000 plus the rule's position in the file. */
export const CUSTOM_RULE_PRIORITY = 1000;

function mapDru(text: string, ctx: DruCtx, rep: Reporter): void {
  let lists: SList[];
  try {
    lists = parseSexprAll(text, { comments: true });
  } catch (e) {
    rep.dropped("custom rules file", `could not be read (${(e as Error).message}); KiCad drops a file that does not parse too`);
    return;
  }
  const copperOf = (l: string): CopperLayer | undefined => ctx.copperOf?.(l) ?? (l === "F.Cu" ? "top" : l === "B.Cu" ? "bottom" : /^In(\d+)\.Cu$/.test(l) ? ctx.copper.find((x) => x === `inner${l.replace(/\D/g, "")}`) : undefined);
  let mapped = 0;
  let position = 0;
  for (const rule of lists) {
    if (rule[0] === "version") continue;
    if (rule[0] !== "rule") {
      rep.dropped("custom rules item", "not a rule", { source: `line ${rule.line}` });
      continue;
    }
    position++;
    const name = str(rule[1]) ?? `rule ${position}`;
    const src = `line ${rule.line}`;
    const label = `custom rule '${name}'`;
    const priority = CUSTOM_RULE_PRIORITY + position;
    const applies: RuleRec["applies"] = {};
    let when: RuleCondition | undefined;
    let severity: KicadSeverity | undefined;
    const constraints: SList[] = [];
    let unmapped: string | undefined;
    for (const item of rule.slice(2)) {
      if (!isList(item) || unmapped) continue;
      if (item[0] === "condition") {
        const expr = str(item[1]) ?? "";
        try {
          when = kicadCondition(expr, { className: (k) => ctx.classNames.get(k) ?? k.replace(/[^A-Za-z0-9_.\-+]+/g, "_"), copperOf });
        } catch (e) {
          if (!(e instanceof UnsupportedCondition)) throw e;
          unmapped = `condition: ${e.message}`;
        }
      } else if (item[0] === "layer") {
        const l = str(item[1]);
        const layers = l === "outer" ? ctx.copper.filter((x) => x === "top" || x === "bottom") : l === "inner" ? ctx.copper.filter((x) => x.startsWith("inner")) : l ? (copperOf(l) ? [copperOf(l)!] : undefined) : undefined;
        if (!layers?.length) unmapped = `layer ${l} is not a copper layer of this board`;
        else applies.layers = [...layers];
      } else if (item[0] === "severity") {
        const s = str(item[1]);
        if (s === "error" || s === "warning" || s === "ignore") severity = s;
        else if (s === "exclusion") severity = "ignore";
        else unmapped = `severity ${s} not mapped`;
      } else if (item[0] === "constraint") constraints.push(item);
      else unmapped = `${String(item[0])} clause not mapped`;
    }
    if (unmapped) {
      ctx.notEvaluated(label, unmapped, src);
      continue;
    }
    if (when) applies.when = when;
    const from = label;
    for (const c of constraints) {
      const type = str(c[1]) ?? "";
      if (type === "disallow") {
        const kinds = [...new Set(c.slice(2).map((x) => (isList(x) ? undefined : DISALLOW_KINDS[String(x)])).filter((k): k is NonNullable<typeof k> => !!k))];
        const other = c.slice(2).filter((x) => !isList(x) && !DISALLOW_KINDS[String(x)]).map(String);
        if (other.length) ctx.notEvaluated(label, `disallow ${other.join(" ")}: no object of that type is checked${kinds.length ? ` (its ${kinds.join(", ")} are)` : ""}`, src);
        if (!kinds.length) continue;
        if (c.slice(2).some((x) => ["through_via", "blind_via", "buried_via", "micro_via"].includes(String(x)))) rep.approximated("disallow of a via type", "every via of the board is matched, whatever its type", { source: `${src} (${name})` });
        const kindTerm: RuleCondition = { side: "A", kind: kinds };
        const sev = ctx.severityFor("disallow", "no_go", severity);
        ctx.addRule({ tier: "no_go", check: "disallow", priority, applies: { ...applies, when: when ? { all: [kindTerm, when] } : kindTerm }, ...(sev ? { severity: sev } : {}), note: `KiCad ${label}` }, `kicad.dru.${position}.${name}.disallow`, from);
        mapped++;
        continue;
      }
      const check = DRU_CONSTRAINTS[type];
      if (!check) {
        ctx.notEvaluated(label, `constraint ${type} has no rule check`, src);
        continue;
      }
      const v: Record<string, number> = {};
      for (const part of c.slice(2)) {
        if (!isList(part)) continue;
        const k = str(part[0]);
        const len = parseLength(str(part[1]) ?? "");
        if ((k === "min" || k === "max" || k === "opt") && len !== undefined && len >= 0) v[k] = len;
      }
      if (v.min === undefined && v.max === undefined && v.opt === undefined) {
        ctx.notEvaluated(label, `constraint ${type} has no min, max or opt length`, src);
        continue;
      }
      if (v.min !== undefined || v.max !== undefined) {
        const sev = ctx.severityFor(check, "floor", severity);
        ctx.addRule({ tier: "floor", check, priority, applies, ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}), ...(sev ? { severity: sev } : {}), note: `KiCad ${label}` }, `kicad.dru.${position}.${name}.${check}`, from);
      }
      // opt is the router's value; KiCad's DRC does not check it
      if (v.opt !== undefined) ctx.addRule({ tier: "target", check, priority, applies, preferred: v.opt, note: `KiCad ${label}: opt (a routing value; KiCad's DRC does not check it)` }, `kicad.dru.${position}.${name}.${check}.opt`, from);
      mapped++;
    }
  }
  if (mapped) rep.info("custom rule constraint", "mapped with KiCad's precedence: the last matching rule in the file wins, over net class and board setup values", { count: mapped });
}
