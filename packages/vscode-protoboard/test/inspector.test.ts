/**
 * The Inspector (PB-919, PB-940): the card of a part picked in Project parts
 * or the Library, an interface's card, what the page may load for a selection
 * (pictures only, a model only when it is small, nothing outside the project
 * and the cache), and one Inspector container in the manifest.
 */
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appCsp, appHtml } from "../src/appPage.js";
import { findings } from "../src/drc.js";
import { boardSection, interfaceCard, libraryPartCard, linkHarnessDefs, pageContent, partCard, type InspectorContent } from "../src/inspector.js";
import { MODEL_THUMB_MAX, artifactFiles, detailFiles, evidenceFiles, exportedPreview, fileKey, interfaceArtifacts, previewKey, resourceRoots, smallModel, type FileSystem } from "../src/inspectorFiles.js";
import { indexProject, type ResolvedArtifact, type ResolvedProject } from "../src/model.js";
import { buildTree, nodeMap } from "../src/tree.js";
import { bundle, resolved } from "./fixtures.js";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
const ROOT = join(sep, "p");
const at = (...parts: string[]) => join(ROOT, ...parts);

/** A project's files: sizes by path (a string is a text file's content). */
const disk = (files: Record<string, number | string>): FileSystem => ({
  exists: (f) => f in files,
  size: (f) => (f in files ? (typeof files[f] === "string" ? (files[f] as string).length : (files[f] as number)) : undefined),
  read: (f) => {
    if (typeof files[f] !== "string") throw new Error(`no text in ${f}`);
    return files[f] as string;
  },
});

const artifact = (definition: string, id: string, file: string, extra: Partial<ResolvedArtifact> = {}): ResolvedArtifact => ({ definition, id, filePath: file, resolved: `parts/${definition}/${file}`, base: `parts/${definition}`, present: true, ...extra });
const project = (artifacts: ResolvedArtifact[]): ResolvedProject => ({ ...resolved, artifacts });

