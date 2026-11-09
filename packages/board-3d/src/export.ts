/**
 * One call exports a board in 3D: build the scene, write each requested format, the sidecar and the images (isometric
 * and top PNG for every export), then read every file back and check it. Returns what was written, the counts, the
 * findings, the validation and the time each step took.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardDocument } from "@protoboardai/board";
import { renderPng } from "./render.js";
import { buildBoard3d, bodyCount, exportedComponents, type Board3d, type Board3dOptions } from "./scene.js";
import { buildSidecar, type Sidecar, type SidecarFile } from "./sidecar.js";
import { boardIntersections, expectedSolids, findCadPython, validateFile, type FileValidation } from "./validate.js";
import { writeGlb } from "./writers/glb.js";
import { safeFileName, sceneMeshes, write3mf, writeStl, writeStlZip } from "./writers/mesh.js";
import { writeStep } from "./writers/step.js";

export type Format = "step" | "stl" | "3mf" | "glb";
export const FORMATS: readonly Format[] = ["step", "stl", "3mf", "glb"];

export interface ExportOptions extends Board3dOptions {
  /** Folder to write into (created when missing). */
  outDir: string;
  /** File base name (default: the board name and tier, `airnode-c3-full`). */
  baseName?: string;
  /** Formats (default all four). */
  formats?: Format[];
  /** STL as one mesh (`single`), one file per body in a ZIP (`per-body`), or both (default). */
  stl?: "single" | "per-body" | "both";
  /** STEP products: one per component (`unique`, default) or shared between identical bodies. */
  instances?: "unique" | "shared";
  /** Isometric and top PNG of the export (default true). */
  images?: boolean;
  /** Read back and check every file (default true). `occt` also re-reads STEP with OCCT when the CAD runtime is found, and checks overlap with OCCT booleans. */
  validate?: boolean | "occt";
  /** The CAD runtime's Python (default: found from `PROTOBOARD_PYTHON` or a project's `.protoboard/tools/cad` above `outDir`). */
  python?: string;
  /** STEP header time stamp (default now). */
  timestamp?: string;
}

export interface ExportReport {
  board: string;
  tier: Board3d["tier"];
  dir: string;
  files: SidecarFile[];
  images: SidecarFile[];
  sidecar: string;
  /** Mechanical bodies: the board, one per component with a body, slabs. */
  bodies: number;
  /** Solids in the STEP file (bodies plus render solids). */
  solids: number;
  components: { total: number; withBody: number; bySource: Record<string, number> };
  findings: Board3d["findings"];
  intersections: { ref: string; id: string; depthMm: number }[];
  validation: FileValidation[];
  ok: boolean;
  /** Milliseconds per step. `exportMs` is the scene and the files (what a user waits for to get the files); images and validation are separate. */
  timing: { sceneMs: number; stepMs?: number; stlMs?: number; "3mfMs"?: number; glbMs?: number; exportMs: number; imagesMs?: number; validateMs?: number; totalMs: number };
  sidecarData: Sidecar;
}

const sha = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board";

