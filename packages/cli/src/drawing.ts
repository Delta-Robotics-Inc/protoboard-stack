/**
 * `protoboard drawing ...` (PB-1190): read a 2D drawing (vector PDF, DXF) and check a model against it,
 * through the `drawing` Python package of `@protoboardai/ext-parts` (scripts/drawing) on the project's CAD
 * runtime (PROTOBOARD_PYTHON, else `protoboard tools install cad`; pdfplumber and ezdxf are pinned in
 * ext-parts' runtime declaration).
 *
 *   protoboard drawing inspect <file>                    vector or raster, pages, units, scale, projection, title block
 *   protoboard drawing views <file> [--page N]           the orthographic views: boxes, labels, roles, projection
 *   protoboard drawing crop <file> [--view vN|--bbox x0,y0,x1,y1] [--dpi N] [--out x.png]
 *                                                        a view as PNG (plus an overview with the crop outlined)
 *   protoboard drawing dimensions <file> [--part <id> --write]
 *                                                        every dimension, with provenance measured-from-drawing;
 *                                                        --write keeps the table as parts/evidence/<id>/drawing-dimensions.json
 *   protoboard drawing compare <file> --part <instance> | --model <x.step> [--view-map v1=front] [--tolerance mm]
 *                                                        the model re-projected through the drawing's views; per-dimension deltas
 *
 * Common: --page N, --ocr (raster pages, only when pytesseract and tesseract are installed; off by DEFAULT), --json,
 * --ignore-pdf-permissions (DEFAULT at the wave 4 gate: a PDF whose flags forbid content extraction is refused without
 * it; the flags and the override are recorded in the reply's `file.pdf`).
 * The project folder is the containment root for every file (the drawing, the model, crops); outside a project
 * the current folder is (DEFAULT). The worker runs as `python -I` (isolated) with its cwd in ext-parts'
 * scripts folder, never the project.
 *
 * The registration in `cli/src/index.ts` is one case (handoffs.md, 2026-11-01 W4-C), raw argv so flags such as
 * --view (a boolean in the shared flag table) arrive as they were typed:
 *   case "drawing": process.exitCode = await (await import("./drawing.js")).drawingCommand(cwd, process.argv.slice(process.argv.indexOf("drawing") + 1), out); return;
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot } from "@protoboardai/core";
import { cadPythonFor, resolvePartStep } from "@protoboardai/core/geometry-service";

type Out = (data: unknown, text: () => string) => void;

export const DRAWING_OPS = ["inspect", "views", "crop", "dimensions", "compare"] as const;
export type DrawingOp = (typeof DRAWING_OPS)[number];

export const DRAWING_USAGE =
  "usage: protoboard drawing <inspect|views|crop|dimensions|compare> <file> [--page N] [--view vN] [--bbox x0,y0,x1,y1] [--dpi N] [--out x.png] [--part <id>] [--write] [--model x.step] [--view-map v1=front,v2=top] [--tolerance mm] [--no-overlay] [--ocr] [--ignore-pdf-permissions]";

export const DRAWING_LIMITS = {
  /** DEFAULT ms for inspect, views, crop, dimensions. */
  timeoutMs: 300_000,
  /** DEFAULT ms for compare (imports build123d and loads a STEP). */
  compareTimeoutMs: 900_000,
  /** DEFAULT bytes of the worker's reply. */
  maxOutputBytes: 32 * 1024 * 1024,
} as const;

/** Flags passed through to the worker: name -> takes a value. */
const PASS: Record<string, boolean> = { page: true, view: true, bbox: true, dpi: true, out: true, model: true, "view-map": true, tolerance: true, "no-overlay": false, ocr: false, "ignore-pdf-permissions": false };

/** The drawing package folder: the project's @protoboardai/ext-parts, else the one beside this checkout. */
export function drawingPackage(root: string): string | undefined {
  const candidates: string[] = [];
  try {
    const req = createRequire(join(root, "package.json"));
    candidates.push(join(dirname(req.resolve("@protoboardai/ext-parts/package.json")), "scripts", "drawing"));
  } catch {
    // not installed in the project
  }
  candidates.push(fileURLToPath(new URL("../../ext-parts/scripts/drawing", import.meta.url)));
  return candidates.find((c) => existsSync(join(c, "__main__.py")));
}

