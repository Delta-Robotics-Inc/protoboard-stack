/**
 * `protoboard schematic …`: the pin-level schematic without a window (PCB editor Phase 3, contract
 * docs/specs/pcb-editor/phase3-schematic-core.md sections 10 and 15), as `protoboard board …` is for a board.
 *
 * The positional is the schematic folder, `<module folder>/schematic` (it may not exist yet). The circuit always
 * comes from UHD: the project is loaded and the board definition whose source file sits in the schematic folder's
 * parent is drawn. A command uses the schematic's running service when its service.json names a live one
 * (`schematic serve`), else it opens the schematic itself for the one call, saving what it changed. A folder that
 * holds no schematic yet opens as an empty schematic: `layout` lays it out and saves; read-only commands say it is
 * not laid out yet.
 *
 * Text for people by default; `--json` (or `--format json`) on every command. Exit codes, flag reading and actor
 * rules are the board CLI's: 0 applied (or valid in a dry run), 1 invalid (or check errors), 3 refused, 2 a usage
 * error or a failure; `--as human | agent:<name>`, and under an agent `--as human` is refused.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { boardOptions, findProjectRoot as findUhdProjectRoot, loadProject, type Project } from "@protoboardai/core";
import { findProjectRoot as findStateRoot } from "@protoboardai/board/node";
import {
  circuitHash,
  connectSchematic,
  describeSchematicOperations,
  emptySchematic,
  exportKicad,
  findSchematicService,
  openSchematicService,
  renderSchematicSvg,
  schematicBuildDir,
  schematicKey,
  serveSchematic,
  svgToPng,
  type Reply,
  type SchematicCircuit,
  type SchematicClient,
  type SchematicDocument,
  type SchematicQueryParams,
  type SchematicSnapshot,
  type Transaction,
} from "@protoboardai/schematic/node";
import { circuitFromUhd } from "@protoboardai/schematic/uhd";
import { BOARD_EXIT, resolveActor, transactionFrom } from "./board.js";

export type Out = (data: unknown, text: () => string) => void;

/** A schematic a UHD board of the project gives. */
export interface SchematicTarget {
  key: string;
  board: string;
  name: string;
  /** absolute schematic folder */
  dir: string;
  moduleDir: string;
  /** absolute layout board folder (holding board.jsonl) when it exists */
  boardDir?: string;
}

export interface SchematicIo {
  /** Folder relative paths resolve against. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  write?: (s: string) => void;
  stderr?: (s: string) => void;
  /** stdin text for `apply -` (default: process.stdin). */
  readStdin?: () => Promise<string>;
  /** `serve` runs until this aborts (default: SIGINT, SIGTERM, SIGBREAK or `schematic stop`). */
  signal?: AbortSignal;
  /** `serve`: called once listening, with the JSON it printed. */
  onServing?: (info: Record<string, unknown>) => void;
  /** The circuit of a schematic folder (default: from the project's UHD, `schematicCircuitFor`). Tests inject one. */
  circuitFor?: (dir: string) => Promise<{ circuit: SchematicCircuit; target?: SchematicTarget }>;
}

export const SCHEMATIC_EXIT = BOARD_EXIT;

interface Spec {
  name: string;
  args: string;
  summary: string;
  /** Flags it takes besides --json, --format, --cwd. */
  flags: string[];
}

/** Every `protoboard schematic` command (the parity test runs each with --json). */
export const SCHEMATIC_COMMANDS: readonly Spec[] = [
  { name: "serve", args: "<dir>", summary: "Open the schematic as its service on 127.0.0.1 (a free port) and write service.json; Ctrl+C or `schematic stop` saves and stops", flags: ["port", "origin", "recover", "autosave"] },
  { name: "stop", args: "<dir>", summary: "Stop the schematic's running service (it saves first)", flags: [] },
  { name: "inspect", args: "<dir>", summary: "Summary: board, cards, counts, score and gates, whether the layout is current, version, leases", flags: [] },
  { name: "query", args: "<dir>", summary: "Records with their boxes (grid units) by --id, --net, --card or --region x0,y0,x1,y1; JSON", flags: ["id", "net", "card", "region", "kinds"] },
  { name: "ops", args: "", summary: "The operation registry: names, descriptions, examples and JSON schemas (--all adds system ones)", flags: ["all"] },
  { name: "apply", args: "<dir> [<ops.json> | -]", summary: "Apply a transaction file (or ops, or one op; - or no file reads stdin); --dry-run validates only", flags: ["as", "dry-run", "label", "batch-id", "change-set", "expect-seq", "expect-epoch", "lease"] },
  { name: "undo", args: "<dir>", summary: "Undo the actor's own last transaction (needs a running service to have history)", flags: ["as", "lease"] },
  { name: "redo", args: "<dir>", summary: "Redo the actor's last undone transaction", flags: ["as", "lease"] },
  { name: "save", args: "<dir>", summary: "Write the changed schematic files", flags: [] },
  { name: "checkpoint", args: "<dir> <label>", summary: "Save, then print the commit message for the caller to commit (never runs Git)", flags: [] },
  { name: "layout", args: "<dir>", summary: "Run the automatic layout (all cards or --scope card:<key>,…; --mode fresh|tidy; --sheet keep|repack) and save", flags: ["as", "scope", "mode", "sheet"] },
  { name: "check", args: "<dir>", summary: "Electrical findings (unconnected pins, single-pin nets, conflicting outputs, voltage) and the readability gates, in plain words; exit 1 on errors", flags: [] },
  { name: "render", args: "<dir>", summary: "SVG of the sheet (dark, or --theme paper), and a PNG with --png, under .protoboard/build/schematic/<key>/ (or --out <folder>)", flags: ["theme", "png", "out"] },
  { name: "describe", args: "<dir>", summary: "The agent scene (JSON and an image) of the sheet, one --card or one --net; --image png|svg|both|none", flags: ["card", "net", "image", "theme", "out"] },
  {
    name: "cleanup",
    args: "<dir> [pass | list | propose <defect> | apply <fix.json> | explain <defect> | revert <change set>]",
    summary: "The cleanup tools: pass (the default: the worth-most defect first, fixes that raise the score without opening a gate, within --budget operations), list the defects, propose fixes for one, apply one, explain one, revert a change set",
    flags: ["as", "budget", "max-passes", "change-set", "card", "rules", "include-info", "limit", "max"],
  },
  { name: "export-kicad", args: "<dir>", summary: "Write the flat KiCad schematic (one sheet per card) to --out (default the build folder)", flags: ["out", "project"] },
];

