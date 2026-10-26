/**
 * TEST FIXTURE: a small synthetic device for the enclosure provider. A board
 * (30 × 24 mm, USB-C receptacle at the +X edge, two side-push switches set
 * back 1.5 mm from the +Y edge) on four M2 insert bosses, and a pouch cell
 * under it, in a two-part printed case with a USB-C opening, two button
 * plungers and four lid screws.
 *
 * The board's GLB and geometry manifest stand in for what a circuit provider
 * would export (out/board.glb, out/board.manifest.json): boxes, not a real
 * board. Sizes are representative, not taken from a part.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Box = { name: string; min: [number, number, number]; max: [number, number, number] };

/** A GLB of boxes, given in CAD millimetres (Z up), written as glTF expects (metres, Y up). */
export function glbBoxes(boxes: Box[]): Buffer {
  const pos: number[] = [];
  const idx: number[] = [];
  const nodes: { name: string; mesh: number }[] = [];
  const meshes: unknown[] = [];
  const accessors: unknown[] = [];
  const views: unknown[] = [];
  const chunks: Buffer[] = [];
  let offset = 0;
  const view = (b: Buffer, target: number) => {
    views.push({ buffer: 0, byteOffset: offset, byteLength: b.length, target });
    chunks.push(b);
    offset += b.length;
    return views.length - 1;
  };
  for (const [k, box] of boxes.entries()) {
    pos.length = 0;
    idx.length = 0;
    for (const z of [box.min[2], box.max[2]]) for (const y of [box.min[1], box.max[1]]) for (const x of [box.min[0], box.max[0]]) pos.push(x / 1000, z / 1000, -y / 1000);
    idx.push(0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5);
    const pb = Buffer.from(new Float32Array(pos).buffer);
    const ib = Buffer.from(new Uint32Array(idx).buffer);
    const xs = [0, 1, 2].map((a) => pos.filter((_, i) => i % 3 === a));
    accessors.push({ bufferView: view(pb, 34962), componentType: 5126, count: 8, type: "VEC3", min: xs.map((v) => Math.min(...v)), max: xs.map((v) => Math.max(...v)) });
    accessors.push({ bufferView: view(ib, 34963), componentType: 5125, count: idx.length, type: "SCALAR" });
    meshes.push({ name: box.name, primitives: [{ attributes: { POSITION: 2 * k }, indices: 2 * k + 1 }] });
    nodes.push({ name: box.name, mesh: k });
  }
  const bin = Buffer.concat(chunks);
  const doc = { asset: { version: "2.0", generator: "ext-enclosure-cad test fixture" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors, bufferViews: views, buffers: [{ byteLength: bin.length }] };
  let json = JSON.stringify(doc);
  while (json.length % 4) json += " ";
  const jb = Buffer.from(json);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "latin1");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
  const ch = (b: Buffer, type: number) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(b.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, b]);
  };
  return Buffer.concat([header, ch(jb, 0x4e4f534a), ch(bin, 0x004e4942)]);
}

/** Board geometry (board coordinates: origin at the board centre underside, Z up). */
export const BOARD = { w: 30, h: 24, t: 1.6, usb: { w: 8.94, d: 7.35, h: 3.26, overhang: 0.5 }, sw: { w: 4.5, d: 3.4, h: 3.3, setback: 1.5, x: 8 } };
/** A status LED on the board's top (its emitting face; in the manifest only, too small to matter to the fit). */
export const LED = { x: 0, y: -6, h: 0.6 };

export function boardBoxes(w = BOARD.w, h = BOARD.h): Box[] {
  const { t, usb, sw } = BOARD;
  return [
    { name: "pcb", min: [-w / 2, -h / 2, 0], max: [w / 2, h / 2, t] },
    { name: "j1", min: [BOARD.w / 2 + usb.overhang - usb.d, -usb.w / 2, t], max: [BOARD.w / 2 + usb.overhang, usb.w / 2, t + usb.h] },
    ...[-1, 1].map((s, i) => ({ name: `sw${i + 1}`, min: [s * sw.x - sw.w / 2, BOARD.h / 2 - sw.setback - sw.d, t], max: [s * sw.x + sw.w / 2, BOARD.h / 2 - sw.setback, t + sw.h] }) as Box),
  ];
}

/** The board's geometry manifest: outline, components, and the connector and switch faces with their normals. */
export function boardManifest() {
  const { w, h, t, usb, sw } = BOARD;
  const face = (centroid: number[], normal: number[], area: number) => ({ area_mm2: area, centroid, normal });
  return {
    artifact: "board",
    tool: "test fixture",
    units: "mm",
    features: {
      outline: face([0, 0, t], [0, 0, 1], w * h),
      usb: face([w / 2 + usb.overhang, 0, t + usb.h / 2], [1, 0, 0], usb.w * usb.h),
      btn_a: face([-sw.x, h / 2 - sw.setback, t + sw.h / 2], [0, 1, 0], 1),
      btn_b: face([sw.x, h / 2 - sw.setback, t + sw.h / 2], [0, 1, 0], 1),
      led: face([LED.x, LED.y, t + LED.h], [0, 0, 1], 1),
    },
  };
}