export interface DrawingRun {
  root: string;
  args: string[];
  python?: string;
  pkg?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Run the worker once; resolves with its `protoboard.drawing/v0` reply, rejects with its error. */
export function runDrawing(r: DrawingRun): Promise<Record<string, unknown> & { result: Record<string, unknown> }> {
  const python = r.python ?? cadPythonFor(r.root, r.env);
  const pkg = r.pkg ?? drawingPackage(r.root);
  if (!python) return Promise.reject(new Error("no CAD runtime: run `protoboard tools install cad` in the project, or set PROTOBOARD_PYTHON"));
  if (!pkg) return Promise.reject(new Error("the drawing package (scripts/drawing) was not found: @protoboardai/ext-parts is needed"));
  const timeout = r.timeoutMs ?? (r.args[0] === "compare" ? DRAWING_LIMITS.compareTimeoutMs : DRAWING_LIMITS.timeoutMs);
  return new Promise((ok, fail) => {
    const child = spawn(python, ["-I", pkg, ...r.args, "--json", "--root", r.root], {
      // the scripts folder, not the project: nothing in the project is ever on the worker's import path
      cwd: dirname(pkg),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...(r.env ?? process.env), PYTHONIOENCODING: "utf-8", PYTHONHASHSEED: "0" },
    });
    let stdout = "";
    let stderr = "";
    let killed: string | undefined;
    const timer = setTimeout(() => {
      killed = `the drawing worker took longer than ${timeout} ms (stopped)`;
      child.kill();
    }, timeout);
    child.stdout!.setEncoding("utf8").on("data", (d: string) => {
      stdout += d;
      if (stdout.length > DRAWING_LIMITS.maxOutputBytes && !killed) {
        killed = "the drawing worker's reply was over the size cap (stopped)";
        child.kill();
      }
    });
    child.stderr!.setEncoding("utf8").on("data", (d: string) => (stderr = (stderr + d).slice(-8192)));
    child.on("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return fail(new Error(killed));
      const line = stdout.trim().split("\n").pop() ?? "";
      let reply: Record<string, unknown> & { result: Record<string, unknown> };
      try {
        reply = JSON.parse(line);
      } catch {
        return fail(new Error(`the drawing worker failed (exit ${code})${stderr ? `: ${stderr.trim().split("\n").pop()}` : ""}`));
      }
      if (reply.ok === false) return fail(new Error(String(reply.error ?? "the drawing worker failed")));
      ok(reply);
    });
  });
}

function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq > 0) flags[name] = a.slice(eq + 1);
    else if (PASS[name] || name === "part" || name === "cwd" || name === "format") flags[name] = args[++i] ?? "";
    else flags[name] = true;
  }
  return { positional, flags };
}

