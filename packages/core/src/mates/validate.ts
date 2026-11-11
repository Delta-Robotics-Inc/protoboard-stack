/**
 * Mate validator (PB-1185): kinds, frames, limits and their units, instances
 * and links that exist, provenance and confidence. Pure; findings are
 * `MateProblem`s, turned into project diagnostics by `./project.ts`.
 *
 * Codes:
 *   MATE_KIND_UNKNOWN      kind is not fixed | revolute | prismatic | cylindrical | coaxial | planar (error)
 *   MATE_FRAME_INVALID     an origin or axis that is not three finite numbers, or a zero axis (error)
 *   MATE_FRAME_SKEW        xAxis not perpendicular to zAxis within 1 degree (warning; x is re-squared when used)
 *   MATE_INSTANCE_UNKNOWN  an end names an instance the project does not have (error)
 *   MATE_SAME_INSTANCE     both ends on the same instance and body (error)
 *   MATE_LIMIT_UNIT        a rotation limit not in deg or rad, a slide limit not in mm or m (error)
 *   MATE_LIMIT_DOF         a limit on a degree of freedom the kind does not have (fixed has none) (error)
 *   MATE_LIMIT_RANGE       min above max (error)
 *   MATE_REST_OUTSIDE      rest outside [min, max]; the sequence holds it at the stop (warning)
 *   MATE_LIMIT_UNSOURCED   a limit with neither source nor assumption (info: the torque rule, research E.5 item 4)
 *   MATE_PROVENANCE        provenance not declared | inferred | measured (error)
 *   MATE_CONFIDENCE        an inferred mate without a confidence in [0, 1] (warning)
 *   MATE_LINK_UNKNOWN      `link` names no mated link (warning)
 *   MATE_DUPLICATE_ID      two mates with one id (warning)
 */
import { DOFS, dot, finite3, len, unit } from "./frames.js";
import { MATE_KINDS, MATE_PROVENANCE, type Mate, type MateProblem } from "./types.js";

export interface ValidateContext {
  /** Instance paths that exist. */
  instances: ReadonlySet<string>;
  /** Link ids assemble() mates (prefixed as it prefixes them); undefined skips the link check. */
  links?: ReadonlySet<string>;
}

const SKEW_COS = Math.cos((89 * Math.PI) / 180); // DEFAULT: 1 degree off perpendicular

export function validateMates(mates: readonly Mate[], ctx: ValidateContext): MateProblem[] {
  const out: MateProblem[] = [];
  const seen = new Set<string>();
  for (const m of mates) {
    const p = (code: string, severity: MateProblem["severity"], message: string) => out.push({ code, severity, message: `mate "${m.id}": ${message}`, mate: m.id, ...(m.origin ? { file: m.origin } : {}) });
    if (seen.has(m.id)) p("MATE_DUPLICATE_ID", "warning", "a second mate with this id");
    seen.add(m.id);
    if (!(MATE_KINDS as readonly string[]).includes(m.kind)) p("MATE_KIND_UNKNOWN", "error", `kind "${m.kind}" is not one of ${MATE_KINDS.join(", ")}`);
    if (!(MATE_PROVENANCE as readonly string[]).includes(m.provenance)) p("MATE_PROVENANCE", "error", `provenance "${m.provenance}" is not one of ${MATE_PROVENANCE.join(", ")}`);
    if (m.provenance === "inferred" && !(typeof m.confidence === "number" && m.confidence >= 0 && m.confidence <= 1)) p("MATE_CONFIDENCE", "warning", "an inferred mate carries a confidence in [0, 1]");
    for (const [side, e] of [["a", m.a], ["b", m.b]] as const) {
      if (!e || typeof e.instance !== "string") {
        p("MATE_INSTANCE_UNKNOWN", "error", `end ${side} names no instance`);
        continue;
      }
      if (!ctx.instances.has(e.instance)) p("MATE_INSTANCE_UNKNOWN", "error", `end ${side}: no instance "${e.instance}" in the project`);
      const f = e.frame;
      if (!f || !finite3(f.origin) || !finite3(f.zAxis) || len(f.zAxis) < 1e-9 || (f.xAxis !== undefined && (!finite3(f.xAxis) || len(f.xAxis) < 1e-9))) {
        p("MATE_FRAME_INVALID", "error", `end ${side}: the frame needs an origin and a non-zero zAxis (and xAxis, if given) as three finite numbers, mm, Z up`);
        continue;
      }
      if (f.xAxis && Math.abs(dot(unit(f.xAxis), unit(f.zAxis))) > SKEW_COS) p("MATE_FRAME_SKEW", "warning", `end ${side}: xAxis is not perpendicular to zAxis (it is squared up when used)`);
    }
    if (m.a?.instance === m.b?.instance && (m.a?.body ?? "") === (m.b?.body ?? "")) p("MATE_SAME_INSTANCE", "error", `both ends are on "${m.a.instance}"`);
    if (m.link !== undefined && ctx.links && !ctx.links.has(m.link)) p("MATE_LINK_UNKNOWN", "warning", `no mated link "${m.link}"`);
    const allowed = DOFS[m.kind] ?? [];
    const dofs = new Set<string>();
    for (const l of m.limits ?? []) {
      if (!allowed.includes(l.dof)) {
        p("MATE_LIMIT_DOF", "error", `a ${l.dof} limit on a ${m.kind} mate (it has ${allowed.length ? allowed.join(" and ") : "no degrees of freedom"})`);
        continue;
      }
      if (dofs.has(l.dof)) p("MATE_DUPLICATE_ID", "warning", `two ${l.dof} limits; the first is used`);
      dofs.add(l.dof);
      const okUnit = l.dof === "rotate" ? l.unit === "deg" || l.unit === "rad" : l.unit === "mm" || l.unit === "m";
      if (!okUnit) p("MATE_LIMIT_UNIT", "error", `a ${l.dof} limit in "${l.unit}" (rotate takes deg or rad, slide mm or m)`);
      for (const k of ["min", "max", "rest"] as const) if (l[k] !== undefined && !(typeof l[k] === "number" && Number.isFinite(l[k]))) p("MATE_LIMIT_RANGE", "error", `${l.dof} ${k} is not a finite number`);
      if (l.min !== undefined && l.max !== undefined && l.min > l.max) p("MATE_LIMIT_RANGE", "error", `${l.dof} min ${l.min} is above max ${l.max}`);
      const rest = l.rest ?? 0;
      if ((l.min !== undefined && rest < l.min) || (l.max !== undefined && rest > l.max)) p("MATE_REST_OUTSIDE", "warning", `${l.dof} rest ${rest} ${l.unit} lies outside [${l.min ?? "-inf"}, ${l.max ?? "inf"}]; it is held at the nearer stop`);
      if (m.provenance !== "inferred" && !l.source && !l.assumption) p("MATE_LIMIT_UNSOURCED", "info", `the ${l.dof} limit cites no source and states no assumption`);
    }
  }
  return out;
}