const T = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
/** Where the board's underside sits above the case origin (the boss tops). */
export const BOSS_TOP = 6;

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "enclosure-fixture", private: true, type: "module" }),
  "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/device.uhd.ts", export: "DEVICE" } });\n`,
  ".protoboard/display.json": JSON.stringify({ spatial: { root: "case", placements: { battery: { matrix: T(0, 0, 1) } } } }),
  "src/parts.uhd.ts": `// TEST FIXTURE: a pouch cell (20 × 14 × 4 mm box, representative).
export const CELL = {
  id: "fixture-cell",
  name: "Fixture LiPo cell",
  interfaces: [{ id: "pos", name: "+", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["source"] }] }],
  artifacts: [{ id: "body_glb", name: "Cell body", type: "cad", role: "body", format: "glb", units: "mm", filePath: "src/parts/cell.glb" }],
};
`,
  "src/boards/mainboard/mainboard.uhd.ts": `// TEST FIXTURE: the board as its circuit provider would describe it, with its exported body and manifest.
import { BoltPattern } from "@deltarobotics/uhd";

export const MAINBOARD = {
  id: "fixture-mainboard",
  name: "Fixture mainboard",
  interfaces: [
    { ...BoltPattern({ id: "mount", role: "component", shape: "rectangle", spacingMm: 25, spacingYmm: 19, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2 }), geometry: { frame: { origin: [0, 0, 0], normal: [0, 0, -1] } } },
    { id: "usb", name: "USB-C", domain: "electrical", exposed: true, protocols: [{ type: "usb", roles: ["device"] }] },
    { id: "btn_a", name: "Switch A", domain: "mechanical", exposed: true, protocols: [] },
    { id: "btn_b", name: "Switch B", domain: "mechanical", exposed: true, protocols: [] },
    { id: "led", name: "Status LED", domain: "electrical", exposed: true, protocols: [] },
  ],
  artifacts: [
    { id: "board_glb", name: "Board", type: "pcb", role: "body", format: "glb", units: "mm", filePath: "src/boards/mainboard/out/board.glb" },
    { id: "board_manifest", name: "Board manifest", type: "cad", format: "json", filePath: "src/boards/mainboard/out/board.manifest.json", provenance: { generatedFrom: "board_glb" } },
  ],
};
`,
  "src/enclosures/case/case.uhd.ts": `// TEST FIXTURE: a two-part printed case for the fixture board and cell.
import { Button, InsertBosses, Joint, Opening, RUTHEX_RX_M2X4, M2X6_PAN, USB_C_PLUG } from "@protoboardai/ext-enclosure-cad/lib/index.ts";

export const CASE = {
  id: "fixture-case",
  name: "Fixture case",
  interfaces: [
    Opening({
      id: "usb_opening",
      serves: { child: "board", interfaceId: "usb" },
      widthMm: 9.6,
      heightMm: 3.9,
      cornerRadiusMm: 1.2,
      maxRecessMm: 2.0,
      plug: USB_C_PLUG,
      assumption: "receptacle shell 8.94 × 3.26 mm plus 0.3 mm a side; the plug's overmold butts the wall, so the receptacle may sit up to 2 mm behind it",
    }),
    Button({ id: "btn_a", serves: { child: "board", interfaceId: "btn_a" }, holeDiameterMm: 2.5, travelMm: 0.2, gapMm: 0.1 }),
    Button({ id: "btn_b", serves: { child: "board", interfaceId: "btn_b" }, holeDiameterMm: 2.5, travelMm: 0.2, gapMm: 0.1 }),
    InsertBosses({ id: "board_mount", shape: "rectangle", spacingMm: 25, spacingYmm: 19, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2, insert: RUTHEX_RX_M2X4, frame: { origin: [0, 0, ${BOSS_TOP}], normal: [0, 0, 1] } }),
    Joint({ id: "lid_joint", screw: M2X6_PAN, insert: RUTHEX_RX_M2X4, count: 4 }),
  ],
  traits: [{ type: "design_envelope", params: { max_mm: { length: 50, width: 45, height: 20 }, reason: "test fixture" } }],
};
`,
  "src/enclosures/case/cad.config.ts": `import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({
  provider: "@protoboardai/ext-enclosure-cad",
  process: "print",
  // a rabbet needs two minimum walls and the joint clearance: (1.7 - 0.1) / 2 = 0.8 mm for the tongue and for the lid's skirt
  constraints: { wall_mm: 1.7, clearance_mm: 0.3, material: "PETG", fasteners: "screws", joint: { style: "rabbet", clearance_mm: 0.1 } },
});
`,
  "src/device.uhd.ts": `export const DEVICE = {
  id: "fixture-device",
  name: "Fixture device",
  interfaces: [],
  children: [
    { id: "case", moduleDefId: "fixture-case" },
    { id: "board", moduleDefId: "fixture-mainboard" },
    { id: "battery", moduleDefId: "fixture-cell" },
  ],
  links: [{ id: "board_on_bosses", a: { child: "case", interfaceId: "board_mount" }, b: { child: "board", interfaceId: "mount" } }],
};
`,
};

/** Write the fixture project into `dir`. */
export function writeFixture(dir: string, overrides: Record<string, string | Buffer> = {}) {
  const files: Record<string, string | Buffer> = {
    ...FILES,
    "src/parts/cell.glb": glbBoxes([{ name: "cell", min: [-10, -7, 0], max: [10, 7, 4] }]),
    "src/boards/mainboard/out/board.glb": glbBoxes(boardBoxes()),
    "src/boards/mainboard/out/board.manifest.json": JSON.stringify(boardManifest(), null, 2),
    ...overrides,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}
