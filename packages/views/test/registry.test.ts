/** The view registry and its predicates (docs/specs/viewer-stack.md). */
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import { describe, expect, it, vi } from "vitest";
import { ViewRegistry, registerContributedViews } from "../src/registry.js";
import { appliesFromDecl, hasArtifact, hasFile } from "../src/applies.js";

const mod = (id: string, extra: Partial<ModuleDef> = {}): ModuleDef => ({ id, name: id, interfaces: [], ...extra });
const board = mod("board", { categories: ["electronics.board.custom"], artifacts: [{ id: "sch", type: "drawing", filePath: "out/schematic.svg" } as never, { id: "glb", type: "cad", filePath: "out/board.glb?v=2" } as never] });
const root = mod("root", { children: [{ id: "b", moduleDefId: "board" }, { id: "m", moduleDefId: "motor" }] });
const motor = mod("motor");
const bundle: UhdBundle = { schema: "uhd.bundle/v0", root: "root", definitions: [root, board, motor] };
const view = (id: string, order?: number, applies = () => true) => ({ id, title: id, icon: "box", order, applies });

describe("ViewRegistry", () => {
  it("keys views by id and lists them in tab order", () => {
    const r = new ViewRegistry();
    r.register(view("pcb", 30));
    r.register(view("diagram", 0));
    r.register(view("ext-x.extra"));
    expect(r.list().map((v) => v.id)).toEqual(["diagram", "pcb", "ext-x.extra"]);
    expect(r.get("pcb")?.status).toBe("planned");
    expect(r.register.bind(r, view("Bad id"))).toThrow(/lowercase/);
  });

  it("refuses a second view with the same id unless it replaces it, and undoes either", () => {
    const r = new ViewRegistry();
    r.register(view("bom", 40));
    expect(() => r.register(view("bom"))).toThrow(/already registered/);
    const Comp = () => null;
    const undo = r.register({ ...view("bom", 40), component: Comp }, { replace: true });
    expect(r.get("bom")?.status).toBe("ready");
    undo();
    expect(r.get("bom")?.status).toBe("planned");
  });

  it("offers a module only the views that apply to it", () => {
    const r = new ViewRegistry();
    r.register(view("diagram", 0));
    r.register({ ...view("schematic", 20), applies: (m) => hasFile(m, bundle, ["schematic.svg"]) });
    r.register({ ...view("broken", 99), applies: () => { throw new Error("no"); } });
    expect(r.forModule(board, bundle, "b").map((v) => v.id)).toEqual(["diagram", "schematic"]);
    expect(r.forModule(motor, bundle, "m").map((v) => v.id)).toEqual(["diagram"]);
  });

  it("tells subscribers about changes", () => {
    const r = new ViewRegistry();
    const seen = vi.fn();
    const off = r.subscribe(seen);
    const undo = r.register(view("diagram"));
    undo();
    off();
    r.register(view("pcb"));
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("predicates", () => {
  it("match standard-output file names on the module or below it", () => {
    expect(hasFile(board, bundle, ["schematic.svg"])).toBe(true);
    expect(hasFile(root, bundle, ["schematic.svg"])).toBe(false);
    expect(hasFile(root, bundle, ["schematic.svg"], true)).toBe(true);
    expect(hasArtifact(root, bundle, (n) => n.endsWith(".glb"))).toBe(true);
    expect(hasArtifact(motor, bundle, (n) => n.endsWith(".glb"))).toBe(false);
  });

  it("follow a manifest's appliesTo: every condition given", () => {
    expect(appliesFromDecl(undefined)(motor, bundle)).toBe(true);
    const rootOnly = appliesFromDecl({ root: true });
    expect(rootOnly(root, bundle)).toBe(true);
    expect(rootOnly(root, bundle, { path: "b" })).toBe(false);
    expect(appliesFromDecl({ categories: ["electronics.board"] })(board, bundle)).toBe(true);
    expect(appliesFromDecl({ categories: ["electronics.boa"] })(board, bundle)).toBe(false);
    expect(appliesFromDecl({ root: true, files: ["schematic.svg"], descendants: true })(root, bundle, { path: "" })).toBe(true);
    expect(appliesFromDecl({ root: true, files: ["schematic.svg"] })(root, bundle, { path: "" })).toBe(false);
  });
});

describe("contributed views", () => {
  it("register from manifests, ready with a component, and take over a planned built-in", () => {
    const r = new ViewRegistry();
    r.register({ ...view("schematic", 20), source: "builtin" });
    r.register({ ...view("diagram", 0), component: () => null, source: "builtin" });
    const Comp = () => null;
    const result = registerContributedViews(
      r,
      [
        { id: "schematic", title: "Schematic", icon: "circuit-board", extension: "ext-tscircuit", appliesTo: { files: ["schematic.svg"] } },
        { id: "diagram", title: "Mine", icon: "box", extension: "ext-x" },
        { id: "ext-x.thermal", title: "Thermal", icon: "thermometer", extension: "ext-x", order: 70 },
      ],
      { schematic: Comp },
    );
    expect(result.registered).toEqual(["schematic", "ext-x.thermal"]);
    expect(result.skipped.map((s) => s.id)).toEqual(["diagram"]);
    expect(r.get("schematic")).toMatchObject({ status: "ready", source: "ext-tscircuit", component: Comp });
    expect(r.get("ext-x.thermal")).toMatchObject({ status: "planned", order: 70 });
    expect(r.forModule(motor, bundle, "m").map((v) => v.id)).toEqual(["diagram", "ext-x.thermal"]);
  });
});
