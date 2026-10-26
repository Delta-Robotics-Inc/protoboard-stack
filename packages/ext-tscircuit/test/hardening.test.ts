/**
 * The provider's fixes from a large field board's review (PB-1013, PB-1018), on boards small
 * enough to build in a second each:
 *
 *   - model files on Windows: drive-letter paths and file:///C:/ URLs are local
 *     files, and board.glb names every body it could not load
 *   - a board STEP with more entities than the stack holds arguments
 *   - a pin with several pads: every pad netted, and check catches one that is not
 *   - the build digest covers every file the build read (JSON a hand file imports)
 *   - an envelope keep-out the board module states can let a module's own body lie over it
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { BoardNetlist } from "@protoboardai/core";
import { checkBoard } from "../lib/checks.ts";
import { readConstraints } from "../lib/config.ts";
import { unjoinedPads } from "../lib/layout.ts";
import { boxStep } from "../lib/models.ts";
import { BUILD_SCHEMA, digestOf, joinPads, loadedFiles, sourceDigest } from "../lib/native.ts";
import { boardGlb, nextEntityId } from "../lib/outputs.ts";
import { buildCircuit, localFile, offline, type FileRequests } from "../lib/runtime.ts";
import { generateSource } from "../lib/source.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-hardening");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/** u1 has a ground pin on three pads (a module's exposed pad grid) and a signal pin; r1 joins both nets. */
const netlist: BoardNetlist = {
  schema: "protoboard.board-netlist/v0",
  board: "b",
  components: [
    { instance: "u1", part: "x", name: "X", kind: "ic", package: { name: "TRIPAD", pin_count: 2, exposed_pad: true }, pins: [{ interface: "gnd", pin: "1", name: "GND", kind: "ground" }, { interface: "sig", pin: "2", name: "SIG", kind: "signal" }], bodies: [] },
    { instance: "r1", part: "r", name: "R", kind: "resistor", value: { value: 1e3, unit: "Ω" }, package: { name: "0402", pin_count: 2, exposed_pad: false }, pins: [{ interface: "pin_1", pin: "1", name: "1", kind: "passive" }, { interface: "pin_2", pin: "2", name: "2", kind: "passive" }], bodies: [] },
  ],
  nets: [
    { id: "gnd", name: "GND", kind: "ground", pins: ["r1:pin_1", "u1:gnd"], links: [] },
    { id: "s", name: "S", kind: "signal", pins: ["r1:pin_2", "u1:sig"], links: [] },
  ],
  edge: [],
  problems: [],
};
const tripad = { id: "tripad", match: { package: "TRIPAD" }, pads: [{ pin: "1", x: -2, y: 0, w: 1, h: 1 }, { pin: "1", x: 0, y: 0, w: 1, h: 1 }, { pin: "1", x: 2, y: 0, w: 1, h: 1 }, { pin: "2", x: 0, y: 2, w: 0.6, h: 0.6 }], source: "test", verified: false as const };
const layout = { u1: { at: [0, -3] as [number, number], rotation_deg: 0, side: "top" as const }, r1: { at: [0, 4] as [number, number], rotation_deg: 0, side: "top" as const } };
const generated = () => generateSource({ netlist, constraints: readConstraints({ outline: { rect: { width_mm: 16, height_mm: 16 } } }).constraints!, overrides: { packages: [tripad] }, layout });

/** Build `source` (and `extra` files beside it) in a scratch native folder under `root`. */
async function build(name: string, source: string, extra: Record<string, string> = {}) {
  const root = join(TMP, name);
  const native = "src/boards/b/tscircuit";
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, native), { recursive: true });
  writeFileSync(join(root, native, "board.gen.tsx"), source);
  writeFileSync(join(root, native, "board.tsx"), `export { default } from "./board.gen.tsx"\n`);
  for (const [f, text] of Object.entries(extra)) {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return { root, native, result: await buildCircuit(join(root, native, "board.tsx")) };
}

