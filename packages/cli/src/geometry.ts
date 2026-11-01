/**
 * `protoboard geometry ...` (PB-1187): the exact measurement tier on the
 * command line, for agents and for the viewer's host. Measures a part's
 * source STEP through build123d in the project's CAD runtime and answers the
 * same `MeasureResult` the viewer's mesh tier gives, with `tier: "exact"`.
 *
 *   protoboard geometry measure <request.json | ->    a protoboard.geometry-request/v0 (from the viewer: exactRequest)
 *   protoboard geometry faces <instance> [--limit N]  the B-rep faces (index, type, area, centroid, normal / axis, radius)
 *   protoboard geometry bounds <instance>             the STEP's exact bounding box, part mm
 *   protoboard geometry load <instance>               load a STEP now (warm-up), with its load time
 *   protoboard geometry serve                         JSON lines on stdin and stdout: a request per line, a result per line
 *
 * The registration in `cli/src/index.ts` is one case (handoffs.md, 2026-11-01 W3-D):
 *   case "geometry": process.exitCode = await (await import("./geometry.js")).geometryCommand(cwd, args, out); break;
 * Flags are read from `args` here, so the shared flag table does not change.
 */
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { findProjectRoot } from "@protoboardai/core";
import { GEOMETRY_REQUEST_SCHEMA, closeGeometryServices, geometryService, type GeometryRequest, type MeasureResult } from "@protoboardai/core/geometry-service";

type Out = (data: unknown, text: () => string) => void;

export const GEOMETRY_USAGE =
  "usage: protoboard geometry measure <request.json | -> | faces <instance> [--limit N] | bounds <instance> | load <instance> | serve";

/** DEFAULT: the largest request read from a file or stdin. */
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

function flagValue(args: string[], name: string): string | undefined {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = args[i];
  return a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[i + 1];
}
const positional = (args: string[]) => args.filter((a, i) => !a.startsWith("--") && !(i > 0 && /^--(limit|cwd|format)$/.test(args[i - 1])));

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let s = "";
  for await (const chunk of stream) {
    s += chunk;
    if (s.length > MAX_REQUEST_BYTES) throw new Error(`the request is over ${MAX_REQUEST_BYTES} bytes`);
  }
  return s;
}

const f4 = (x: number | undefined) => (x === undefined ? "?" : x.toFixed(4));

/** One line for a result. */
export function formatMeasure(r: MeasureResult & { files?: Record<string, string> }): string {
  const parts = [`${r.tier} ${r.kind} (${r.method}, ${r.frame} mm)`];
  if (r.distance !== undefined) parts.push(`distance ${f4(r.distance)} mm`);
  if (r.angleDeg !== undefined) parts.push(`angle ${f4(r.angleDeg)} deg`);
  if (r.diameter !== undefined) parts.push(`diameter ${f4(r.diameter)} mm`);
  if (r.size) parts.push(`size ${r.size.map(f4).join(" x ")} mm`);
  const faces = r.faces ? Object.entries(r.faces).map(([k, m]) => `${k}: B-rep face ${m!.brepFace} ${m!.type}${m!.centroidOffset !== undefined ? ` (${f4(m!.centroidOffset)} mm off)` : ""}`) : [];
  if (faces.length) parts.push(faces.join(", "));
  if (r.tier === "mesh") parts.push(`tolerance ±${f4(r.tolerance.mm)} mm`);
  if (r.files) parts.push(Object.values(r.files).join(", "));
  if (r.ms !== undefined) parts.push(`${r.ms} ms`);
  return parts.join("; ") + (r.notes?.length ? `\n  ${r.notes.join("\n  ")}` : "");
}

/** Run `protoboard geometry <sub> ...`; returns the exit code. */
export async function geometryCommand(cwd: string, args: string[], out: Out, io: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream } = {}): Promise<number> {
  const [sub, ...rest] = args;
  const root = findProjectRoot(cwd);
  if (!root) throw new Error("not in a Protoboard project (no protoboard.config.ts here or above)");
  const svc = geometryService(root);
  const pos = positional(rest);
  try {
    switch (sub) {
      case "measure": {
        const src = pos[0];
        if (!src) throw new Error(GEOMETRY_USAGE);
        // a file's size is checked before it is read (gate 3)
        if (src !== "-" && statSync(src).size > MAX_REQUEST_BYTES) throw new Error(`the request is over ${MAX_REQUEST_BYTES} bytes`);
        const text = src === "-" ? await readAll(io.stdin ?? process.stdin) : readFileSync(src, "utf8");
        if (text.length > MAX_REQUEST_BYTES) throw new Error(`the request is over ${MAX_REQUEST_BYTES} bytes`);
        const req = JSON.parse(text) as GeometryRequest;
        const r = await svc.measure(req);
        out(r, () => formatMeasure(r));
        return 0;
      }
      case "faces": {
        const part = pos[0];
        if (part === undefined) throw new Error(GEOMETRY_USAGE);
        const limit = Number(flagValue(rest, "limit") ?? 500);
        const r = await svc.faces(part, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100_000) : 500);
        out(r, () => [`${r.faces} face(s) in ${r.file}`, ...(r.listed as { index: number; type: string; area: number; centroid: number[]; radius?: number }[]).map((f) => `  ${f.index}\t${f.type}\tarea ${f.area} mm2\tcentroid ${f.centroid.join(", ")}${f.radius !== undefined ? `\tr ${f.radius}` : ""}`)].join("\n"));
        return 0;
      }
      case "bounds": {
        const part = pos[0];
        if (part === undefined) throw new Error(GEOMETRY_USAGE);
        const r = await svc.measure({ schema: GEOMETRY_REQUEST_SCHEMA, kind: "bounds", a: { part } });
        out(r, () => formatMeasure(r));
        return 0;
      }
      case "load": {
        const part = pos[0];
        if (part === undefined) throw new Error(GEOMETRY_USAGE);
        const r = await svc.load(part);
        out({ ...r, worker: svc.info }, () => `${r.file}: ${r.faces} face(s), loaded in ${r.loadS} s${r.cached ? " (already loaded)" : ""}; worker start ${svc.info?.startMs ?? "?"} ms`);
        return 0;
      }
      case "serve": {
        // one request per line in, one result per line out, until stdin closes
        const write = (o: unknown) => (io.stdout ?? process.stdout).write(JSON.stringify(o) + "\n");
        const rl = createInterface({ input: io.stdin ?? process.stdin, crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          if (line.length > MAX_REQUEST_BYTES) {
            write({ ok: false, error: "request line over the size cap" });
            continue;
          }
          try {
            write({ ok: true, result: await svc.measure(JSON.parse(line) as GeometryRequest) });
          } catch (e) {
            write({ ok: false, error: (e as Error).message });
          }
        }
        return 0;
      }
      default:
        throw new Error(GEOMETRY_USAGE);
    }
  } finally {
    closeGeometryServices();
  }
}