describe("what the Inspector's page may load", () => {
  const index = indexProject(
    project([
      artifact("mcu", "photo", "img/mcu.png"),
      artifact("mcu", "sch", "out/schematic.svg"),
      artifact("mcu", "step", "cad/mcu.step", { role: "body", format: "step" }),
      artifact("mcu", "glb", "cad/mcu.glb", { role: "body", format: "glb" }),
      artifact("mcu", "pin1", "cad/interfaces/pin1.glb", { role: "interface", format: "glb" }),
      artifact("mcu", "bom", "out/bom.csv"),
      artifact("mcu", "sheet", "docs/mcu.pdf"),
      artifact("mcu", "gone", "img/gone.png", { present: false }),
      { definition: "mcu", id: "datasheet", url: "https://example.com/mcu.pdf", base: "parts/mcu", present: "remote" },
      { definition: "mcu", id: "odd", url: "ftp://example.com/x", base: "parts/mcu", present: "remote" },
      artifact("led", "body", "led.glb", { role: "body", format: "glb" }),
    ]),
    bundle,
  );
  const files = {
    [at("parts/mcu/img/mcu.png")]: 9000,
    [at("parts/mcu/out/schematic.svg")]: 120000,
    [at("parts/mcu/cad/mcu.step")]: 9_000_000,
    [at("parts/mcu/cad/mcu.glb")]: 400_000,
    [at("parts/mcu/cad/interfaces/pin1.glb")]: 2000,
    [at("parts/mcu/out/bom.csv")]: 300,
    [at("parts/mcu/docs/mcu.pdf")]: 5_000_000,
    [at("parts/led/led.glb")]: MODEL_THUMB_MAX + 1,
  };

  it("hands out pictures only: images as files, never a document, a table or a model as a file", () => {
    const f = artifactFiles(ROOT, index, ["mcu"], disk(files));
    expect(f.files).toEqual({ [fileKey("mcu", "img/mcu.png")]: at("parts/mcu/img/mcu.png"), [fileKey("mcu", "out/schematic.svg")]: at("parts/mcu/out/schematic.svg") });
    // only the web addresses the artifacts name may be opened from the page
    expect(f.links).toEqual(["https://example.com/mcu.pdf"]);
  });

  it("draws a small model as its thumbnail (a STEP from the GLB of its name), and never loads a large one", () => {
    const f = artifactFiles(ROOT, index, ["mcu", "led"], disk(files));
    expect(f.previews).toEqual({
      [previewKey("mcu", "step")]: { kind: "model", src: at("parts/mcu/cad/mcu.glb") },
      [previewKey("mcu", "glb")]: { kind: "model", src: at("parts/mcu/cad/mcu.glb") },
      // the marker of one interface is small: drawn as its own card's picture
      [previewKey("mcu", "pin1")]: { kind: "model", src: at("parts/mcu/cad/interfaces/pin1.glb") },
    });
    // the LED's model is over the limit: its card keeps its icon
    expect(f.previews[previewKey("led", "body")]).toBeUndefined();
    expect(smallModel(at("parts/mcu/cad/mcu.step"), disk(files))).toBeUndefined();
    expect(smallModel(at("parts/mcu/cad/mcu.step"), disk(files))).toBeUndefined();
    expect(smallModel(at("nowhere.glb"), disk(files))).toBeUndefined();
  });

  it("prefers the picture exported with the project's documents over any model", () => {
    const withExport = disk({ ...files, [at("docs/images/part-mcu.png")]: 8000, [at("docs/images/part-led.png")]: 8000 });
    const f = artifactFiles(ROOT, index, ["mcu", "led"], withExport);
    expect(f.previews[previewKey("mcu", "step")]).toEqual({ kind: "image", src: at("docs/images/part-mcu.png") });
    expect(f.previews[previewKey("mcu", "glb")]).toEqual({ kind: "image", src: at("docs/images/part-mcu.png") });
    // the large model has a picture after all, and still is not loaded
    expect(f.previews[previewKey("led", "body")]).toEqual({ kind: "image", src: at("docs/images/part-led.png") });
    // an interface's marker is not the part: it keeps its own small model, never the part's picture
    expect(f.previews[previewKey("mcu", "pin1")]).toEqual({ kind: "model", src: at("parts/mcu/cad/interfaces/pin1.glb") });
    // a definition id is never a path
    expect(exportedPreview(ROOT, "../../etc/passwd", withExport)).toBeUndefined();
  });

  it("reads a part's evidence: a researched part's from parts/evidence, a catalog part's where its origin says", () => {
    const sources = JSON.stringify([{ id: "s1", title: "Datasheet", url: "https://example.com/ds.pdf", type: "datasheet", authority: "manufacturer" }, { id: "bad" }]);
    const fs = disk({
      [at("parts/evidence/led/sources.json")]: sources,
      [at("parts/evidence/led/verification.json")]: JSON.stringify({ audit: null, assumptions: ["colour"], data_gaps: [], vocabulary_gaps: [], repairs: null, recorded_at: "2026-10-03" }),
      [at("parts/origins.json")]: JSON.stringify({ definitions: { mcu: { artifactBase: { kind: "vendored", dir: "parts/catalog/mcu" }, evidence: [{ kind: "sources", path: "library/parts/mcu/sources.json" }, { kind: "verification", path: "../../../../outside.json" }] } } }),
      [at("parts/catalog/mcu/library/parts/mcu/sources.json")]: JSON.stringify([{ id: "m", title: "MCU page", url: "https://example.com/mcu", authority: "manufacturer" }]),
      [join(sep, "outside.json")]: JSON.stringify({ audit: { checked: 1, confirmed: 1, wrong: 0, unsupported: 0 } }),
    });
    const e = evidenceFiles(ROOT, ["led", "mcu", "case"], fs);
    expect(Object.keys(e.evidence!)).toEqual(["led", "mcu"]);
    // rows without a title and an address are dropped
    expect(e.evidence!.led.sources).toHaveLength(1);
    expect(e.evidence!.led.verification).toMatchObject({ assumptions: ["colour"] });
    expect(e.evidence!.mcu.sources).toEqual([{ id: "m", title: "MCU page", url: "https://example.com/mcu", authority: "manufacturer" }]);
    // a path that leaves the project is not read
    expect(e.evidence!.mcu.verification).toBeUndefined();
    expect(e.links).toEqual(["https://example.com/ds.pdf", "https://example.com/mcu"]);
    expect(detailFiles(ROOT, index, ["mcu"], fs).links).toEqual(["https://example.com/mcu.pdf", "https://example.com/mcu"]);
  });

  it("reads the evidence a part's package carries, where Node finds the package from the project, and nothing outside it", () => {
    // the package is hoisted above the project (a monorepo's node_modules)
    const pkg = join(sep, "node_modules", "@acme", "parts");
    const origins = (evidence: { kind: string; path: string }[], name = "@acme/parts") => JSON.stringify({ definitions: { mcu: { artifactBase: { kind: "package", package: name }, evidence } } });
    const fs = (o: string) =>
      disk({
        [at("parts/origins.json")]: o,
        [join(pkg, "package.json")]: "{}",
        [join(pkg, "parts", "mcu", "sources.json")]: JSON.stringify([{ id: "m", title: "MCU page", url: "https://example.com/mcu" }]),
        [join(sep, "node_modules", "secret.json")]: JSON.stringify({ audit: { checked: 1 } }),
        [join(sep, "package.json")]: "{}",
      });
    const e = evidenceFiles(ROOT, ["mcu"], fs(origins([{ kind: "sources", path: "parts/mcu/sources.json" }, { kind: "verification", path: "../../secret.json" }])));
    expect(e.evidence!.mcu.sources).toEqual([{ id: "m", title: "MCU page", url: "https://example.com/mcu" }]);
    expect(e.evidence!.mcu.verification).toBeUndefined();
    // a package that is not installed, or a name that is a path, gives nothing
    expect(evidenceFiles(ROOT, ["mcu"], fs(origins([{ kind: "sources", path: "parts/mcu/sources.json" }], "@acme/gone"))).evidence).toEqual({});
    expect(evidenceFiles(ROOT, ["mcu"], fs(origins([{ kind: "sources", path: "package.json" }], ".."))).evidence).toEqual({});
  });

  it("a project part's card shows its own artifacts only (PB-1063)", () => {
    expect(partCard(index, { id: "watch", name: "Watch" }, []).details?.artifactsOf).toBe("watch");
  });

  it("gives the page the projects, the packages their artifacts are in and the cache as its roots, and nothing wider", () => {
    const withPackage = indexProject(resolved, bundle);
    const exists = (p: string) => p === join(sep, "ws", "node_modules", "@acme", "parts", "package.json");
    const roots = resourceRoots([{ root: join(sep, "ws", "proj"), index: withPackage }, { root: join(sep, "ws", "other") }], join(sep, "cache"), exists);
    expect(roots).toEqual([join(sep, "cache"), join(sep, "ws", "node_modules", "@acme", "parts"), join(sep, "ws", "other"), join(sep, "ws", "proj")]);
    // not the workspace, not the whole of node_modules
    expect(roots).not.toContain(join(sep, "ws"));
    expect(roots).not.toContain(join(sep, "ws", "node_modules"));
  });

  it("names every file to the page by its URL, never by its path", () => {
    const content: InspectorContent = {
      card: {
        ...partCard(index, { id: "mcu", name: "MCU" }, [], detailFiles(ROOT, index, ["mcu"], disk({ ...files, [at("docs/images/part-mcu.png")]: 1 }))),
        artifacts: interfaceArtifacts(ROOT, { ...index, bundleDefs: new Map([["mcu", { id: "mcu", artifacts: [{ id: "pin1", name: "pin 1 geometry", interfaceId: "gpio1" }] } as never]]) }, "mcu", "gpio1", disk(files)),
      },
      project: "p",
      bundle: { file: at(".protoboard/build/uhd-bundle.json"), version: "7" },
    };
    const page = pageContent(content, (f) => `https://res.test${f.split(sep).join("/")}`);
    const text = JSON.stringify(page);
    // no value is a path on disk
    expect(text).not.toContain(`"${JSON.stringify(ROOT + sep).slice(1, -1)}`);
    expect(page).toMatchObject({ bundle: { src: "https://res.test/p/.protoboard/build/uhd-bundle.json", version: "7" } });
    if (!("card" in page)) throw new Error("no card");
    const card = page.card;
    expect(card.details!.files[fileKey("mcu", "img/mcu.png")]).toBe("https://res.test/p/parts/mcu/img/mcu.png");
    expect(card.details!.previews[previewKey("mcu", "glb")]).toEqual({ kind: "image", src: "https://res.test/p/docs/images/part-mcu.png" });
    expect(card.artifacts).toEqual([{ defId: "mcu", artifactId: "pin1", title: "pin 1 geometry", kindLabel: "Interface geometry", format: "GLB", source: "pin1.glb", icon: "scan", preview: { kind: "model", src: "https://res.test/p/parts/mcu/cad/interfaces/pin1.glb" } }]);
    expect(pageContent({ empty: "Nothing." }, () => "x")).toEqual({ empty: "Nothing." });
  });
});

