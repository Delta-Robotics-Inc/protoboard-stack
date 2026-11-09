/** The status line: "N unconnected, M errors, K warnings" (", W waived" when a person waived some), computed here from findings and connectivity. */
import type { Finding } from "@protoboardai/board";
import type { ConnectivityResult } from "./connectivity.js";

export interface Timing {
  totalMs: number;
  /** Milliseconds per stage: model, pairs, connectivity, then each check id. */
  stages: Record<string, number>;
}

export interface CheckCounts {
  errors: number;
  warnings: number;
  infos: number;
}

export interface Summary {
  /** For the status bar, e.g. "3 unconnected, 2 errors, 5 warnings". */
  line: string;
  /** Missing links over all nets (the ratsnest), from connectivity. */
  unconnected: number;
  /** Error findings other than unconnected items. */
  errors: number;
  warnings: number;
  infos: number;
  /** Findings a person waived (left out of every count above and of byCheck). */
  waived: number;
  byCheck: Record<string, CheckCounts>;
  inputHash: string;
  timing?: Timing;
  /** True when the line leaves out something that would change it: zones without fill, no netlist, no clearance rule. */
  incomplete: boolean;
  /** What the numbers do not cover (zones without fill, checks without a rule). Never empty when something was left out. */
  caveats: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Count findings for the status line. `unconnected` comes from connectivity so the two can never disagree silently
 * (less the unconnected items a person waived). `waived`: the findings waivers left out of `findings`.
 */
export function summarize(findings: readonly Finding[], connectivity: ConnectivityResult, extra: { timing?: Timing; notRun?: { check: string; reason: string }[]; waived?: readonly Finding[] } = {}): Summary {
  const byCheck: Record<string, CheckCounts> = {};
  let errors = 0,
    warnings = 0,
    infos = 0;
  for (const f of findings) {
    const c = (byCheck[f.check] ??= { errors: 0, warnings: 0, infos: 0 });
    if (f.severity === "error") c.errors++;
    else if (f.severity === "warning") c.warnings++;
    else c.infos++;
    if (f.check === "unconnected") continue;
    if (f.severity === "error") errors++;
    else if (f.severity === "warning") warnings++;
    else infos++;
  }
  const waived = extra.waived ?? [];
  const waivedUnconnected = waived.filter((f) => f.check === "unconnected").length;
  const unconnected = connectivity.unconnected - waivedUnconnected;
  const reported = (byCheck.unconnected ? byCheck.unconnected.errors + byCheck.unconnected.warnings + byCheck.unconnected.infos : 0) + waivedUnconnected;
  const caveats: string[] = [];
  if (reported !== connectivity.unconnected) caveats.push(`the findings list ${reported} unconnected item(s) but connectivity counts ${connectivity.unconnected} (findings were filtered to a region)`);
  if (connectivity.zoneFill === "absent" || connectivity.zoneFill === "partial")
    caveats.push(`${plural(connectivity.zonesWithoutFill.length, "zone")} without fill connect nothing: unconnected counts assume no pour`);
  if (!connectivity.netlist) caveats.push("no netlist: pads have no nets, so pad connections are not checked");
  if (connectivity.undecided) caveats.push(`${connectivity.undecided} track end(s) or via(s) in an unfilled zone of their net were not judged dangling`);
  // policy checks without a rule have nothing to enforce; every other check without one is a gap
  const gaps = (extra.notRun ?? []).filter((n) => n.check !== "via_in_pad" && n.check !== "via_under_footprint");
  for (const n of gaps) caveats.push(`${n.check} not checked: ${n.reason}`);
  const incomplete = connectivity.zoneFill === "absent" || connectivity.zoneFill === "partial" || !connectivity.netlist || gaps.some((g) => g.check === "clearance");
  const line = `${unconnected} unconnected, ${plural(errors, "error")}, ${plural(warnings, "warning")}${waived.length ? `, ${waived.length} waived` : ""}${incomplete ? " (incomplete: see caveats)" : ""}`;
  return {
    line,
    unconnected,
    errors,
    warnings,
    infos,
    waived: waived.length,
    byCheck: Object.fromEntries(Object.entries(byCheck).sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    inputHash: connectivity.inputHash,
    ...(extra.timing ? { timing: extra.timing } : {}),
    incomplete,
    caveats,
  };
}