export const SCHEMATIC_USAGE = [
  "usage: protoboard schematic <command> <module folder>/schematic [args] [--json]",
  "",
  ...SCHEMATIC_COMMANDS.map((c) => `  ${`${c.name} ${c.args}`.padEnd(32)} ${c.summary}`),
  "",
  "  --as human | agent:<name>        who acts (default: the agent this runs under, else a person)",
  "  coordinates are integer grid units (1 gu = 2.54 mm), +Y down",
  "  exit codes: 0 applied or valid, 1 invalid (check: errors), 3 refused, 2 usage or failure",
].join("\n");

class UsageError extends Error {}

const BOOLEAN = new Set(["json", "dry-run", "all", "recover", "autosave", "png", "include-info"]);
const MULTI = new Set(["id", "origin"]);
const GLOBAL = new Set(["json", "format", "cwd"]);

interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
  has(name: string): boolean;
  one(name: string): string | undefined;
  all(name: string): string[];
}

/** `--name value`, `--name=value`, booleans, and `--` ending options (as the board CLI reads them). */
export function parseSchematicArgs(argv: readonly string[]): Parsed {
  const pos: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--") || a === "-") {
      pos.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    let value: string;
    if (eq > 0) value = a.slice(eq + 1);
    else if (BOOLEAN.has(name)) value = "true";
    else {
      if (i + 1 >= argv.length) throw new UsageError(`--${name} needs a value`);
      value = argv[++i];
    }
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return {
    pos,
    flags,
    has: (n) => flags.has(n) && flags.get(n)!.at(-1) !== "false",
    one: (n) => flags.get(n)?.at(-1),
    all: (n) => (flags.get(n) ?? []).flatMap((v) => (MULTI.has(n) ? v.split(",") : [v])).map((s) => s.trim()).filter(Boolean),
  };
}

const list = (s: string | undefined) => (s ? s.replace(/^\[(.*)\]$/, "$1").split(",").map((x) => x.trim()).filter(Boolean) : undefined);
const int = (s: string | undefined, what: string) => {
  if (s === undefined) return undefined;
  if (!/^-?\d+$/.test(s)) throw new UsageError(`${what} must be a whole number`);
  return Number(s);
};
const cliBatch = () => `cli-${randomBytes(6).toString("hex")}`;

// ---------------------------------------------------------------- the circuit from UHD

/** A board: UHD's `kind: "board"`, a design envelope, or a module bound to a circuit provider. */
const isBoardDef = (def: { id: string; kind?: string; traits?: { type: string }[] }, boards: (id: string) => boolean): boolean => def.kind === "board" || (def.traits ?? []).some((t) => t.type === "design_envelope") || boards(def.id);

/** The project's own board definitions (not vendored parts), each with its schematic folder beside its source file. */
function targetsOf(p: Project): SchematicTarget[] {
  const boards = boardOptions(p).isBoard ?? (() => false);
  const out: SchematicTarget[] = [];
  for (const rec of p.definitions.values()) {
    if (rec.origin.kind !== "local" || !rec.origin.source?.file || !isBoardDef(rec.def, boards)) continue;
    const moduleDir = dirname(resolve(p.root, rec.origin.source.file));
    const dir = join(moduleDir, "schematic");
    const boardDir = join(moduleDir, "board");
    out.push({ key: schematicKey(p.root, dir), board: rec.def.id, name: rec.def.name ?? rec.def.id, dir, moduleDir, ...(existsSync(join(boardDir, "board.jsonl")) ? { boardDir } : {}) });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.board < b.board ? -1 : 1));
}

/** Every UHD board definition of the project at `root`, with its schematic folder (`<module folder>/schematic`). */
export async function schematicTargets(root: string): Promise<SchematicTarget[]> {
  const r = findUhdProjectRoot(resolve(root));
  if (!r) throw new Error(`no protoboard.config.ts in ${resolve(root)} or its parents (run \`protoboard init\`)`);
  return targetsOf(await loadProject(r, { checks: false }));
}

const samePath = (a: string, b: string) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

/** The circuit for a schematic folder: the project's UHD board whose source file sits in the folder's parent. */
export async function schematicCircuitFor(dir: string): Promise<{ circuit: SchematicCircuit; target: SchematicTarget; root: string }> {
  const d = resolve(dir);
  const root = findUhdProjectRoot(d);
  if (!root) throw new Error(`no protoboard.config.ts in ${d} or its parents: a schematic folder is <module folder>/schematic inside a Protoboard project`);
  const p = await loadProject(root, { checks: false });
  const targets = targetsOf(p);
  const target = targets.find((t) => samePath(t.dir, d));
  if (!target) throw new Error(`no UHD board of the project has its source file in ${dirname(d)}; a schematic folder is <module folder>/schematic (schematic folders here: ${targets.map((t) => relative(root, t.dir)).join(", ") || "none"})`);
  const def = p.definitions.get(target.board)!.def;
  return { circuit: circuitFromUhd(def, p.lookup, boardOptions(p)) as SchematicCircuit, target, root };
}

// ---------------------------------------------------------------- the command

