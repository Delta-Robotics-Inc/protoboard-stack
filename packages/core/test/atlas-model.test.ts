/**
 * Atlas model (docs/specs/atlas.md): the file classifier, sensitive names,
 * the display key the bundle leaves out, and the view projection.
 */
import { describe, expect, it } from "vitest";
import {
  ATLAS_DISPLAY_KEY,
  ATLAS_KINDS,
  ATLAS_KIND_ORDER,
  ATLAS_SCHEMA,
  atlasGraph,
  byCodeUnit,
  classifyFile,
  displayForBundle,
  isSensitiveName,
  type ArtifactRef,
  type AtlasIndex,
} from "../src/atlas/model.js";

const kindOf = (path: string, hints?: Parameters<typeof classifyFile>[1]) => {
  const c = classifyFile(path, hints);
  return c ? `${c.kind}/${c.from}` : null;
};
const ref = (extra: Partial<ArtifactRef> = {}): ArtifactRef => ({ definition: "d", id: "a", ...extra });

describe("classifyFile", () => {
  it("classifies by extension first", () => {
    const table: [string, string][] = [
      ["cad/frame.glb", "model/extension"],
      ["out/body.STL", "model/extension"],
      ["out/body.3mf", "model/extension"],
      ["out/body.step", "cad/extension"],
      ["src/frame.kcl", "cad/extension"],
      ["drawings/plate.dxf", "cad/extension"],
      ["board/main.kicad_pcb", "board/extension"],
      ["gerbers/top.gtl", "board/extension"],
      ["docs/brief.md", "doc/extension"],
      ["docs/datasheet.pdf", "doc/extension"],
      ["docs/guide.html", "doc/extension"],
      ["docs/test-data/thrust.csv", "data/extension"],
      ["firmware/build/app.uf2", "firmware/extension"],
      ["firmware/build/app.elf", "firmware/extension"],
    ];
    for (const [path, want] of table) expect([path, kindOf(path)]).toEqual([path, want]);
  });

  it("recognizes board outputs by file name, whatever their extension means elsewhere", () => {
    for (const name of ["schematic.svg", "pcb-top.svg", "pcb-bottom.svg", "circuit.json", "netlist.json", "pnp.csv"]) expect(kindOf(`src/boards/fc/out/${name}`)).toBe("board/extension");
    expect(kindOf("docs/diagram.svg")).toBe("image/extension");
  });

  it("splits image paths into tokens: concept, render and photo", () => {
    const table: [string, string][] = [
      ["concepts/v1.png", "concept/path"],
      ["docs/sketch-01.jpg", "concept/path"],
      ["art/moodboard.webp", "concept/path"],
      ["docs/renders/front.png", "render/path"],
      ["docs/images/ag-hero.png", "render/path"],
      ["docs/rendering_top.png", "render/path"],
      ["photos/bench.jpg", "photo/path"],
      ["phone/IMG_0042.JPG", "photo/path"],
      ["dcim/DSC01234.jpg", "photo/path"],
      ["phone/PXL_20260101_120000.jpg", "photo/path"],
      ["shots/board.heic", "photo/path"],
      ["docs/images/figure.png", "image/extension"],
      // a token is a whole word: "rendered" and "conceptual" are not tokens
      ["docs/rendered.png", "image/extension"],
      ["docs/conceptual.png", "image/extension"],
    ];
    for (const [path, want] of table) expect([path, kindOf(path)]).toEqual([path, want]);
  });

  it("takes an image an operation produced as a render, after the path tokens", () => {
    expect(kindOf("docs/images/ag-step-01.png", { producedBy: "operations/x.json" })).toBe("render/operation");
    expect(kindOf("photos/bench.png", { producedBy: "operations/x.json" })).toBe("photo/path");
  });

  it("lets an author's tag override the extension and the path", () => {
    expect(kindOf("docs/images/figure.png", { artifacts: [ref({ tags: ["concept"] })] })).toBe("concept/tag");
    expect(kindOf("photos/bench.png", { artifacts: [ref({ tags: ["Render"] })] })).toBe("render/tag");
    expect(kindOf("cad/body.step", { artifacts: [ref({ tags: ["photo"] })] })).toBe("photo/tag");
    expect(kindOf("docs/images/figure.png", { artifacts: [ref({ tags: ["hero", "draft"] })] })).toBe("image/extension");
  });

  it("keeps a STEP typed 3d_model as cad: the extension wins over the artifact type", () => {
    expect(kindOf("out/body.step", { artifacts: [ref({ type: "3d_model", role: "body" })] })).toBe("cad/extension");
  });

  it("returns null for code, configuration and records, unless an artifact names the file", () => {
    for (const path of ["src/sys.uhd.ts", "protoboard.config.ts", "scripts/gen.py", "package.json", "parts/origins.json", "ci.yaml", "Cargo.toml", "package-lock.json", "LICENSE"]) expect([path, kindOf(path)]).toEqual([path, null]);
    expect(kindOf("out/body.manifest.json", { artifacts: [ref({ type: "cad" })] })).toBe("data/artifact");
    expect(kindOf("out/body.manifest.json", { artifacts: [ref({ type: "cad", role: "source" })] })).toBe("cad/artifact");
    expect(kindOf("cad/frame.py", { artifacts: [ref({ type: "cad", role: "source" })] })).toBe("cad/artifact");
  });

  it("gives video and unknown assets kind other, with the artifact type as a tie-breaker", () => {
    expect(kindOf("media/flight.mp4")).toBe("other/extension");
    expect(kindOf("vendor/M9N_step.zip")).toBe("other/extension");
    expect(kindOf("vendor/sim.ngspice", { artifacts: [ref({ type: "datasheet" })] })).toBe("doc/artifact");
  });

  it("handles spaces, Unicode and backslashes", () => {
    expect(kindOf("photos/Café shot 1.jpg")).toBe("photo/path");
    expect(kindOf("docs\\renders\\front.png")).toBe("render/path");
    expect(kindOf("my concept board.png")).toBe("concept/path");
  });
});

