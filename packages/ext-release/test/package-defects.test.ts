/**
 * Package defects from the eval trials (PB-870), on the desk-rover fixture
 * (ext-hardware's e2e-desk-rover eval: an Arduino UNO R3 with the Adafruit
 * Motor Shield V2 stacked on it and a VL53L4CD on the I2C bus, its parts from
 * examples/uno-motor-bench), copied into a scratch folder:
 *
 *   - inputs left unconnected on purpose (UHD ChildModuleRef.unconnected) get
 *     no bench-supply row; checks that read an open input (the shield's motor
 *     outputs) come after a temporary-supply step on it;
 *   - the bus scan lists every address a device answers at (the PCA9685's
 *     all-call 0x70, as the part's next revision states it);
 *   - a cable made by hand (no cad provider) has its cut list in the package,
 *     and the work order and test plan name that file;
 *   - the shield is lowered onto the UNO, not the UNO onto the shield;
 *   - a part whose headers ship loose gets a soldering step before it is fitted.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadProject, sha256 } from "@protoboardai/core";
import { BASELINE } from "../lib/sections/baseline.ts";
import { unitTests } from "../lib/sections/tests.ts";
import { testContexts } from "../lib/testing.ts";
import type { Block, SectionContribution, Step } from "../lib/types.ts";
import { unitPlan } from "@protoboardai/ext-docs/plan";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EVAL = join(HERE, "../../ext-hardware/evals/e2e-desk-rover");
const PARTS = join(HERE, "../../../examples/uno-motor-bench/parts");
const TMP = join(HERE, ".tmp/defects");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const SHIELD = "adafruit-1438-motor-shield-v2";
const LEAD = `import { Connector, type ModuleDef } from "@deltarobotics/uhd";
export const TOF_LEAD = {
  id: "tof-lead", name: "ToF lead", kind: "harness", topology: "wire",
  interfaces: [
    Connector({ id: "end_uno", name: "UNO end", connector: "dupont_2_54", pins: ["5V", "GND", "SDA", "SCL"] }),
    Connector({ id: "end_tof", name: "ToF end", connector: "solder_leads", pins: ["VIN", "GND", "SDA", "SCL"] }),
  ],
  links: [{ id: "wires", name: "Conductors", a: { self: true, interfaceId: "end_uno" }, b: { self: true, interfaceId: "end_tof" } }],
  traits: [
    { type: "performance", params: { kind: "cable", length_mm: 150, conductors: 4 } },
    { type: "cable_build", params: { colors: ["red", "black", "blue", "yellow"], bundle: "parallel", od_mm: 1.2, note: "four AWG26 jumper wires" } },
  ],
} as ModuleDef;
`;

/**
 * The fixture project: `marks` adds the unconnected marks, `lead` a hand-made cable, `revised` the shield's
 * next revision (the all-call address as a parameter, the shield headers supplied loose), re-pinned by digest.
 */
function project(name: string, o: { marks?: boolean; lead?: boolean; revised?: boolean } = {}): string {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(EVAL, "fixture"), dir, { recursive: true });
  cpSync(PARTS, join(dir, "parts"), { recursive: true });
  let src = readFileSync(join(EVAL, "solution/desk-rover.uhd.ts"), "utf8");
  // the solution marks the open inputs; without marks is the model before PB-870
  if (!o.marks) src = src.replace(/\n\s*unconnected: \[[^\]]*\],/g, "");
  expect(src.includes("unconnected:")).toBe(Boolean(o.marks));
  if (o.lead) {
    src = src.replace('{ id: "tof", moduleDefId: "adafruit-5396-vl53l4cd", name: "ToF sensor" },', '{ id: "tof", moduleDefId: "adafruit-5396-vl53l4cd", name: "ToF sensor" },\n    { id: "tof_lead", moduleDefId: "tof-lead" },');
    writeFileSync(join(dir, "src/tof-lead.uhd.ts"), LEAD);
  }
  writeFileSync(join(dir, "src/desk-rover.uhd.ts"), src);
  if (o.revised) {
    const file = join(dir, `parts/catalog/${SHIELD}.json`);
    const json = JSON.parse(readFileSync(file, "utf8"));
    const def = json.module ?? json;
    for (const i of def.interfaces) {
      if (i.id === "i2c") i.parameters.push({ id: "i2c_address_all_call", unit: "dimensionless", value: 0x70 });
      for (const t of i.traits ?? []) if (t.type === "connector" && /shield header/.test(t.params?.note ?? "")) t.params.supplied = "loose";
    }
    const bytes = Buffer.from(JSON.stringify(json, null, 2));
    writeFileSync(file, bytes);
    const origins = JSON.parse(readFileSync(join(dir, "parts/origins.json"), "utf8"));
    origins.definitions[SHIELD].digest = sha256(bytes);
    // the simulated revision is vendored compiled: the shield's vendored source (PB-910) is the unrevised one
    delete origins.definitions[SHIELD].source;
    writeFileSync(join(dir, "parts/origins.json"), JSON.stringify(origins, null, 2));
  }
  return dir;
}

