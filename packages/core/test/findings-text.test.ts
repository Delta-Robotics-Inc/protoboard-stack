/**
 * Plain-language findings (findings-text.ts, wave R2 D3 and D7): the table in docs/reference/diagnostic-codes.md, its
 * copy in findings-text-table.ts, the fallbacks, the human link names, and the findings ClientX's check writes today
 * (their raw messages, copied from `protoboard check --format json` on 2026-11-02).
 *
 * `UPDATE_FINDINGS_TEXT=1 npx vitest run packages/core/test/findings-text.test.ts` rewrites the table's copy from the
 * reference page.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SUMMARY_MAX,
  TITLE_MAX,
  annotateFindings,
  clip,
  codesWithoutText,
  fillTemplate,
  genericTitle,
  humanLinkName,
  parsePlainTable,
  plainFinding,
  projectNames,
  shortName,
  type FindingNames,
  type NamedProject,
} from "../src/findings-text.js";
import { PLAIN_TABLE } from "../src/findings-text-table.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "../../..");
const DOC = join(REPO, "docs/reference/diagnostic-codes.md");
const TABLE_FILE = join(HERE, "../src/findings-text-table.ts");

/** The table's copy as a TypeScript module (sorted keys, one entry per line). */
function tableModule(table: Record<string, { title: string; summary: string }>): string {
  const lines = Object.keys(table)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: { title: ${JSON.stringify(table[k].title)}, summary: ${JSON.stringify(table[k].summary)} },`);
  return [
    "/** Generated from docs/reference/diagnostic-codes.md by packages/core/test/findings-text.test.ts (UPDATE_FINDINGS_TEXT=1). Do not edit. */",
    'import type { PlainEntry } from "./findings-text.js";',
    "",
    "export const PLAIN_TABLE: Record<string, PlainEntry> = {",
    ...lines,
    "};",
    "",
  ].join("\n");
}

describe("the plain-words table", () => {
  const doc = parsePlainTable(readFileSync(DOC, "utf8"));
  if (process.env.UPDATE_FINDINGS_TEXT) writeFileSync(TABLE_FILE, tableModule(doc));

  it("findings-text-table.ts is the reference page's rows (UPDATE_FINDINGS_TEXT=1 rewrites it)", () => {
    expect(readFileSync(TABLE_FILE, "utf8").replace(/\r\n/g, "\n")).toBe(tableModule(doc));
    expect(Object.keys(PLAIN_TABLE).length).toBe(Object.keys(doc).length);
  });

  it("every title fits 60 characters and names no placeholder; every sentence is one sentence", () => {
    const bad: string[] = [];
    for (const [k, e] of Object.entries(doc)) {
      if (e.title.length > TITLE_MAX || /[{}]/.test(e.title) || /\.$/.test(e.title)) bad.push(`${k} title: ${e.title}`);
      // the written template (placeholders count as about 20 characters each once filled; the fill is clipped at 160)
      if (!/\.$/.test(e.summary) || e.summary.replace(/\{\w+\}/g, "x".repeat(20)).replace(/\[\[|\]\]/g, "").length > SUMMARY_MAX + 40) bad.push(`${k} summary: ${e.summary}`);
      if (/[A-Z]{2,}_[A-Z_]{2,}/.test(e.title + e.summary)) bad.push(`${k} names a code: ${e.title} / ${e.summary}`);
    }
    expect(bad).toEqual([]);
  });

  /** Codes the stack emits: quoted literals in core, cli and the extensions (as cli/test/skills-sop.test.ts collects them), plus UHD's rules. */
  const PREFIX = "(?:PB|HW|FRAME_CAD|HARDWARE_CAD|HARNESS|ENCLOSURE|CIRCUIT|SRC|UHD)_[A-Z0-9_]+";
  const emitted = new Set<string>();
  const packages = readdirSync(join(REPO, "packages")).filter((d) => d.startsWith("ext-"));
  for (const dir of ["packages/core/src", "packages/cli/src", ...packages.flatMap((d) => ["lib", "ops", "checks", "py"].map((x) => `packages/${d}/${x}`))]) {
    const root = join(REPO, dir);
    if (!existsSync(root)) continue;
    for (const f of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!f.isFile() || !/\.(ts|py)$/.test(f.name) || f.name.startsWith("findings-text")) continue;
      const src = readFileSync(join(f.parentPath, f.name), "utf8");
      for (const [, code] of src.matchAll(new RegExp(`(?<!Error\\()["'\`](${PREFIX})["'\`]`, "g"))) if (!/_DEBUG$/.test(code)) emitted.add(code);
    }
  }
  // UHD's system rules become `UHD_<RULE>` in project.ts (dynamic, not a literal)
  for (const rule of ["LINK_STATE", "SUPPLY_BUDGET", "PROPULSION_CURRENT", "BUS_ADDRESS", "BUS_PULLUP", "NET", "DESIGN_ENVELOPE", "PASSIVE_OVERRIDE", "INTERFACE_REUSE", "UNPOWERED", "UNCONNECTED", "HARNESS_CONNECTOR", "FASTENER_TORQUE", "PROP_HANDEDNESS", "UNKNOWN_CATEGORY"]) emitted.add(`UHD_${rule}`);

  it("lists the emitted codes that have no plain words yet (empty: the table is complete)", () => {
    expect(emitted.size).toBeGreaterThan(100);
    expect(codesWithoutText(emitted, doc)).toEqual([]);
  });
});