/** Run `protoboard schematic <argv>`; returns the exit code. */
export async function schematicCommand(argv: readonly string[], io: SchematicIo): Promise<number> {
  const write = io.write ?? ((s: string) => void process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => void process.stderr.write(s));
  const env = io.env ?? process.env;
  let json = false;
  try {
    const a = parseSchematicArgs(argv);
    json = a.has("json") || a.one("format") === "json";
    const out: Out = (data, text) => write(json ? JSON.stringify(data, null, 2) + "\n" : text() + "\n");
    const [sub, ...pos] = a.pos;
    const spec = SCHEMATIC_COMMANDS.find((c) => c.name === sub);
    if (!sub || sub === "help") {
      out({ commands: SCHEMATIC_COMMANDS }, () => SCHEMATIC_USAGE);
      return sub ? SCHEMATIC_EXIT.ok : SCHEMATIC_EXIT.usage;
    }
    if (!spec) throw new UsageError(`no schematic command ${sub}\n${SCHEMATIC_USAGE}`);
    for (const f of a.flags.keys()) if (!GLOBAL.has(f) && !spec.flags.includes(f)) throw new UsageError(`schematic ${sub} takes no --${f} (it takes ${spec.flags.map((x) => `--${x}`).join(", ") || "no flags"} and --json)`);
    const path = (p: string | undefined, what = "<dir>") => {
      if (!p) throw new UsageError(`usage: protoboard schematic ${spec.name} ${spec.args}  (missing ${what})`);
      return resolve(io.cwd, p);
    };
    const ctx: Ctx = { a, pos, out, json, env, stderr, io, path, write };
    return await COMMANDS[spec.name as keyof typeof COMMANDS](ctx);
  } catch (e) {
    const message = (e as Error)?.name === "BoardLockedError" ? `${(e as Error).message}. Is \`protoboard schematic serve\` starting, or the editor open on it?` : (e as Error).message;
    if (json) write(JSON.stringify({ error: message }) + "\n");
    else stderr(`protoboard: ${message}\n`);
    return SCHEMATIC_EXIT.usage;
  }
}

interface Ctx {
  a: Parsed;
  pos: string[];
  out: Out;
  json: boolean;
  env: NodeJS.ProcessEnv;
  stderr: (s: string) => void;
  write: (s: string) => void;
  io: SchematicIo;
  path(p: string | undefined, what?: string): string;
}

/** The circuit (and target, when known) of a schematic folder: the injected source, else UHD. */
function circuitSource(c: Ctx, dir: string): () => Promise<{ circuit: SchematicCircuit; target?: SchematicTarget }> {
  let loaded: Promise<{ circuit: SchematicCircuit; target?: SchematicTarget }> | undefined;
  return () => (loaded ??= c.io.circuitFor ? c.io.circuitFor(dir) : schematicCircuitFor(dir));
}

/** The document a folder without a schematic opens as: the schematic record named after the board, nothing laid out. */
const startDoc = (dir: string, name: () => string | undefined) => (circuit: SchematicCircuit): SchematicDocument | undefined => (existsSync(join(dir, "schematic.jsonl")) ? undefined : emptySchematic(circuit, name()));

/**
 * Run with a client of the schematic; closes it after. "read": a one-call open writes no journal; "service": a
 * running service is needed.
 */