describe("model files on Windows (PB-1013 item 2)", () => {
  it("reads drive-letter paths, UNC paths and file:///C:/ URLs as local files on Windows", () => {
    expect(localFile("file:///C:/proj/parts/u1/out/body.step", "win32")).toBe("C:\\proj\\parts\\u1\\out\\body.step");
    expect(localFile("C:\\proj\\parts\\u1\\out\\body.step", "win32")).toBe("C:\\proj\\parts\\u1\\out\\body.step");
    expect(localFile("C:/proj/src/boards/b/tscircuit/models/box-1x1x1.step", "win32")).toBe("C:/proj/src/boards/b/tscircuit/models/box-1x1x1.step");
    expect(localFile("\\\\server\\share\\body.step", "win32")).toBe("\\\\server\\share\\body.step");
    // the old guard's reading: the URL's pathname (/C:/…) is no path on Windows
    expect(new URL("file:///C:/proj/body.step").pathname).toBe("/C:/proj/body.step");
    // POSIX is unchanged; a drive-letter path is not absolute there
    expect(localFile("file:///home/me/body.step", "linux")).toBe("/home/me/body.step");
    expect(localFile("/home/me/body.step", "darwin")).toBe("/home/me/body.step");
    expect(localFile("C:\\proj\\body.step", "linux")).toBeUndefined();
    expect(localFile("https://example.com/body.step", "win32")).toBeUndefined();
    expect(localFile("models/body.step", "win32")).toBeUndefined();
  });

  it("serves a Windows model path as a file (found or not) instead of refusing it as a network request", async () => {
    const files: FileRequests = { read: [], missing: [] };
    const status = await offline(async () => (await fetch("C:\\proj\\parts\\u1\\out\\body.step")).status, { files, platform: "win32" });
    expect(status).toBe(404); // not on this machine; on Windows the same path is read
    expect(files.missing).toEqual(["C:\\proj\\parts\\u1\\out\\body.step"]);
    mkdirSync(TMP, { recursive: true });
    const real = join(TMP, "body.step");
    writeFileSync(real, boxStep("b", [1, 1, 1]));
    const text = await offline(async () => (await fetch(pathToFileURL(real).href)).text(), { files });
    expect(text).toMatch(/^ISO-10303-21;/);
    expect(files.read).toEqual([real]);
    await expect(offline(async () => fetch("https://example.com/x.step"))).rejects.toThrow(/works offline/);
  });

  it("board.glb says which bodies it could not load, instead of counting them as bodies", async () => {
    const g = generated();
    const { result } = await build("glb", g.source);
    mkdirSync(TMP, { recursive: true });
    const good = join(TMP, "good.step");
    const bad = join(TMP, "bad.step");
    writeFileSync(good, boxStep("good", [2, 2, 1]));
    // what an unfetched Git LFS file looks like: a field board's bodies on a fresh clone
    writeFileSync(bad, "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 1\n");
    const withModels = (u1: string, r1: string) =>
      result.circuitJson.map((e) => {
        if (e.type !== "cad_component") return e;
        const name = result.circuitJson.find((s) => s.type === "source_component" && s.source_component_id === e.source_component_id)?.name;
        const { model_jscad: _j, footprinter_string: _f, ...rest } = e;
        return { ...rest, model_step_url: name === "u1" ? u1 : r1, show_as_bounding_box: false };
      });
    const fine = await boardGlb(withModels(good, good), g.map);
    expect(fine.failed).toEqual([]);
    expect(fine.glb.subarray(0, 4).toString("latin1")).toBe("glTF");
    const broken = await boardGlb(withModels(bad, join(TMP, "missing.step")), g.map);
    expect(broken.failed).toEqual([bad, join(TMP, "missing.step")].sort());
  }, 120_000);
});

describe("a large board's STEP (PB-1013 item 8)", () => {
  it("numbers new entities above the highest id without spreading every id onto the stack", () => {
    const ids = new Map(Array.from({ length: 600_000 }, (_, i) => [i + 1, ""]));
    expect(() => Math.max(0, ...ids.keys())).toThrow(/call stack/);
    expect(nextEntityId(ids.keys())).toBe(600_001);
    expect(nextEntityId([])).toBe(1);
  });
});