/** A part id safe as one folder name under parts/evidence. */
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function inside(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

type Dim = { id: string; kind: string; text?: string | null; value: number; unit: string; view?: string | null; confidence: string };
type Cmp = { id: string; kind: string; drawing: number | null; model: number | null; delta: number | null; within: boolean | null };

/** A short text for one reply. */
export function formatDrawing(op: DrawingOp, reply: Record<string, unknown> & { result: Record<string, unknown> }): string {
  const f = reply.file as { path: string; kind: string; sha256: string };
  const r = reply.result as Record<string, unknown>;
  const head = `${op} ${f.path} (${f.kind}, sha256 ${f.sha256.slice(0, 12)}), ${reply.ms} ms`;
  if (op === "inspect") {
    const sheets = (r.sheets as { name: string; vector: boolean; views?: number; unit?: { unit: string }; scale?: { ratio?: string } | null; titleBlock?: { text: string[] } }[]) ?? [];
    return [head, ...sheets.map((s) => `  ${s.name}: ${s.vector ? "vector" : "raster"}, ${s.views ?? 0} view(s), unit ${s.unit?.unit ?? "?"}, scale ${s.scale?.ratio ?? "not stated"}${s.titleBlock?.text?.length ? `; title block: ${s.titleBlock.text.slice(0, 4).join(" | ")}` : ""}`)].join("\n");
  }
  if (op === "views") {
    const p = r.projection as { guess: string; reason: string };
    const views = r.views as { id: string; role: string; label?: string; size_mm: number[] }[];
    return [head, `  projection ${p.guess} (${p.reason})`, ...views.map((v) => `  ${v.id} ${v.role}${v.label ? ` "${v.label}"` : ""}: ${v.size_mm.join(" x ")} mm`)].join("\n");
  }
  if (op === "dimensions") {
    const dims = r.dimensions as Dim[];
    return [head, ...dims.map((d) => `  ${d.id} ${d.kind} ${d.text ?? ""} = ${d.value} ${d.unit} (${d.view ?? "no view"}, ${d.confidence})`)].join("\n");
  }
  if (op === "crop") return `${head}\n  ${r.png} (${(r.size_px as number[]).join(" x ")} px at ${r.dpi} dpi), overview ${r.overview}`;
  const per = r.perDimension as Cmp[];
  return [head, `  verdict: ${r.verdict}`, ...per.map((d) => `  ${d.id} ${d.kind}: drawing ${d.drawing} mm, model ${d.model ?? "?"} mm, delta ${d.delta ?? "?"} (${d.within === true ? "within" : d.within === false ? "OUT" : "not compared"})`)].join("\n");
}

/** Run `protoboard drawing <op> <file> ...`; returns the exit code. */
export async function drawingCommand(cwd: string, args: string[], out: Out, opts: { python?: string; pkg?: string; env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const { positional, flags } = parseArgs(args);
  const [op, file] = positional as [DrawingOp | undefined, string | undefined];
  if (!op || !DRAWING_OPS.includes(op) || !file) throw new Error(DRAWING_USAGE);
  // DEFAULT: outside a project the current folder is the containment root
  const root = findProjectRoot(cwd) ?? resolve(cwd);
  const pass: string[] = [op, resolve(cwd, file)];
  for (const [name, takes] of Object.entries(PASS)) {
    const v = flags[name];
    if (v === undefined) continue;
    if (takes && typeof v !== "string") throw new Error(`--${name} needs a value\n${DRAWING_USAGE}`);
    pass.push(`--${name}`, ...(takes ? [name === "out" || name === "model" ? resolve(cwd, v as string) : (v as string)] : []));
  }
  const part = typeof flags.part === "string" ? flags.part : undefined;
  let model: { part: string; holder: string; file: string } | undefined;
  if (op === "compare" && part && !flags.model) {
    const s = resolvePartStep(root, part);
    model = { part: s.part, holder: s.holder, file: s.relative };
    pass.push("--model", s.file);
  }
  const reply = await runDrawing({ root, args: pass, python: opts.python, pkg: opts.pkg, env: opts.env });
  if (part) reply.part = part;
  if (model) reply.resolvedModel = model;
  if (op === "dimensions" && flags.write) {
    if (!part || !PART_ID.test(part)) throw new Error("--write needs --part <part id> (letters, digits, dot, dash, underscore): the table goes to parts/evidence/<id>/drawing-dimensions.json");
    const dir = join(root, "parts", "evidence", part);
    if (!inside(root, dir)) throw new Error("the evidence folder resolves outside the project: refused");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "drawing-dimensions.json");
    const table = { ...reply.result, source: reply.file, part };
    writeFileSync(`${target}.tmp`, JSON.stringify(table, null, 2) + "\n");
    renameSync(`${target}.tmp`, target);
    reply.written = relative(root, target).replace(/\\/g, "/");
  }
  out(reply, () => formatDrawing(op, reply) + (reply.written ? `\n  wrote ${reply.written}` : ""));
  return 0;
}
