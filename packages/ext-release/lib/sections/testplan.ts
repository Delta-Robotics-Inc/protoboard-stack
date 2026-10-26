/**
 * The test plan of one unit (PK5, basic for v0.1): the checks of
 * ./tests.ts as tables by group, and the records to capture, with a CSV
 * to fill in (files/test/test-record.csv, one row per check).
 */
import { unitPlan } from "@protoboardai/ext-docs/plan";
import type { Block, SectionContext, SectionContribution } from "../types.ts";
import { toCsv } from "../util.ts";
import { unitTests, type TestGroup, type TestItem } from "./tests.ts";

const GROUPS: { group: TestGroup; title: string; intro: string; none: (s: SectionContext) => string | undefined }[] = [
  {
    group: "fai",
    title: "First-article inspection",
    intro: "The first of each part made for this unit, before it is used. Nominal sizes come from the CAD outputs and the model's interfaces; the tolerance is the one on the fabrication order.",
    none: () => "No parts are made for this unit: check purchased parts on receipt against their part numbers (work order, first operation).",
  },
  {
    group: "joint",
    title: "Fits and joints",
    intro: "One check per assembly operation, made at its inspection point (work order) before the next operation covers it up.",
    none: () => "This unit makes no joints.",
  },
  {
    group: "bringup",
    title: "Bring-up",
    intro: "In this order, stopping at the first failure, at the point the work order calls for it (before any step that must follow the test, such as fitting propellers). Expected voltages are the design values in the model; currents are the model's supply budget.",
    none: () => "Nothing in this unit is powered on its own; it is tested where it is assembled.",
  },
  {
    group: "function",
    title: "Functional checks",
    intro: "One per requirement of the project's brief, on the finished product (the work order's last operation). The method follows the requirement's wording; refine it before testing.",
    none: (s) => (s.unit.kind === "root" ? "The project has no requirements source (docs/brief.md), so no functional checks are generated." : undefined),
  },
];

export async function testPlanSection(s: SectionContext): Promise<SectionContribution> {
  const { project: p, unit: u } = s;
  const tests = unitTests(p, u, await unitPlan(p, u));
  const blocks: Block[] = [
    { kind: "note", level: "caution", text: "Basic test plan (v0.1): generated from the model. It lists what to check and the pass criterion the model supports; it does not replace a qualification plan, and nothing here has been run." },
  ];
  for (const g of GROUPS) {
    const items = tests.items.filter((t) => t.group === g.group);
    const none = items.length ? undefined : g.none(s);
    if (!items.length && !none) continue;
    blocks.push({ kind: "heading", text: g.title });
    if (!items.length) {
      blocks.push({ kind: "paragraph", text: none! });
      continue;
    }
    const intro = g.group === "bringup" && tests.powerBudget ? `${g.intro} The project's power budget is ${tests.powerBudget}.` : g.group === "function" && tests.requirements ? `${g.intro} Source: ${tests.requirements}.` : g.intro;
    blocks.push({ kind: "paragraph", text: intro, keep: true });
    blocks.push({ kind: "table", columns: [{ key: "id", label: "ID", nowrap: true }, { key: "check", label: "Check" }, { key: "how", label: "How" }, { key: "pass", label: "Pass" }, { key: "record", label: "Record" }], rows: items.map(row) });
  }
  blocks.push({ kind: "heading", text: "Records to capture" });
  blocks.push({
    kind: "list",
    items: [
      `For each unit built: its serial number and the release it was built to (${s.release.version}).`,
      "For each check: pass or fail, the measured value where the check names one, the instrument, who checked and when.",
      "Any deviation from this package, and what was decided.",
      "files/test/test-record.csv has one row per check to fill in; measured results are attached to the release later as evidence.",
    ],
  });
  return { blocks, files: [{ path: "files/test/test-record.csv", content: recordCsv(tests.items, s), role: "test", description: "test record to fill in, one row per check" }] };
}

const row = (t: TestItem) => ({ id: t.id, check: `${t.check}: ${t.subject}`, how: t.how, pass: t.pass, record: t.record });

const recordCsv = (items: TestItem[], s: SectionContext) =>
  toCsv(
    ["release", "unit", "serial", "id", "group", "check", "subject", "pass_criterion", "result", "measured", "instrument", "by", "date", "note"],
    items.map((t) => ({ release: s.release.version, unit: s.unit.id, serial: "", id: t.id, group: t.group, check: t.check, subject: t.subject, pass_criterion: t.pass, result: "", measured: "", instrument: "", by: "", date: "", note: "" })),
  );
