/**
 * The work order of one unit (PK3): the manufacturing process.
 *
 *   - ordering checklist: from the whole product's ordering list; supplier,
 *     lead time and minimum order where an offer or sourcing record states
 *     them, else "unknown";
 *   - fabrication orders: one line per part made for the unit, pointing at
 *     the provider's own order details (board fab profile, print settings,
 *     cut stock, cable cut list) contributed below the main body;
 *   - operations in sequence: kit and first-article inspection, board
 *     assembly, cable preparation, then the unit's assembly steps in the
 *     order of its assembly guide (@protoboardai/ext-docs/plan: mates with
 *     their fastener stacks and torques, soldered and plugged connections),
 *     the operations other extensions contribute to configure the unit
 *     (stage "configure", e.g. load the flight controller's configuration)
 *     with the bench test around them, then the steps that must follow the
 *     test (propellers, a battery strapped on for use) and a final check;
 *     each with parts, tools, materials, torque, an inspection point and the
 *     test-plan check that follows;
 *   - kitting: what each operation consumes and where it comes from.
 */
import { unitPlan, type PlannedStep } from "@protoboardai/ext-docs/plan";
import { includedWith, orderingList, unitBom, type OrderLine, type UnitBomRow } from "../bom.ts";
import { unitModules } from "../collect.ts";
import { cutList, isCable } from "../cutlist.ts";
import type { Block, Cell, SectionContext, SectionContribution, SectionDiagnostic, Step } from "../types.ts";
import { unitTests, type UnitTests } from "./tests.ts";

const RELEASE = "@protoboardai/ext-release";

interface Op extends Step {
  id: string;
  kit: { item: string; qty: number; from: string }[];
}