describe("words", () => {
  it("makes a title from a code name, keeping abbreviations", () => {
    expect(genericTitle("UHD_SUPPLY_BUDGET")).toBe("Supply budget");
    expect(genericTitle("PB_I2C_BUS_MISSING")).toBe("I2C bus missing");
    expect(genericTitle("FRAME_CAD_HOLE_TOO_CLOSE")).toBe("Hole too close");
  });
  it("clips at a word with an ellipsis, and strips a trailing parenthetical from names", () => {
    expect(clip("a".repeat(10), 10)).toBe("a".repeat(10));
    const c = clip("the quick brown fox jumps over the lazy dog", 20);
    expect(c.length).toBeLessThanOrEqual(20);
    expect(c.endsWith("…")).toBe(true);
    expect(shortName("Mainboard B1_4 (rev-a)")).toBe("Mainboard B1_4");
    expect(shortName("12 V DC output (plug centre)")).toBe("12 V DC output");
    expect(shortName("(only brackets)")).toBe("(only brackets)");
  });
  it("fills placeholders and drops an optional segment whose value is missing", () => {
    expect(fillTemplate("Net {net}[[ on {board}]] reaches only {pin}.", { net: "x1", pin: "pin 37 on ESP32" })).toBe("Net x1 reaches only pin 37 on ESP32.");
    expect(fillTemplate("Net {net}[[ on {board}]].", { net: "x1", board: "Mainboard" })).toBe("Net x1 on Mainboard.");
    expect(fillTemplate("Net {net} on {board}.", { net: "x1" })).toBeUndefined();
  });
  it("names a link for a person (Kevin's shape: link name, holder, to the other interface and its holder)", () => {
    expect(humanLinkName({ name: "12 V barrel plug", a: { iface: "DC barrel plug 5.5 x 2.1 x 11 mm", holder: "12 V 3 A wall adapter" }, b: { iface: "12 V DC jack", holder: "Mainboard B1_4" } })).toBe(
      "12 V barrel plug (12 V 3 A wall adapter) to 12 V DC jack (Mainboard B1_4)",
    );
    expect(humanLinkName({ a: { iface: "Battery plug", holder: "Battery" }, b: { iface: "XT60 pads", holder: "ESC" } })).toBe("Battery plug (Battery) to XT60 pads (ESC)");
  });
});

