/**
 * Net classes and design rules from the files beside a KiCad board: the project file (`.kicad_pro`, JSON:
 * `net_settings` and `board.design_settings.rules`) and the custom rules file (`.kicad_dru`, S-expressions).
 * Only what maps one to one onto the four-tier rules is mapped; every other rule is reported, never guessed:
 *
 * - board constraints (the fab's minimums) become `floor` rules;
 * - net class values (the design defaults) become `target` rules, the Default class's as global rules;
 * - custom rules with a simple condition (none, one net class, one net, `A.Type == 'Via'`) and an optional layer
 *   become `floor` rules for `min` and `max`, and `target` rules for `opt`.
 */
import type { CopperLayer, NetclassRec, RuleRec } from "@protoboardai/board";
import type { Reporter } from "../report.js";
import { isList, parseSexprAll, str, type SList } from "../sexpr.js";

const RULE_PROVENANCE = { by: "imported", tool: "kicad" } as const;

export interface MappedRules {
  netclasses: NetclassRec[];
  rules: RuleRec[];
  /** net name -> our class name, for the netlist. */
  netClass: Map<string, string>;
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

/** The checks a class value maps to. */
const CLASS_FIELDS: Record<string, RuleRec["check"]> = { clearance: "clearance", track_width: "track_width", via_diameter: "via_diameter", via_drill: "via_hole", diff_pair_gap: "diff_pair_gap" };
/** Class fields that are rules we cannot express (microvia sizes, diff pair width and via gap). */
const CLASS_UNMAPPED = ["uvia_diameter", "uvia_drill", "microvia_diameter", "microvia_drill", "diff_pair_width", "diff_pair_via_gap"];
/** Board constraints that map to floor rules. */
const BOARD_FIELDS: Record<string, { check: RuleRec["check"]; note?: string }> = {
  min_clearance: { check: "clearance" },
  min_track_width: { check: "track_width" },
  min_via_diameter: { check: "via_diameter" },
  min_through_hole_diameter: { check: "via_hole", note: "KiCad's minimum through hole; here it applies to via holes (pad holes have no hole-size check)" },
  min_via_annular_width: { check: "annular_ring" },
  min_hole_clearance: { check: "hole_clearance" },
  min_hole_to_hole: { check: "hole_to_hole" },
  min_copper_edge_clearance: { check: "edge_clearance" },
};

/** Custom rule constraints that map, and the checks they become. */
const DRU_CONSTRAINTS: Record<string, RuleRec["check"]> = {
  clearance: "clearance",
  track_width: "track_width",
  via_diameter: "via_diameter",
  edge_clearance: "edge_clearance",
  hole_clearance: "hole_clearance",
  hole_to_hole: "hole_to_hole",
  annular_width: "annular_ring",
  diff_pair_gap: "diff_pair_gap",
  length: "length",
};

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

export function mapKicadRules(input: { project?: string; dru?: string; nets: readonly string[]; copper: readonly CopperLayer[] }, rep: Reporter): MappedRules {
  const out: MappedRules = { netclasses: [], rules: [], netClass: new Map() };
  const usedRuleIds = new Set<string>();
  const addRule = (r: Omit<RuleRec, "kind" | "id" | "provenance">, key: string) => {
    let id = `rule:${ruleKey(key)}`;
    for (let n = 2; usedRuleIds.has(id); n++) id = `rule:${ruleKey(key)}~${n}`;
    usedRuleIds.add(id);
    out.rules.push({ kind: "rule", id, ...r, provenance: RULE_PROVENANCE });
  };
  const classNames = new Map<string, string>(); // KiCad name -> ours

  if (input.project !== undefined) {
    let pro: { net_settings?: { classes?: KicadClass[]; netclass_patterns?: { netclass: string; pattern: string }[]; netclass_assignments?: Record<string, string | string[]> | null }; board?: { design_settings?: { rules?: Record<string, unknown> } } } | undefined;
    try {
      pro = JSON.parse(input.project);
    } catch (e) {
      rep.dropped("project file", `not JSON (${(e as Error).message}); net classes and rules not read`);
    }
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
          out.netclasses.push({ kind: "netclass", id: `class:${ours}`, name: ours, ...(nets.length ? { nets } : {}), ...(pats.length ? { patterns: pats.slice(0, 100) } : {}), provenance: RULE_PROVENANCE });
          if (pats.length > 100) rep.dropped("net class pattern", "more than 100 patterns in one class", { count: pats.length - 100, source: ours });
        }
        for (const [field, check] of Object.entries(CLASS_FIELDS)) {
          const v = c[field];
          if (typeof v !== "number" || !(v > 0)) continue;
          addRule({ tier: "target", check, applies: c.name === "Default" ? {} : { classes: [ours] }, min: nm(v), note: `KiCad net class ${c.name === "Default" ? "Default" : ours}: ${field}` }, `kicad.class.${ours}.${check}`);
        }
        for (const field of CLASS_UNMAPPED)
          if (typeof c[field] === "number" && (c[field] as number) > 0) rep.dropped("net class value", "no rule check expresses it (microvia sizes, diff pair width and via gap)", { source: `${ours}.${field}` });
        if (typeof c.tuning_profile === "string" && c.tuning_profile) rep.dropped("net class value", "tuning profiles are not modeled", { source: `${ours}.tuning_profile` });
      }
      if (patternsByClass.size) rep.info("net class pattern", "kept for nets added later; the nets the board has now are listed in each class explicitly (KiCad's priority order applied)", { count: [...patternsByClass.values()].reduce((s, l) => s + l.length, 0) });
      // ---- board constraints
      const rules = pro.board?.design_settings?.rules ?? {};
      for (const [k, v] of Object.entries(rules)) {
        const map = BOARD_FIELDS[k];
        if (map) {
          if (typeof v === "number" && v > 0) {
            addRule({ tier: "floor", check: map.check, applies: {}, min: nm(v), note: `KiCad board constraint ${k}` }, `kicad.board.${k}`);
            if (map.note) rep.approximated("board constraint", map.note, { source: k });
          }
          continue;
        }
        if ((typeof v === "number" && v !== 0) || v === true) rep.dropped("board constraint", "no rule check expresses it", { source: k });
      }
    }
  }

  if (input.dru !== undefined) mapDru(input.dru, { classNames, copper: input.copper, addRule }, rep);
  return out;
}