describe("isSensitiveName", () => {
  it("matches secrets by name, never by content", () => {
    for (const path of [".env", ".env.local", "config/.env.production", "certs/server.pem", "keys/deploy.key", "store.p12", "cert.pfx", "home/id_rsa", "home/id_rsa.pub", "id_ed25519", "credentials.json", "gcloud/credentials-prod.json", "android.keystore"])
      expect([path, isSensitiveName(path)]).toEqual([path, true]);
    for (const path of ["docs/brief.md", "environment.md", "keyboard.step", "credentials.md", "src/id.ts", "docs/keys.pdf"]) expect([path, isSensitiveName(path)]).toEqual([path, false]);
  });
});

describe("displayForBundle", () => {
  it("drops the Atlas layout and keeps everything else", () => {
    const display = { schema: "uhd.display/v0", diagram: { layouts: {} }, [ATLAS_DISPLAY_KEY]: { positions: { "def:x": [1, 2] } } };
    expect(displayForBundle(display)).toEqual({ schema: "uhd.display/v0", diagram: { layouts: {} } });
    expect(display[ATLAS_DISPLAY_KEY]).toBeDefined(); // the input is not changed
  });

  it("returns a display without the key as it is", () => {
    const display = { schema: "uhd.display/v0" };
    expect(displayForBundle(display)).toBe(display);
  });
});

describe("the kind table and order", () => {
  it("names every kind once, in a fixed order", () => {
    expect([...ATLAS_KIND_ORDER].sort()).toEqual(Object.keys(ATLAS_KINDS).sort());
    expect(new Set(ATLAS_KIND_ORDER).size).toBe(ATLAS_KIND_ORDER.length);
    expect(ATLAS_KINDS.concept).toEqual({ label: "Concept images", one: "Concept image" });
  });

  it("orders by code unit, not by locale", () => {
    expect(["b", "a", "B", "é", "Z"].sort(byCodeUnit)).toEqual(["B", "Z", "a", "b", "é"]);
  });
});

describe("atlasGraph", () => {
  it("keeps what a view needs and leaves the inputs, census and problems out", () => {
    const index: AtlasIndex = {
      schema: ATLAS_SCHEMA,
      stack: "0.3.0",
      project: { name: "p", root: "sys" },
      enumerator: "walk",
      counts: { nodes: 1, edges: 0, byKind: { module: 1 }, census: { total: 0, linked: 0, unlinked: 0, failed: 0, excluded: 0 } },
      nodes: [{ id: "def:sys", kind: "module", label: "System", folder: "src", status: "ok", degree: 0 }],
      edges: [],
      census: [],
      instances: { "": "sys" },
      inputs: [["src/sys.uhd.ts", 10, 1, "sha256:00"]],
      problems: [],
    };
    const graph = atlasGraph(index);
    expect(Object.keys(graph).sort()).toEqual(["counts", "edges", "nodes", "project"]);
    expect(graph.nodes).toBe(index.nodes);
    expect(graph.project).toEqual({ name: "p", root: "sys" });
  });
});