describe("a part's card", () => {
  const index = indexProject(resolved, bundle);
  const list = findings(index, resolved.diagnostics);

  it("from Project parts: where it is used (each instance leads to it), its library and status; the definition's details show the rest", () => {
    const card = partCard(index, { id: "mcu", name: "MCU", library: "protoboard", revision: 3, recommended: 4, status: "update-available", tier: "catalog", trust: "unverified", trustBasis: "no verification record" }, list);
    expect(card).toMatchObject({ kind: "part", title: "MCU", subtitle: "mcu · protoboard v3", path: "board/mcu", part: { partId: "mcu", library: "protoboard" }, actions: { focus: true, source: true, detail: true } });
    // its status (PB-932) with the state's dot, then its sync in the words every parts view uses
    // design A (PB-1042): what it is goes before the subtitle, its status at the title's right, its sync under it
    expect(card.kindLabel).toBe("Part");
    expect(card.chips.map((c) => c.text)).toEqual(["Unverified", "Update available · v4"]);
    expect(card.chips[0]).toMatchObject({ status: "unverified", title: expect.stringMatching(/^Unverified\. In a library, but not verified.*No verification record/) });
    expect(card.chips[1]).toMatchObject({ tone: "info", title: expect.stringMatching(/pins v3; the library recommends v4/) });
    expect(partCard(index, { id: "cap", name: "Cap", tier: "project-specific", status: "designed", trust: "local" }, list).chips.map((c) => [c.text, c.status])).toEqual([["Local", "local"], ["Local only", undefined], ["designed here", undefined]]);
    expect(card.sections.map((s) => s.title)).toEqual(["Used in", "Checks"]);
    expect(card.sections[0].rows[0]).toMatchObject({ label: "board/mcu", action: { type: "focus", path: "board/mcu" } });
    // the definition as the build has it; a part the build does not have has no details
    expect(card.details).toEqual({ target: { kind: "definition", id: "mcu" }, artifactsOf: "mcu", files: {}, previews: {}, links: [] });
    expect(partCard(index, { id: "cap", name: "Cap" }, list).details).toBeUndefined();
  });

  it("from the Library: the revision's definition, its picture and its model drawn small, its specs, whether the project uses it", () => {
    const definition = { id: "bosch-bmi270", name: "BMI270", artifacts: [{ id: "ds", url: "https://example.com/bmi270.pdf" }, { id: "step", filePath: "cad/x.step", format: "step", role: "body" }, { id: "glb", filePath: "cad/x.glb", format: "glb", role: "body" }, { id: "pad", filePath: "cad/pad.glb", format: "glb", role: "interface" }] };
    const card = libraryPartCard({ partId: "bosch-bmi270", name: "BMI270", library: "protoboard", revision: 2, recommended: true, used: "used v2 here", trust: "verified", trustBasis: "independent audit recorded", facts: [{ label: "Size", value: "2.5 × 3 mm" }], interfaceCount: 14, thumbnail: "/cache/t.png", model: "/cache/m.glb", definition });
    expect(card.details).toEqual({
      target: { kind: "definition", id: "bosch-bmi270" },
      files: {},
      previews: { "bosch-bmi270#step": { kind: "model", src: "/cache/m.glb" }, "bosch-bmi270#glb": { kind: "model", src: "/cache/m.glb" } },
      links: ["https://example.com/bmi270.pdf"],
      definitions: [definition],
      picture: "/cache/t.png",
    });
    expect(card.kindLabel).toBe("Library part");
    expect(card.chips.map((c) => c.text)).toEqual(["Verified", "v2 · recommended", "14 interfaces", "used v2 here"]);
    expect(card.chips[0].status).toBe("verified");
    expect(card.actions).toMatchObject({ detail: true, focus: false, source: false });
    // a definition of another part is not shown as this one's
    expect(libraryPartCard({ partId: "a", name: "A", library: "l", revision: 1, facts: [], interfaceCount: 0, definition: { id: "b" } }).details).toBeUndefined();
  });
});

