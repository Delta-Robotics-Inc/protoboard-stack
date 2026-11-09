/**
 * PCB regression runner (PCB editor overhaul, Phase 0): measures every
 * reference board again and compares it with its baseline.
 *
 *   npm run test:pcb-regression [-- --board <id>]... [--update] [--jobs <n>] [--no-kicad] [--threshold <fraction>] [--verbose]
 *
 * Boards: the shareable ones listed in test/fixtures/pcb-regression/boards.json,
 * plus every board listed in local/manifest.json (Git-ignored; internal or
 * confidential boards are named only there). A board whose file is absent is
 * skipped, with the reason.
 * Exit 0 when nothing regressed, 1 when something did (or a board failed to
 * measure), 2 on a usage error. See README.md beside this file.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASELINE_SCHEMA, compareImages, compareNumbers, differencesTable, FAILING, table, toBaseline, type Baseline, type Row } from "./compare.ts";
import { kicadAvailable, measureBoard, workDirOf, type Measurement } from "./measure.ts";

export const FIXTURES = fileURLToPath(new URL("../fixtures/pcb-regression/", import.meta.url));
const ARTIFACTS = fileURLToPath(new URL("../.tmp/pcb-regression/", import.meta.url));

interface BoardsFile {
  boards: { id: string; name: string; tracked: boolean; root?: string; pcb?: string }[];
}
interface LocalManifest {
  boards: Record<string, { root: string; pcb: string; name?: string; source?: string }>;
}

export interface Board {
  id: string;
  name: string;
  tracked: boolean;
  root: string;
  pcb: string;
  baselineDir: string;
}

interface Options {
  boards: string[];
  update: boolean;
  jobs: number;
  kicad: boolean;
  threshold: number;
  verbose: boolean;
}

function usage(msg?: string): never {
  if (msg) console.error(`pcb-regression: ${msg}`);
  console.error("usage: npm run test:pcb-regression -- [--board <id>]... [--update] [--jobs <n>] [--no-kicad] [--threshold <fraction>] [--verbose]");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const envJobs = Number(process.env.PB_PCB_REGRESSION_JOBS);
  // an 8 GB laptop runs two kicad-cli processes side by side comfortably; never more than four
  const o: Options = { boards: [], update: false, jobs: Number.isFinite(envJobs) && envJobs > 0 ? envJobs : Math.min(2, Math.max(1, cpus().length - 1)), kicad: true, threshold: 0.001, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => argv[++i] ?? usage(`${a} needs a value`);
    if (a === "--board" || a === "-b") o.boards.push(val());
    else if (a === "--update") o.update = true;
    else if (a === "--jobs" || a === "-j") o.jobs = Number(val());
    else if (a === "--no-kicad") o.kicad = false;
    else if (a === "--threshold") o.threshold = Number(val());
    else if (a === "--verbose" || a === "-v") o.verbose = true;
    else if (a === "--help" || a === "-h") usage();
    else usage(`unknown argument ${a}`);
  }
  if (!Number.isInteger(o.jobs) || o.jobs < 1) usage("--jobs must be a whole number of at least 1");
  o.jobs = Math.min(o.jobs, 4);
  if (!(o.threshold >= 0 && o.threshold < 1)) usage("--threshold is a fraction of pixels, from 0 to below 1");
  return o;
}

/** The local folder: board copies, their baselines and the research corpus (Git-ignored). */
export const localDir = () => resolve(process.env.PB_PCB_REGRESSION_LOCAL ?? join(FIXTURES, "local"));

/** Every board of the set that can run here, and the ones skipped with the reason. */
export function resolveBoards(): { boards: Board[]; skipped: { id: string; reason: string }[] } {
  const list = (JSON.parse(readFileSync(join(FIXTURES, "boards.json"), "utf8")) as BoardsFile).boards;
  const local = localDir();
  const manifestPath = join(local, "manifest.json");
  const manifest: LocalManifest | undefined = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as LocalManifest) : undefined;
  const boards: Board[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const add = (id: string, name: string, tracked: boolean, root: string, pcb: string) => {
    if (!existsSync(join(root, pcb))) skipped.push({ id, reason: `board file not found: ${join(root, pcb)}` });
    else boards.push({ id, name, tracked, root, pcb, baselineDir: tracked ? join(FIXTURES, "baselines", id) : join(local, "baselines", id) });
  };
  for (const b of list) {
    if (b.tracked) {
      add(b.id, b.name, true, join(FIXTURES, b.root ?? b.id), b.pcb ?? `${b.id}.kicad_pcb`);
      continue;
    }
    const e = manifest?.boards[b.id];
    if (!manifest) skipped.push({ id: b.id, reason: `local only, and there is no local manifest (${manifestPath})` });
    else if (!e) skipped.push({ id: b.id, reason: `local only, and not in ${manifestPath}` });
    else add(b.id, b.name, false, isAbsolute(e.root) ? e.root : join(local, e.root), e.pcb);
  }
  // boards added only in the local manifest
  for (const [id, e] of Object.entries(manifest?.boards ?? {})) {
    if (!list.some((b) => b.id === id)) add(id, e.name ?? id, false, isAbsolute(e.root) ? e.root : join(local, e.root), e.pcb);
  }
  return { boards, skipped };
}