export async function workOrderSection(s: SectionContext): Promise<SectionContribution> {
  const { project: p, unit: u, units, release, files } = s;
  const rows = unitBom(p, u);
  const builds = u.perProduct * release.build;
  const lines = orderingList(p, units, release.config);
  const plan = await unitPlan(p, u);
  const tests = unitTests(p, u, plan);
  const blocks: Block[] = [];
  const diagnostics: SectionDiagnostic[] = [];
  blocks.push({ kind: "paragraph", text: `Build ${builds} of this unit (${u.perProduct} per product × ${release.build} ${release.build === 1 ? "product" : "products"}). Ordering quantities are for all of them; operations and kits are per build. Test ids (FAI, JT, BU, FN) are in this unit's test plan.` });
  // ---- builds that are not all the same (a module unit whose instances differ in what their parent sets)
  if (plan.variants.length) {
    const list = plan.variants.map((x) => `${x.field}: ${x.values.map((y) => `${y.build} (${y.path}) ${y.value}`).join(", ")}`).join("; ");
    blocks.push({ kind: "note", level: "caution", text: `The ${plan.builds.length} builds of this unit are not all the same. ${list}. ${plan.variants.every((x) => x.handled) ? "The operations that depend on it list each build." : "Not every operation says which build gets what: check each build against the position it goes to."}` });
    for (const x of plan.variants.filter((y) => !y.handled))
      diagnostics.push({ code: "REL_BUILDS_DIFFER", severity: "warning", message: `the ${plan.builds.length} builds of unit ${u.id} differ in ${x.field} (${x.values.map((y) => `${y.path} ${y.value}`).join(", ")}), and no step says which build gets what; name each instance as its own unit, or check the documents per build` });
  }
  // ---- steps that must follow the product's own bench test, in a unit built before it
  if (u.kind !== "root")
    for (const st of plan.steps.filter((x) => x.afterTest))
      diagnostics.push({ code: "REL_AFTER_TEST_IN_SUBUNIT", severity: "warning", message: `unit ${u.id}: "${st.title}" must follow the bench test (${st.afterTest}), but ${u.id} is built before final assembly, so it is done before the product's own test and configuration; leave it to final assembly (do not name ${u.entry} as a unit) or check the order by hand` });

  // ---- ordering checklist
  blocks.push({ kind: "heading", text: "Ordering checklist" });
  const buy = checklist(u.kind === "root", rows, lines, builds);
  if (buy.rows.length) {
    blocks.push({
      kind: "table",
      columns: [{ key: "done", label: "✓" }, { key: "line", label: "Line", align: "right" }, { key: "item", label: "Item" }, { key: "qty", label: "Qty", align: "right" }, { key: "supplier", label: "Supplier" }, { key: "lead", label: "Lead time" }, { key: "moq", label: "MOQ", align: "right" }],
      rows: buy.rows,
      note: `${u.kind === "root" ? "Every bought line of the whole product, with the order quantity (spares and packs included)" : "What this unit uses, for all its builds; order it once for the product on system/ordering-list.csv (the line numbers)"}. Supplier, lead time and minimum order come from the offers and sourcing records the project holds; "unknown" means none states it (record offers with ext-sourcing or protoboard parts offers).`,
    });
  } else blocks.push({ kind: "paragraph", text: "Nothing is bought for this unit alone." });
  const included = rows.filter((r) => r.action === "included");
  if (included.length) blocks.push({ kind: "paragraph", text: `Not ordered separately (ships with another part): ${[...new Set(included.map((r) => `${r.item} (with ${includedWith(p.lookup(r.definition)!)})`))].join("; ")}.` });

  // ---- fabrication orders
  blocks.push({ kind: "heading", text: "Fabrication orders" });
  const bound = unitModules(p, u);
  const fab = aggregate(rows.filter((r) => r.action === "fabricate"), builds);
  // the unit's own module, when a provider designs it (a printed housing that is the unit): it is made here too
  const ownBound = u.kind !== "root" ? bound.find((b) => b.module === u.definition) : undefined;
  if (ownBound && !fab.some((r) => r.definition === u.definition)) {
    const def = p.lookup(u.definition)!;
    fab.unshift({ level: 0, path: "", item: def.name ?? def.id, definition: def.id, kind: "part", action: "fabricate", manufacturer: def.manufacturer ?? "", mpn: "", value: "", package: "", qty_per_unit: 1, qty_per_product: u.perProduct, tier: "project", origin: "", note: ownBound.process ?? (ownBound.capability === "circuit" ? "board" : ownBound.capability), qty: builds } as UnitBomRow & { qty: number });
  }
  if (fab.length) {
    blocks.push({
      kind: "table",
      columns: [{ key: "item", label: "Part" }, { key: "qty", label: "Qty", align: "right" }, { key: "process", label: "Process" }, { key: "details", label: "Order details" }, { key: "files", label: "Files" }],
      rows: fab.map((r) => {
        const b = bound.find((x) => x.module === r.definition);
        const by = b && s.contributors.includes(b.provider) && b.provider !== RELEASE ? `below, from ${b.provider}` : r.kind === "cable" ? (files.some((f) => f.path.endsWith(`/files/harnesses/${r.definition}/cut-list.csv`)) ? "cut list (files)" : "as the assembly guide shows (no cut list in the model)") : "—";
        return { item: r.item, qty: r.qty, process: r.note || r.kind, details: by, files: filesFor(files, r.definition) || "—" };
      }),
      note: "Quantities are for every build of this unit, without spares; the ordering list adds the spares for purchased parts. Send each fabricator the files listed and the order details.",
    });
  } else blocks.push({ kind: "paragraph", text: "No custom parts are made for this unit." });

  // ---- operations
  const ops = operations(s, rows, lines, plan.steps, tests);
  blocks.push({ kind: "heading", text: "Operations" });
  blocks.push({ kind: "paragraph", text: `${ops.length} operations, in order. Assembly operations follow the assembly guide's steps (same order and parts; its figures show each one). Each ends at an inspection point and names the test that follows.` });
  blocks.push({ kind: "steps", steps: ops });

  // ---- kitting
  const kitRows: (Record<string, Cell> | { group: string })[] = [];
  for (const op of ops.filter((o) => o.kit.length)) {
    kitRows.push({ group: `${op.id} · ${op.title}` });
    for (const k of op.kit) kitRows.push({ item: k.item, qty: k.qty, from: k.from });
  }
  if (kitRows.length) {
    blocks.push({ kind: "heading", text: "Kitting" });
    blocks.push({ kind: "table", columns: [{ key: "item", label: "Item" }, { key: "qty", label: "Qty / build", align: "right" }, { key: "from", label: "From" }], rows: kitRows, caption: "Kit per operation", note: "Pick one kit per build before starting. Hardware is counted per operation; spares are on the ordering list." });
  }
  return { blocks, ...(diagnostics.length ? { diagnostics } : {}) };
}