describe("an interface's card", () => {
  const index = indexProject(resolved, bundle);
  const nodes = nodeMap(buildTree(index));

  it("says what the interface is and what it is linked to on its module's level, each end leading there", () => {
    const card = interfaceCard(index, nodes.get("if:board/mcu:gpio1")!)!;
    expect(card).toMatchObject({ kind: "interface", title: "gpio1", subtitle: "board/mcu:gpio1", path: "board/mcu", actions: { focus: true, source: true } });
    expect(card.kindLabel).toBe("Interface");
    expect(card.chips.map((c) => c.text)).toEqual(["electrical", "1 link"]);
    expect(card.sections.map((s) => s.title)).toEqual(["Protocols", "Linked to"]);
    expect(card.sections[1].rows).toEqual([{ icon: "link", label: "led:anode", detail: "mcu_led", action: { type: "focus", path: "board/led" } }]);
    // an interface nothing is linked to says so; an export leads to the child it comes from
    expect(interfaceCard(index, nodes.get("if:board/mcu:usb")!)!.chips.map((c) => c.text)).toEqual(["electrical", "not linked"]);
    const exported = interfaceCard(index, nodes.get("if:board:usb")!)!;
    expect(exported).toMatchObject({ title: "USB-C" });
    expect(exported.sections[0]).toMatchObject({ title: "Exports", rows: [{ label: "usb", detail: "mcu", action: { type: "focus", path: "board/mcu" } }] });
    expect(interfaceCard(index, nodes.get("i:board")!)).toBeUndefined();
  });

  it("brings the harnesses of a link's level, whose artifacts show with the link", () => {
    expect(linkHarnessDefs(index, "board_flex")).toEqual(["flex", "case-screws"]);
    expect(linkHarnessDefs(index, "board/mcu_led")).toEqual([]);
    expect(linkHarnessDefs(index, "nowhere")).toEqual([]);
  });
});