/** Run `fn` over `items`, at most `limit` at once, results in order. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function writeBaseline(b: Board, m: Measurement): string {
  const file = join(b.baselineDir, "baseline.json");
  const old: Baseline | undefined = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Baseline) : undefined;
  const next = toBaseline(m, b.name, b.pcb);
  let note = "recorded";
  if (!m.kicad && old?.kicad) {
    // never drop KiCad's numbers and images because KiCad is missing on this run
    next.kicad = old.kicad;
    note = "file numbers recorded; KiCad numbers and images kept (KiCad not run)";
  }
  mkdirSync(b.baselineDir, { recursive: true });
  if (m.kicad && m.imageDir) {
    rmSync(join(b.baselineDir, "layers"), { recursive: true, force: true });
    for (const key of Object.keys(m.kicad.images)) {
      mkdirSync(join(b.baselineDir, key, ".."), { recursive: true });
      cpSync(join(m.imageDir, key), join(b.baselineDir, key));
    }
  }
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return note;
}

interface Outcome {
  board: Board;
  m?: Measurement;
  rows: Row[];
  error?: string;
  note?: string;
}

async function runOne(b: Board, o: Options, cli: string | undefined): Promise<Outcome> {
  let m: Measurement | undefined;
  try {
    m = await measureBoard(b.id, b.root, b.pcb, { cli });
    const artifacts = join(ARTIFACTS, b.id);
    rmSync(artifacts, { recursive: true, force: true });
    if (m.imageDir) cpSync(m.imageDir, join(artifacts, "current"), { recursive: true });
    if (o.update) return { board: b, m, rows: [], note: writeBaseline(b, m) };
    const file = join(b.baselineDir, "baseline.json");
    if (!existsSync(file)) return { board: b, m, rows: [{ board: b.id, metric: "baseline", baseline: "-", current: "measured", status: "missing", note: `no baseline at ${file}; record one with --update` }] };
    const base = JSON.parse(readFileSync(file, "utf8")) as Baseline;
    if (base.schema !== BASELINE_SCHEMA) return { board: b, m, rows: [{ board: b.id, metric: "baseline schema", baseline: String(base.schema), current: BASELINE_SCHEMA, status: "changed", note: "record the baseline again with --update" }] };
    const rows = compareNumbers(base, m);
    if (base.kicad && m.kicad && m.imageDir) rows.push(...(await compareImages(b.id, b.baselineDir, base.kicad.images, m.imageDir, m.kicad.images, o.threshold, artifacts)));
    return { board: b, m, rows };
  } catch (e) {
    return { board: b, m, rows: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    const w = m && workDirOf(m);
    if (w) rmSync(w, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const o = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const { boards: all, skipped } = resolveBoards();
  const unknown = o.boards.filter((id) => !all.some((b) => b.id === id) && !skipped.some((s) => s.id === id));
  if (unknown.length) usage(`no such board: ${unknown.join(", ")}`);
  const boards = o.boards.length ? all.filter((b) => o.boards.includes(b.id)) : all;
  const skips = o.boards.length ? skipped.filter((s) => o.boards.includes(s.id)) : skipped;

  let cli: string | undefined;
  const k = o.kicad ? kicadAvailable() : { missing: "turned off with --no-kicad" };
  if ("path" in k) cli = k.path;
  console.log(`PCB regression set: ${boards.length} board(s), ${o.jobs} at a time, ${cli ? `KiCad ${"version" in k ? k.version : ""} (${cli})` : "without KiCad"}${o.update ? ", recording baselines" : ""}`);
  if (!cli) console.log(`KiCad: ${"missing" in k ? k.missing : ""}. DRC, KiCad stats and golden images are skipped; board-file numbers are still compared.`);

  const outcomes = await pool(boards, o.jobs, (b) => runOne(b, o, cli));

  const summary = outcomes.map((r) => {
    const f = r.m?.file;
    const d = r.m?.kicad?.drc;
    const failed = !!r.error || r.rows.some((x) => FAILING.has(x.status));
    const improved = r.rows.some((x) => x.status === "improved");
    const result = r.error ? "ERROR" : o.update ? r.note ?? "recorded" : failed ? "FAIL" : improved ? "pass (improved)" : "pass";
    return [
      r.board.id,
      r.board.tracked ? "tracked" : "local",
      f ? String(f.copperLayers) : "-",
      f ? String(f.footprints) : "-",
      f ? String(f.tracks) : "-",
      f ? String(f.vias) : "-",
      f ? String(f.zones) : "-",
      f ? String(f.nets) : "-",
      f ? `${f.boardWidthMm} x ${f.boardHeightMm}` : "-",
      d ? `${d.errors} / ${d.warnings} / ${d.unconnected}` : "-",
      r.m?.kicad ? String(Object.keys(r.m.kicad.images).length) : "-",
      r.m ? `${r.m.seconds.toFixed(1)} s` : "-",
      result,
    ];
  });
  console.log("");
  console.log(table(["board", "where", "Cu", "footprints", "tracks", "vias", "zones", "nets", "outline mm", "DRC err / warn / unconn", "images", "time", "result"], summary));

  const rows = outcomes.flatMap((r) => r.rows);
  const diff = differencesTable(rows);
  if (o.verbose && rows.length) {
    console.log("");
    console.log(table(["board", "metric", "baseline", "current", "status", "note"], rows.map((r) => [r.board, r.metric, r.baseline, r.current, r.status, r.note ?? ""])));
  } else if (diff) {
    console.log("\nDifferences:");
    console.log(diff);
  }
  for (const r of outcomes) if (r.error) console.log(`\n${r.board.id}: ${r.error}`);
  if (skips.length) {
    console.log("\nSkipped:");
    for (const s of skips) console.log(`  ${s.id}: ${s.reason}`);
  }
  const failed = outcomes.some((r) => r.error || r.rows.some((x) => FAILING.has(x.status)));
  const improved = rows.some((r) => r.status === "improved");
  console.log("");
  if (o.update) console.log(`Baselines recorded in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  else if (failed) console.log(`REGRESSION: see the differences above (current images and diffs in ${ARTIFACTS}). ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  else console.log(`No regressions${improved ? "; some numbers improved: record them with --update" : ""}. ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