/** ClientX's names, as projectNames reads them from its definitions (a small copy). */
const CLIENTX: NamedProject = {
  rootDef: { id: "clientx" },
  instances: [
    { path: "psu", definition: "supirit", name: "12 V 3 A wall adapter" },
    { path: "pcb", definition: "pcb-b1-4", name: "Mainboard B1_4 (rev-a)" },
    { path: "pcb/power", definition: "sec-power", name: "Power (12 V input, fan supply)" },
    { path: "pcb/power/power_in", definition: "power-in", name: "12 V input" },
    { path: "pcb/power/power_in/cs_12v", definition: "ina226", name: "CS_12V INA226 board-input current / bus monitor (I2C0 0x40)" },
    { path: "pcb/controller", definition: "sec-controller", name: "Controller (ESP32-S3, USB, sensors)" },
    { path: "pcb/controller/sensors", definition: "sensors", name: "Sensors" },
    { path: "pcb/controller/sensors/ps", definition: "bmp580", name: "PS BMP580 barometric pressure sensor (I2C0)" },
    { path: "fan_unit_1", definition: "fan-unit", name: "Fan unit 1" },
    { path: "fan_lead_1", definition: "fan-lead", name: "Fan 1 lead (4-pin PWM)", kind: "harness" },
  ],
  links: [
    { id: "psu_plug", owner: "", a: "psu:dc_plug", b: "pcb:dc_jack" },
    { id: "fan_lead_1_fan", owner: "", a: "fan_unit_1:fan_leads", b: "fan_lead_1:end_fan" },
    { id: "fan_lead_1_board", owner: "", a: "fan_lead_1:end_board", b: "pcb:fan_0" },
  ],
  lookup: (id) =>
    ({
      clientx: { id, name: "ClientX", links: [{ id: "psu_plug", name: "12 V barrel plug" }] },
      supirit: { id, name: "Supirit ZF120A-1203000 12 V 3 A wall adapter", interfaces: [{ id: "dc_plug", name: "DC barrel plug 5.5 x 2.1 x 11 mm (centre +)" }] },
      "pcb-b1-4": { id, name: "Mainboard B1_4 (rev-a)", exports: [{ id: "dc_jack", name: "12 V DC jack (12V_DCJ)" }, { id: "fan_0", name: "FAN0 header" }] },
      bmp580: { id, name: "Bosch BMP580", interfaces: [{ id: "pin_4", name: "SDI (I2C data)" }] },
    })[id],
};