describe("the Inspector page", () => {
  const page = { screen: "inspector" as const, title: "Selection", cspSource: "https://file+.vscode-resource.test", script: "https://file+.vscode-resource.test/ext/dist/views-app.js", style: "https://file+.vscode-resource.test/ext/dist/views-app.css", nonce: "N0NCE" };
  it("is the extension's React page: its own script by nonce, files only from the webview's roots, nothing from the network", () => {
    const html = appHtml(page);
    expect(html).toContain('<body data-screen="inspector" data-theme="vscode">');
    const csp = appCsp(page);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-N0NCE'");
    expect(csp).toContain("img-src https://file+.vscode-resource.test data: blob:");
    // the bundle and a small model are read from the project and the cache; no other host
    expect(csp).toContain("connect-src https://file+.vscode-resource.test blob: data:");
    expect(csp).not.toMatch(/(img|connect|script|style|font)-src[^;]*(https?:\/\/(?!file\+)|\*)/);
  });
  it("gives its webview only the extension, the projects, their artifact packages and the cache as roots", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/inspectorView.ts", import.meta.url)), "utf8");
    expect(src).toContain('localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "media"), ...roots.map((r) => vscode.Uri.file(r))]');
    const ext = readFileSync(fileURLToPath(new URL("../src/extension.ts", import.meta.url)), "utf8");
    expect(ext).toMatch(/roots: \(\) => resourceRoots\(/);
    expect(ext).not.toContain("workspaceFolders ?? []) {\n    roots.set");
  });
});

