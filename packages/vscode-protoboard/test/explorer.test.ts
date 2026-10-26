/**
 * The Explorer's tree from a build: hierarchy, kinds (boards, enclosures,
 * harnesses, fastener stacks), interface and link sections, badges, the
 * filter, where a module is written and which module a cursor is in; then
 * the same on the real CLI's build of the quadcopter example.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildArtifactFile, buildArtifacts } from "../src/artifacts.js";
import { parseCheck } from "../src/check.js";
import { parseJsonOutput, resolveCli, runCli } from "../src/cli.js";
import { diagnosticTarget, indexProject, isStaleCode, linkFromViewer, readBuild, RESOLVED_FILE, BUNDLE_FILE, viewerMessages } from "../src/model.js";
import { childDeclarationLine, idLine, instanceAtCursor, instanceSource, projectRelative } from "../src/source.js";
import { buildTree, filterTree, nodeMap, placeFindings, walk, type ExplorerNode } from "../src/tree.js";
import { bundle, resolved } from "./fixtures.js";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

const tree = () => buildTree(indexProject(resolved, bundle));
const byKey = () => nodeMap(tree());
const labels = (nodes: ExplorerNode[]) => nodes.map((n) => n.label);

describe("Explorer tree", () => {
  it("is the root system with its instances by hierarchy, in declaration order", () => {
    const [root] = tree();
    expect(root).toMatchObject({ key: "i:", label: "Smart watch", kind: "system", path: "" });
    expect(labels(root.children)).toEqual(["Main board", "Case", "Strap", "Flex cable", "Case screws", "Spare LED", "Links"]);
    const board = byKey().get("i:board")!;
    expect(labels(board.children)).toEqual(["MCU", "Status LED", "Interfaces", "Links"]);
    expect(byKey().get("i:board/led")!.parentKey).toBe("i:board");
  });

  it("names what each module is: boards and enclosures by their capability, harnesses, fastener stacks, groups, parts", () => {
    const k = byKey();
    expect(k.get("i:board")!.kind).toBe("board");
    expect(k.get("i:case")!.kind).toBe("enclosure");
    expect(k.get("i:strap")!.kind).toBe("group");
    expect(k.get("i:flex")!.kind).toBe("harness");
    expect(k.get("i:screws")!.kind).toBe("fasteners");
    expect(k.get("i:board/mcu")!.kind).toBe("part");
  });

  it("lists interfaces (exports included) and the links a module declares in short sections", () => {
    const k = byKey();
    expect(k.get("s:board:interfaces")!.children.map((c) => [c.label, c.description])).toEqual([["usb", "USB-C · from mcu:usb"]]);
    expect(k.get("s:board/mcu:interfaces")!.description).toBe("2");
    expect(k.get("if:board/mcu:usb")!.description).toBe("USB · electrical · usb2");
    // root links named by the bundle; a sub-assembly's link by its local id
    expect(k.get("s::links")!.children.map((c) => [c.label, c.description])).toEqual([
      ["Board to flex", "board:fpc ↔ flex:end_a"],
      ["case_mount", "case:boss ↔ board:holes"],
    ]);
    expect(k.get("l:board:mcu_led")).toMatchObject({ label: "mcu_led", path: "board", linkId: "board:mcu_led" });
  });

  it("badges: tier, quantity and stale outputs in the description; the worst finding here or below", () => {
    const k = byKey();
    expect(k.get("i:board/led")!.description).toBe("×2 · researched");
    expect(k.get("i:board/mcu")!.description).toBe("catalog");
    expect(k.get("i:case")).toMatchObject({ stale: true, description: "project · stale outputs", worst: "warning" });
    // a definition's finding is on every instance of it
    expect(k.get("i:spare_led")!.counts).toEqual({ error: 0, warning: 1, info: 0 });
    expect(k.get("i:board/led")!.counts.warning).toBe(1);
    // the link's error rolls up to the board and the root
    expect(k.get("l:board:mcu_led")!.counts.error).toBe(1);
    expect(k.get("i:board")!.worst).toBe("error");
    expect(k.get("i:")!.worst).toBe("error");
    expect(k.get("i:strap")!.worst).toBe("info");
    expect(k.get("i:flex")!.worst).toBeUndefined();
    // the root's own: the project, the interface finding on its definition, a derived link
    expect(k.get("i:")!.counts).toEqual({ error: 0, warning: 1, info: 1 });
    expect(k.get("l:board_flex")!.counts.info).toBe(1);
  });

  it("offers the capability operations of a module with a provider config, and artifacts where there are files or links", () => {
    const k = byKey();
    expect(k.get("i:board")!.ops).toEqual(["circuit:generate", "circuit:export", "circuit:extract", "circuit:check"]);
    expect(k.get("i:board/mcu")!.ops).toEqual([]);
    expect(k.get("i:board/mcu")!.hasArtifacts).toBe(true);
    expect(k.get("i:case")!.hasArtifacts).toBe(false);
  });

  it("filters by every word, keeping the ancestors that lead to a match, expanded", () => {
    const { nodes, expanded } = filterTree(tree(), "status led");
    expect([...walk(nodes)].map((n) => n.key)).toEqual(["i:", "i:board", "i:board/led", "s:board/led:interfaces", "if:board/led:anode"]);
    expect([...expanded].sort()).toEqual(["i:", "i:board"]);
    // instance paths, definition ids and link ids match too; nothing matches: nothing shown
    expect([...walk(filterTree(tree(), "strap/pin").nodes)].map((n) => n.key)).toContain("i:strap/pin");
    expect([...walk(filterTree(tree(), "mcu_led").nodes)].map((n) => n.key)).toContain("l:board:mcu_led");
    expect(filterTree(tree(), "nothing-like-this").nodes).toEqual([]);
    expect(filterTree(tree(), "  ").nodes).toEqual(tree());
  });

  it("is empty without a root instance", () => {
    expect(buildTree(indexProject({ ...resolved, instances: [] }))).toEqual([]);
  });
});

describe("what a finding is about", () => {
  const index = indexProject(resolved, bundle);
  it("instances, definitions at their first instance, artifacts by definition, links at their owner, the project at the root", () => {
    expect(diagnosticTarget(index, { entity: { kind: "instance", id: "strap/pin" } })).toEqual({ path: "strap/pin", defId: "pin", label: "Pin (strap/pin)" });
    expect(diagnosticTarget(index, { entity: { kind: "definition", id: "led" } })).toEqual({ defId: "led", path: "board/led", label: "LED" });
    expect(diagnosticTarget(index, { entity: { kind: "artifact", id: "mcu#cad_vendor" } })).toMatchObject({ defId: "mcu", path: "board/mcu" });
    expect(diagnosticTarget(index, { entity: { kind: "link", id: "board:mcu_led" } })).toEqual({ path: "board", defId: "mainboard", linkId: "board:mcu_led", label: "board:mcu_led", module: "Main board (board)" });
    // a derived link: the first link it runs through
    expect(diagnosticTarget(index, { entity: { kind: "link", id: "board_flex+case_mount~vbat~vin" } })).toMatchObject({ linkId: "board_flex", derivedId: "board_flex+case_mount~vbat~vin", path: "" });
    expect(diagnosticTarget(index, { entity: { kind: "link", id: "board:mcu_led" } }).derivedId).toBeUndefined();
    expect(diagnosticTarget(index, { entity: { kind: "interface", id: "board/mcu:usb" } })).toMatchObject({ path: "board/mcu", label: "board/mcu:usb" });
    expect(diagnosticTarget(index, { entity: { kind: "project", id: "watch" } })).toMatchObject({ path: "", label: "Smart watch" });
    expect(diagnosticTarget(index, { entity: { kind: "instance", id: "gone" } })).toEqual({ label: "gone" });
  });

  it("puts a finding on a definition with no instance on the root system", () => {
    const d = { code: "HW_NO_SOURCES", severity: "warning" as const, entity: { kind: "definition", id: "unused-part" }, message: "no sources", validator: "x" };
    const lone = indexProject({ ...resolved, definitions: [...resolved.definitions, { id: "unused-part", kind: "module", origin: { kind: "local", tier: "project-specific", source: { file: "parts/unused.uhd.ts" } } }] }, bundle);
    expect(placeFindings(lone, [d]).get("i:")).toEqual([d]);
  });

  it("knows which codes mean stale generated outputs", () => {
    for (const c of ["ENCLOSURE_STALE", "CIRCUIT_STALE", "FRAME_CAD_EXPORT_STALE", "HARNESS_ROUTE_STALE", "PB_OUTPUT_NOT_EXPORTED"]) expect(isStaleCode(c), c).toBe(true);
    for (const c of ["SRC_STALE", "UHD_LINK_STATE", "STALE_NOTHING"]) expect(isStaleCode(c), c).toBe(false);
  });
});

describe("where a module is written", () => {
  const index = indexProject(resolved, bundle);
  const files: Record<string, string> = {
    "src/watch.uhd.ts": ["// watch", ...Array(8).fill(""), "export const watch = defineModule({", '  id: "watch",', "  children: [", '    { id: "board", moduleDefId: "mainboard" },', '    { id: "case", moduleDefId: "case" },', "  ],", "});"].join("\n"),
    "src/boards/mainboard/mainboard.uhd.ts": ['import x from "y";', "", "", "", "export const mainboard = defineModule({", '  id: "mainboard",', "  children: [", "    { id: 'mcu', moduleDefId: 'mcu' },", "    { id: `led`, moduleDefId: 'led' },", "  ],", "});"].join("\n"),
  };
  const read = (f: string) => files[f];

  it("finds a child's declaration from its parent's definition line down", () => {
    expect(childDeclarationLine(files["src/watch.uhd.ts"], "case", 10)).toBe(14);
    expect(childDeclarationLine('{"id": "mcu"}', "mcu")).toBe(1);
    expect(childDeclarationLine(files["src/watch.uhd.ts"], "case", 15)).toBeUndefined();
    // ids are matched whole, with any quote
    expect(childDeclarationLine('{ id: "board2" }\n{ id: "board" }', "board")).toBe(2);
    // a link declared through a helper: the line that quotes its id
    expect(idLine('x\nlink("battery_plug2", a, b),\nlink("battery_plug", a, b),', "battery_plug")).toBe(3);
    expect(idLine('{ id: "usb" }', "usb")).toBe(1);
    expect(idLine("nothing", "usb")).toBeUndefined();
  });

  it("puts an instance at its declaration in the parent system, the root at its definition", () => {
    expect(instanceSource(index, "case", read)).toEqual({ file: "src/watch.uhd.ts", line: 14 });
    expect(instanceSource(index, "board/led", read)).toEqual({ file: "src/boards/mainboard/mainboard.uhd.ts", line: 9 });
    expect(instanceSource(index, "", read)).toEqual({ file: "src/watch.uhd.ts", line: 10 });
    // the parent's file cannot be read: the instance's own definition
    expect(instanceSource(index, "strap/pin", read)).toEqual({ file: "parts/catalog/pin.json" });
    expect(instanceSource(index, "missing", read)).toBeUndefined();
  });

  it("finds the module a cursor is in: the definition above it, or the child declared on its line", () => {
    const at = (line: number, file = "src/boards/mainboard/mainboard.uhd.ts", prefer?: string) => instanceAtCursor(index, file, line, (read(file) ?? "").split("\n")[line - 1] ?? "", prefer);
    expect(at(6)).toBe("board");
    expect(at(8)).toBe("board/mcu");
    expect(at(9)).toBe("board/led");
    expect(at(2)).toBeUndefined();
    expect(at(13, "src/watch.uhd.ts")).toBe("board");
    expect(at(11, "src/watch.uhd.ts")).toBe("");
    // a definition used twice: the selected instance wins
    expect(instanceAtCursor(index, "parts/local/led.uhd.ts", 5, "", undefined)).toBe("board/led");
    expect(instanceAtCursor(index, "parts/local/led.uhd.ts", 5, "", "spare_led")).toBe("spare_led");
    expect(projectRelative("/p", "/p/src/a.uhd.ts")).toBe("src/a.uhd.ts");
    expect(projectRelative("/p", "/q/a.ts")).toBeUndefined();
  });
});

describe("artifacts from the build", () => {
  const index = indexProject(resolved, bundle);
  it("resolves project and package files, keeps links, and leaves out references with nothing to open", () => {
    expect(buildArtifactFile("/p", "parts/catalog/mcu/cad/mcu.step")).toBe("/p/parts/catalog/mcu/cad/mcu.step");
    expect(buildArtifactFile("/w/p", "package:@acme/parts/led.glb", (f) => f === "/w/node_modules/@acme/parts/led.glb")).toBe("/w/node_modules/@acme/parts/led.glb");
    expect(buildArtifactFile("/w/p", "package:plain/x.glb", () => false)).toBeUndefined();
    const mcu = buildArtifacts("/p", index, "mcu")!;
    expect(mcu).toMatchObject({ definition: "mcu", label: "MCU", instances: ["board/mcu"] });
    expect(mcu.artifacts.map((a) => [a.id, a.resolved ?? a.url])).toEqual([
      ["datasheet", "https://example.com/mcu.pdf"],
      ["cad_step", "/p/parts/catalog/mcu/cad/mcu.step"],
    ]);
    // a package file that is not installed is not offered
    expect(buildArtifacts("/nowhere", index, "led", () => false)).toBeUndefined();
    expect(buildArtifacts("/p", index, "case")).toBeUndefined();
  });
});

describe("modules and links in the viewer", () => {
  const index = indexProject(resolved, bundle);
  it("focuses a module; drills to a link's owner and selects it by its canonical path", () => {
    expect(viewerMessages({ path: "board/mcu" })).toEqual([{ type: "uhd-viewer:focus", path: "board/mcu" }]);
    expect(viewerMessages({ path: "", linkId: "board_flex" })).toEqual([
      { type: "uhd-viewer:focus", path: "" },
      { type: "uhd-viewer:select", ids: ["board_flex"] },
    ]);
    expect(viewerMessages({ path: "board", linkId: "board:mcu_led" })).toEqual([
      { type: "uhd-viewer:drill", path: "board" },
      { type: "uhd-viewer:select", ids: ["board/mcu_led", "board"] },
    ]);
    // a derived link by its own id first, then the link it starts with
    expect(viewerMessages(diagnosticTarget(index, { entity: { kind: "link", id: "board_flex+case_mount~vbat~vin" } }) as { path: string })).toEqual([
      { type: "uhd-viewer:focus", path: "" },
      { type: "uhd-viewer:select", ids: ["board_flex+case_mount~vbat~vin", "board_flex"] },
    ]);
  });

  it("maps the viewer's link selections (canonical paths, derived links) to resolved.json's links", () => {
    expect(linkFromViewer(index, "board/mcu_led")?.id).toBe("board:mcu_led");
    expect(linkFromViewer(index, "board_flex")?.id).toBe("board_flex");
    expect(linkFromViewer(index, "board_flex+case_mount~vbat~vin")?.id).toBe("board_flex");
    expect(linkFromViewer(index, "mcu_led")).toBeUndefined();
    expect(linkFromViewer(index, "board/nothing")).toBeUndefined();
  });
});

describe("the real CLI's build of the quadcopter", () => {
  it("gives a tree with every instance, its fastener stacks, harnesses and cad structures, and places every finding", async () => {
    const root = join(REPO, "examples", "quadcopter-5in");
    const r = await runCli(resolveCli(root), ["build", "--format", "json"], { cwd: root });
    parseJsonOutput(r, "protoboard build");
    expect(existsSync(join(root, RESOLVED_FILE))).toBe(true);
    expect(existsSync(join(root, BUNDLE_FILE))).toBe(true);
    const build = readBuild(root)!;
    expect(build.bundle).toBeDefined();
    // the Problems panel reads the same findings as `protoboard check`
    expect(parseCheck(build.resolved).diagnostics).toBe(build.resolved.diagnostics);
    const index = indexProject(build.resolved, build.bundle);
    const t = buildTree(index);
    const k = nodeMap(t);
    expect(t[0]).toMatchObject({ kind: "system", label: "5-inch 6S quadcopter" });
    for (const i of build.resolved.instances) expect(k.has(`i:${i.path}`), i.path).toBe(true);
    for (const l of build.resolved.links) expect(k.has(`l:${l.id}`), l.id).toBe(true);
    expect(k.get("i:stack_hardware")!.kind).toBe("fasteners");
    expect(k.get("i:xt60_lead")!.kind).toBe("harness");
    expect(k.get("i:frame")!.kind).toBe("structure");
    expect(k.get("i:arm_fl")!.kind).toBe("group");
    expect(k.get("i:frame")!.ops).toContain("cad:generate");
    expect(k.get("i:battery")!.tier).toBe("catalog");
    // every finding lands on a node
    const placed = [...walk(t)].reduce((n, x) => n + x.counts.error + x.counts.warning + x.counts.info, 0);
    // (a definition's on each of its instances, or on the root when it has none)
    const perInstance = build.resolved.diagnostics.reduce((n, d) => n + (d.entity.kind === "definition" || d.entity.kind === "artifact" ? index.usedBy.get(diagnosticTarget(index, d).defId!)?.length || 1 : 1), 0);
    expect(placed).toBe(perInstance);
    // nested links both ways: the viewer drills to the owner and selects `owner/local`, and reports it so
    const nested = build.resolved.links.filter((l) => l.owner);
    expect(nested.length).toBeGreaterThan(0);
    for (const l of nested) {
      const local = l.id.slice(l.owner.length + 1);
      expect(viewerMessages(k.get(`l:${l.id}`)!)).toEqual([
        { type: "uhd-viewer:drill", path: l.owner },
        { type: "uhd-viewer:select", ids: [`${l.owner}/${local}`, l.owner] },
      ]);
      expect(linkFromViewer(index, `${l.owner}/${local}`), l.id).toBe(l);
    }
    expect(linkFromViewer(index, "stack/fc_esc_plug_fc")?.id).toBe("stack:fc_esc_plug_fc");
    expect(linkFromViewer(index, "arm_fl/prop_on_shaft")?.id).toBe("arm_fl:prop_on_shaft");
    for (const l of build.resolved.links.filter((x) => !x.owner)) expect(linkFromViewer(index, l.id)).toBe(l);
    // findings on derived links locate the derived link first
    for (const d of build.resolved.diagnostics.filter((x) => x.entity.kind === "link" && x.entity.id.includes("+"))) {
      const t = diagnosticTarget(index, d);
      expect(t.derivedId).toBe(d.entity.id);
      expect((viewerMessages(t as { path: string })[1] as { ids: string[] }).ids[0]).toBe(d.entity.id);
    }
    // an instance's declaration in its parent: the arm's motor
    const src = instanceSource(index, "arm_fl/motor", (f) => readFileSync(join(root, f), "utf8"))!;
    expect(readFileSync(join(root, src.file), "utf8").split("\n")[src.line! - 1]).toMatch(/id: "motor"/);
    expect(filterTree(t, "motor").nodes.length).toBe(1);
  });
});
