/**
 * Contributions to the Manufacturing Package (@protoboardai/ext-release section
 * contract) for the cables this provider routes: their preparation in the
 * unit's work order (cut length against the supplied length, strip length,
 * gauge, lay, and how each end is terminated and onto what), and routing
 * checks in the test plan (bend radius, clearance, slack). Values come from
 * the cable's UHD facts (cut list) and the routed standard output
 * (out/body.manifest.json).
 */
import type { CapabilityBinding, Project } from "@protoboardai/core";
import type { Block, SectionContext, SectionFn } from "@protoboardai/ext-release";
import { cutList, perBuild, providerModules, readOutput } from "@protoboardai/ext-release/helpers";

const PROVIDER = "@protoboardai/ext-harness-cad";

interface RouteManifest {
  length_mm?: number;
  route_length_mm?: number;
  length_fit?: { slack_mm?: number; method?: string; worst_clearance_mm?: number };
  bundle?: { kind?: string; conductors?: number; bundle_od_mm?: number; twist_pitch_mm?: number };
  bend_radius_mm?: { target?: number; minimum?: number; centreline?: number };
  clearance_mm?: { min_conductor_surface?: number };
  ends?: Record<string, { counterpart?: string; termination?: string; link?: string }>;
}

// manifests write null for a value the router could not measure (callers check with != null)
const n = (v: number, d = 1) => String(Number(v.toFixed(d)));

/** How an end is finished, by the termination the route records. */
const TERMINATION: Record<string, string> = {
  solder: "strip, tin, solder to the pads; keep each joint clear of its neighbours, and fix the lead near the pad (tie or tape) so the joint carries no strain",
  plug: "plugs in (pre-terminated housing); check the latch",
  integral: "fixed to the part (its own leads): nothing to terminate",
  crimp: "crimp the contacts and insert them in the housing positions of the cut list",
};

export function cables(p: Project, unit: SectionContext["unit"]) {
  return providerModules(p, unit, PROVIDER).map((b: CapabilityBinding) => {
    const def = p.definitions.get(b.module!)!.def;
    return { b, def, cut: cutList(def), m: readOutput<RouteManifest>(p, b, "body.manifest.json") ?? {}, per: perBuild(unit, def.id) };
  });
}

export const workOrder: SectionFn = ({ project: p, unit, release }: SectionContext) => {
  const cs = cables(p, unit);
  if (!cs.length) return undefined;
  const builds = unit.perProduct * release.build;
  const blocks: Block[] = [
    { kind: "paragraph", text: `${cs.length} cable${cs.length === 1 ? "" : "s"} routed in this unit. Cut each to its installed length before fitting; the routed length is the centreline the CAD found, with the slack it bows into. Per-conductor rows (positions, colours) are in files/harnesses/<cable>/cut-list.csv.`, keep: true },
    {
      kind: "table",
      columns: [
        { key: "cable", label: "Cable" },
        { key: "qty", label: "Qty", align: "right" },
        { key: "cut", label: "Cut to" },
        { key: "strip", label: "Strip" },
        { key: "wire", label: "Conductors" },
        { key: "lay", label: "Lay" },
        { key: "bend", label: "Min bend" },
      ],
      rows: cs.map(({ def, cut, m, per }) => {
        const c = cut[0];
        return {
          cable: def.name ?? def.id,
          qty: per * builds,
          cut: c?.length_mm ? `${c.length_mm} mm${c.supplied_length_mm && c.supplied_length_mm !== c.length_mm ? ` (of ${c.supplied_length_mm})` : ""}` : "as supplied",
          strip: c?.strip_mm ? `${c.strip_mm} mm` : "—",
          wire: [String(cut.length || m.bundle?.conductors || "?"), c?.gauge_awg ? `${c.gauge_awg} AWG` : ""].filter(Boolean).join(" × "),
          lay: c?.lay || m.bundle?.kind || "",
          bend: m.bend_radius_mm?.minimum ? `${n(m.bend_radius_mm.minimum)} mm` : "",
        };
      }),
      caption: "Cable preparation",
    },
    { kind: "heading", text: "Terminations" },
    {
      kind: "table",
      columns: [{ key: "cable", label: "Cable" }, { key: "end", label: "End" }, { key: "onto", label: "Onto" }, { key: "how", label: "How" }],
      rows: cs.flatMap(({ def, m }) =>
        Object.entries(m.ends ?? {}).map(([id, e]) => ({ cable: def.name ?? def.id, end: def.interfaces.find((i) => i.id === id)?.name ?? id, onto: e.counterpart ?? "", how: TERMINATION[e.termination ?? ""] ?? e.termination ?? "" })),
      ),
      caption: "Terminations",
    },
  ];
  return { title: "Cables", order: 40, blocks };
};

export const testPlan: SectionFn = ({ project: p, unit }: SectionContext) => {
  const cs = cables(p, unit).filter(({ m }) => m.bend_radius_mm || m.clearance_mm || m.length_fit);
  if (!cs.length) return undefined;
  return {
    title: "Cable routing",
    order: 40,
    blocks: [
      { kind: "paragraph", text: "After final assembly, each cable as the routed CAD lays it: compare with the assembly guide's figures.", keep: true },
      {
        kind: "table",
        columns: [{ key: "cable", label: "Cable" }, { key: "bend", label: "Bend radius" }, { key: "clear", label: "Clearance" }, { key: "slack", label: "Slack" }],
        rows: cs.map(({ def, m }) => ({
          cable: def.name ?? def.id,
          bend: m.bend_radius_mm?.minimum ? `no bend tighter than ${n(m.bend_radius_mm.minimum)} mm` : "",
          clear: m.clearance_mm?.min_conductor_surface != null ? `clear of every part (routed ${n(m.clearance_mm.min_conductor_surface, 2)} mm); nothing rubs on an edge or a moving part` : "clear of moving parts",
          slack: m.length_fit?.slack_mm != null ? `${n(m.length_fit.slack_mm)} mm taken up${m.length_fit.method ? ` (${m.length_fit.method})` : ""}; no tension at either end` : "no tension at either end",
        })),
      },
    ],
  };
};