function checklist(root: boolean, rows: UnitBomRow[], lines: OrderLine[], builds: number) {
  // by definition and MPN: a series passive placed at two values is two lines
  const key = (x: { definition: string; mpn: string }) => `${x.definition}\u0000${x.mpn}`;
  const need = new Map<string, number>();
  for (const r of rows.filter((r) => r.action === "buy")) need.set(key(r), (need.get(key(r)) ?? 0) + r.qty_per_unit * builds);
  const chosen = lines.filter((l) => l.action === "buy" && (root || need.has(key(l))));
  const unknown = (v: unknown, f: (x: never) => string) => (v === null || v === undefined || v === "" ? "unknown" : f(v as never));
  return {
    rows: chosen.map((l) => ({
      done: "☐",
      line: l.line,
      item: `${l.item}${l.value ? `, ${l.value}` : ""}${l.mpn ? ` (${l.mpn})` : ""}`,
      qty: root ? l.order : need.get(key(l))!,
      supplier: l.supplier || "unknown",
      lead: unknown(l.lead_time_weeks, (x: number) => `${x} wk`),
      moq: unknown(l.moq, (x: number) => String(x)),
    })),
  };
}

/** Rows of one definition summed, quantities for `builds` builds. */
function aggregate(rows: UnitBomRow[], builds: number) {
  const by = new Map<string, UnitBomRow & { qty: number }>();
  for (const r of rows) {
    const x = by.get(r.definition) ?? { ...r, qty: 0 };
    x.qty += r.qty_per_unit * builds;
    by.set(r.definition, x);
  }
  return [...by.values()];
}

export const filesFor = (files: SectionContext["files"], module: string) =>
  [...new Set(files.filter((f) => f.path.includes(`/files/`) && f.path.split("/").includes(module)).map((f) => f.path.slice(0, f.path.indexOf(module) + module.length) + "/"))].map((d) => d.slice(d.indexOf("files/"))).join(", ");