describe("plainFinding on ClientX's findings", () => {
  const names: FindingNames = projectNames(CLIENTX);

  it("names the root link for people (D7)", () => {
    expect(names.link!("psu_plug~dc_12v_out~pin_1")).toBe("12 V barrel plug (12 V 3 A wall adapter) to 12 V DC jack (Mainboard B1_4)");
    // a run through a harness: the cable's name and the two ends it joins
    expect(names.link!("fan_lead_1_board+fan_lead_1_fan~gnd~pin_1")).toBe("Fan 1 lead: Mainboard B1_4 to Fan unit 1");
  });

  it("UHD_BUS_PULLUP: an I2C clock line by its net, on its board section", () => {
    const t = plainFinding(
      { code: "UHD_BUS_PULLUP", severity: "warning", entity: { kind: "interface", id: "pcb/power/:i2c0_scl" }, message: "pcb/power (clientx-mb-sec-power): net i2c0_scl carries I2C (power_in/cs_12v:pin_5) but no resistor pulls it up to a supply." },
      names,
    );
    expect(t).toEqual({ title: "I2C line has no pull-up", summary: "The I2C clock line i2c0_scl on Power needs a pull-up resistor to its supply; none is connected." });
  });

  it("UHD_LINK_STATE incompatible: the two ends, then the link by its human name", () => {
    const t = plainFinding(
      {
        code: "UHD_LINK_STATE",
        severity: "error",
        entity: { kind: "link", id: "psu_plug~dc_12v_out~pin_1" },
        message: "12 V DC output (plug centre) ↔ CENTER (+): incompatible — no compatible protocol/role between psu:dc_12v_out and pcb/power/power_in/n12v_dcj:pin_1",
      },
      names,
    );
    expect(t.title).toBe("Link protocols do not match");
    expect(t.summary.startsWith("12 V DC output and CENTER share no protocol, so they cannot connect as modelled: 12 V barrel plug (12 V 3 A wall adapter) to")).toBe(true);
    expect(t.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
  });

  it("UHD_INTERFACE_REUSE: the pin by its name on its part, in words", () => {
    const t = plainFinding(
      {
        code: "UHD_INTERFACE_REUSE",
        severity: "error",
        entity: { kind: "link", id: "pcb/controller/sensors/i2c0_sda.ps.pin_4+x~pin_4~pin_4" },
        message: "pcb (pcb-b1-4): controller/sensors/ps:pin_4 is linked 2 times (a~pin_4~pin_4, b~pin_4~pin_4) but supports 1.",
      },
      names,
    );
    expect(t).toEqual({ title: "Connection point used too many times", summary: "SDI on PS BMP580 barometric pressure sensor is wired twice, but it can take only 1 connection." });
  });

  it("UHD_UNPOWERED on a rail: the rail's own name and how many parts it feeds", () => {
    const t = plainFinding(
      { code: "UHD_UNPOWERED", severity: "warning", entity: { kind: "interface", id: "pcb/power:p5v_int" }, message: "pcb (pcb-b1-4): power:p5v_int (+5V_INT (net port)) is a net port feeding power/rail_3v3_int/u2:pin_3, outputs/fans/ls:pin_20, outputs/argb/sargb:pin_2, but no supply reaches it on net p5v_int." },
      names,
    );
    expect(t).toEqual({ title: "Power rail has no supply", summary: "Nothing supplies the +5V_INT rail on Mainboard B1_4, which feeds 3 parts." });
  });

  it("UHD_SUPPLY_BUDGET as an assumed branch (the drone's 4.5 V rail): the branch row", () => {
    const t = plainFinding({ code: "UHD_SUPPLY_BUDGET", severity: "info", entity: { kind: "link", id: "x" }, message: "stack:rail_4v5: branch of stack:bec_5v via diode (assumed); its 1 load(s) are budgeted there (assumed relation, not a cited source)." }, {});
    expect(t).toEqual({ title: "Supply fed from another supply", summary: "Rail 4v5 on stack is fed from bec 5v on stack through a diode; its loads are counted there." });
  });

  it("a code with no row: a title from the code name and the message's first sentence", () => {
    const t = plainFinding({ code: "PB_SOMETHING_NEW", message: "first part (with a. dot) here. Second sentence." }, names, {});
    expect(t).toEqual({ title: "Something new", summary: "First part (with a. dot) here." });
  });

  it("a variant row whose value the message lacks falls back to the code's own row", () => {
    const t = plainFinding({ code: "UHD_LINK_STATE", severity: "warning", entity: { kind: "link", id: "psu_plug" }, message: "12 V barrel plug: partial" }, names);
    expect(t.title).toBe("Link only partly matches");
    expect(t.summary.startsWith("12 V barrel plug (12 V 3 A wall adapter) to 12 V DC jack (Mainboard B1_4): the two ends of this connection do not agree")).toBe(true);
  });

  it("annotateFindings keeps a title and summary already there (an agent's rewrite) and fills the rest", () => {
    const list = annotateFindings(
      [
        { code: "UHD_UNPLACED", message: "no mechanical interface: not placed (strapped, glued or free)", entity: { kind: "instance", id: "psu" } },
        { code: "UHD_UNPLACED", message: "x", entity: { kind: "instance", id: "psu" }, title: "Kept", summary: "Kept." },
      ] as { code: string; message: string; entity: { kind: string; id: string }; title?: string; summary?: string }[],
      names,
    );
    expect(list[0].title).toBe("Not placed in 3D");
    expect(list[0].summary).toBe("12 V 3 A wall adapter has no mounting point, so it is not placed in the 3D assembly (strapped, glued or loose).");
    expect(list[1]).toMatchObject({ title: "Kept", summary: "Kept." });
  });
});