describe("the manifest after the review (PB-916, PB-917, PB-919)", () => {
  const views = Object.values(pkg.contributes.views as Record<string, { id: string; name: string; contextualTitle?: string }[]>).flat();
  const containers = Object.values(pkg.contributes.viewsContainers as Record<string, { id: string; title: string; icon: string }[]>).flat();

  it("has one Inspector container, and its two views name themselves apart when one is moved out of it", () => {
    expect(containers.filter((c) => /Inspector/.test(c.title))).toHaveLength(1);
    const titles = pkg.contributes.views["protoboard-inspector"].map((v: { contextualTitle: string }) => v.contextualTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gathers the Inspector's views once into its container, by the id VS Code gives an extension's container", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/extension.ts", import.meta.url)), "utf8");
    expect(src).toContain(`container: "workbench.view.extension.${pkg.contributes.viewsContainers.secondarySidebar[0].id}"`);
    expect(src).toMatch(/executeCommand\("vscode\.moveViews", \{ viewIds: \[\.\.\.INSPECTOR_VIEWS\.views\], destinationId: INSPECTOR_VIEWS\.container \}\)/);
  });

  it("names a container's only view as the container, so the side bar title is one name, not 'PROTOBOARD LIBRARY: LIBRARY'", () => {
    for (const c of containers) {
      // with a project, and without one (PB-931: the container's start view), a container shows one view at a time
      const all = pkg.contributes.views[c.id] as { name: string; when?: string }[];
      for (const state of ["protoboard.hasProject && !protoboard.needsSetup", "protoboard.noProject || protoboard.needsSetup"]) {
        const own = all.filter((v) => v.when === state);
        if (own.length === 1 && c.id !== "protoboard-drc") expect(own[0].name, `${c.id} (${state})`).toBe(c.title);
      }
    }
  });

  it("carries the Protoboard 0 mark: the extension icon, the Inspector's icon, and an icon font for the status bar", () => {
    expect(pkg.icon).toBe("media/icon.png");
    expect(pkg.contributes.icons["protoboard-logo"].default).toEqual({ fontPath: "media/protoboard-icons.woff", fontCharacter: "\\E000" });
    const mark = readFileSync(fileURLToPath(new URL("../media/protoboard.svg", import.meta.url)), "utf8");
    // one colour VS Code can tint, no strokes of the old mark
    expect(mark).toContain('fill="currentColor"');
    expect(mark).not.toMatch(/<rect|<circle|stroke=/);
    const ignore = readFileSync(fileURLToPath(new URL("../.vscodeignore", import.meta.url)), "utf8");
    expect(ignore).toContain("!media/icon.png");
    expect(ignore).toContain("!media/protoboard-icons.woff");
    expect(views.some((v) => v.name === "Library")).toBe(false);
  });
});

describe("a component of a routed board (the PCB tab's selection)", () => {
  const native = fileURLToPath(new URL("../../../examples/wearable-watch/src/boards/watch-main/tscircuit/", import.meta.url));
  const files: Record<string, string> = { "b/tscircuit/build.json": readFileSync(join(native, "build.json"), "utf8"), "b/tscircuit/circuit.json": readFileSync(join(native, "circuit.json"), "utf8") };
  const index = indexProject({
    ...resolved,
    instances: [...resolved.instances, { path: "board", definition: "watch-board", kind: "module", quantity: 1 }, { path: "board/u2", definition: "bosch-bmi270", kind: "module", quantity: 1, parent: "board" }],
    artifacts: [
      { definition: "watch-board", id: "board_build", filePath: "b/tscircuit/build.json", resolved: "b/tscircuit/build.json", base: "", present: true },
      { definition: "watch-board", id: "board_routed", filePath: "b/tscircuit/circuit.json", resolved: "b/tscircuit/circuit.json", base: "", present: true },
    ],
  });
  it("says its reference, part, footprint, side and place, from the provider's own files", () => {
    const s = boardSection(index, { path: "board/u2" }, (f) => files[f]);
    expect(s?.title).toBe("On the board");
    const rows = Object.fromEntries(s!.rows.map((r) => [r.label, r.detail]));
    expect(rows).toMatchObject({ Reference: "U2", Part: "bosch-bmi270", Footprint: "lga-14-3x2.5-p0.5-bosch", Side: "top" });
    expect(rows.Position).toMatch(/^-?\d+\.\d\d, -?\d+\.\d\d mm · \d+°$/);
  });
  it("is not there for a module that is no component of such a board", () => {
    expect(boardSection(index, { path: "board" }, (f) => files[f])).toBeUndefined();
    expect(boardSection(index, { path: "board/nobody" }, (f) => files[f])).toBeUndefined();
    expect(boardSection(index, { path: "board/u2" }, () => undefined)).toBeUndefined();
  });
});