describe("a pin with several pads (PB-1013 item 17)", () => {
  it("joins each of the pin's other pads (tscircuit's internal ports) to its nearest pad, so every pad is netted", async () => {
    const g = generated();
    expect(g.problems).toEqual([]);
    expect(g.source).toContain('<trace from=".u1 > .pin1" to="net.gnd" />');
    // pads at x = -2 (the port), 0 and 2: 0 joins -2, then 2 joins 0, with the ground net's width (the power
    // width by default); straight copper laid after routing, so not in the source the router reads
    expect(g.map.components.u1.padJoins).toEqual([
      { a: "pin1_internal_1", b: "pin1", width: 0.3 },
      { a: "pin1_internal_2", b: "pin1_internal_1", width: 0.3 },
    ]);
    expect(g.source).not.toContain("_internal_");
    const { result } = await build("multipad", g.source);
    expect(result.circuitJson.filter((e) => /_error$/.test(e.type))).toEqual([]);
    const pins = new Set(netlist.nets.flatMap((n) => n.pins));
    expect(unjoinedPads(result.circuitJson, g.map, pins)).toMatchObject([{ pin: "u1:gnd", pads: 3 }]);
    const joined = joinPads(result.circuitJson, g.map);
    const traces = joined.filter((e) => e.type === "pcb_trace" && /pad_join/.test(e.pcb_trace_id));
    expect(traces.map((t) => t.route.map((p: { x: number; y: number; width: number }) => [p.x, p.y, p.width]))).toEqual([
      [[0, -3, 0.3], [-2, -3, 0.3]],
      [[2, -3, 0.3], [0, -3, 0.3]],
    ]);
    expect(unjoinedPads(joined, g.map, pins)).toEqual([]);
  }, 120_000);

  it("leaves a join that would pass another pin's pad to the router", () => {
    const blocked = { ...tripad, pads: [...tripad.pads, { pin: "2", x: -1, y: 0, w: 0.4, h: 0.4 }].filter((p, i, all) => !(p.pin === "2" && i < all.length - 1)) };
    const g = generateSource({ netlist, constraints: readConstraints({ outline: { rect: { width_mm: 16, height_mm: 16 } } }).constraints!, overrides: { packages: [blocked] }, layout });
    expect(g.source).toContain('<trace from=".u1 > .pin1_internal_1" to=".u1 > .pin1" thickness="0.3mm" />');
    expect(g.map.components.u1.padJoins).toEqual([{ a: "pin1_internal_2", b: "pin1_internal_1", width: 0.3 }]);
  });

  it("check reports a pin whose other pads float (the provider before 0.1.7, and the examples it built)", async () => {
    const g = generated();
    // built without laying the joins: what the provider before 0.1.7 built
    const { root, native, result } = await build("multipad-floating", g.source);
    expect(unjoinedPads(result.circuitJson, g.map, new Set(netlist.nets.flatMap((n) => n.pins)))).toMatchObject([{ pin: "u1:gnd", pads: 3, pieces: 3 }]);
    const digest = sourceDigest(root, native);
    const found = await checkBoard({
      native: { circuitJson: result.circuitJson, build: { schema: BUILD_SCHEMA, map: g.map, sourceDigest: digest, netlistDigest: "n", inputsDigest: "i", tscircuit: { core: "x" }, build_ms: 0, log: [] } },
      netlist,
      netlistDigest: "n",
      sourceDigest: digest,
      inputsDigest: "i",
      file: `${native}/board.gen.tsx`,
      module: "b",
      overrides: { packages: [tripad] },
    });
    const pads = found.filter((d) => d.code === "CIRCUIT_PAD_UNNETTED");
    expect(pads.map((d) => [d.severity, d.message])).toEqual([["error", "u1:gnd has 3 pads in 3 copper pieces: not every pad is joined to net gnd; run circuit:generate (it joins the pin's pads to each other)"]]);
    // located where a viewer draws it: the pads (mm, board frame), their layer, the component and the net
    expect(pads[0].location).toMatchObject({ at: [-2, -3], layer: "top", components: ["u1"], nets: ["gnd"] });
    expect(pads[0].location!.points).toHaveLength(3);
    expect(pads[0].location!.pads).toHaveLength(3);
    // every finding has a location, a point on the board or the whole board
    expect(found.every((d) => d.location && (d.location.scope === "design" || d.location.at || d.location.components?.length))).toBe(true);
  }, 120_000);
});