function operations(s: SectionContext, rows: UnitBomRow[], lines: OrderLine[], steps: PlannedStep[], tests: UnitTests): Op[] {
  const { project: p, unit: u, units } = s;
  const ops: Op[] = [];
  const next = () => String((ops.length + 1) * 10);
  const lineOf = (def: string) => lines.find((l) => l.definition === def);
  const source = (def: string): string => {
    const r = rows.find((x) => x.definition === def);
    const asUnit = u.members.find((m) => m.unit && m.definition === def);
    if (asUnit) return `unit ${asUnit.unit} (units/${asUnit.unit}/)`;
    if (!r) {
      const sub = units.find((x) => x.id !== u.id && unitBom(p, x).some((y) => y.definition === def) && u.members.some((m) => m.unit === x.id));
      return sub ? `in unit ${sub.id} (${sub.folder}/)` : "—";
    }
    if (r.action === "fabricate") return "fabrication order";
    if (r.action === "included") return `with ${includedWith(p.lookup(def)!)}`;
    const l = lineOf(def);
    return l ? `ordering list line ${l.line}` : "ordering list";
  };
  const fai = [...tests.fai.values()].flat();
  const subs = [...new Set(u.members.filter((m) => m.unit).map((m) => m.unit!))];

  // ---- kit and incoming inspection
  ops.push({
    id: next(),
    title: "Kit and inspect incoming parts",
    actions: [
      "Pick one kit per build from the kitting table below.",
      "Check purchased parts on receipt against bom.csv: part numbers, quantities, no damage.",
      ...(subs.length ? [`Receive the finished sub-units: ${subs.map((x) => `${x} (units/${x}/), tested to its own test plan`).join(", ")}.`] : []),
      ...(fai.length ? ["First-article inspection of the parts designed in the project (made, or cut and routed here), before any is used."] : []),
    ],
    // bought parts no assembly step uses (a housing's inserts, set in its print order; not a board's components): kitted here
    kit: aggregate(rows.filter((r) => r.action === "buy" && r.kind !== "component" && !steps.some((st) => st.parts.some((pt) => pt.def.id === r.definition))), 1).map((r) => ({ item: r.item, qty: r.qty, from: source(r.definition) })),
    ...(fai.length ? { tools: ["calipers", "pin gauges or the matching fasteners"] } : {}),
    inspect: fai.length ? "every made part passes first-article inspection; purchased parts match their part numbers" : "purchased parts match their part numbers",
    test: fai.length ? idRanges(fai) : "none",
  });

  // ---- boards
  for (const b of unitModules(p, u).filter((x) => x.capability === "circuit")) {
    const def = p.definitions.get(b.module!)!.def;
    const bu = tests.bringup.length ? `${tests.bringup[0]}…${tests.bringup[tests.bringup.length - 1]} (bring-up)` : "first-article inspection";
    ops.push({
      id: next(),
      title: `Assemble the ${def.name ?? def.id}`,
      actions: [
        `Assemble the board as its fabrication order says: by the fabricator (pnp.csv, bom.csv) or by hand (paste, place, reflow), ${def.children?.length ?? 0} components.`,
        "Clean flux residue; hand-solder any part the order leaves for hand assembly.",
      ],
      parts: [{ name: def.name ?? def.id, quantity: 1, ref: def.id }],
      tools: ["reflow oven or hot-air station", "soldering iron", "magnifier"],
      materials: ["solder paste", "solder and flux"],
      inspect: "every component present and oriented as pnp.csv; joints wetted, no bridges (AOI or magnifier)",
      test: bu,
      trace: [def.id],
      kit: [{ item: def.name ?? def.id, qty: 1, from: "fabrication order (bare or assembled board)" }],
    });
  }

  // ---- cables to cut and prepare before assembly
  const seen = new Set<string>();
  for (const r of rows.filter((x) => x.kind === "cable")) {
    if (seen.has(r.definition)) continue;
    seen.add(r.definition);
    const def = p.lookup(r.definition)!;
    if (!isCable(def)) continue;
    const cut = cutList(def);
    const c0 = cut[0];
    const needsCut = c0?.length_mm && c0.supplied_length_mm && c0.length_mm < c0.supplied_length_mm;
    if (r.action !== "fabricate" && !needsCut) continue;
    const qty = rows.filter((x) => x.definition === r.definition).reduce((t, x) => t + x.qty_per_unit, 0);
    const step = steps.find((st) => st.plan.wiring.some((w) => w.harness && p.instances.find((i) => i.path === w.harness)?.definition === def.id));
    ops.push({
      id: next(),
      title: `${r.action === "fabricate" ? "Make" : "Prepare"} the ${def.name ?? def.id}${qty > 1 ? ` (× ${qty})` : ""}`,
      actions: [
        // the cut list is packaged (files/harnesses/<id>/cut-list.csv) whenever the model gives one
        c0?.length_mm
          ? `Cut to ${c0.length_mm} mm${c0.supplied_length_mm ? ` (supplied ${c0.supplied_length_mm} mm)` : ""}, as files/harnesses/${def.id}/cut-list.csv.`
          : c0
            ? `Cut as files/harnesses/${def.id}/cut-list.csv.`
            : "Cut and prepare as the assembly guide shows (the model states no cut list).",
        ...(c0?.strip_mm ? [`Strip ${c0.strip_mm} mm at each soldered end and tin.`] : []),
        ...(c0?.lay ? [`Lay: ${c0.lay}.`] : []),
        ...(cut.length > 1 ? [`Keep the conductor order of the cut list (${cut.length} conductors).`] : []),
      ],
      parts: [{ name: def.name ?? def.id, quantity: qty, ref: def.id }],
      tools: ["side cutters", "wire stripper", "rule", ...(c0?.strip_mm ? ["soldering iron"] : [])],
      ...(c0?.strip_mm ? { materials: ["solder and flux"] } : {}),
      inspect: `length and strip lengths as the cut list; no nicked strands`,
      test: (tests.fai.get(def.id)?.length ? idRanges(tests.fai.get(def.id)!) : "") || (step ? `${tests.joint.get(step.n)} after it is fitted (op for step ${step.n})` : "continuity when fitted"),
      trace: [def.id],
      kit: [{ item: def.name ?? def.id, qty, from: source(def.id) }],
    });
  }

  // ---- assembly steps (the assembly guide's order), up to the ones that follow the test
  const assembly = (st: PlannedStep): Op => ({
    id: next(),
    title: st.title,
    actions: [`Assembly guide step ${st.n}.`, ...st.actions],
    parts: st.parts.map((pt) => ({ name: pt.def.name ?? pt.def.id, quantity: pt.count, ref: pt.def.id })),
    ...(st.tools.length ? { tools: st.tools } : {}),
    ...(st.materials.length ? { materials: st.materials } : {}),
    ...(st.torque ? { torque: st.torque } : {}),
    inspect: inspection(st),
    test: tests.joint.get(st.n)!,
    trace: st.trace,
    ...(st.afterTest ? { notes: [{ level: "caution" as const, text: u.kind === "root" ? `This step follows the bench test and configuration (${st.afterTest}).` : `This step must follow the product's bench test (${st.afterTest}), but this unit is built before final assembly; check the order with the system work order.` }] } : {}),
    kit: st.parts.map((pt) => ({ item: pt.def.name ?? pt.def.id, qty: pt.count, from: source(pt.def.id) })),
  });
  const later = steps.filter((st) => st.afterTest);
  for (const st of steps.filter((x) => !x.afterTest)) ops.push(assembly(st));

  // ---- bench test, with the contributed configuration inside it: power first, then configure, then the checks that need it
  const fn = tests.items.filter((t) => t.group === "function").map((t) => t.id);
  const bu = tests.bringup;
  const power = bu.filter((id) => tests.items.find((t) => t.id === id)?.phase === "power");
  const running = bu.filter((id) => !power.includes(id));
  const configure = s.operations.filter((o) => o.stage === "configure");
  const span = (ids: string[], dash = "–") => (ids.length ? (ids.length === 1 ? ids[0] : `${ids[0]}${dash}${ids[ids.length - 1]}`) : "");
  const benchTools = (ids: string[]) => (ids.length ? { tools: ["current-limited bench supply", "multimeter", ...(tests.items.some((t) => ids.includes(t.id) && t.check === "Bus scan") ? ["I2C bus adapter or the firmware's scan"] : [])] } : {});
  const laterNote = later.length ? [{ level: "caution" as const, text: `${later.map((x) => `"${x.title}"`).join(" and ")} come${later.length === 1 ? "s" : ""} after this test and any configuration: not before.` }] : [];
  const record = "Record every result in files/test/test-record.csv; mark the unit with the release version and a serial number.";
  const what = u.kind === "root" ? "the product" : "the unit";
  // functional checks need the finished product: after the steps that follow the test when there are any
  const fnHere = later.length ? [] : fn;
  if (configure.length && power.length) {
    ops.push({
      id: next(),
      title: `Power up ${what}`,
      actions: [`Bring-up ${span(power, "…")}: ${coverage(tests, power)}.`],
      ...benchTools(power),
      inspect: "no short, no current limit hit; every rail at its design voltage",
      test: span(power),
      notes: laterNote,
      kit: [],
    });
  }
  for (const o of configure) {
    const { stage: _stage, extension, ...step } = o;
    ops.push({ ...step, id: next(), trace: [...(step.trace ?? []), `contributed by ${extension} (details below)`], kit: [] });
  }
  const testIds = configure.length && power.length ? running : bu;
  // a unit with nothing to bring up and steps after the test is checked once, at the end
  if (testIds.length || configure.length || fnHere.length || !later.length) {
    ops.push({
      id: next(),
      title: `Test ${what}`,
      actions: [
        ...(testIds.length ? [`Bring-up ${span(testIds, "…")}: ${coverage(tests, testIds)}.`] : []),
        ...(configure.length ? ["Then the bench checks that follow the configuration (test plan, after bring-up)."] : []),
        ...(fnHere.length ? [`Functional checks ${fnHere[0]}…${fnHere[fnHere.length - 1]}, one per requirement.`] : []),
        ...(later.length ? [] : [record]),
      ],
      ...benchTools(testIds),
      inspect: later.length ? "every bench check passed and recorded" : "every check in the test plan passed and recorded",
      test: [span(testIds), span(fnHere)].filter(Boolean).join(", ") || "the joint checks above",
      ...(later.length && !(configure.length && power.length) ? { notes: laterNote } : {}),
      kit: [],
    });
  }

  // ---- the steps that follow the test, then the final check
  for (const st of later) ops.push(assembly(st));
  if (later.length) {
    ops.push({
      id: next(),
      title: u.kind === "root" ? "Final check" : "Final check of the unit",
      actions: [
        `Check the work of ${later.map((x) => `"${x.title}"`).join(" and ")} against the assembly guide${later.some((x) => x.perBuild) ? ", each build against its position" : ""}.`,
        ...(fn.length ? [`Functional checks ${fn[0]}…${fn[fn.length - 1]}, one per requirement, on the finished ${u.kind === "root" ? "product" : "unit"}.`] : []),
        record,
      ],
      inspect: "nothing loose; every check in the test plan passed and recorded",
      test: span(fn) || later.map((x) => tests.joint.get(x.n)).join(", "),
      kit: [],
    });
  }
  return ops.map((o) => ({ ...o, id: `OP ${o.id}` }));
}

