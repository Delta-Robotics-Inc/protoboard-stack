/**
 * Fastener stack-up table for the project's mechanical harnesses.
 *
 *   npx tsx <this file> [harness-id ...] [--json]
 *
 * For every harness with a `fastenerStack`: each item's span along the joint
 * normal (from the structure-side face, mm), its torque, and for each nut
 * the thread the screw leaves beyond the nut's far face (negative = the
 * screw stops inside the nut; UHD's assemble reports that as an error).
 * A nut on a threaded shaft (a prop nut) has the shaft as its screw.
 * Harness quantities are compared with the number of positions the stack
 * places. Positions are per hole of the structure's bolt pattern unless an
 * item lists its own `positions`.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { loadProject } from "@protoboardai/core";

const args = process.argv.slice(2);
const json = args.includes("--json");
const only = args.filter((a) => !a.startsWith("--"));
const p = await loadProject(process.cwd(), { checks: false, extensions: false });

const lengthOf = (def: ModuleDef) =>
  def.interfaces.flatMap((i) => i.parameters ?? []).find((x) => x.id === "length")?.value ?? 0;
const kindOf = (def: ModuleDef) => (["nut", "screw", "standoff", "spacer"] as const).find((k) => def.tags?.includes(k)) ?? "part";
const holesOf = (h: ModuleDef) => h.interfaces.flatMap((i) => i.parameters ?? []).find((x) => x.id === "hole_count")?.value ?? 4;

const harnesses = [...new Set(p.instances.map((i) => i.definition))]
  .map((id) => p.lookup(id)!)
  .filter((d) => d?.fastenerStack?.length && (!only.length || only.includes(d.id)))
  .sort((a, b) => a.id.localeCompare(b.id));

/**
 * The threaded shaft a harness's nut runs on (a prop nut on a motor shaft): the joint the harness carries
 * is a shaft link whose structure end (a) states a thread in its `shaft` trait. UHD's assemble takes that
 * shaft as the nut's screw; so does this table.
 */
function threadedShaftOf(h: ModuleDef): string | undefined {
  for (const rec of p.definitions.values()) {
    const parent = rec.def;
    for (const l of parent.links ?? []) {
      const ref = parent.children?.find((c) => c.id === l.harness);
      if (!ref || ref.moduleDefId !== h.id || !("child" in l.a)) continue;
      const end = l.a as { child: string; interfaceId: string };
      const child = parent.children?.find((c) => c.id === end.child);
      const iface = child && p.lookup(child.moduleDefId)?.interfaces.find((i) => i.id === end.interfaceId);
      const thread = iface?.protocols?.some((x) => x.type === "shaft") ? iface.traits?.find((t) => t.type === "shaft")?.params?.thread : undefined;
      if (typeof thread === "string") return `${child!.moduleDefId}:${iface!.id} (${thread})`;
    }
  }
  return undefined;
}

const report = harnesses.map((h) => {
  const items = h.fastenerStack!.map((item) => {
    const ref = h.children?.find((c) => c.id === item.child);
    const def = ref ? p.lookup(ref.moduleDefId) : undefined;
    const len = def ? lengthOf(def) : 0;
    const dir = item.direction ?? 1;
    return {
      child: item.child,
      part: def?.id ?? `(unknown child ${item.child})`,
      kind: def ? kindOf(def) : "part",
      from: Math.min(item.atMm, item.atMm + dir * len),
      to: Math.max(item.atMm, item.atMm + dir * len),
      direction: dir,
      positions: item.positions?.length ?? holesOf(h),
      torqueNm: item.torque?.torqueNm,
      torqueBasis: item.torque ? (item.torque.source ? "source" : item.torque.assumption ? "assumption" : "unsupported") : undefined,
    };
  });
  const nuts = items
    .filter((x) => x.kind === "nut")
    .map((nut) => {
      const screw = items.find((s) => s.kind === "screw" && s.from <= nut.to && s.to >= nut.from);
      const shaft = !screw && nut.from >= 0 ? threadedShaftOf(h) : undefined;
      if (shaft) return { nut: nut.child, screw: `threaded shaft ${shaft}`, beyondFarFaceMm: null, onShaft: true };
      if (!screw) return { nut: nut.child, screw: null, beyondFarFaceMm: null };
      // the far face is the one the screw reaches last
      const up = screw.direction === 1 ? screw.to - nut.to : nut.from - screw.from;
      return { nut: nut.child, screw: screw.child, beyondFarFaceMm: Number(up.toFixed(2)) };
    });
  const placed = new Map<string, number>();
  for (const x of items) placed.set(x.child, (placed.get(x.child) ?? 0) + x.positions);
  const quantities = (h.children ?? []).map((c) => ({ child: c.id, listed: c.quantity ?? 1, placed: placed.get(c.id) ?? 0 }));
  return { harness: h.id, name: h.name, items, nuts, quantities };
});

if (json) console.log(JSON.stringify(report, null, 2));
else {
  for (const r of report) {
    console.log(`\n${r.harness}  ${r.name ?? ""}`);
    for (const x of r.items) {
      console.log(
        `  ${x.child.padEnd(10)} ${x.part.padEnd(40)} ${x.from.toFixed(2).padStart(7)} … ${x.to.toFixed(2).padEnd(7)} ${x.direction === 1 ? "+" : "-"}  ×${x.positions}${x.torqueNm !== undefined ? `  ${x.torqueNm} N·m (${x.torqueBasis})` : ""}`,
      );
    }
    for (const n of r.nuts) {
      console.log("onShaft" in n ? `  nut ${n.nut}: on the ${n.screw} (the shaft's thread length is the motor's fact; check it covers the nut)` : n.screw ? `  nut ${n.nut}: ${n.screw} ${n.beyondFarFaceMm! >= 0 ? `protrudes ${n.beyondFarFaceMm} mm beyond the far face` : `STOPS ${-n.beyondFarFaceMm!} mm SHORT of the far face`}` : `  nut ${n.nut}: NO SCREW passes through it`);
    }
    for (const q of r.quantities.filter((q) => q.listed !== q.placed)) console.log(`  quantity ${q.child}: listed ${q.listed}, stack places ${q.placed}`);
  }
}
process.exitCode = report.some((r) => r.nuts.some((n) => !("onShaft" in n) && (n.beyondFarFaceMm === null || n.beyondFarFaceMm < 0))) ? 1 : 0;