async function sections(dir: string) {
  const p = await loadProject(dir, { checks: false });
  const t = testContexts(p);
  const u = t.units.find((x) => x.kind === "root")!;
  const tests = unitTests(p, u, await unitPlan(p, u));
  const one = async (sec: "work-order" | "assembly" | "test-plan") => [await BASELINE[sec](t.context("system", sec))].flat()[0] as SectionContribution;
  const steps = (c: SectionContribution) => c.blocks.flatMap((b: Block) => (b.kind === "steps" ? b.steps : [])) as Step[];
  return { p, t, tests, workOrder: steps(await one("work-order")), assembly: steps(await one("assembly")) };
}

const bench = (items: { check: string; how: string }[]) => items.filter((x) => x.check === "Power up").map((x) => /\(([^()]+)\), current limit/.exec(x.how)?.[1]);

describe("test plan: inputs left unconnected on purpose", () => {
  it("reproduced: without marks, every open input gets a bench-supply row and the motor outputs read an unpowered input", async () => {
    const { tests } = await sections(project("plain"));
    expect(bench(tests.items)).toEqual(["uno:vin", "uno:usb", "uno:dc_jack", "shield:arduino_vin", "shield:vmotor_in"]);
    expect(tests.items.some((x) => x.check === "Temporary supply")).toBe(false);
  });

  it("marked inputs get no bench-supply row; the motor outputs come after a temporary supply on the motor terminal", async () => {
    const { tests } = await sections(project("marked", { marks: true }));
    expect(bench(tests.items)).toEqual(["uno:usb"]);
    const bu = tests.items.filter((x) => x.group === "bringup");
    const supply = bu.findIndex((x) => x.check === "Temporary supply");
    expect(bu[supply].trace).toBe("shield:vmotor_in");
    expect(bu[supply].how).toMatch(/^Connect a second current-limited bench supply to .*Motor power \+ \(shield:vmotor_in\).*disconnect it when the bring-up is done \(unconnected in the product: stays unconnected until the rover's battery is chosen \(R5\)\)$/);
    // every check on the motor outputs follows it, and says so
    const motor = bu.map((x, i) => [x, i] as const).filter(([x]) => /shield:(m\d[ab]|dc_motor_output)\)/.test(x.subject));
    expect(motor.length).toBe(9);
    for (const [x, i] of motor) {
      expect(i).toBeGreaterThan(supply);
      expect(x.how).toMatch(/with the temporary supply on/);
      expect(x.pass).toMatch(/read on Motor power \+/);
    }
    // the logic rails from USB need no temporary supply
    const rail5 = bu.findIndex((x) => x.subject.includes("(uno:5v)"));
    expect(rail5).toBeGreaterThan(-1);
    expect(rail5).toBeLessThan(supply);
  });
});

describe("test plan: I2C addresses", () => {
  it("reproduced: the scan lists only the shield's own address", async () => {
    const { tests } = await sections(project("plain-scan"));
    expect(tests.items.find((x) => x.check === "Bus scan")!.pass).toBe("answers at 0x60 (Adafruit Motor/Stepper/Servo Shield v2.3), 0x29 (Adafruit VL53L4CD Time of Flight Distance Sensor (STEMMA QT)); nothing else unexpected");
  });

  it("the scan lists the all-call address the part declares", async () => {
    const { tests } = await sections(project("revised-scan", { revised: true }));
    expect(tests.items.find((x) => x.check === "Bus scan")!.pass).toBe(
      "answers at 0x60 (Adafruit Motor/Stepper/Servo Shield v2.3), 0x70 (Adafruit Motor/Stepper/Servo Shield v2.3, all-call address), 0x29 (Adafruit VL53L4CD Time of Flight Distance Sensor (STEMMA QT)); nothing else unexpected",
    );
  });
});

describe("package: a cable made without a cad provider", () => {
  it("packages its cut list, and the work order and test plan name the packaged file", async () => {
    const { t, tests, workOrder } = await sections(project("lead", { lead: true }));
    const path = "system/files/harnesses/tof-lead/cut-list.csv";
    const file = t.files.find((f) => f.path === path)!;
    expect(String(file.content).split("\n")[0]).toBe("conductor,from,to,colour,length_mm,supplied_length_mm,gauge_awg,od_mm,strip_mm,lay,note");
    expect(tests.items.find((x) => x.check === "Conductor order")!.how).toBe("Against the cut list (files/harnesses/tof-lead/cut-list.csv); a continuity tester end to end");
    const make = workOrder.find((s) => s.title === "Make the ToF lead")!;
    expect(make.actions?.[0]).toBe("Cut to 150 mm, as files/harnesses/tof-lead/cut-list.csv.");
    // no step or check names a cut list the package does not hold
    const named = [...workOrder.flatMap((s) => s.actions ?? []), ...tests.items.map((x) => x.how)].flatMap((x) => x.match(/files\/harnesses\/[^/]+\/cut-list\.csv/g) ?? []);
    for (const n of named) expect(t.files.some((f) => f.path === `system/${n}`)).toBe(true);
  });
});

describe("assembly: stacking and header soldering", () => {
  it("lowers the shield onto the UNO", async () => {
    const { workOrder, assembly } = await sections(project("stack"));
    const mate = workOrder.find((s) => s.actions?.some((a) => /^Lower /.test(a)))!;
    expect(mate.actions!.find((a) => /^Lower /.test(a))).toMatch(/^Lower the Adafruit Motor\/Stepper\/Servo Shield v2\.3 onto the mounting holes, top \(UNO R3 shield diagonal pair/);
    // the plain assembly guide has the work order's steps, in its order
    expect(assembly.map((s) => s.title)).toEqual(workOrder.filter((s) => /^Assembly guide step /.test(s.actions?.[0] ?? "")).map((s) => s.title));
  });

  it("solders the shield's loose headers before the shield is fitted, with a joint check", async () => {
    const { tests, workOrder, assembly } = await sections(project("headers", { revised: true }));
    const title = "Solder the header strips to the Adafruit Motor/Stepper/Servo Shield v2.3";
    expect(assembly[0].title).toBe(title);
    expect(assembly[0].tools).toEqual(["soldering iron"]);
    expect(assembly[0].actions?.[0]).toMatch(/ships with its header strips loose \(Arduino UNO R3 shield header \(plain or stacking header, soldered by the user\)\): solder them before the part is fitted\.$/);
    const at = (t: string) => workOrder.findIndex((s) => s.title === t);
    const solder = workOrder[at(title)];
    expect(solder.actions?.[0]).toBe("Assembly guide step 1.");
    expect(at(title)).toBeLessThan(workOrder.findIndex((s) => s.actions?.some((a) => /^Lower the Adafruit/.test(a))));
    const jt = tests.items.find((x) => x.id === solder.test)!;
    expect(jt.check).toBe("Solder joints");
    expect(solder.inspect).toBe("every pin soldered, no bridges; strips flush and square");
  });
});