describe("the build digest (PB-1013 item 10)", () => {
  it("covers JSON a hand file imports and hand files outside the native folder", async () => {
    const g = generated();
    const hand = `import widths from "./widths.json"\nimport { note } from "../../shared/hand.tsx"\nexport const W = widths.gnd + note.length\n`;
    const { root, native, result } = await build("digest", g.source.replace("export default function Board", `${hand}\nexport default function Board`), {
      "src/boards/b/tscircuit/widths.json": `{ "gnd": 0.4 }\n`,
      "src/boards/shared/hand.tsx": `export const note = "shared"\n`,
    });
    expect(result.files.map((f) => f.slice(root.length + 1)).sort()).toEqual(["src/boards/b/tscircuit/board.gen.tsx", "src/boards/b/tscircuit/board.tsx", "src/boards/b/tscircuit/widths.json", "src/boards/shared/hand.tsx"]);
    const loaded = loadedFiles(root, native, result.files);
    expect(loaded).toEqual(["src/boards/b/tscircuit/widths.json", "src/boards/shared/hand.tsx"]);
    const was = sourceDigest(root, native, loaded);
    const folderOnly = sourceDigest(root, native);
    writeFileSync(join(root, native, "widths.json"), `{ "gnd": 0.6 }\n`);
    expect(sourceDigest(root, native, loaded)).not.toBe(was);
    // the pre-0.1.7 digest read only the folder's .ts/.tsx files, so it missed the edit
    expect(sourceDigest(root, native)).toBe(folderOnly);
    writeFileSync(join(root, native, "widths.json"), `{ "gnd": 0.4 }\n`);
    expect(sourceDigest(root, native, loaded)).toBe(was);
    writeFileSync(join(root, "src/boards/shared/hand.tsx"), `export const note = "edited"\n`);
    expect(sourceDigest(root, native, loaded)).not.toBe(was);
    // a build that read nothing else keeps the digest builds before 0.1.7 recorded
    const names = ["board.gen.tsx", "board.tsx"].map((n) => `${n}\n${readFileSync(join(root, native, n), "utf8")}`);
    expect(sourceDigest(root, native, [])).toBe(digestOf(names.join("\n\0")));
  }, 120_000);
});

describe("an envelope keep-out and the module's own body (PB-1013 item 12 i)", () => {
  const envelope = { max_mm: { length: 30, width: 20 }, keep_outs: [{ name: "antenna", region: { min: [10, 15, -1], max: [20, 20, 1] }, reason: "module antenna" }] } as never;

  it("a config entry with the keep-out's name and allow_bodies, and no shape, lets that body lie over it", () => {
    const r = readConstraints({ keepouts: [{ name: "antenna", allow_bodies: ["u1"] }] }, envelope);
    expect(r.problems).toEqual([]);
    expect(r.constraints!.keepouts).toEqual([{ name: "antenna", shape: { rect: { at: [15, 17.5], size: [10, 5] } }, layers: ["top", "bottom"], reason: "module antenna", allow_bodies: ["u1"], from: "envelope" }]);
    const g = generateSource({ netlist, constraints: r.constraints!, overrides: { packages: [tripad] }, layout });
    expect(g.source).toContain('<keepout shape="rect" width="10mm" height="5mm" pcbX={15} pcbY={17.5} layer="top" excludeRefs={[".u1"]} />');
    // without it, as before: no body may lie over it
    expect(readConstraints({}, envelope).constraints!.keepouts[0].allow_bodies).toBeUndefined();
  });

  it("names a keep-out the envelope does not have, and a malformed list", () => {
    expect(readConstraints({ keepouts: [{ name: "antena", allow_bodies: ["u1"] }] }, envelope).problems).toEqual([
      "keepouts[0] (antena) gives allow_bodies without a shape, which names a keep-out of the board's design_envelope, and the board has none called antena (it has antenna)",
    ]);
    expect(readConstraints({ keepouts: [{ name: "antenna", allow_bodies: "u1" }] }, envelope).problems).toEqual(["keepouts[0].allow_bodies must be a list of instance paths"]);
  });
});