async function withSchematic<T>(c: Ctx, dir: string, fn: (s: SchematicClient) => Promise<T>, how: "write" | "read" | "service" = "write"): Promise<T> {
  const load = circuitSource(c, dir);
  let name: string | undefined;
  const client = await connectSchematic(
    dir,
    how === "service"
      ? { mode: "service" }
      : {
          ...(how === "read" ? { journal: false } : {}),
          circuit: async () => {
            const l = await load();
            name = l.target?.name;
            return l.circuit;
          },
          document: startDoc(dir, () => name),
        },
  );
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const laidOut = (doc: SchematicDocument) => [...doc.records.values()].some((r) => r.kind === "symbol" || r.kind === "card");

function notLaidOut(c: Ctx, dir: string, command: string): number {
  c.out({ status: "not-laid-out", command, dir, message: `the schematic in ${dir} is not laid out yet; \`protoboard schematic layout ${dir}\` lays it out` }, () => `not laid out yet: ${dir}\n  \`protoboard schematic layout <dir>\` lays it out from the UHD board`);
  return SCHEMATIC_EXIT.usage;
}

const exitOf = (r: Reply) => (r.status === "applied" || r.status === "valid" ? SCHEMATIC_EXIT.ok : r.status === "refused" ? SCHEMATIC_EXIT.refused : SCHEMATIC_EXIT.invalid);

function replyText(r: Reply, mode: string): string {
  const where = mode === "local" ? " (no running service: opened here and saved)" : "";
  if (r.status === "applied" || r.status === "valid") {
    const lines = [`${r.status === "valid" ? "VALID (dry run, nothing committed)" : "APPLIED"}  seq ${r.seq}, epoch ${r.epoch}, batch ${r.batchId}${r.duplicate ? " (a resend: the first reply)" : ""}${r.status === "applied" ? where : ""}`];
    if (r.changed.length) lines.push(`  changed: ${r.changed.length > 12 ? `${r.changed.slice(0, 12).join(", ")} and ${r.changed.length - 12} more` : r.changed.join(", ")}`);
    for (const [h, id] of Object.entries(r.created)) lines.push(`  created: ${h} -> ${id}`);
    if (r.removed.length) lines.push(`  removed: ${r.removed.length > 12 ? `${r.removed.slice(0, 12).join(", ")} and ${r.removed.length - 12} more` : r.removed.join(", ")}`);
    return lines.join("\n");
  }
  if (r.status === "refused") {
    const lines = [`REFUSED  ${r.reason}: ${r.message}`];
    if (r.ids?.length) lines.push(`  objects: ${r.ids.join(", ")}`);
    for (const k of r.conflicts ?? []) lines.push(`  conflict ${k.id}: expected version ${k.expected}, now ${k.current}${k.by ? ` (by ${k.by.id})` : ""}`);
    return lines.join("\n");
  }
  const bad = r as Extract<Reply, { status: "invalid" }>;
  return `INVALID  ${bad.index !== undefined ? `op ${bad.index}: ` : ""}${bad.error}`;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new UsageError("schematic apply needs a transaction file, or one on stdin (`-`)");
  const chunks: Buffer[] = [];
  for await (const ch of process.stdin) chunks.push(ch as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function wrap(text: string, width: number, indent: string): string {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if (line && line.length + w.length + 1 > width) {
      out.push(indent + line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(indent + line);
  return out.join("\n");
}

/** Where derived files go: the build folder of the schematic, as the service keys it. */
const buildDir = (dir: string) => schematicBuildDir(findStateRoot(dir), dir);

/** What `inspect` says about a snapshot. */
function summarize(s: SchematicSnapshot, dir: string, mode: string) {
  const doc = s.doc;
  const counts: Record<string, number> = {};
  for (const r of doc.records.values()) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  const head = doc.records.get("schematic");
  const cards = [...doc.records.values()]
    .filter((r) => r.kind === "card")
    .map((card) => ({ id: card.id, title: card.kind === "card" ? card.title : "", group: card.kind === "card" ? card.group : "", members: [...doc.records.values()].filter((r) => r.kind === "symbol" && r.card === card.id).length }));
  const hash = circuitHash(doc.circuit);
  const source = head?.kind === "schematic" ? head.source : undefined;
  return {
    dir,
    mode,
    epoch: s.epoch,
    seq: s.seq,
    name: head?.kind === "schematic" ? head.name : null,
    board: doc.circuit.board,
    laidOut: laidOut(doc),
    /** the layout was made against another circuit: `schematic layout` places what changed */
    stale: laidOut(doc) && !!source && source.hash !== hash,
    circuit: { parts: doc.circuit.parts.length, nets: doc.circuit.nets.length, hash },
    counts,
    cards,
    pinned: [...doc.records.values()].filter((r) => "pinned" in r && r.pinned).map((r) => r.id),
  };
}

const COMMANDS = {
  async serve(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const live = findSchematicService(dir);
    if (live) throw new Error(`this schematic is already served by pid ${live.pid} on port ${live.port} (${live.file})`);
    const src = await circuitSource(c, dir)();
    const document = startDoc(dir, () => src.target?.name)(src.circuit);
    const svc = openSchematicService({ dir, circuit: src.circuit, ...(document ? { document } : {}) });
    let server: Awaited<ReturnType<typeof serveSchematic>> | undefined;
    try {
      let recovered: number | undefined;
      const pending = svc.recoverable();
      if (pending && c.a.has("recover")) recovered = svc.recover().replayed;
      else if (pending) c.stderr(`protoboard: ${pending} journal entr${pending === 1 ? "y" : "ies"} of an earlier session are not in the files; \`schematic serve --recover\` replays them\n`);
      const stop = new AbortController();
      const origins = c.a.all("origin");
      const port = int(c.a.one("port"), "--port");
      server = await serveSchematic(svc, { ...(port !== undefined ? { port } : {}), ...(origins.length ? { origins } : {}), onShutdown: () => stop.abort() });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsub = c.a.has("autosave")
        ? svc.subscribe((e) => {
            if (e.type !== "commit") return;
            clearTimeout(timer);
            timer = setTimeout(() => {
              const r = svc.save();
              if (r.refused.length) c.stderr(`protoboard: not saved, changed on disk by someone else: ${r.refused.join(", ")}\n`);
            }, 2000);
          })
        : () => {};
      const info = { status: "serving", dir, url: server.url, port: server.port, pid: process.pid, epoch: svc.epoch, seq: svc.seq, serviceFile: server.serviceFile ?? null, laidOut: laidOut(svc.snapshot().doc), ...(recovered !== undefined ? { recovered } : {}), autosave: c.a.has("autosave") };
      if (c.json) c.write(JSON.stringify(info) + "\n");
      else c.write(`serving ${dir}\n  ${server.url}  pid ${process.pid}  epoch ${svc.epoch}\n  service.json: ${server.serviceFile}\n  Ctrl+C or \`protoboard schematic stop\` saves the schematic and stops${c.a.has("autosave") ? "; saving 2 s after each change" : "; nothing is saved until `schematic save`, `schematic checkpoint` or the stop"}\n`);
      c.io.onServing?.(info);
      await new Promise<void>((done) => {
        const end = () => done();
        stop.signal.addEventListener("abort", end);
        c.io.signal?.addEventListener("abort", end);
        if (c.io.signal?.aborted) return done();
        if (!c.io.signal) for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.once(s, end);
      });
      unsub();
      clearTimeout(timer);
      await server.close();
      server = undefined;
      const saved = svc.save();
      svc.close({ save: false });
      if (c.json) c.write(JSON.stringify({ status: "stopped", seq: saved.seq, written: saved.written, refused: saved.refused }) + "\n");
      else c.write(`stopped at seq ${saved.seq}; ${saved.written.length ? `saved ${saved.written.join(", ")}` : "no file changed"}${saved.refused.length ? `; NOT saved (changed on disk by someone else): ${saved.refused.join(", ")}` : ""}\n`);
      return saved.refused.length ? SCHEMATIC_EXIT.refused : SCHEMATIC_EXIT.ok;
    } finally {
      await server?.close();
      svc.close({ save: false });
    }
  },

  async stop(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const live = findSchematicService(dir);
    if (!live) {
      c.out({ status: "not-running", dir }, () => `no schematic service is running for ${dir}`);
      return SCHEMATIC_EXIT.ok;
    }
    const client = await connectSchematic(dir, { mode: "service" });
    try {
      await client.call("schematic.shutdown", {});
    } finally {
      await client.close();
    }
    const end = Date.now() + 10_000;
    while (findSchematicService(dir) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    c.out({ status: "stopped", dir, pid: live.pid }, () => `stopped the schematic service (pid ${live.pid}); it saved the schematic`);
    return SCHEMATIC_EXIT.ok;
  },

  async inspect(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const r = await withSchematic(c, dir, async (s) => {
      const snap = await s.snapshot();
      return { snap, presence: await s.presence(), score: laidOut(snap.doc) ? await s.score() : undefined, mode: s.mode, recoverable: s.recoverable };
    }, "read");
    const sum = summarize(r.snap, dir, r.mode);
    const data = { ...sum, score: r.score ? { score: r.score.score, presentable: r.score.presentable, gates: r.score.gates } : null, leases: r.presence.leases, ...(r.mode === "local" ? { recoverable: r.recoverable } : {}) };
    c.out(data, () =>
      [
        `${data.name ?? "(no schematic record)"}  ${dir}`,
        `  board: ${data.board} (${data.circuit.parts} parts, ${data.circuit.nets} nets)`,
        `  version: seq ${data.seq}, epoch ${data.epoch} (${data.mode === "service" ? "running service" : "opened here; no service running"})`,
        data.laidOut ? `  layout: ${data.cards.length} cards${data.stale ? "; STALE: the UHD circuit changed since it was laid out (`schematic layout` places what changed)" : ""}` : "  layout: not laid out yet (`protoboard schematic layout <dir>`)",
        ...data.cards.map((k) => `    ${k.id.padEnd(28)} ${k.title}${k.group ? ` (${k.group})` : ""}: ${k.members} part${k.members === 1 ? "" : "s"}`),
        `  objects: ${["symbol", "wire", "label", "power", "noconnect", "text", "proposal"].map((k) => `${data.counts[k] ?? 0} ${k}${(data.counts[k] ?? 0) === 1 ? "" : "s"}`).join(", ")}`,
        ...(data.score ? [`  score: ${data.score.score}${data.score.presentable ? ", presentable" : ""}; gates open: ${data.score.gates.open}${data.score.gates.rules.length ? ` (${data.score.gates.rules.join(", ")})` : ""}`] : []),
        `  pinned: ${data.pinned.length ? data.pinned.length : "none"}`,
        `  leases: ${data.leases.length ? data.leases.map((l) => `${l.id} by ${l.holder.id}`).join(", ") : "none"}`,
        ...("recoverable" in data && data.recoverable ? [`  journal: ${data.recoverable} entries of an earlier session are not in the files (\`schematic serve --recover\`)`] : []),
      ].join("\n"),
    );
    return SCHEMATIC_EXIT.ok;
  },

  async query(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const ids = c.a.all("id");
    const chosen = [ids.length ? "id" : "", c.a.one("net") ? "net" : "", c.a.one("card") ? "card" : "", c.a.one("region") ? "region" : ""].filter(Boolean);
    if (chosen.length !== 1) throw new UsageError("schematic query takes one of --id <id>[,<id>…], --net <name>, --card <card id>, --region x0,y0,x1,y1 (grid units)");
    let q: SchematicQueryParams;
    if (ids.length) q = { by: "id", ids };
    else if (c.a.one("net")) q = { by: "net", name: c.a.one("net")! };
    else if (c.a.one("card")) q = { by: "card", id: c.a.one("card")! };
    else {
      const parts = (list(c.a.one("region")) ?? []).map(Number);
      if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) throw new UsageError("--region takes x0,y0,x1,y1 in grid units");
      const kinds = list(c.a.one("kinds"));
      q = { by: "region", box: parts as [number, number, number, number], ...(kinds ? { kinds } : {}) };
    }
    const r = await withSchematic(c, dir, (s) => s.query(q), "read");
    c.write(JSON.stringify(r, null, 2) + "\n");
    return r.missing?.length ? SCHEMATIC_EXIT.invalid : SCHEMATIC_EXIT.ok;
  },

  async ops(c: Ctx): Promise<number> {
    const r = describeSchematicOperations({ all: c.a.has("all") });
    c.out(r, () =>
      [
        ...r.operations.map((o) => `${o.name}${o.audience === "system" ? "  (system: hosts, undo and recovery only)" : ""}  ${o.title}\n${wrap(o.description, 96, "    ")}\n    example: ${JSON.stringify({ op: o.name, ...o.example })}`),
        "",
        "JSON schemas of every input: protoboard schematic ops --json",
      ].join("\n"),
    );
    return SCHEMATIC_EXIT.ok;
  },

  async apply(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const file = c.pos[1];
    const text = !file || file === "-" ? await (c.io.readStdin ?? readStdin)() : readFileSync(resolve(c.io.cwd, file), "utf8");
    const tx = transactionFrom(text, c.a) as unknown as Transaction;
    const actor = resolveActor(c.a.one("as"), c.env);
    const { r, mode } = await withSchematic(c, dir, async (s) => ({ r: await s.apply(tx, actor), mode: s.mode }));
    c.out(r, () => replyText(r, mode));
    return exitOf(r);
  },

  async undo(c: Ctx): Promise<number> {
    return undoRedo(c, "undo");
  },
  async redo(c: Ctx): Promise<number> {
    return undoRedo(c, "redo");
  },

  async save(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const { r, mode } = await withSchematic(c, dir, async (s) => ({ r: await s.save(), mode: s.mode }));
    c.out({ ...r, mode }, () => `${r.written.length ? `saved ${r.written.join(", ")}` : "no file changed"} at seq ${r.seq}${mode === "local" ? " (no running service: the files are as last saved)" : ""}${r.refused.length ? `\nNOT saved, changed on disk by someone else: ${r.refused.join(", ")}` : ""}\nfiles ${r.files.slice(0, 16)}`);
    return r.refused.length ? SCHEMATIC_EXIT.refused : SCHEMATIC_EXIT.ok;
  },

  async checkpoint(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const label = c.pos.slice(1).join(" ").trim();
    if (!label) throw new UsageError("usage: protoboard schematic checkpoint <dir> <label>");
    const r = await withSchematic(c, dir, (s) => s.checkpoint(label));
    c.out(r, () => `${r.written.length ? `saved ${r.written.join(", ")}` : "no file changed"} at seq ${r.seq}${r.refused.length ? `; NOT saved: ${r.refused.join(", ")}` : ""}\n\nCommit message (Protoboard does not commit; run git yourself):\n\n${r.message}`);
    return r.refused.length ? SCHEMATIC_EXIT.refused : SCHEMATIC_EXIT.ok;
  },

  async layout(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const actor = resolveActor(c.a.one("as"), c.env);
    const scope = list(c.a.one("scope"));
    const mode = c.a.one("mode");
    if (mode !== undefined && mode !== "fresh" && mode !== "tidy") throw new UsageError("--mode takes fresh or tidy");
    const sheet = c.a.one("sheet");
    if (sheet !== undefined && sheet !== "keep" && sheet !== "repack") throw new UsageError("--sheet takes keep or repack");
    const tx: Transaction = { batchId: cliBatch(), label: "lay out the schematic", ops: [{ op: "layout.run", ...(scope ? { scope } : {}), ...(mode ? { mode } : {}), ...(sheet ? { sheet } : {}) }] };
    const t0 = performance.now();
    const res = await withSchematic(c, dir, async (s) => {
      const r = await s.apply(tx, actor);
      const saved = r.status === "applied" ? await s.save() : undefined;
      const score = r.status === "applied" ? await s.score() : undefined;
      return { r, saved, score, mode: s.mode };
    });
    const ms = Math.round(performance.now() - t0);
    const data = { ...res.r, ...(res.saved ? { saved: { written: res.saved.written, refused: res.saved.refused } } : {}), ...(res.score ? { score: { score: res.score.score, presentable: res.score.presentable, gates: res.score.gates } } : {}), ms };
    c.out(data, () =>
      [
        replyText(res.r, res.mode),
        ...(res.saved ? [`  saved: ${res.saved.written.length ? res.saved.written.join(", ") : "no file changed"}${res.saved.refused.length ? `; NOT saved (changed on disk by someone else): ${res.saved.refused.join(", ")}` : ""}`] : []),
        ...(res.score ? [`  score ${res.score.score}${res.score.presentable ? ", presentable" : ""}; gates open: ${res.score.gates.open}${res.score.gates.rules.length ? ` (${res.score.gates.rules.join(", ")})` : ""}`] : []),
        `  took ${ms} ms`,
      ].join("\n"),
    );
    return res.saved?.refused.length ? SCHEMATIC_EXIT.refused : exitOf(res.r);
  },

  async check(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const r = await withSchematic(c, dir, async (s) => {
      const snap = await s.snapshot();
      return { snap, findings: await s.checks(), score: laidOut(snap.doc) ? await s.score() : undefined };
    }, "read");
    const errors = r.findings.filter((f) => f.severity === "error").length;
    const warnings = r.findings.filter((f) => f.severity === "warning").length;
    const gateRules = r.score ? r.score.rules.filter((x) => x.severity === "gate" && x.count > 0) : [];
    const data = {
      dir,
      epoch: r.snap.epoch,
      seq: r.snap.seq,
      laidOut: !!r.score,
      summary: { errors, warnings, info: r.findings.length - errors - warnings, gatesOpen: r.score?.gates.open ?? null, score: r.score?.score ?? null, presentable: r.score?.presentable ?? null },
      findings: r.findings,
      gates: gateRules.map((g) => ({ rule: g.id, title: g.title, count: g.count, opportunities: g.opportunities })),
    };
    c.out(data, () =>
      [
        ...r.findings.map((f) => `${f.severity.toUpperCase().padEnd(7)} ${f.message}`),
        r.findings.length ? `electrical: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}, ${data.summary.info} note${data.summary.info === 1 ? "" : "s"}` : "electrical: no findings",
        ...(r.score
          ? gateRules.length
            ? [`readability gates open (${r.score.gates.open}): the sheet is not presentable until they close`, ...gateRules.map((g) => `GATE    ${g.title} (${g.id}): ${g.count} place${g.count === 1 ? "" : "s"}`)]
            : [`readability: every gate closed, score ${r.score.score}`]
          : ["readability: not laid out yet (`protoboard schematic layout <dir>`), so no gates were measured"]),
        ...(r.score && gateRules.length ? [`score ${r.score.score}; \`protoboard schematic cleanup <dir>\` tries fixes, \`schematic describe\` shows where`] : []),
      ].join("\n"),
    );
    return errors ? SCHEMATIC_EXIT.invalid : SCHEMATIC_EXIT.ok;
  },

  async render(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const theme = c.a.one("theme") ?? "dark";
    if (theme !== "dark" && theme !== "paper") throw new UsageError("--theme takes dark (the default) or paper");
    const s = await withSchematic(c, dir, (x) => x.snapshot(), "read");
    if (!laidOut(s.doc)) return notLaidOut(c, dir, "render");
    const t0 = performance.now();
    const svg = renderSchematicSvg(s.doc, { theme });
    const folder = c.a.one("out") ? resolve(c.io.cwd, c.a.one("out")!) : buildDir(dir);
    mkdirSync(folder, { recursive: true });
    const files: { svg: string; png?: string } = { svg: join(folder, `sheet-${theme}.svg`) };
    writeFileSync(files.svg, svg);
    const notes: string[] = [];
    let size: { width: number; height: number } | undefined;
    if (c.a.has("png")) {
      try {
        const p = svgToPng(svg);
        files.png = join(folder, `sheet-${theme}.png`);
        writeFileSync(files.png, p.png);
        size = { width: p.width, height: p.height };
      } catch (e) {
        notes.push(`no PNG: the PNG renderer (@resvg/resvg-js) did not load here (${(e as Error).message.split("\n")[0]})`);
      }
    }
    const data = { status: "written", dir, seq: s.seq, epoch: s.epoch, theme, files, ...(size ? { png: size } : {}), ...(notes.length ? { notes } : {}), ms: Math.round(performance.now() - t0) };
    c.out(data, () => [`wrote ${files.svg} (${theme}, seq ${s.seq})`, ...(files.png ? [`wrote ${files.png} (${size!.width} x ${size!.height} px)`] : []), ...notes.map((n) => `  note: ${n}`)].join("\n"));
    return SCHEMATIC_EXIT.ok;
  },

  async describe(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const card = c.a.one("card");
    const net = c.a.one("net");
    const image = c.a.one("image") ?? "png";
    if (!["png", "svg", "both", "none"].includes(image)) throw new UsageError("--image takes png (the default), svg, both or none");
    const theme = c.a.one("theme");
    if (theme !== undefined && theme !== "dark" && theme !== "paper") throw new UsageError("--theme takes dark or paper");
    const t0 = performance.now();
    const notes: string[] = [];
    const r = await withSchematic(
      c,
      dir,
      async (s) => {
        const snap = await s.snapshot();
        if (!laidOut(snap.doc)) return undefined;
        if (card && !snap.doc.records.has(card)) throw new UsageError(`--card: no card ${card} on the sheet (\`schematic inspect\` lists them)`);
        if (net && !snap.doc.nets.has(net)) throw new UsageError(`--net: the circuit has no net ${net}`);
        const opts = { ...(card ? { card } : {}), ...(net ? { net } : {}), ...(theme ? { theme: theme as "dark" | "paper" } : {}) };
        try {
          return { snap, scene: await s.scene({ ...opts, image: image as "png" | "svg" | "both" | "none" }) };
        } catch (e) {
          if (image !== "png" && image !== "both") throw e;
          notes.push(`PNG output is not available here (${(e as Error).message.split("\n")[0]}): wrote the SVG instead`);
          return { snap, scene: await s.scene({ ...opts, image: "svg" }) };
        }
      },
      "read",
    );
    if (!r) return notLaidOut(c, dir, "describe");
    const slug = card ? `card-${card.replace(/^card:/, "")}` : net ? `net-${net}` : "overview";
    const base = c.a.one("out") ? resolve(c.io.cwd, c.a.one("out")!).replace(/\.(json|png|svg)$/i, "") : join(buildDir(dir), `describe-${slug.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80)}`);
    mkdirSync(dirname(base), { recursive: true });
    const files: { json: string; png?: string; svg?: string } = { json: `${base}.json` };
    const text = JSON.stringify(r.scene.json);
    writeFileSync(files.json, text + "\n");
    if (r.scene.png) writeFileSync((files.png = `${base}.png`), r.scene.png);
    if (r.scene.svg) writeFileSync((files.svg = `${base}.svg`), r.scene.svg);
    const data = { status: "written", dir, epoch: r.snap.epoch, seq: r.snap.seq, focus: card ? { card } : net ? { net } : "overview", files, stats: { jsonChars: text.length, estTokens: Math.ceil(text.length / 4) }, ...(notes.length ? { notes } : {}), ms: Math.round(performance.now() - t0), scene: r.scene.json };
    c.out(data, () => [`wrote ${files.json} (${text.length} characters, about ${data.stats.estTokens} tokens)`, ...(files.png ? [`wrote ${files.png}`] : []), ...(files.svg ? [`wrote ${files.svg}`] : []), ...notes.map((n) => `  note: ${n}`), "  the scene itself: add --json (it prints the scene with these paths)"].join("\n"));
    return SCHEMATIC_EXIT.ok;
  },

  async cleanup(c: Ctx): Promise<number> {
    const tool = c.pos[1] ?? "pass";
    if (tool !== "pass") return cleanupTool(c, tool);
    const dir = c.path(c.pos[0]);
    const actor = resolveActor(c.a.one("as"), c.env);
    const budget = int(c.a.one("budget"), "--budget");
    if (budget !== undefined && (budget < 1 || budget > 1000)) throw new UsageError("--budget takes 1 to 1000 operations");
    const maxPasses = int(c.a.one("max-passes"), "--max-passes");
    if (maxPasses !== undefined && (maxPasses < 1 || maxPasses > 50)) throw new UsageError("--max-passes takes 1 to 50");
    const cs = c.a.one("change-set");
    const changeSet = cs ? { id: cs.split(":")[0], ...(cs.includes(":") ? { title: cs.slice(cs.indexOf(":") + 1) } : {}) } : undefined;
    const t0 = performance.now();
    const r = await withSchematic(c, dir, async (s) => {
      if (!laidOut((await s.snapshot()).doc)) return undefined;
      return { result: await s.cleanupPass(actor, { ...(budget !== undefined ? { budget } : {}), ...(maxPasses !== undefined ? { maxPasses } : {}), ...(changeSet ? { changeSet } : {}) }), mode: s.mode };
    });
    if (!r) return notLaidOut(c, dir, "cleanup");
    const x = r.result;
    const data = { ...x, mode: r.mode, ms: Math.round(performance.now() - t0) };
    c.out(data, () =>
      [
        `CLEANUP  ${x.changeSet.transactions} fix${x.changeSet.transactions === 1 ? "" : "es"}, ${x.changeSet.ops} operation${x.changeSet.ops === 1 ? "" : "s"} in change set ${x.changeSet.id}${r.mode === "local" && x.changeSet.transactions ? " (no running service: opened here and saved)" : ""}`,
        `  score ${x.before.score} -> ${x.after.score}; gates open ${x.before.gates} -> ${x.after.gates}; ${x.passes} pass${x.passes === 1 ? "" : "es"}, ${x.tried} candidates scored; stopped: ${x.stopped}`,
        ...x.steps.map((st) => `  ${st.rule} ${st.title} (${st.ops} op${st.ops === 1 ? "" : "s"}): ${st.before} -> ${st.after}`),
        ...(x.changeSet.transactions && r.mode === "service" ? [`  revert it as a whole: \`protoboard schematic cleanup <dir> revert ${x.changeSet.id}\``] : []),
      ].join("\n"),
    );
    return SCHEMATIC_EXIT.ok;
  },

  async "export-kicad"(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const s = await withSchematic(c, dir, (x) => x.snapshot(), "read");
    if (!laidOut(s.doc)) return notLaidOut(c, dir, "export-kicad");
    const head = s.doc.records.get("schematic");
    const project = (c.a.one("project") ?? (head?.kind === "schematic" ? head.name : s.doc.circuit.board)).replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[._]+|_+$/g, "").slice(0, 80) || "schematic";
    const folder = c.a.one("out") ? resolve(c.io.cwd, c.a.one("out")!) : join(buildDir(dir), "kicad");
    const r = exportKicad(s.doc, { dir: folder, project });
    const files = Object.keys(r.files).sort();
    const data = { status: "written", dir, seq: s.seq, epoch: s.epoch, out: folder, project, root: r.root, files, notes: r.notes };
    c.out(data, () => [`wrote ${files.length} file${files.length === 1 ? "" : "s"} to ${folder} (open ${r.root} in KiCad)`, ...files.map((f) => `  ${f}`), ...r.notes.map((n) => `  note: ${n}`)].join("\n"));
    return SCHEMATIC_EXIT.ok;
  },
} satisfies Record<string, (c: Ctx) => Promise<number>>;

/** A defect named by its id or its marker number. */
const defectRef = (s: string | undefined): string | number => {
  if (!s) throw new UsageError("name the defect by its id or its number (`schematic cleanup <dir> list` gives both)");
  return /^\d+$/.test(s) ? Number(s) : s;
};

/** `cleanup <dir> list | propose <defect> | apply <fix.json> | explain <defect> | revert <change set>`. */
async function cleanupTool(c: Ctx, tool: string): Promise<number> {
  const dir = c.path(c.pos[0]);
  const arg = c.pos[2];
  switch (tool) {
    case "list": {
      const rules = list(c.a.one("rules"));
      const limit = int(c.a.one("limit"), "--limit");
      const r = await withSchematic(c, dir, async (s) => (laidOut((await s.snapshot()).doc) ? s.listDefects({ ...(c.a.one("card") ? { card: c.a.one("card")! } : {}), ...(rules ? { rules } : {}), ...(c.a.has("include-info") ? { includeInfo: true } : {}), ...(limit !== undefined ? { limit } : {}) }) : undefined), "read");
      if (!r) return notLaidOut(c, dir, "cleanup list");
      c.out(r, () => [`score ${r.score}${r.presentable ? ", presentable" : ""}; gates open ${r.gates.open}${r.gates.rules.length ? ` (${r.gates.rules.join(", ")})` : ""}; ${r.defects.length} defect${r.defects.length === 1 ? "" : "s"} listed`, ...r.defects.map((d) => `  ${String(d.n).padStart(3)} ${d.gate ? "GATE" : d.severity.padEnd(4)} ${d.rule} +${d.points}  ${d.message}${d.card ? `  [${d.card}]` : ""}  (${d.id})`)].join("\n"));
      return SCHEMATIC_EXIT.ok;
    }
    case "propose": {
      const defect = defectRef(arg);
      const max = int(c.a.one("max"), "--max");
      const r = await withSchematic(c, dir, (s) => s.proposeFixes(defect, max !== undefined ? { max } : {}), "read");
      c.out({ defect, candidates: r }, () => (r.length ? r.map((f, i) => `${i + 1}. ${f.title} (${f.rule}): score ${f.predicted.before} -> ${f.predicted.after}, gates ${f.predicted.gatesBefore} -> ${f.predicted.gatesAfter}${f.predicted.resolved ? ", resolves it" : ""}\n   ops: ${JSON.stringify(f.ops)}`).join("\n") : `no fix proposed for defect ${defect} (none applies, or each would touch a pinned item or open a gate)`));
      return SCHEMATIC_EXIT.ok;
    }
    case "apply": {
      if (!arg) throw new UsageError("usage: protoboard schematic cleanup <dir> apply <fix.json>  (a fix: { title, ops, changeSet? })");
      const fix = readFix(resolve(c.io.cwd, arg));
      const actor = resolveActor(c.a.one("as"), c.env);
      const cs = c.a.one("change-set");
      const changeSet = cs ? { id: cs.split(":")[0], ...(cs.includes(":") ? { title: cs.slice(cs.indexOf(":") + 1) } : {}) } : fix.changeSet;
      const { r, mode } = await withSchematic(c, dir, async (s) => ({ r: await s.applyFix(actor, { title: fix.title, ops: fix.ops, ...(changeSet ? { changeSet } : {}) }, { batchId: cliBatch() }), mode: s.mode }));
      c.out(r, () => replyText(r, mode));
      return exitOf(r);
    }
    case "explain": {
      const defect = defectRef(arg);
      const text = await withSchematic(c, dir, (s) => s.explainDefect(defect), "read");
      c.out({ defect, text }, () => text);
      return SCHEMATIC_EXIT.ok;
    }
    case "revert": {
      if (!arg) throw new UsageError("usage: protoboard schematic cleanup <dir> revert <change set id>");
      const actor = resolveActor(c.a.one("as"), c.env);
      const { r, mode } = await withSchematic(c, dir, async (s) => ({ r: await s.revertChangeSet(actor, arg, { batchId: cliBatch() }), mode: s.mode }));
      c.out(r, () => replyText(r, mode) + (mode === "local" && r.status === "refused" ? "\n  (no running service: a one-call open has no history; revert works against `protoboard schematic serve`)" : ""));
      return exitOf(r);
    }
    default:
      throw new UsageError(`schematic cleanup takes pass, list, propose <defect>, apply <fix.json>, explain <defect> or revert <change set> (got ${tool.slice(0, 40)})`);
  }
}

/** A fix file: `{ title, ops, changeSet? }` as `cleanup propose` gives a candidate. */
function readFix(file: string): { title: string; ops: Transaction["ops"]; changeSet?: { id: string; title?: string } } {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UsageError(`the fix (${file}) is not readable JSON: ${(e as Error).message}`);
  }
  const f = data as { title?: unknown; ops?: unknown; changeSet?: { id: string; title?: string } };
  if (!f || typeof f !== "object" || typeof f.title !== "string" || !Array.isArray(f.ops)) throw new UsageError("a fix file holds { title, ops, changeSet? } (a candidate from `cleanup propose`)");
  return { title: f.title, ops: f.ops as Transaction["ops"], ...(f.changeSet ? { changeSet: f.changeSet } : {}) };
}

async function undoRedo(c: Ctx, which: "undo" | "redo"): Promise<number> {
  const dir = c.path(c.pos[0]);
  const actor = resolveActor(c.a.one("as"), c.env);
  const lease = int(c.a.one("lease"), "--lease");
  const meta = { batchId: cliBatch(), ...(lease !== undefined ? { leaseToken: lease } : {}) };
  const { r, mode } = await withSchematic(c, dir, async (s) => ({ r: await (which === "undo" ? s.undo(actor, meta) : s.redo(actor, meta)), mode: s.mode }));
  c.out(r, () => replyText(r, mode) + (mode === "local" && r.status === "refused" ? "\n  (no running service: a one-call open has no history; undo works against `protoboard schematic serve`)" : ""));
  return exitOf(r);
}