interface DruCtx {
  classNames: Map<string, string>;
  copper: readonly CopperLayer[];
  addRule: (r: Omit<RuleRec, "kind" | "id" | "provenance">, key: string) => void;
}

function mapDru(text: string, ctx: DruCtx, rep: Reporter): void {
  let lists: SList[];
  try {
    lists = parseSexprAll(text, { comments: true });
  } catch (e) {
    rep.dropped("custom rules file", `could not be read (${(e as Error).message})`);
    return;
  }
  let mapped = 0;
  /** Custom rule names that gave a floor, per check. */
  const floorsByCheck = new Map<string, string[]>();
  lists.forEach((rule, index) => {
    if (rule[0] === "version") return;
    if (rule[0] !== "rule") {
      rep.dropped("custom rules item", "not a rule", { source: `line ${rule.line}` });
      return;
    }
    const name = str(rule[1]) ?? `rule ${index}`;
    const src = `line ${rule.line} (${name})`;
    const unmapped = (why: string) => rep.dropped("custom rule", why, { source: src });
    const applies: RuleRec["applies"] = {};
    let viaOnly = false;
    let severity: RuleRec["severity"];
    const constraints: SList[] = [];
    for (const item of rule.slice(2)) {
      if (!isList(item)) continue;
      if (item[0] === "condition") {
        const expr = str(item[1]) ?? "";
        const clauses = expr.split("&&").map((c) => c.trim()).filter(Boolean);
        if (/\|\||!|\(\s*\(/.test(expr)) return unmapped(`condition is not simple enough to map (${expr})`);
        for (const c of clauses) {
          let m: RegExpExecArray | null;
          if ((m = /^A\.(?:NetClass\s*==\s*|hasNetclass\(\s*)['"]([^'"]+)['"]\s*\)?$/.exec(c))) {
            const ours = ctx.classNames.get(m[1]);
            if (!ours || applies.classes) return unmapped(`condition names an unknown or second net class (${c})`);
            applies.classes = [ours];
          } else if ((m = /^A\.NetName\s*==\s*['"]([^'"]+)['"]$/.exec(c))) {
            if (applies.nets) return unmapped(`condition names a second net (${c})`);
            applies.nets = [m[1]];
          } else if ((m = /^A\.Type\s*==\s*['"]([^'"]+)['"]$/.exec(c)) && m[1].toLowerCase() === "via") {
            viaOnly = true;
          } else return unmapped(`condition clause not mapped (${c})`);
        }
      } else if (item[0] === "layer") {
        const l = str(item[1]);
        const layers = l === "outer" ? ctx.copper.filter((x) => x === "top" || x === "bottom") : l === "inner" ? ctx.copper.filter((x) => x.startsWith("inner")) : l === "F.Cu" ? ["top" as const] : l === "B.Cu" ? ["bottom" as const] : /^In(\d+)\.Cu$/.test(l ?? "") ? ctx.copper.filter((x) => x === `inner${l!.replace(/\D/g, "")}`) : undefined;
        if (!layers?.length) return unmapped(`layer ${l} not mapped`);
        applies.layers = [...layers];
      } else if (item[0] === "severity") {
        const s = str(item[1]);
        if (s === "error" || s === "warning" || s === "ignore") severity = s;
        else return unmapped(`severity ${s} not mapped`);
      } else if (item[0] === "constraint") constraints.push(item);
      else return unmapped(`${String(item[0])} clause not mapped`);
    }
    for (const c of constraints) {
      const type = str(c[1]) ?? "";
      let check = DRU_CONSTRAINTS[type];
      if (type === "hole_size") {
        if (!viaOnly) {
          rep.dropped("custom rule constraint", "hole_size without A.Type == 'Via' also covers pad holes, which no check expresses", { source: `${src} ${type}` });
          continue;
        }
        check = "via_hole";
      }
      if (!check) {
        rep.dropped("custom rule constraint", `${type} has no rule check`, { source: src });
        continue;
      }
      if (viaOnly && !["via_diameter", "via_hole", "annular_ring"].includes(check)) {
        rep.dropped("custom rule constraint", `${type} limited to vias cannot be expressed (applies has no object type for one side)`, { source: src });
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
        rep.dropped("custom rule constraint", `${type} has no min, max or opt length`, { source: src });
        continue;
      }
      const base = { check, applies, ...(severity ? { severity } : {}), note: `KiCad custom rule ${name}` };
      if (v.min !== undefined || v.max !== undefined) floorsByCheck.set(check, [...(floorsByCheck.get(check) ?? []), name]);
      if (v.min !== undefined || v.max !== undefined) ctx.addRule({ tier: "floor", ...base, ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}) }, `kicad.dru.${index}.${name}.${check}`);
      if (v.opt !== undefined) ctx.addRule({ tier: "target", ...base, min: v.opt }, `kicad.dru.${index}.${name}.${check}.opt`);
      mapped++;
    }
  });
  if (mapped) rep.info("custom rule constraint", "mapped; KiCad lets the last matching custom rule win, here floors combine by the largest minimum", { count: mapped });
  for (const [check, names] of floorsByCheck)
    if (names.length > 1)
      rep.approximated(
        "set of custom rules combined by the largest minimum",
        `${names.length} custom rules give ${check} a minimum (${names.join(", ")}); where more than one applies, the largest minimum is used, while KiCad would use the last matching rule in the file, so the result can be stricter than KiCad`,
        { source: check },
      );
}
