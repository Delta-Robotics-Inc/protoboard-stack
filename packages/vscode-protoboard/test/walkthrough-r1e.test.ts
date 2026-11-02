/**
 * Fix wave R1, workstream R1-E (Kevin's walkthrough of 2026-11-01): the Inspector follows a component picked in
 * the 3D view (M2), a check row shows its finding on the model and explains itself under the row (D7), a board
 * part's card leads to its 3D (F5), and a right-click on the viewer shows no Cut/Copy/Paste menu but says where it
 * was (M9).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { findings } from "../src/drc.js";
import { findingMessages, holderOf, moduleCard, selectionPath, threeDCards, viewerFindingId, THREE_D_HOLDER, THREE_D_OWN } from "../src/inspector.js";
import { indexProject, viewerMessages, type ResolvedArtifact, type ResolvedProject } from "../src/model.js";
import { buildTree, nodeMap } from "../src/tree.js";
import { CONTEXT_MENU_DRAG_PX, suppressContextMenu, type PointDocument } from "../../web-viewer/src/vscode/contextMenu.js";
import { parseFromWebview, type FromWebview } from "../../web-viewer/src/vscode/protocol.js";
import { bundle, resolved } from "./fixtures.js";

const artifact = (definition: string, id: string, file: string, extra: Partial<ResolvedArtifact> = {}): ResolvedArtifact => ({ definition, id, filePath: file, resolved: `parts/${definition}/${file}`, base: `parts/${definition}`, present: true, ...extra });
const project = (artifacts: ResolvedArtifact[]): ResolvedProject => ({ ...resolved, artifacts });

// a board whose parts are drawn inside its own model (the ClientX mainboard's body.glb), and a part with a vendor model
const index = indexProject(project([artifact("mainboard", "body", "out/body.glb", { role: "body", format: "glb" }), artifact("mcu", "vendor", "cad/mcu.step", { role: "body", format: "step" }), artifact("led", "sheet", "docs/led.pdf", { role: "datasheet" })]), bundle);
const nodes = nodeMap(buildTree(index));
const list = findings(index, resolved.diagnostics);
const has = (p: string) => index.instances.has(p);

describe("M2: the Inspector shows what was picked in the 3D view", () => {
  it("the component, not the board that draws it, nor the level", () => {
    // the viewer's new fields (R1-A): the component's path, its holder body and the holder's definition
    expect(selectionPath({ id: "board/mcu", component: "board/mcu", holder: "board" }, has)).toBe("board/mcu");
    expect(selectionPath({ id: "board", component: "board/led", holder: "board" }, has)).toBe("board/led");
    // an older viewer named a component by its id in the body: found under the holder
    expect(selectionPath({ id: "mcu", holder: "board" }, has)).toBe("board/mcu");
    // a named body of an artifact (`path#artifact`), and a pick below what the build knows: the nearest module
    expect(selectionPath({ id: "board#body" }, has)).toBe("board");
    expect(selectionPath({ id: "board/mcu/pad3" }, has)).toBe("board/mcu");
    // nothing the build knows: the tab's level is shown (undefined here), never the root by accident
    expect(selectionPath({ id: "nowhere/at/all" }, has)).toBeUndefined();
    expect(selectionPath(null, has)).toBeUndefined();
  });

  it("keeps the new selection fields through the relay, and only as short strings", () => {
    const m = parseFromWebview({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "pcb/controller/usb/usbc", defId: "shouhan", component: "pcb/controller/usb/usbc", holder: "pcb", holderDefId: "pcb-b1-4", extra: 1 } } });
    expect(m).toEqual({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "pcb/controller/usb/usbc", defId: "shouhan", component: "pcb/controller/usb/usbc", holder: "pcb", holderDefId: "pcb-b1-4" } } });
    const long = parseFromWebview({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "a", component: "x".repeat(2000), holder: 3 } } });
    expect(long).toEqual({ type: "event", event: { type: "uhd-viewer:selectionChanged", selection: { kind: "node", id: "a" } } });
  });
});

describe("D7: a check row shows its finding on the model and explains itself", () => {
  const f = list.find((x) => x.code === "UHD_LINK_STATE")!;

  it("carries the explanation the row opens (no tab), and the entity the 3D view knows the finding by", () => {
    const checks = moduleCard(index, nodes.get("i:board")!, list).sections.find((s) => s.title === "Checks")!;
    const row = checks.rows.find((r) => r.code === "UHD_LINK_STATE")!;
    expect(row.action).toEqual({ type: "finding", key: f.key });
    expect(row.explain).toMatchObject({ severity: "error", validator: "uhd/checkSystem" });
    // the whole message only when the row shows a part of it
    expect(row.explain!.message).toBe(f.message);
    expect(f.entity).toEqual({ kind: "link", id: "board:mcu_led" });
    expect(viewerFindingId(f)).toBe("drc:UHD_LINK_STATE:link:board:mcu_led");
  });

  it("on the diagram: as Locate; in 3D: the link's first end framed and the callout pinned (a link is not drawn there)", () => {
    expect(findingMessages(index, f, "diagram")).toEqual(viewerMessages({ ...f.target, path: f.target.path! }));
    expect(findingMessages(index, f, "3d")).toEqual([
      { type: "uhd-viewer:focus", path: "board/mcu" },
      { type: "uhd-viewer:openFinding", id: "drc:UHD_LINK_STATE:link:board:mcu_led", code: "UHD_LINK_STATE", path: "board/mcu" },
    ]);
    const unplaced = list.find((x) => x.code === "UHD_UNPLACED")!;
    expect(findingMessages(index, unplaced, "3d")[0]).toEqual({ type: "uhd-viewer:focus", path: "strap/pin" });
  });
});

describe("F5: a board part's card leads to its 3D", () => {
  it("names the board whose model draws it", () => {
    expect(holderOf(index, "board/mcu")).toBe("board");
    expect(holderOf(index, "board")).toBeUndefined();
    expect(holderOf(index, "")).toBeUndefined();
    // a board without a model of its own draws nothing
    expect(holderOf(indexProject(resolved, bundle), "board/mcu")).toBeUndefined();
  });

  it("offers the board's 3D view with the part framed, and the part's own vendor model when it has one", () => {
    const mcu = moduleCard(index, nodes.get("i:board/mcu")!, list);
    expect(mcu.threeD?.map((c) => c.artifactId)).toEqual([THREE_D_HOLDER, THREE_D_OWN]);
    expect(mcu.threeD?.[0]).toMatchObject({ title: "In Main board", kindLabel: "3D view", source: "board" });
    // the existing cards stay
    expect(mcu.sections.map((s) => s.title)).toEqual(moduleCard(indexProject(resolved, bundle), nodeMap(buildTree(indexProject(resolved, bundle))).get("i:board/mcu")!, list).sections.map((s) => s.title));
    // a datasheet is not a model
    expect(threeDCards(index, { path: "board/led", defId: "led" }).map((c) => c.artifactId)).toEqual([THREE_D_HOLDER]);
    // the board itself, and a level, have none
    expect(moduleCard(index, nodes.get("i:board")!, list).threeD).toBeUndefined();
    expect(moduleCard(index, nodes.get("i:board/mcu")!, list, true).threeD).toBeUndefined();
  });
});

describe("M9: a right-click on the viewer", () => {
  const hub = globalThis as unknown as Record<string, unknown>;
  afterEach(() => {
    delete hub.__uhdViewHub;
  });

  /** A fake element: its listeners, and events dispatched to them. */
  const fake = () => {
    const listeners = new Map<string, (e: never) => void>();
    const el = {
      addEventListener: (type: string, l: (e: never) => void) => void listeners.set(type, l),
      removeEventListener: (type: string) => void listeners.delete(type),
    };
    const fire = (type: string, e: Record<string, unknown>) => (listeners.get(type) as ((e: unknown) => void) | undefined)?.(e);
    return { el, fire, listeners };
  };
  const target = (own: boolean) => ({ closest: (sel: string) => (own && sel.includes("data-vscode-context") ? {} : null) });
  const canvasDoc = { elementsFromPoint: () => [{ tagName: "DIV" }, { tagName: "CANVAS", getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 200 }) }] } satisfies PointDocument;

  it("shows no Cut/Copy/Paste over the view and says what the 3D view has under the pointer", () => {
    const posted: FromWebview[] = [];
    const picks: number[][] = [];
    hub.__uhdViewHub = { view: "3d", pick: (fx: number, fy: number) => (picks.push([fx, fy]), { instancePath: "pcb/controller/usb/usbc", body: "pcb", face: 7, point: [1, 2, 3] }) };
    const { el, fire } = fake();
    suppressContextMenu(el, (m) => posted.push(m), canvasDoc);
    const prevent = vi.fn();
    fire("pointerdown", { button: 2, clientX: 300, clientY: 100 });
    fire("contextmenu", { clientX: 301, clientY: 101, target: target(false), preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    expect(picks).toEqual([[201 / 400, 51 / 200]]);
    expect(posted).toEqual([{ type: "contextmenu", x: 301, y: 101, view: "3d", pick: { instancePath: "pcb/controller/usb/usbc", body: "pcb", face: 7 } }]);
    // the relay keeps it field by field
    expect(parseFromWebview(posted[0])).toEqual(posted[0]);
    expect(parseFromWebview({ type: "contextmenu", x: "1", y: 2 })).toBeUndefined();
  });

  it("a right-drag pans as before: the menu is still not shown, and nothing is said", () => {
    const posted: FromWebview[] = [];
    const { el, fire } = fake();
    suppressContextMenu(el, (m) => posted.push(m), canvasDoc);
    const prevent = vi.fn();
    fire("pointerdown", { button: 2, clientX: 300, clientY: 100 });
    fire("contextmenu", { clientX: 300 + CONTEXT_MENU_DRAG_PX + 20, clientY: 100, target: target(false), preventDefault: prevent });
    expect(prevent).toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it("keeps VS Code's menus over text fields and hierarchy rows", () => {
    const posted: FromWebview[] = [];
    const { el, fire } = fake();
    suppressContextMenu(el, (m) => posted.push(m), canvasDoc);
    const prevent = vi.fn();
    fire("contextmenu", { clientX: 10, clientY: 10, target: target(true), preventDefault: prevent });
    expect(prevent).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