/** What a run of bring-up checks covers, in plan order, from their check names ("before power, power up, rails, …"). */
function coverage(tests: UnitTests, ids: string[]): string {
  const kinds: [RegExp, string][] = [
    [/^Before power/, "before power"],
    [/^Power up/, "power up current-limited"],
    [/^Rail /, "rails"],
    [/^Current/, "current"],
    [/programming|boot/i, "programming and boot"],
    [/^Bus scan/, "bus scans"],
    [/^Smoke test/, "smoke tests"],
  ];
  const checks = tests.items.filter((t) => ids.includes(t.id)).map((t) => t.check);
  const out = kinds.filter(([re]) => checks.some((c) => re.test(c))).map(([, label]) => label);
  return out.length ? out.join(", ") : "the checks listed in the test plan";
}

/** Test ids as ranges: FAI-1, FAI-2, FAI-3, BU-1 → "FAI-1…FAI-3, BU-1". */
export function idRanges(ids: string[]): string {
  const out: string[] = [];
  let run: { prefix: string; from: number; to: number } | undefined;
  const flush = () => run && out.push(run.from === run.to ? `${run.prefix}-${run.from}` : `${run.prefix}-${run.from}…${run.prefix}-${run.to}`);
  for (const id of ids) {
    const m = /^(.*)-(\d+)$/.exec(id);
    if (m && run && run.prefix === m[1] && Number(m[2]) === run.to + 1) run.to++;
    else {
      flush();
      run = m ? { prefix: m[1], from: Number(m[2]), to: Number(m[2]) } : undefined;
      if (!m) out.push(id);
    }
  }
  flush();
  return out.join(", ");
}

function inspection(st: PlannedStep): string {
  if (st.kind === "mate") return `parts seated flush, no gap${st.torque ? "; every fastener at torque and witness-marked" : ""}`;
  if (st.kind === "place") return "the part sits as the figure shows and is secured";
  if (st.kind === "prepare") return "every pin soldered, no bridges; strips flush and square";
  return st.solder ? "joints wetted and concave, no bridges; conductor order as the step's table" : "connectors fully seated and latched; cables clear of moving parts";
}