export async function exportBoard3d(doc: BoardDocument, options: ExportOptions): Promise<ExportReport> {
  const t0 = performance.now();
  const scene = buildBoard3d(doc, options);
  const tScene = performance.now();
  const formats = options.formats ?? [...FORMATS];
  const base = safeFileName(options.baseName ?? `${slug(scene.name)}-${scene.tier}${scene.render.copper || scene.render.silkscreen ? "-render" : ""}`);
  mkdirSync(options.outDir, { recursive: true });
  const files: SidecarFile[] = [];
  const written: { format: string; path: string; data: Uint8Array }[] = [];
  const timing: ExportReport["timing"] = { sceneMs: round(tScene - t0), exportMs: 0, totalMs: 0 };
  const names: Record<string, { step?: string; stl?: string; "3mf"?: string; glb?: string }> = {};
  for (const c of exportedComponents(scene)) names[c.id] = {};
  const put = (format: string, file: string, data: Uint8Array) => {
    const path = join(options.outDir, file);
    writeFileSync(path, data);
    files.push({ format, path: file, bytes: data.length, sha256: sha(data) });
    written.push({ format, path, data });
  };
  let stepSolids: number | undefined;
  if (formats.includes("step")) {
    const t = performance.now();
    const r = writeStep(scene, { instances: options.instances ?? "unique", fileName: `${base}.step`, ...(options.timestamp ? { timestamp: options.timestamp } : {}) });
    put("step", `${base}.step`, Buffer.from(r.text, "utf8"));
    stepSolids = r.solids;
    for (const c of exportedComponents(scene)) names[c.id].step = c.name;
    timing.stepMs = round(performance.now() - t);
  }
  const meshes = formats.some((f) => f !== "step") || options.images !== false ? sceneMeshes(scene) : [];
  if (formats.includes("stl")) {
    const t = performance.now();
    const mode = options.stl ?? "both";
    if (mode !== "per-body") put("stl", `${base}.stl`, writeStl(meshes, `${scene.name} ${scene.tier}`));
    if (mode !== "single") put("stl-zip", `${base}.stl.zip`, writeStlZip(meshes));
    for (const c of exportedComponents(scene)) names[c.id].stl = `${safeFileName(c.name)}.stl`;
    timing.stlMs = round(performance.now() - t);
  }
  if (formats.includes("3mf")) {
    const t = performance.now();
    put("3mf", `${base}.3mf`, write3mf(meshes, `${scene.name} (${scene.tier})`));
    for (const c of exportedComponents(scene)) names[c.id]["3mf"] = c.name;
    timing["3mfMs"] = round(performance.now() - t);
  }
  if (formats.includes("glb")) {
    const t = performance.now();
    put("glb", `${base}.glb`, writeGlb(scene));
    for (const c of exportedComponents(scene)) names[c.id].glb = c.path ?? c.ref;
    timing.glbMs = round(performance.now() - t);
  }
  timing.exportMs = round(performance.now() - t0);
  const images: SidecarFile[] = [];
  if (options.images !== false) {
    const t = performance.now();
    for (const view of ["iso", "top"] as const) {
      const r = renderPng(scene, meshes, { view, title: `${scene.name}  ${scene.tier}${scene.render.copper ? "  render" : ""}  ${view}` });
      const file = `${base}.${view}.png`;
      writeFileSync(join(options.outDir, file), r.png);
      images.push({ format: "png", path: file, bytes: r.png.length, sha256: sha(r.png) });
    }
    timing.imagesMs = round(performance.now() - t);
  }
  const validation: FileValidation[] = [];
  const intersections = boardIntersections(scene);
  if (options.validate !== false) {
    const t = performance.now();
    const python = options.validate === "occt" ? options.python ?? findCadPython(options.outDir) : undefined;
    for (const w of written) validation.push(await validateFile(scene, w.format, w.path, w.data, { ...(python ? { python, intersect: true } : {}) }));
    timing.validateMs = round(performance.now() - t);
  }
  timing.totalMs = round(performance.now() - t0);
  const sidecarData = buildSidecar({
    scene,
    files,
    images,
    names,
    ...(stepSolids !== undefined ? { stepSolids } : {}),
    validation: { files: validation.map((v) => ({ format: v.format, path: v.path.split(/[\\/]/).pop(), reader: v.reader, ok: v.ok, checks: v.checks })), intersections },
    timing,
    options: { tier: scene.tier, render: scene.render, formats, instances: options.instances ?? "unique", vias: options.vias ?? true, minHoleMm: options.minHoleMm ?? 1.5, seat: options.seat ?? "fix", origin: options.origin ?? "board-center" },
  });
  const sidecar = `${base}.board3d.json`;
  writeFileSync(join(options.outDir, sidecar), `${JSON.stringify(sidecarData, null, 2)}\n`);
  return {
    board: scene.name,
    tier: scene.tier,
    dir: options.outDir,
    files,
    images,
    sidecar,
    bodies: bodyCount(scene),
    solids: expectedSolids(scene),
    components: { total: scene.components.length, withBody: scene.components.filter((c) => c.solid).length, bySource: sidecarData.counts.bySource },
    findings: scene.findings,
    intersections,
    validation,
    ok: validation.every((v) => v.ok) && intersections.length === 0,
    timing,
    sidecarData,
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;
