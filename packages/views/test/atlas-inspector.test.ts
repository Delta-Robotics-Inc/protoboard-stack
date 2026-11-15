/**
 * What the Atlas inspector says about a file no module names (atlas/Inspector.tsx):
 * produced by an operation (linked by its record) or unlinked, in the census's terms.
 */
import type { AtlasNode } from "@protoboardai/core/atlas";
import { describe, expect, it } from "vitest";
import { fileLinkage, operationName, previewSource } from "../src/atlas/Inspector.js";

type FileNodeOverrides = Partial<Omit<AtlasNode, "file">> & { file?: Partial<NonNullable<AtlasNode["file"]>> };

const file = (over: FileNodeOverrides = {}): AtlasNode => ({
  id: "file:docs/images/hero.png",
  kind: "render",
  label: "hero.png",
  path: "docs/images/hero.png",
  folder: "docs/images",
  status: "ok",
  degree: 0,
  ...over,
  file: { ext: "png", size: 10, kindFrom: "operation", artifacts: [], owners: [], ...over.file },
});

describe("the inspector's line for a file no module names", () => {
  it("names the operation that produced it, and says no module holds it", () => {
    expect(fileLinkage(file({ file: { producedBy: "operations/2026-10-24T02-04-20-929Z-tech-docs.json" } }))).toBe("Produced by the tech-docs operation, attached to no module.");
  });

  it("calls a file nothing points to unlinked", () => {
    expect(fileLinkage(file())).toBe("Unlinked: no artifact, folder artifact or operation points to it.");
  });

  it("says nothing for a file a module names, a failed file, or a definition", () => {
    expect(fileLinkage(file({ degree: 1, file: { owners: ["frame"] } }))).toBeUndefined();
    expect(fileLinkage(file({ status: "failed", reason: "LOCKED" }))).toBeUndefined();
    expect(fileLinkage({ id: "def:frame", kind: "module", label: "Frame", folder: "src", status: "ok", degree: 3 })).toBeUndefined();
  });

  it("operationName drops the folder, the timestamp and .json, and keeps a name without them", () => {
    expect(operationName("operations/2026-01-01T00-00-00-000Z-bom.json")).toBe("bom");
    expect(operationName("operations/2026-01-01T00-00-00Z-bom.json")).toBe("bom");
    expect(operationName("operations/handmade.json")).toBe("handmade");
  });
});

describe("the inspector's preview", () => {
  const bundle = {
    schema: "uhd.bundle/v0",
    root: "frame",
    definitions: [{ id: "frame", name: "Frame", artifacts: [{ id: "hero", type: "image", filePath: "docs/images/hero.png" }] }],
  } as unknown as Parameters<typeof previewSource>[1];
  const host = { artifactUrl: (def: string, path: string) => `http://127.0.0.1:5180/artifacts/${def}/${path}` };

  it("an image an artifact names: the host's URL for it (the dev server's artifact route)", () => {
    const n = file({ file: { artifacts: [{ definition: "frame", id: "hero" }] } });
    expect(previewSource(n, bundle, host)).toEqual({ url: "http://127.0.0.1:5180/artifacts/frame/docs/images/hero.png" });
  });

  it("an image no artifact names, or a host that cannot serve files: no URL, and a reason to show", () => {
    const loose = previewSource(file(), bundle, host);
    expect("url" in loose).toBe(false);
    expect((loose as { reason: string }).reason).toMatch(/no artifact names this one/);
    const named = file({ file: { artifacts: [{ definition: "frame", id: "hero" }] } });
    expect((previewSource(named, bundle, {}) as { reason: string }).reason).toMatch(/cannot load project files/);
    expect((previewSource(file({ file: { ext: "heic" } }), bundle, host) as { reason: string }).reason).toMatch(/\.heic/);
  });

  it("an image no artifact names: the Atlas data's image route, when the shell has one", () => {
    const data = { imageUrl: (path: string) => `http://127.0.0.1:5180/__protoboard/atlas/image?path=${encodeURIComponent(path)}` };
    expect(previewSource(file(), bundle, host, data)).toEqual({ url: "http://127.0.0.1:5180/__protoboard/atlas/image?path=docs%2Fimages%2Fhero.png" });
    // an artifact's own URL comes first
    const named = file({ file: { artifacts: [{ definition: "frame", id: "hero" }] } });
    expect(previewSource(named, bundle, host, data)).toEqual({ url: "http://127.0.0.1:5180/artifacts/frame/docs/images/hero.png" });
  });

  it("anything that is not an image: the glyph, with nothing to explain", () => {
    expect(previewSource(file({ kind: "cad", file: { ext: "step" } }), bundle, host)).toEqual({});
  });
});
