import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_POINTS_PER_FINDING, bodyFor, findingsAnchors, glbToBody, severityOf, worst, type FindingInput, type SceneBody } from "../src/findings-anchors.js";

const here = dirname(fileURLToPath(import.meta.url));
const stackRoot = join(here, "..", "..", "..");

// a board placed at "pcb" (definition pcb-b1-4): z 0..1.6 mm, U13 on top at board (42.8, -78.5) mm
const board: SceneBody = {
  key: "pcb",
  definition: "pcb-b1-4",
  nodes: [
    { instancePath: "", bounds: { min: [0, 0, 0], max: [0.1, 0.0016, 0.1] } },
    { instancePath: "power/rail_5v_ext/u13", refdes: "U13", bounds: { min: [0.039807, 0.0016, 0.076102], max: [0.045807, 0.00332, 0.080917] } },
  ],
};
const bodies: SceneBody[] = [{ key: "shell" }, board, { key: "lid#cad_lid" }];

describe("findings to 3D anchors (PB-1184)", () => {
  it("converts glTF metres, Y up, to body mm, Z up", () => {
    expect(glbToBody([0.01, 0.002, 0.03])).toEqual([10, -30, 2]);
  });

  it("maps severities to marker shapes, worst first", () => {
    expect(severityOf({ severity: "error" })).toBe("fail");
    expect(severityOf({ severity: "warning" })).toBe("warn");
    expect(severityOf({ severity: "warning", risk: true })).toBe("risk");
    expect(severityOf({ severity: "info" })).toBe("info");
    expect(severityOf({ severity: "odd" })).toBe("unknown");
    expect(worst(["warn", "fail", "risk"])).toBe("fail");
    expect(worst([])).toBeUndefined();
  });

  it("finds the body that holds a path (longest placed path, artifact bodies only by their own path)", () => {
    expect(bodyFor(bodies, "pcb/power/rail_5v_ext/u13")?.key).toBe("pcb");
    expect(bodyFor(bodies, "lid")?.key).toBe("lid#cad_lid");
    expect(bodyFor(bodies, "lid/screw")).toBeUndefined();
    expect(bodyFor(bodies, "nothing")).toBeUndefined();
  });

  it("puts a component finding on top of the part, from the sidecar bounds", () => {
    const d: FindingInput = { code: "CIRCUIT_FOOTPRINT_MISMATCH", severity: "error", message: "x", entity: { kind: "definition", id: "pcb-b1-4" }, location: { components: ["power/rail_5v_ext/u13"] } };
    const [a] = findingsAnchors([d], bodies);
    expect(a.how).toBe("components");
    expect(a.severity).toBe("fail");
    expect(a.anchors[0].body).toBe("pcb");
    expect(a.anchors[0].component).toBe("pcb/power/rail_5v_ext/u13");
    expect(a.anchors[0].local![0]).toBeCloseTo(42.807, 3);
    expect(a.anchors[0].local![1]).toBeCloseTo(-78.51, 2);
    expect(a.anchors[0].local![2]).toBeCloseTo(3.32, 3);
    expect(a.refs).toEqual(["pcb/power/rail_5v_ext/u13"]);
  });

  it("finds a component by its reference designator", () => {
    const [a] = findingsAnchors([{ code: "X", severity: "warning", message: "x", entity: { kind: "instance", id: "pcb" }, location: { components: ["U13"] } }], bodies);
    expect(a.anchors[0].component).toBe("pcb/power/rail_5v_ext/u13");
  });

  it("puts points on the copper surface of their layer, deduplicated and capped", () => {
    const pts: [number, number][] = Array.from({ length: 40 }, (_, i) => [i, -i]);
    const d: FindingInput = { code: "CIRCUIT_VIA_UNDER_BODY", severity: "error", message: "vias", entity: { kind: "definition", id: "pcb-b1-4" }, location: { at: [0, 0], points: pts, layer: "bottom", components: ["U13"] } };
    const [a] = findingsAnchors([d], bodies);
    expect(a.how).toBe("points");
    expect(a.anchors).toHaveLength(MAX_POINTS_PER_FINDING);
    expect(a.anchors[1].local).toEqual([1, -1, 0]);
    expect(findingsAnchors([{ ...d, location: { at: [5, 6], layer: "top" } }], bodies)[0].anchors[0].local).toEqual([5, 6, 1.6]);
    expect(findingsAnchors([{ ...d, location: { at: [5, 6], layer: "inner1" } }], bodies)[0].anchors[0].local).toEqual([5, 6, 0.8]);
    // the parts it names are what isolate shows
    expect(a.refs).toEqual(["pcb/power/rail_5v_ext/u13"]);
  });

  it("gives deterministic ids, numbering repeats", () => {
    const d: FindingInput = { code: "UHD_LINK_STATE", severity: "error", message: "m", entity: { kind: "link", id: "j3" } };
    const out = findingsAnchors([d, d], bodies, { entityAnchor: () => ({ body: "shell", local: [1, 2, 3] }) });
    expect(out.map((o) => o.id)).toEqual(["drc:UHD_LINK_STATE:link:j3", "drc:UHD_LINK_STATE:link:j3#2"]);
    expect(out[0].how).toBe("entity");
    expect(out[0].anchors[0]).toEqual({ body: "shell", local: [1, 2, 3] });
    expect(findingsAnchors([d, d], bodies, { entityAnchor: () => ({ body: "shell" }) }).map((o) => o.id)).toEqual(out.map((o) => o.id));
  });

  it("anchors a whole-design finding on its body, and an instance finding on what it names", () => {
    expect(findingsAnchors([{ code: "D", severity: "warning", message: "", entity: { kind: "definition", id: "pcb-b1-4" }, location: { scope: "design" } }], bodies)[0]).toMatchObject({ how: "design", anchors: [{ body: "pcb" }] });
    const [p] = findingsAnchors([{ code: "P", severity: "warning", message: "", entity: { kind: "instance", id: "pcb/power/rail_5v_ext/u13" } }], bodies);
    expect(p.how).toBe("entity");
    expect(p.anchors[0].component).toBe("pcb/power/rail_5v_ext/u13");
  });

  it("lists a finding with nothing placed under it with a reason, never somewhere else", () => {
    const out = findingsAnchors(
      [
        { code: "PB_CATALOG", severity: "warning", message: "", entity: { kind: "project", id: "parts/origins.json" } },
        { code: "GONE", severity: "error", message: "", entity: { kind: "instance", id: "nothing/here" } },
        { code: "DEF", severity: "error", message: "", entity: { kind: "definition", id: "not-placed" }, location: { components: ["u1"] } },
      ],
      bodies,
    );
    expect(out.map((o) => o.how)).toEqual(["none", "none", "none"]);
    expect(out.map((o) => o.anchors.length)).toEqual([0, 0, 0]);
    expect(out[0].reason).toMatch(/project/);
    expect(out[1].reason).toMatch(/nothing placed/);
    expect(out[2].reason).toMatch(/not-placed/);
  });

  it("drops info unless asked", () => {
    const d: FindingInput = { code: "I", severity: "info", message: "", entity: { kind: "instance", id: "shell" } };
    expect(findingsAnchors([d], bodies)).toHaveLength(0);
    expect(findingsAnchors([d], bodies, { includeInfo: true })[0].severity).toBe("info");
  });
});

describe("shared findings-anchors file", () => {
  // the viewer maps findings with the same file: they must not drift
  const viewerLink = join(stackRoot, "node_modules", "@deltarobotics", "uhd-viewer");
  const viewer = existsSync(viewerLink) ? realpathSync(viewerLink) : undefined;
  const copy = viewer ? join(viewer, "src", "cad", "annot", "findings-anchors.ts") : "";
  it.skipIf(!viewer || !existsSync(copy))("is identical in core and the linked uhd-viewer checkout", () => {
    const a = readFileSync(join(here, "..", "src", "findings-anchors.ts"), "utf8").replace(/\r\n/g, "\n");
    const b = readFileSync(copy, "utf8").replace(/\r\n/g, "\n");
    expect(b).toBe(a);
  });
});
