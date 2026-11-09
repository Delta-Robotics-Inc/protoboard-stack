/**
 * `protoboard board …`: every board operation without a window (PCB editor Phase 1, contract
 * docs/specs/pcb-editor/phase1-board-core.md section 10; reference docs/specs/pcb-editor/board-cli.md).
 *
 * A command uses the board's running service when its service.json names a live one (`board serve`), else it
 * opens the board itself for the one call, saving what it changed. Text for people by default; `--json` (or
 * `--format json`) on every command. Exit codes: 0 applied (or valid in a dry run), 1 invalid (or check errors),
 * 3 refused, 2 a usage error or a failure.
 *
 * Who acts: `--as human` (a person, the default in a person's terminal) or `--as agent:<name>`. Under an agent
 * (PROTOBOARD_AGENT, or an agent host's environment such as Claude Code's) the actor is that agent and
 * `--as human` is refused: an agent never passes itself off as a person. The MCP tools always pass their agent.
 *
 * Flags are read from the raw argv here (`--name value` or `--name=value`; `--` ends them), as `drawing` does,
 * because the shared flag table would read some of them as other commands' flags.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as ChecksModule from "@protoboardai/board-checks";
import type * as ImportModule from "@protoboardai/board-import";
import type * as RouteModule from "@protoboardai/board-route";
import type * as SceneModule from "@protoboardai/board-scene";
import type * as HostModule from "@protoboardai/views/pcb/host";
import { boardExportKicad, exportKicadText } from "./board-export-kicad.js";
import {
  agentActor,
  BoardLockedError,
  boardBuildDir,
  canonicalRecord,
  connectBoard,
  createEngine,
  describeOperations,
  findProjectRoot,
  findService,
  HUMAN,
  importResultToTransaction,
  netClassOf,
  openBoardService,
  serveBoard,
  toMm,
  withChanges,
  writeBoardDir,
  writeNetlist,
  writeZoneFill,
  type Actor,
  type BoardClient,
  type BoardRecord,
  type BoardSnapshot,
  type Importer,
  type ImportResult,
  type ImportSource,
  type LeaseClaim,
  type QueryParams,
  type Reply,
  type Transaction,
} from "@protoboardai/board/node";
import { applyWithWait, attachServeEditing, EDITING_BOOLEAN, EDITING_COMMANDS, editingCommands, proposeRoute, waitSeconds } from "./board-editing.js";

export type Out = (data: unknown, text: () => string) => void;

export interface BoardIo {
  /** Folder relative paths resolve against. */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** stdout (data, text); default: process.stdout by `--json`. */
  write?: (s: string) => void;
  stderr?: (s: string) => void;
  /** stdin text for `apply -` (default: process.stdin). */
  readStdin?: () => Promise<string>;
  /** `serve` runs until this aborts (default: SIGINT, SIGTERM, SIGBREAK or `board stop`). */
  signal?: AbortSignal;
  /** `serve`: called once listening, with the JSON it printed. */
  onServing?: (info: Record<string, unknown>) => void;
  /** `route` and `diagnose`: routers and a scorer instead of the product's (tests inject the built-in router). */
  routing?: RoutingDeps;
}

/** Routers and a scorer for `route` and `diagnose` (default: tscircuit then Freerouting, scored by the board checks). */
export interface RoutingDeps {
  routers?: RouteModule.Router[];
  scorer?: RouteModule.BoardScorer;
  /** What the injected scorer is, for the report. */
  scorerName?: string;
}

export const BOARD_EXIT = { ok: 0, invalid: 1, usage: 2, refused: 3 } as const;

interface Spec {
  name: string;
  args: string;
  summary: string;
  /** Flags it takes besides --json, --format, --cwd. */
  flags: string[];
}

/** Every `protoboard board` command (the parity test runs each with --json). */
export const BOARD_COMMANDS: readonly Spec[] = [
  { name: "serve", args: "<dir>", summary: "Open the board as its service on 127.0.0.1 (a free port) and write service.json; Ctrl+C or `board stop` saves and stops", flags: ["port", "origin", "recover", "autosave"] },
  { name: "stop", args: "<dir>", summary: "Stop the board's running service (it saves the board first)", flags: [] },
  { name: "inspect", args: "<dir>", summary: "Summary: board, layers, counts, nets, rules, locks, version, leases", flags: [] },
  { name: "query", args: "<dir> [<query.json>]", summary: "Objects by --id, --net, --region x1,y1,x2,y2 or --point x,y (nm, or with mm); JSON", flags: ["id", "net", "region", "point", "tolerance", "layers", "kinds", "records"] },
  { name: "ops", args: "", summary: "The operation registry: names, descriptions, examples and JSON schemas (--all adds system ones)", flags: ["all"] },
  { name: "apply", args: "<dir> [<ops.json> | -]", summary: "Apply a transaction file (or ops, or one op; - or no file reads stdin); --dry-run validates only; --wait <s> retries while paused or held", flags: ["as", "dry-run", "label", "batch-id", "change-set", "expect-seq", "expect-epoch", "lease", "wait"] },
  { name: "undo", args: "<dir>", summary: "Undo the actor's own last transaction (needs a running service to have history)", flags: ["as", "lease"] },
  { name: "redo", args: "<dir>", summary: "Redo the actor's last undone transaction", flags: ["as", "lease"] },
  { name: "revert", args: "<dir> <change set id>", summary: "Undo a whole change set, all or nothing", flags: ["as", "lease"] },
  { name: "claim", args: "<dir> [<claim.json>]", summary: "Take a lease: --purpose, and --roots, --nets or --region (needs a running service)", flags: ["as", "purpose", "roots", "nets", "region", "layers", "ttl"] },
  { name: "release", args: "<dir>", summary: "End the actor's leases (or --lease <id>)", flags: ["as", "lease"] },
  { name: "presence", args: "<dir>", summary: "Live leases and recent agent intents", flags: [] },
  { name: "save", args: "<dir>", summary: "Write the changed board files", flags: [] },
  { name: "checkpoint", args: "<dir> <label>", summary: "Save, then print the commit message for the caller to commit (never runs Git)", flags: [] },
  { name: "import", args: "<source> <dir>", summary: "Import a board (KiCad, Circuit JSON, EasyEDA Pro) into an empty folder, with its zone fill and import record; prints the import report", flags: ["kind", "as"] },
  { name: "check", args: "<dir>", summary: "Connectivity and design rule checks with the board's zone fill, and KiCad's DRC beside them when the board came from KiCad; exit 1 on errors; --with <ops or proposal file> or --proposal <id> (--items) checks the board as it would be after that change, beside the board now; --refill fills the zones again first", flags: ["kicad", "kicad-root", "no-cross-check", "with", "proposal", "items", "as", "refill"] },
  { name: "render", args: "<dir>", summary: "A PNG of the board (headless Chrome) with its fill, ratsnest and findings; --out, --region, --layers, --flip, --net, --width, --height", flags: ["out", "region", "layers", "flip", "net", "width", "height"] },
  { name: "describe", args: "<dir>", summary: "The agent scene (JSON and PNG) of the whole board, or of one --region (mm), --net, --object or --finding, with the checks' connectivity", flags: ["region", "net", "object", "finding", "out", "image"] },
  { name: "route", args: "<dir>", summary: "Autoroute (tscircuit first, Freerouting as the fallback) and print the scored proposal; --nets or --region, --budget <s>; changes nothing unless --apply; --propose stores it as proposals", flags: ["nets", "region", "budget", "apply", "propose", "as"] },
  { name: "diagnose", args: "<dir> <net>", summary: "Why a net does not route: rules or placement, the attempts, the probe, what blocks it, and relaxations test-run on copies; changes nothing", flags: ["budget"] },
  { name: "import-dxf", args: "<dir> <file.dxf>", summary: "Set the board outline and cutouts from a DXF drawing (one outline.import_dxf op); prints what was read and skipped", flags: ["units", "layers", "tolerance", "as"] },
  { name: "export-kicad", args: "<dir> <out.kicad_pcb>", summary: "Write the board as a KiCad board: the .kicad_pcb, .kicad_pro and .kicad_dru beside each other (through the import record's offset, with the zone fill; objects the source gave one UUID share one again unless --unique-ids); prints the export report", flags: ["unique-ids"] },
  // proposals, pause and resume, the corridor query (board-editing.ts)
  ...EDITING_COMMANDS.map((c) => ({ ...c, flags: [...c.flags] })),
];

export const BOARD_USAGE = [
  "usage: protoboard board <command> [args] [--json]",
  "",
  ...BOARD_COMMANDS.map((c) => `  ${`${c.name} ${c.args}`.padEnd(38)} ${c.summary}`),
  "",
  "  --as human | agent:<name>        who acts (default: the agent this runs under, else a person)",
  "  lengths are integer nanometers; a number with mm (1.5mm) is converted",
  "  exit codes: 0 applied or valid, 1 invalid (check: errors; route: nothing proposed), 3 refused, 2 usage or failure",
].join("\n");

class UsageError extends Error {}

const BOOLEAN = new Set(["json", "dry-run", "all", "records", "recover", "autosave", "no-cross-check", "refill", "flip", "apply", "unique-ids", ...EDITING_BOOLEAN]);
const MULTI = new Set(["id", "origin"]);
const GLOBAL = new Set(["json", "format", "cwd"]);

interface Parsed {
  pos: string[];
  flags: Map<string, string[]>;
  has(name: string): boolean;
  one(name: string): string | undefined;
  all(name: string): string[];
}

/** `--name value`, `--name=value`, booleans, and `--` ending options. */
export function parseBoardArgs(argv: readonly string[]): Parsed {
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

// ---------------------------------------------------------------- actors

/** The agent this process runs under, from its environment: PROTOBOARD_AGENT, then agent hosts' own markers. */
export function detectAgent(env: NodeJS.ProcessEnv): string | undefined {
  if (env.PROTOBOARD_AGENT?.trim()) return env.PROTOBOARD_AGENT.trim();
  if (env.CLAUDECODE === "1") return "claude-code";
  if (env.AI_AGENT?.trim()) return env.AI_AGENT.trim();
  return undefined;
}

/** Who acts: `--as`, else the agent this runs under, else a person. An agent cannot name itself a person. */
export function resolveActor(as: string | undefined, env: NodeJS.ProcessEnv): Actor {
  const agent = detectAgent(env);
  if (as === undefined) return agent ? agentActor(agent) : HUMAN;
  if (as === "human" || as === "person") {
    if (agent) throw new UsageError(`this command runs under an agent (${agent}); an agent acts as agent:<name>, never as a person (drop --as human)`);
    return HUMAN;
  }
  const m = /^(agent|router):([A-Za-z0-9_.@-]{1,64})$/.exec(as);
  if (!m) throw new UsageError(`--as takes human, agent:<name> or router:<name> (got ${as.slice(0, 40)})`);
  if (m[1] === "agent") return agentActor(m[2]);
  if (agent) throw new UsageError(`this command runs under an agent (${agent}); it acts as agent:<name>`);
  return { kind: "router", id: `router:${m[2]}`, name: m[2] };
}

// ---------------------------------------------------------------- values

/** A length: integer nanometers, or a number with `mm`. */
export function parseLength(s: string, what: string): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(mm|nm)?\s*$/i.exec(s);
  if (!m) throw new UsageError(`${what}: ${s} is not a length (nanometers, or a number with mm)`);
  const v = Number(m[1]);
  if (m[2]?.toLowerCase() === "mm") return Math.round(v * 1_000_000);
  if (!Number.isInteger(v)) throw new UsageError(`${what}: ${s} is not a whole number of nanometers (add mm for millimeters)`);
  return v;
}
/** A list value, optionally in brackets (`[-1,2,3,4]`: a value that cannot start with a dash, as the MCP tools pass it). */
const unwrap = (s: string) => s.trim().replace(/^\[(.*)\]$/, "$1");
const lengths = (s: string, n: number, what: string) => {
  const parts = unwrap(s).split(",");
  if (parts.length !== n) throw new UsageError(`${what} takes ${n} comma-separated lengths`);
  return parts.map((p) => parseLength(p, what));
};
const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);
const int = (s: string | undefined, what: string) => {
  if (s === undefined) return undefined;
  if (!/^-?\d+$/.test(s)) throw new UsageError(`${what} must be a whole number`);
  return Number(s);
};
const mmText = (nm: number) => `${+toMm(nm).toFixed(4)} mm`;

// ---------------------------------------------------------------- the command

/** Run `protoboard board <argv>`; returns the exit code. */
export async function boardCommand(argv: readonly string[], io: BoardIo): Promise<number> {
  const write = io.write ?? ((s: string) => void process.stdout.write(s));
  const stderr = io.stderr ?? ((s: string) => void process.stderr.write(s));
  const env = io.env ?? process.env;
  let json = false;
  try {
    const a = parseBoardArgs(argv);
    json = a.has("json") || a.one("format") === "json";
    const out: Out = (data, text) => write(json ? JSON.stringify(data, null, 2) + "\n" : text() + "\n");
    const [sub, ...pos] = a.pos;
    const spec = BOARD_COMMANDS.find((c) => c.name === sub);
    if (!sub || sub === "help") {
      out({ commands: BOARD_COMMANDS }, () => BOARD_USAGE);
      return sub ? BOARD_EXIT.ok : BOARD_EXIT.usage;
    }
    if (!spec) throw new UsageError(`no board command ${sub}\n${BOARD_USAGE}`);
    for (const f of a.flags.keys()) if (!GLOBAL.has(f) && !spec.flags.includes(f)) throw new UsageError(`board ${sub} takes no --${f} (it takes ${spec.flags.map((x) => `--${x}`).join(", ") || "no flags"} and --json)`);
    const path = (p: string | undefined, what = "<dir>") => {
      if (!p) throw new UsageError(`usage: protoboard board ${spec.name} ${spec.args}  (missing ${what})`);
      return resolve(io.cwd, p);
    };
    const ctx: Ctx = { a, pos, out, json, env, stderr, io, path, write };
    return await COMMANDS[spec.name as keyof typeof COMMANDS](ctx);
  } catch (e) {
    const message = e instanceof BoardLockedError ? `${e.message}. Is \`protoboard board serve\` starting, or the editor open on it?` : (e as Error).message;
    if (json) write(JSON.stringify({ error: message }) + "\n");
    else stderr(`protoboard: ${message}\n`);
    return BOARD_EXIT.usage;
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
  io: BoardIo;
  path(p: string | undefined, what?: string): string;
}

/**
 * Run with a client of the board; closes it after. "read": a one-call open writes no journal (nothing changes);
 * "service": a running service is needed (leases live only as long as one).
 */
async function withBoard<T>(dir: string, fn: (c: BoardClient) => Promise<T>, how: "write" | "read" | "service" = "write"): Promise<T> {
  if (!existsSync(join(dir, "board.jsonl"))) throw new Error(`${dir} is not a board folder (no board.jsonl)`);
  const c = await connectBoard(dir, how === "service" ? { mode: "service" } : how === "read" ? { journal: false } : {});
  try {
    return await fn(c);
  } finally {
    await c.close();
  }
}

const exitOf = (r: Reply) => (r.status === "applied" || r.status === "valid" ? BOARD_EXIT.ok : r.status === "refused" ? BOARD_EXIT.refused : BOARD_EXIT.invalid);

function replyText(r: Reply, mode: string): string {
  const where = mode === "local" ? " (no running service: opened here and saved)" : "";
  if (r.status === "applied" || r.status === "valid") {
    const lines = [`${r.status === "valid" ? "VALID (dry run, nothing committed)" : "APPLIED"}  seq ${r.seq}, epoch ${r.epoch}, batch ${r.batchId}${r.duplicate ? " (a resend: the first reply)" : ""}${r.status === "applied" ? where : ""}`];
    if (r.changed.length) lines.push(`  changed: ${r.changed.join(", ")}`);
    for (const [h, id] of Object.entries(r.created)) lines.push(`  created: ${h} -> ${id}`);
    if (r.removed.length) lines.push(`  removed: ${r.removed.join(", ")}`);
    return lines.join("\n");
  }
  if (r.status === "refused") {
    const lines = [`REFUSED  ${r.reason}: ${r.message}`];
    for (const m of r.missed ?? []) lines.push(`  missed seq ${m.seq} by ${m.actor.id}: ${m.changed.join(", ")}`);
    for (const c of r.conflicts ?? []) lines.push(`  conflict ${c.id}: expected version ${c.expected}, now ${c.current}${c.by ? ` (by ${c.by.id})` : ""}`);
    return lines.join("\n");
  }
  const bad = r as Extract<Reply, { status: "invalid" }>;
  return `INVALID  ${bad.index !== undefined ? `op ${bad.index}: ` : ""}${bad.error}`;
}

const COMMANDS = {
  async serve(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    if (!existsSync(join(dir, "board.jsonl"))) throw new Error(`${dir} is not a board folder (no board.jsonl)`);
    const live = findService(dir);
    if (live) throw new Error(`this board is already served by pid ${live.pid} on port ${live.port} (${live.file})`);
    const svc = openBoardService({ dir });
    let server: Awaited<ReturnType<typeof serveBoard>> | undefined;
    let editing: Awaited<ReturnType<typeof attachServeEditing>>;
    try {
      let recovered: number | undefined;
      const pending = svc.recoverable();
      if (pending && c.a.has("recover")) recovered = svc.recover().replayed;
      else if (pending) c.stderr(`protoboard: ${pending} journal entr${pending === 1 ? "y" : "ies"} of an earlier session are not in the files; \`board serve --recover\` replays them\n`);
      const stop = new AbortController();
      const origins = c.a.all("origin");
      const port = int(c.a.one("port"), "--port");
      // live checks (a `derived` event after each commit) and board.diagnose, when the editing kernel is installed
      editing = await attachServeEditing(svc, c.stderr);
      server = await serveBoard(svc, { ...(port !== undefined ? { port } : {}), ...(origins.length ? { origins } : {}), ...(editing ? { methods: editing.methods } : {}), onShutdown: () => stop.abort() });
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
      const info = { status: "serving", dir, url: server.url, port: server.port, pid: process.pid, epoch: svc.epoch, seq: svc.seq, serviceFile: server.serviceFile ?? null, ...(recovered !== undefined ? { recovered } : {}), autosave: c.a.has("autosave") };
      // one line of JSON, so a script can read it before the service stops
      if (c.json) c.write(JSON.stringify(info) + "\n");
      else c.write(`serving ${dir}\n  ${server.url}  pid ${process.pid}  epoch ${svc.epoch}\n  service.json: ${server.serviceFile}\n  Ctrl+C or \`protoboard board stop\` saves the board and stops${c.a.has("autosave") ? "; saving 2 s after each change" : "; nothing is saved until `board save`, `board checkpoint` or the stop"}\n`);
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
      editing?.stop();
      editing = undefined;
      const saved = svc.save();
      svc.close({ save: false });
      if (c.json) c.write(JSON.stringify({ status: "stopped", seq: saved.seq, written: saved.written, refused: saved.refused }) + "\n");
      else c.write(`stopped at seq ${saved.seq}; ${saved.written.length ? `saved ${saved.written.join(", ")}` : "no file changed"}${saved.refused.length ? `; NOT saved (changed on disk by someone else): ${saved.refused.join(", ")}` : ""}\n`);
      return saved.refused.length ? BOARD_EXIT.refused : BOARD_EXIT.ok;
    } finally {
      await server?.close();
      editing?.stop();
      svc.close({ save: false });
    }
  },

  async stop(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const live = findService(dir);
    if (!live) {
      c.out({ status: "not-running", dir }, () => `no board service is running for ${dir}`);
      return BOARD_EXIT.ok;
    }
    const client = await connectBoard(dir, { mode: "service" });
    try {
      await client.call("board.shutdown", {});
    } finally {
      await client.close();
    }
    // wait for the service to go (it removes service.json as it closes)
    const end = Date.now() + 10_000;
    while (findService(dir) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    c.out({ status: "stopped", dir, pid: live.pid }, () => `stopped the board service (pid ${live.pid}); it saved the board`);
    return BOARD_EXIT.ok;
  },

  async inspect(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const r = await withBoard(dir, async (b) => ({ s: await b.snapshot(), presence: await b.presence(), mode: b.mode, recoverable: b.recoverable }), "read");
    const sum = summarize(r.s, dir, r.mode);
    const data = { ...sum, leases: r.presence.leases, ...(r.mode === "local" ? { recoverable: r.recoverable } : {}) };
    c.out(data, () => inspectText(data));
    return BOARD_EXIT.ok;
  },

  async query(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const ids = c.a.all("id");
    const chosen = [ids.length ? "id" : "", c.a.one("net") ? "net" : "", c.a.one("region") ? "region" : "", c.a.one("point") ? "point" : "", c.pos[1] ? "file" : ""].filter(Boolean);
    if (chosen.length !== 1) throw new UsageError("board query takes one of --id <id>[,<id>…], --net <name>, --region x1,y1,x2,y2, --point x,y, or a query file ({ by: id | net | region | at, … })");
    const layers = list(c.a.one("layers"));
    const kinds = list(c.a.one("kinds"));
    const records = c.a.has("records");
    const filt = { ...(layers ? { layers } : {}), ...(kinds ? { kinds } : {}), ...(records ? { records } : {}) };
    let q: QueryParams;
    if (c.pos[1]) q = readJson(resolve(c.io.cwd, c.pos[1]), "the query") as QueryParams;
    else if (ids.length) q = { by: "id", ids, records: true };
    else if (c.a.one("net")) q = { by: "net", name: c.a.one("net")!, ...(records ? { records } : {}) };
    else if (c.a.one("region")) {
      const [x1, y1, x2, y2] = lengths(c.a.one("region")!, 4, "--region");
      q = { by: "region", box: { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) }, ...filt };
    } else {
      const [x, y] = lengths(c.a.one("point")!, 2, "--point");
      const tol = c.a.one("tolerance");
      q = { by: "at", point: { x, y }, ...(tol ? { tolerance: parseLength(tol, "--tolerance") } : {}), ...filt };
    }
    const r = await withBoard(dir, (b) => b.query(q), "read");
    // the answer is JSON either way: it is for scripts and agents first
    c.write(JSON.stringify(r, null, 2) + "\n");
    return r.missing?.length ? BOARD_EXIT.invalid : BOARD_EXIT.ok;
  },

  async ops(c: Ctx): Promise<number> {
    const r = describeOperations({ all: c.a.has("all") });
    c.out(r, () =>
      [
        ...r.operations.map((o) => `${o.name}${o.audience === "system" ? "  (system: hosts and undo only)" : ""}  ${o.title}\n${wrap(o.description, 96, "    ")}\n    example: ${JSON.stringify({ op: o.name, ...o.example })}`),
        "",
        "Planned (Phase 2, not registered yet):",
        ...r.planned.map((p) => `  ${p.name}: ${p.description}`),
        "",
        "JSON schemas of every input: protoboard board ops --json",
      ].join("\n"),
    );
    return BOARD_EXIT.ok;
  },

  async apply(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const file = c.pos[1];
    const text = !file || file === "-" ? await (c.io.readStdin ?? readStdin)() : readFileSync(resolve(c.io.cwd, file), "utf8");
    const tx = transactionFrom(text, c.a);
    const actor = resolveActor(c.a.one("as"), c.env);
    // --wait: a `paused` or `held` refusal is sent again until it clears or the time runs out
    const wait = waitSeconds(c.a.one("wait"), (m) => new UsageError(m));
    if (wait !== undefined && tx.dryRun) throw new UsageError("--wait is for a write; a dry run is never paused or held");
    const { r, mode, waited } = await withBoard(dir, async (b) => (wait !== undefined ? { ...(await applyWithWait(b, tx, actor, wait)), mode: b.mode } : { r: await b.apply(tx, actor), mode: b.mode, waited: undefined }));
    c.out(waited ? { ...r, waited } : r, () => replyText(r, mode) + (waited && waited.tries > 1 ? `\n  waited ${(waited.ms / 1000).toFixed(1)} s, ${waited.tries} tries${r.status === "refused" && (r.reason === "paused" || r.reason === "held") ? " (still refused when --wait ran out)" : ""}` : ""));
    return exitOf(r);
  },

  async undo(c: Ctx): Promise<number> {
    return undoRedo(c, "undo");
  },
  async redo(c: Ctx): Promise<number> {
    return undoRedo(c, "redo");
  },

  async revert(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const id = c.pos[1];
    if (!id) throw new UsageError("usage: protoboard board revert <dir> <change set id>");
    const actor = resolveActor(c.a.one("as"), c.env);
    const lease = int(c.a.one("lease"), "--lease");
    const { r, mode } = await withBoard(dir, async (b) => ({ r: await b.revertChangeSet(actor, id, { batchId: `cli-${randomBytes(6).toString("hex")}`, ...(lease !== undefined ? { leaseToken: lease } : {}) }), mode: b.mode }));
    c.out(r, () => replyText(r, mode));
    return exitOf(r);
  },

  async claim(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const actor = resolveActor(c.a.one("as"), c.env);
    // a claim file ({ purpose, roots?, nets?, region?, ttlMs? }) or flags
    const fromFile = c.pos[1] ? (readJson(resolve(c.io.cwd, c.pos[1]), "the claim") as LeaseClaim) : undefined;
    const purpose = c.a.one("purpose") ?? fromFile?.purpose;
    if (!purpose) throw new UsageError("board claim needs --purpose <what the lease is for> (or a claim file)");
    const region = c.a.one("region");
    const layers = list(c.a.one("layers"));
    let box;
    if (region) {
      const [x1, y1, x2, y2] = lengths(region, 4, "--region");
      box = { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
    }
    const ttl = int(c.a.one("ttl"), "--ttl");
    const claim: LeaseClaim = { ...fromFile, purpose, ...(list(c.a.one("roots")) ? { roots: list(c.a.one("roots")) } : {}), ...(list(c.a.one("nets")) ? { nets: list(c.a.one("nets")) } : {}), ...(box ? { region: { box, ...(layers ? { layers } : {}) } } : {}), ...(ttl !== undefined ? { ttlMs: ttl } : {}) };
    const r = await withBoard(dir, (b) => b.claim(actor, claim), "service");
    c.out(r, () => (r.status === "granted" ? `GRANTED  lease ${r.lease.id}, token ${r.lease.token}, until ${new Date(r.lease.expiresAt).toISOString()}\n  pass --lease ${r.lease.token} with your writes` : r.status === "refused" ? `REFUSED  leased: ${r.message}` : `INVALID  ${r.error}`));
    return r.status === "granted" ? BOARD_EXIT.ok : r.status === "refused" ? BOARD_EXIT.refused : BOARD_EXIT.invalid;
  },

  async release(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const actor = resolveActor(c.a.one("as"), c.env);
    const r = await withBoard(dir, (b) => b.release(actor, c.a.one("lease")), "service");
    c.out({ released: r }, () => (r.length ? r.map((l) => `released ${l.id} (${l.purpose})`).join("\n") : `${actor.id} held no lease`));
    return BOARD_EXIT.ok;
  },

  async presence(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const { p, mode } = await withBoard(dir, async (b) => ({ p: await b.presence(), mode: b.mode }), "read");
    c.out({ ...p, mode }, () =>
      [
        `seq ${p.seq}, epoch ${p.epoch}${mode === "local" ? " (no running service: no leases)" : ""}`,
        ...(p.paused ? [`  PAUSED by ${p.paused.by.id}${p.paused.reason ? ` (${p.paused.reason})` : ""} since ${new Date(p.paused.since).toISOString()}${p.paused.until !== undefined ? ` until ${new Date(p.paused.until).toISOString()}` : " until resumed"}: agents and routers are refused`] : []),
        ...(p.leases.length ? p.leases.map((l) => `  lease ${l.id} by ${l.holder.id}: ${[...l.roots.map((r) => `root ${r || "(whole board)"}`), ...l.nets.map((n) => `net ${n}`), ...(l.region ? ["a region"] : [])].join(", ")} until ${new Date(l.expiresAt).toISOString()}`) : ["  no leases"]),
        ...p.intents.map((i) => `  intent of ${i.actor.id} (${i.from === "lease" ? "from its lease" : "recent edit"}): ${JSON.stringify(i.label)}${i.ids.length ? `, ${i.ids.length} object(s)` : ""}`),
      ].join("\n"),
    );
    return BOARD_EXIT.ok;
  },

  async save(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const { r, mode } = await withBoard(dir, async (b) => ({ r: await b.save(), mode: b.mode }));
    c.out({ ...r, mode }, () => `${r.written.length ? `saved ${r.written.join(", ")}` : "no file changed"} at seq ${r.seq}${mode === "local" ? " (no running service: the files are as last saved)" : ""}${r.refused.length ? `\nNOT saved, changed on disk by someone else: ${r.refused.join(", ")}` : ""}\nfiles ${r.files.slice(0, 16)}`);
    return r.refused.length ? BOARD_EXIT.refused : BOARD_EXIT.ok;
  },

  async checkpoint(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const label = c.pos.slice(1).join(" ").trim();
    if (!label) throw new UsageError("usage: protoboard board checkpoint <dir> <label>");
    const r = await withBoard(dir, (b) => b.checkpoint(label));
    c.out(r, () => `${r.written.length ? `saved ${r.written.join(", ")}` : "no file changed"} at seq ${r.seq}${r.refused.length ? `; NOT saved: ${r.refused.join(", ")}` : ""}\n\nCommit message (Protoboard does not commit; run git yourself):\n\n${r.message}`);
    return r.refused.length ? BOARD_EXIT.refused : BOARD_EXIT.ok;
  },

  async import(c: Ctx): Promise<number> {
    const source = c.path(c.pos[0], "<source>");
    const dir = c.path(c.pos[1]);
    const t0 = performance.now();
    const importers = await loadImporters();
    if (!importers) return notAvailable(c, "import", "no board importer is installed (packages board-import and board-import-easyeda)");
    if (!existsSync(source)) throw new Error(`no file ${source}`);
    const src: ImportSource = { path: source, ...(c.a.one("kind") ? { kind: c.a.one("kind") } : {}) };
    if (statSync(source).isFile()) {
      const bytes = new Uint8Array(readFileSync(source));
      src.bytes = bytes;
      src.text = new TextDecoder().decode(bytes);
    }
    const imp = importers.find((i) => i.accepts(src));
    if (!imp) throw new Error(`no installed importer accepts ${source} (installed: ${importers.map((i) => i.id).join(", ")}; --kind names the format)`);
    const exists = existsSync(join(dir, "board.jsonl"));
    // a whole-board importer (board-import's) returns more than the contract's ImportResult: stats, offset, fill, timing
    const result = (await imp.import(src, exists ? { current: (await withBoard(dir, (b) => b.snapshot(), "read")).doc } : {})) as ImportResult & Partial<Omit<ImportModule.BoardImportResult, "report">>;
    const importMs = result.ms !== undefined ? Math.round(result.ms) : Math.round(performance.now() - t0);
    const report = result.report;
    const levels = { dropped: 0, approximated: 0, info: 0 };
    for (const x of report) levels[x.level]++;
    // objects per level (a line such as "40 hidden footprint text" counts 40), when the importer summarizes them
    const objects = result.summary ? Object.fromEntries((["dropped", "approximated", "info"] as const).map((l) => [l, Object.values(result.summary![l] ?? {}).reduce((n, v) => n + v, 0)])) : undefined;
    let outcome: Record<string, unknown>;
    let code: number = BOARD_EXIT.ok;
    if (result.document) {
      if (exists) throw new Error(`${dir} already holds a board; importing a whole board needs an empty folder`);
      mkdirSync(dir, { recursive: true });
      const root = findProjectRoot(dir);
      const w = writeBoardDir(dir, result.document);
      if (result.netlist && result.netlist.source !== "uhd") writeNetlist(dir, result.netlist);
      // the source's own zone fill (derived data: the build folder, never the board files)
      const fill = result.fill ? { path: writeZoneFill(dir, result.fill, root), source: result.fill.source, entries: result.fill.fills.length, polygons: result.fill.fills.reduce((n, f) => n + f.polygons.length, 0) } : undefined;
      // where the board came from, for `board check`'s KiCad cross-check
      const host = await loadHost();
      const importRecord = host ? host.writeImportRecord(dir, { importer: imp.id, source, ...(result.offset ? { offset: result.offset } : {}), at: new Date().toISOString(), report: levels, ...(result.rulesNotEvaluated?.length ? { rulesNotEvaluated: result.rulesNotEvaluated } : {}), ...(result.sharedSourceIds?.length ? { sharedIds: result.sharedSourceIds } : {}) }, root) : undefined;
      outcome = { status: "written", files: w.written, records: result.document.records.size, fill: fill ?? null, importRecord: importRecord ?? null, ...(host ? {} : { importRecordNote: "not written: the board analysis (views pcb/host) is not installed, so `board check` cannot find the source for a cross-check" }) };
    } else if (result.ops?.length) {
      if (!exists) throw new Error(`${dir} has no board to import into, and ${imp.id} gave operations, not a board`);
      const tx = importResultToTransaction(imp.id, result);
      const host: Actor = { kind: "host", id: `import:${imp.id.replace(/[^A-Za-z0-9_.@-]/g, "-")}`, name: imp.id };
      const r = await withBoard(dir, (b) => b.apply(tx, host));
      outcome = { status: r.status, reply: r };
      code = exitOf(r);
    } else outcome = { status: "nothing", message: `${imp.id} gave neither a board nor operations` };
    const ms = { import: importMs, total: Math.round(performance.now() - t0) };
    const data = {
      importer: imp.id,
      source,
      dir,
      ...outcome,
      ...(result.stats ? { stats: result.stats } : {}),
      ...(result.offset ? { offset: result.offset } : {}),
      levels,
      ...(objects ? { objects } : {}),
      ...(result.summary ? { summary: result.summary } : {}),
      report,
      ...(result.rulesNotEvaluated ? { rulesNotEvaluated: result.rulesNotEvaluated } : {}),
      ms,
    };
    c.out(data, () => {
      const st = result.stats;
      const fill = outcome.fill as { path: string; source: string; entries: number; polygons: number } | null | undefined;
      const per = (l: "dropped" | "approximated" | "info") => `${levels[l]} ${l}${objects && objects[l] !== levels[l] ? ` (${objects[l]} object${objects[l] === 1 ? "" : "s"})` : ""}`;
      return [
        `${String(outcome.status).toUpperCase()}  ${imp.id}: ${source} -> ${dir}`,
        ...(st ? [`  board: ${st.footprints} footprints, ${st.pads} pads, ${st.tracks} tracks (${st.arcs} arcs), ${st.vias} vias, ${st.zones} zones, ${st.keepouts} keep-outs, ${st.nets} nets, ${st.netclasses} net classes, ${st.rules} rules`] : []),
        ...(outcome.files ? [`  files: ${(outcome.files as string[]).join(", ") || "none"}`] : []),
        ...(fill ? [`  zone fill: ${fill.entries ? `${fill.entries} entries, ${fill.polygons} polygons` : "none in the source"} (${fill.source}) -> ${fill.path}`] : outcome.status === "written" ? ["  zone fill: the importer gave none"] : []),
        ...(result.offset ? [`  offset: a board point plus (${mmText(result.offset.x)}, ${mmText(result.offset.y)}) is the source point (+Y up)`] : []),
        ...(outcome.importRecord ? [`  import record: ${outcome.importRecord as string}`] : outcome.importRecordNote ? [`  import record: ${outcome.importRecordNote as string}`] : []),
        `  report: ${per("dropped")}, ${per("approximated")}, ${per("info")} line(s); --json lists every line`,
        ...report.filter((x) => x.level !== "info").map((x) => `  ${x.level.toUpperCase()} ${x.message}${x.source ? ` (${x.source})` : ""}`),
        ...(result.rulesNotEvaluated ?? []).map((r) => `  NOT EVALUATED rule ${r.name}: ${r.reason}`),
        `  took ${ms.import} ms to import, ${ms.total} ms in all`,
      ].join("\n");
    });
    return code;
  },

  async check(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const kicad = c.a.one("kicad") ? resolve(c.io.cwd, c.a.one("kicad")!) : undefined;
    const kicadRoot = c.a.one("kicad-root") ? resolve(c.io.cwd, c.a.one("kicad-root")!) : undefined;
    const noCross = c.a.has("no-cross-check");
    if (noCross && (kicad || kicadRoot)) throw new UsageError("--no-cross-check turns the KiCad cross-check off; drop it, or drop --kicad and --kicad-root");
    if (kicad && !existsSync(kicad)) throw new UsageError(`--kicad: no file ${kicad}`);
    // --with <file> / --proposal <id>: the checks on the board as it would be after that change (nothing changes)
    const withFile = c.a.one("with");
    const proposalId = c.a.one("proposal");
    if (withFile && proposalId) throw new UsageError("--with and --proposal exclude each other");
    if ((withFile || proposalId) && (kicad || kicadRoot)) throw new UsageError("--with and --proposal check a board that is not on disk; KiCad cross-checks a file (drop --kicad and --kicad-root)");
    if (c.a.one("items") && !withFile && !proposalId) throw new UsageError("--items narrows --with <proposal file> or --proposal <id>");
    const host = await loadHost();
    if (!host) return notAvailable(c, "check", "the board analysis is not installed (package views, pcb/host)");
    const t0 = performance.now();
    const loaded = await withBoard(dir, async (b) => {
      const snap = await b.snapshot();
      const preview = proposalId ? await b.previewProposal(proposalId, list(c.a.one("items")) ? { items: list(c.a.one("items"))! } : {}) : undefined;
      return { snap, preview };
    }, "read");
    let s = loaded.snap;
    let candidate: { kind: "with" | "proposal"; what: string; items?: string[]; now: BoardSnapshot } | undefined;
    if (proposalId) {
      const pv = loaded.preview;
      if (!pv || !pv.valid) {
        const error = pv ? (pv.error ?? "it does not apply") : `no proposal ${proposalId}`;
        c.out({ status: "invalid", error }, () => `INVALID  --proposal ${proposalId}: ${error}`);
        return BOARD_EXIT.invalid;
      }
      candidate = { kind: "proposal", what: proposalId, ...(list(c.a.one("items")) ? { items: list(c.a.one("items"))! } : {}), now: s };
      s = { ...s, doc: withChanges(s.doc, [...pv.added, ...pv.changed.map((x) => x.after)], pv.removed.map((x) => x.id)) };
    } else if (withFile) {
      const file = resolve(c.io.cwd, withFile);
      const tx = changeFrom(readFileSync(file, "utf8"), list(c.a.one("items")));
      const actor = resolveActor(c.a.one("as"), c.env);
      // an epoch of its own: ids it issues never collide with the board's (an engine counts ids per epoch from 1)
      const engine = createEngine(s.doc, { epoch: "chkwth", now: () => 0 });
      const r = engine.apply({ ...tx, dryRun: false, expectSeq: undefined, expectEpoch: undefined } as Transaction, actor);
      if (r.status !== "applied") {
        c.out(r, () => `--with ${withFile}: ${replyText(r, "local").replace(/^(\w+)/, "$1 (nothing checked)")}`);
        return exitOf(r);
      }
      candidate = { kind: "with", what: withFile, ...(list(c.a.one("items")) ? { items: list(c.a.one("items"))! } : {}), now: s };
      s = { ...s, doc: engine.doc };
    }
    // --refill: the zones filled again around the copper as it is now (the fill engine), as the board service's live
    // checks and the layout screen do once the board is edited; without it, the cached fill (an imported board's is
    // the source tool's last fill, current for its zones but not refilled around copper moved since)
    const refill = c.a.has("refill");
    const fillMod = refill ? await host.loadFillModule() : undefined;
    if (refill && !fillMod) return notAvailable(c, "check --refill", "the zone fill engine is not installed (package board-fill)");
    const fillOf = (snap: BoardSnapshot) => (fillMod ? { fill: fillMod.fillZones(snap).fill } : {});
    const a = await host.analyzeBoard(s, dir, { crossCheck: candidate || noCross ? false : kicad ? true : "auto", ...(kicad ? { kicadPcb: kicad } : {}), ...(kicadRoot ? { kicadRoot } : {}), ...fillOf(s) });
    const nowA = candidate ? await host.analyzeBoard(candidate.now, dir, { crossCheck: false, ...fillOf(candidate.now) }) : undefined;
    if (!a.available || !a.result) return notAvailable(c, "check", a.reason ?? "the board checks are not installed (package board-checks)");
    const r = a.result;
    const total = Math.round(performance.now() - t0);
    const errorFindings = r.findings.filter((f) => f.severity === "error").length;
    const cross = a.crossCheck ?? { ran: false as const, reason: candidate ? `not run on a board that is not on disk (--${candidate.kind})` : noCross ? "turned off (--no-cross-check)" : "the board was not imported from a KiCad file (--kicad <file> names one)", inputHash: r.inputHash };
    const nowSummary = nowA?.result?.summary;
    const withData = candidate ? { kind: candidate.kind, [candidate.kind === "with" ? "file" : "id"]: candidate.what, ...(candidate.items ? { items: candidate.items } : {}), now: nowSummary ?? null } : undefined;
    const fill = fillState(a, r.connectivity);
    const data = {
      dir,
      epoch: s.epoch,
      seq: s.seq,
      summary: r.summary,
      findings: r.findings,
      // findings a person waived (not in findings or the counts), each with its waiver
      waived: r.waived ?? [],
      notRun: r.notRun,
      defaults: r.defaults,
      notes: r.notes,
      connectivity: connectivityCounts(r.connectivity),
      crossCheck: compactCrossCheck(cross),
      fill: fill.data,
      importRecord: a.importRecord ?? null,
      ms: { checks: a.ms.checks ?? null, kicad: a.ms.kicad ?? null, total },
      ...(withData ? { with: withData } : {}),
    };
    const checks = await host.loadChecksModule();
    c.out(data, () =>
      [
        // in plain language (the screen's words); the ids of findings, objects and rules are in --json
        ...r.findings.map((f) => {
          const d = host.describeFinding?.(f, s.doc);
          return `${f.severity.toUpperCase().padEnd(7)} ${d ? `${d.check}: ${d.sentence}` : `${f.check}  ${f.message}`}  at (${+toMm(f.location.x).toFixed(3)}, ${+toMm(f.location.y).toFixed(3)}) mm`;
        }),
        ...(r.findings.length ? ["(finding, object and rule ids: --json)"] : []),
        ...r.notRun.map((n) => `NOT RUN ${n.check}: ${n.reason}`),
        ...r.defaults.map((n) => `DEFAULT ${n.check}: ${n.reason}`),
        ...r.summary.caveats.map((x) => `CAVEAT  ${x}`),
        ...r.notes.map((x) => `NOTE    ${x}`),
        ...(r.waived ?? []).map((w) => `WAIVED  ${w.finding.check} (${w.finding.id}) by ${w.waiver}: out of the counts`),
        `zone fill: ${fill.text}`,
        `ours:  ${r.summary.line}  (seq ${s.seq}, checks ${a.ms.checks ?? "?"} ms)`,
        ...(candidate
          ? [
              `  with ${candidate.kind === "with" ? `the change in ${candidate.what}` : `proposal ${candidate.what}`}${candidate.items ? ` (items ${candidate.items.join(", ")})` : ""} applied on a copy; nothing changed`,
              `  the board now: ${nowSummary?.line ?? "not checked"}`,
            ]
          : []),
        ...crossCheckLines(cross, checks?.formatCrossCheck),
      ].join("\n"),
    );
    return errorFindings ? BOARD_EXIT.invalid : BOARD_EXIT.ok;
  },

  async render(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const region = c.a.one("region") ? boxOf(lengths(c.a.one("region")!, 4, "--region")) : undefined;
    const layersFlag = c.a.one("layers");
    const layers = layersFlag === undefined ? undefined : (PRESET_IDS as readonly string[]).includes(layersFlag) ? layersFlag : list(layersFlag);
    const width = size(c.a.one("width"), "--width") ?? 1200;
    const height = size(c.a.one("height"), "--height") ?? 900;
    const nets = c.a.all("net").flatMap((v) => v.split(",")).map((x) => x.trim()).filter(Boolean);
    const headless = await loadHeadless();
    if (!headless) return notAvailable(c, "render", "the headless board renderer is not installed (package views, pcb/headless)");
    const t0 = performance.now();
    const s = await withBoard(dir, (b) => b.snapshot(), "read");
    for (const n of nets) if (!s.doc.nets.has(n)) throw new UsageError(`--net: the board has no net ${n}`);
    // the board's fill, ratsnest and findings, from the same analysis `board check` runs (no KiCad: a picture needs none)
    const host = await loadHost();
    const a = host ? await host.analyzeBoard(s, dir, { crossCheck: false }) : undefined;
    const derived = host && a ? host.toBoardDerived(s, a) : undefined;
    const fills = host && derived ? host.zoneFillsFromEntries(derived.fills) : { fills: [], unplaced: 0 };
    const notes = [...(derived?.notes ?? []), ...(host ? [] : ["the board analysis (views pcb/host) is not installed: no fill, ratsnest or findings drawn"]), ...(fills.unplaced ? [`${fills.unplaced} fill entr${fills.unplaced === 1 ? "y has" : "ies have"} no zone record to draw under and ${fills.unplaced === 1 ? "is" : "are"} left out`] : [])];
    const options: HeadlessOptions = { width, height, ...(region ? { region } : {}), ...(layers ? { layers } : {}), ...(c.a.has("flip") ? { flip: true } : {}), ...(nets.length ? { highlightNets: nets } : {}), findings: derived?.findings ?? [], ratsnest: derived?.ratsnest ?? [], fills: fills.fills, origin: true };
    let png: Uint8Array;
    try {
      png = await headless.renderBoardPng(s, options);
    } catch (e) {
      return notAvailable(c, "render", `the headless renderer could not draw (it needs a Chrome-family browser): ${(e as Error).message.split("\n")[0]}`);
    }
    const root = findProjectRoot(dir);
    const outFile = c.a.one("out") ? resolve(c.io.cwd, c.a.one("out")!) : join(boardBuildDir(root, dir), "render.png");
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, png);
    const checks = derived?.checks.ran ? a?.result?.summary.line : undefined;
    const data = {
      status: "written",
      file: outFile,
      seq: s.seq,
      epoch: s.epoch,
      width,
      height,
      region: region ?? null,
      layers: layers ?? "default",
      flip: c.a.has("flip"),
      highlightNets: nets,
      findings: derived?.findings.length ?? 0,
      ratsnest: derived?.ratsnest.length ?? 0,
      fill: derived?.fill ? { ...derived.fill, drawn: fills.fills.length } : null,
      checks: checks ?? null,
      ...(notes.length ? { notes } : {}),
      ms: Math.round(performance.now() - t0),
    };
    c.out(data, () =>
      [
        `wrote ${outFile} (${width} x ${height} px, seq ${s.seq})`,
        `  drawn: ${data.findings} finding marker(s), ${data.ratsnest} ratsnest line(s), ${fills.fills.length} fill entr${fills.fills.length === 1 ? "y" : "ies"}${derived?.fill ? ` (${derived.fill.source}${derived.fill.current ? "" : ", out of date"})` : ""}`,
        ...(checks ? [`  checks: ${checks}`] : []),
        ...notes.map((n) => `  note: ${n}`),
      ].join("\n"),
    );
    return BOARD_EXIT.ok;
  },

  async describe(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const given = (["region", "net", "object", "finding"] as const).filter((k) => c.a.one(k) !== undefined);
    if (given.length > 1) throw new UsageError("board describe takes at most one of --region, --net, --object, --finding (none: the whole board)");
    const focus = given[0];
    const value = focus ? c.a.one(focus)! : undefined;
    const image = c.a.one("image") ?? "png";
    if (!["png", "svg", "both", "none"].includes(image)) throw new UsageError("--image takes png (the default), svg, both or none");
    const region = focus === "region" ? millimeters(value!, 4, "--region") : undefined;
    const scene = await loadScene();
    if (!scene) return notAvailable(c, "describe", "the board scene is not installed (package board-scene)");
    const t0 = performance.now();
    const s = await withBoard(dir, (b) => b.snapshot(), "read");
    const host = await loadHost();
    const a = host ? await host.analyzeBoard(s, dir, { crossCheck: false }) : undefined;
    const r = a?.result;
    const notes: string[] = [];
    if (!r) notes.push(`no checks ran (${a?.reason ?? "the board analysis, views pcb/host, is not installed"}): connectivity is the scene's own estimate and no findings are marked`);
    let img = image as "png" | "svg" | "both" | "none";
    if ((img === "png" || img === "both") && !scene.pngAvailable()) {
      img = "svg";
      notes.push("PNG output is not available here (@resvg/resvg-js did not load): wrote the SVG instead");
    }
    if (focus === "finding" && r && !r.findings.some((f) => f.id === value)) throw new UsageError(`--finding: no finding ${value} on the board now (\`protoboard board check\` lists them with their ids)`);
    if (focus === "finding" && !r) throw new UsageError("--finding needs the board checks (package board-checks), which are not installed");
    const d = scene.describeBoard(s, {
      ...(region ? { region: region as [number, number, number, number] } : {}),
      ...(focus === "net" ? { net: value } : {}),
      ...(focus === "object" ? { object: value } : {}),
      ...(focus === "finding" ? { finding: value } : {}),
      findings: r?.findings ?? [],
      ...(r ? { connectivity: r.connectivity } : {}),
      image: img,
    });
    const root = findProjectRoot(dir);
    const slug = focus ? `${focus}-${(focus === "region" ? region!.join("_") : value!).replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80)}` : "overview";
    const base = c.a.one("out") ? resolve(c.io.cwd, c.a.one("out")!).replace(/\.(json|png|svg)$/i, "") : join(boardBuildDir(root, dir), `describe-${slug}`);
    mkdirSync(dirname(base), { recursive: true });
    const files: { json: string; png?: string; svg?: string } = { json: `${base}.json` };
    writeFileSync(files.json, d.json + "\n");
    if (d.png) writeFileSync((files.png = `${base}.png`), d.png);
    if (d.svg) writeFileSync((files.svg = `${base}.svg`), d.svg);
    const data = {
      status: "written",
      dir,
      epoch: s.epoch,
      seq: s.seq,
      focus: focus ? { [focus]: focus === "region" ? region : value } : "overview",
      files,
      stats: d.stats,
      checks: r ? { line: r.summary.line, unconnected: r.summary.unconnected, errors: r.summary.errors, warnings: r.summary.warnings, incomplete: r.summary.incomplete } : null,
      fill: a?.fill ? { source: a.fill.fill.source, current: a.fill.current } : null,
      ...(notes.length ? { notes } : {}),
      ms: Math.round(performance.now() - t0),
      scene: d.scene,
    };
    c.out(data, () =>
      [
        `wrote ${files.json} (${d.stats.jsonChars} characters, about ${d.stats.estTokens} tokens)`,
        ...(files.png ? [`wrote ${files.png} (${d.stats.imageWidth} x ${d.stats.imageHeight} px, about ${d.stats.estImageTokens} image tokens)`] : []),
        ...(files.svg ? [`wrote ${files.svg}`] : []),
        `  scene: ${String(d.scene.detail)} detail, ${focus ? `focus ${focus} ${focus === "region" ? `${region!.join(", ")} mm` : value}` : "the whole board"}${typeof d.scene.connectivity === "string" ? `; connectivity ${d.scene.connectivity}` : ""}`,
        ...(r ? [`  checks: ${r.summary.line}`] : []),
        ...notes.map((n) => `  note: ${n}`),
        "  the scene itself: add --json (it prints the scene with these paths)",
      ].join("\n"),
    );
    return BOARD_EXIT.ok;
  },

  async "import-dxf"(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const file = c.path(c.pos[1], "<file.dxf>");
    if (!existsSync(file) || !statSync(file).isFile()) throw new UsageError(`no file ${file}`);
    const units = c.a.one("units");
    if (units !== undefined && !["mm", "in", "auto"].includes(units)) throw new UsageError("--units takes mm, in or auto (the default: $INSUNITS, else mm)");
    const layers = list(c.a.one("layers"));
    const tolerance = c.a.one("tolerance") !== undefined ? parseLength(c.a.one("tolerance")!, "--tolerance") : undefined;
    if (tolerance !== undefined && tolerance <= 0) throw new UsageError("--tolerance must be more than 0");
    const actor = resolveActor(c.a.one("as"), c.env);
    const op = { op: "outline.import_dxf", dxf: readFileSync(file, "utf8"), ...(units ? { units } : {}), ...(layers ? { layers } : {}), ...(tolerance !== undefined ? { tolerance } : {}) };
    const tx = { batchId: `cli-${randomBytes(6).toString("hex")}`, label: "import the board outline from DXF", ops: [op] } as Transaction;
    const { r, mode } = await withBoard(dir, async (b) => ({ r: await b.apply(tx, actor), mode: b.mode }));
    const report = r.status === "applied" || r.status === "valid" ? (r.reports?.find((x) => x.op === "outline.import_dxf")?.report as DxfReport | undefined) : undefined;
    c.out({ ...r, file, ...(report ? { report } : {}) }, () => replyText(r, mode) + (report ? `\n${dxfReportText(report)}` : ""));
    return exitOf(r);
  },

  async "export-kicad"(c: Ctx): Promise<number> {
    const r = await boardExportKicad(c.path(c.pos[0]), c.path(c.pos[1], "<out.kicad_pcb>"), await loadHost(), { uniqueIds: c.a.has("unique-ids") });
    if (r.status === "not-available") return notAvailable(c, "export-kicad", r.reason);
    c.out(r, () => exportKicadText(r));
    return BOARD_EXIT.ok;
  },

  async route(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const nets = list(c.a.one("nets"));
    const regionFlag = c.a.one("region");
    if (nets && regionFlag) throw new UsageError("board route takes --nets or --region, not both (neither: every net with open connections)");
    const box = regionFlag ? boxOf(lengths(regionFlag, 4, "--region")) : undefined;
    if (box && (box.minX === box.maxX || box.minY === box.maxY)) throw new UsageError("--region: the box has no area");
    const region = box ? [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }] : undefined;
    const budgetMs = seconds(c.a.one("budget"), 60);
    const by = resolveActor(c.a.one("as"), c.env);
    if (c.a.has("apply") && c.a.has("propose")) throw new UsageError("board route takes --apply or --propose, not both");
    const r = await boardRoute(dir, { ...c.io.routing, ...(nets ? { nets } : {}), ...(region ? { region } : {}), budgetMs, apply: c.a.has("apply"), propose: c.a.has("propose"), by });
    if (r.status === "not-available") return notAvailable(c, "route", r.message);
    c.out(r, () => routeText(r));
    return r.exit;
  },

  async diagnose(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const net = c.pos[1];
    if (!net) throw new UsageError("usage: protoboard board diagnose <dir> <net>  (missing <net>)");
    // one budget for the whole diagnosis (DEFAULT 8 s); progress on stderr for a person (not with --json)
    const budgetMs = seconds(c.a.one("budget"), 8);
    const r = await boardDiagnose(dir, net, { ...c.io.routing, budgetMs, ...(c.json ? {} : { onProgress: diagnoseProgress(c.stderr) }) });
    if (r.status === "not-available") return notAvailable(c, "diagnose", r.message);
    c.out(r, () => diagnoseText(r));
    return BOARD_EXIT.ok;
  },
  // proposals (proposals, proposal, propose, accept, reject), pause, resume and corridor: board-editing.ts
  ...editingCommands({
    withBoard,
    resolveActor,
    parseLength,
    replyText,
    exitOf,
    readJson,
    usage: (m) => new UsageError(m),
    loadScene: () => loadScene(),
    notAvailable: (c, command, why) => notAvailable(c as Ctx, command, why),
  }),
} satisfies Record<string, (c: Ctx) => Promise<number>>;

async function undoRedo(c: Ctx, which: "undo" | "redo"): Promise<number> {
  const dir = c.path(c.pos[0]);
  const actor = resolveActor(c.a.one("as"), c.env);
  const lease = int(c.a.one("lease"), "--lease");
  const meta = { batchId: `cli-${randomBytes(6).toString("hex")}`, ...(lease !== undefined ? { leaseToken: lease } : {}) };
  const { r, mode } = await withBoard(dir, async (b) => ({ r: await (which === "undo" ? b.undo(actor, meta) : b.redo(actor, meta)), mode: b.mode }));
  c.out(r, () => replyText(r, mode) + (mode === "local" && r.status === "refused" ? "\n  (no running service: a one-call open has no history; undo works against `protoboard board serve`)" : ""));
  return exitOf(r);
}

function notAvailable(c: Ctx, command: string, why: string): number {
  c.out({ status: "not-available", command, message: why }, () => `not available: ${why}. \`protoboard board ${command}\` works once that package is installed.`);
  return BOARD_EXIT.usage;
}

function readJson(file: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new UsageError(`${what} (${file}) is not readable JSON: ${(e as Error).message}`);
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) throw new UsageError("board apply needs a transaction file, or one on stdin (`-`)");
  const chunks: Buffer[] = [];
  for await (const ch of process.stdin) chunks.push(ch as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The change `board check --with` tries on a copy: a proposal file (`{ title, items: [{ key?, label, ops }] }`, the
 * items named by key, `i<n>` when they have none, or all of them), or what `board apply` takes.
 */
export function changeFrom(text: string, items: string[] | undefined): Transaction {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`--with: the file is not JSON: ${(e as Error).message}`);
  }
  const its = data && typeof data === "object" && !Array.isArray(data) ? (data as { items?: unknown }).items : undefined;
  if (Array.isArray(its)) {
    const keyed = its.map((it, i) => ({ key: typeof it?.key === "string" ? it.key : `i${i}`, ops: Array.isArray(it?.ops) ? (it.ops as Transaction["ops"]) : [] }));
    const unknown = (items ?? []).filter((k) => !keyed.some((x) => x.key === k));
    if (unknown.length) throw new UsageError(`--items: the proposal file has no item ${unknown.join(", ")} (it has ${keyed.map((x) => x.key).join(", ")})`);
    const chosen = items ? keyed.filter((x) => items.includes(x.key)) : keyed;
    return { batchId: "check-with", label: "check a proposal file on a copy", ops: chosen.flatMap((x) => x.ops) };
  }
  if (items) throw new UsageError("--items narrows a proposal file ({ title, items }); this file holds a transaction or ops");
  return transactionFrom(text, { one: () => undefined, has: () => false });
}

/** A transaction from a file's JSON: a whole transaction, a list of ops, or one op; flags fill or override the envelope. */
export function transactionFrom(text: string, a: Pick<Parsed, "one" | "has">): Transaction {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new UsageError(`the transaction is not JSON: ${(e as Error).message}`);
  }
  const isOp = (x: unknown) => !!x && typeof x === "object" && typeof (x as { op?: unknown }).op === "string";
  let tx: Partial<Transaction>;
  if (Array.isArray(data)) tx = { ops: data as Transaction["ops"] };
  else if (isOp(data)) tx = { ops: [data as Transaction["ops"][number]] };
  else if (data && typeof data === "object" && Array.isArray((data as { ops?: unknown }).ops)) tx = { ...(data as Transaction) };
  else throw new UsageError("the transaction file holds a transaction ({ batchId, label, ops }), a list of ops, or one op ({ op, … })");
  const ops = tx.ops ?? [];
  const label = a.one("label") ?? tx.label ?? (ops.length === 1 ? `apply ${String(ops[0].op)} from the CLI` : `apply ${ops.length} operations from the CLI`);
  const changeSet = a.one("change-set");
  const expectSeq = int(a.one("expect-seq"), "--expect-seq");
  const lease = int(a.one("lease"), "--lease");
  return {
    ...tx,
    ops,
    label,
    batchId: a.one("batch-id") ?? tx.batchId ?? `cli-${randomBytes(6).toString("hex")}`,
    ...(changeSet ? { changeSet: { id: changeSet.split(":")[0], ...(changeSet.includes(":") ? { title: changeSet.slice(changeSet.indexOf(":") + 1) } : {}) } } : {}),
    ...(expectSeq !== undefined ? { expectSeq } : {}),
    ...(a.one("expect-epoch") ? { expectEpoch: a.one("expect-epoch") } : {}),
    ...(lease !== undefined ? { leaseToken: lease } : {}),
    ...(a.has("dry-run") ? { dryRun: true } : {}),
  } as Transaction;
}

// ---------------------------------------------------------------- inspect

export function summarize(s: BoardSnapshot, dir: string, mode: string) {
  const recs = [...s.doc.records.values()];
  const counts: Record<string, number> = {};
  for (const r of recs) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  counts.pad = recs.reduce((n, r) => n + (r.kind === "footprint" ? r.pads.length : 0), 0);
  const of = <K extends BoardRecord["kind"]>(k: K) => recs.filter((r): r is Extract<BoardRecord, { kind: K }> => r.kind === k);
  const board = of("board")[0];
  const nets = [...s.doc.nets.values()].map((n) => {
    const m = s.query.net(n.name);
    return { name: n.name, class: netClassOf(s.doc, n.name), pads: n.pads.length, tracks: m.tracks.length, vias: m.vias.length, zones: m.zones.length, ...(n.missing.length ? { missing: n.missing } : {}) };
  });
  return {
    dir,
    mode,
    epoch: s.epoch,
    seq: s.seq,
    board: board ? { name: board.name, thickness: board.thickness, copper_layers: board.copper_layers } : null,
    layers: of("layer")
      .sort((x, y) => x.order - y.order)
      .map((l) => ({ name: l.name, type: l.type, order: l.order, thickness: l.thickness })),
    counts,
    netlist: s.doc.netlist ? { source: s.doc.netlist.source, nets: s.doc.netlist.nets.length } : null,
    nets,
    netclasses: of("netclass").map((n) => ({ id: n.id, name: n.name, ...(n.nets ? { nets: n.nets } : {}), ...(n.patterns ? { patterns: n.patterns } : {}) })),
    rules: of("rule").map((r) => ({ id: r.id, tier: r.tier, check: r.check, ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}), ...(r.preferred !== undefined ? { preferred: r.preferred } : {}), ...(r.enabled === false ? { enabled: false } : {}) })),
    locks: recs.filter((r) => (r as { locked?: true }).locked).map((r) => r.id),
  };
}

function inspectText(d: ReturnType<typeof summarize> & { leases: { id: string; holder: { id: string } }[]; recoverable?: number }): string {
  const c = d.counts;
  return [
    `${d.board?.name ?? "(no board record)"}  ${d.dir}`,
    `  version: seq ${d.seq}, epoch ${d.epoch} (${d.mode === "service" ? "running service" : "opened here; no service running"})`,
    `  board: ${d.board ? `${d.board.copper_layers} copper layers, ${mmText(d.board.thickness)} thick` : "-"}`,
    `  layers: ${d.layers.map((l) => `${l.name} (${l.type})`).join(", ")}`,
    `  objects: ${["footprint", "pad", "track", "via", "zone", "keepout", "graphic", "text", "cutout"].map((k) => `${c[k] ?? 0} ${k}${(c[k] ?? 0) === 1 ? "" : "s"}`).join(", ")}`,
    `  nets: ${d.nets.length}${d.netlist ? ` from a ${d.netlist.source} netlist` : " (no netlist)"}`,
    ...d.nets.map((n) => `    ${n.name.padEnd(14)} ${n.class.padEnd(8)} ${n.pads} pads, ${n.tracks} tracks, ${n.vias} vias, ${n.zones} zones${n.missing ? `; ${n.missing.length} pin(s) not on the board` : ""}`),
    `  net classes: ${d.netclasses.map((n) => n.name).join(", ") || "none"}`,
    `  rules: ${d.rules.length}`,
    ...d.rules.map((r) => `    ${r.id.padEnd(30)} ${r.tier.padEnd(7)} ${r.check}${r.min !== undefined ? ` min ${mmText(r.min)}` : ""}${r.preferred !== undefined ? ` preferred ${mmText(r.preferred)}` : ""}${r.enabled === false ? " (disabled)" : ""}`),
    `  locked: ${d.locks.length ? d.locks.join(", ") : "none"}`,
    `  leases: ${d.leases.length ? d.leases.map((l) => `${l.id} by ${l.holder.id}`).join(", ") : "none"}`,
    ...(d.recoverable ? [`  journal: ${d.recoverable} entries of an earlier session are not in the files (\`board serve --recover\`)`] : []),
  ].join("\n");
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

// ---------------------------------------------------------------- check, render and describe helpers

type CheckResult = ChecksModule.BoardCheckResult;
type CrossCheckResult = ChecksModule.CrossCheckResult;

const boxOf = ([x1, y1, x2, y2]: number[]) => ({ minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) });

/** A positive pixel size up to 8192. */
function size(s: string | undefined, what: string): number | undefined {
  const v = int(s, what);
  if (v !== undefined && (v < 16 || v > 8192)) throw new UsageError(`${what} must be 16 to 8192 pixels`);
  return v;
}

/** `n` comma-separated millimeter values (a plain number is millimeters; `mm` and `nm` suffixes are read). */
function millimeters(s: string, n: number, what: string): number[] {
  const parts = unwrap(s).split(",");
  if (parts.length !== n) throw new UsageError(`${what} takes ${n} comma-separated millimeter values (x1,y1,x2,y2)`);
  return parts.map((p) => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(mm|nm)?\s*$/i.exec(p);
    if (!m) throw new UsageError(`${what}: ${p} is not a length in millimeters`);
    return m[2]?.toLowerCase() === "nm" ? Number(m[1]) / 1_000_000 : Number(m[1]);
  });
}

/** The layout screen's layer presets, which `render --layers` takes by name. */
const PRESET_IDS = ["all", "routing", "top", "fab"] as const;

/** The zone fill the checks used, for people and for JSON. */
function fillState(a: HostModule.BoardAnalysis, conn: CheckResult["connectivity"]): { text: string; data: unknown } {
  if (a.fill) {
    const f = a.fill.fill;
    const polygons = f.fills.reduce((n, e) => n + e.polygons.length, 0);
    return {
      text: `${f.source}, ${f.fills.length} entries, ${polygons} polygons, ${a.fill.current ? "current" : "OUT OF DATE (made for other zones than the board has now; checked as it is)"}${a.fill.path ? ` (${a.fill.path})` : ""}`,
      data: { source: f.source, current: a.fill.current, entries: f.fills.length, polygons, path: a.fill.path ?? null, zoneFill: conn.zoneFill, zonesWithoutFill: conn.zonesWithoutFill },
    };
  }
  const text = conn.zoneFill === "no-zones" ? "none needed (the board has no zones)" : `none known: ${conn.zonesWithoutFill.length} zone(s) connect nothing in these checks`;
  return { text, data: { source: null, zoneFill: conn.zoneFill, zonesWithoutFill: conn.zonesWithoutFill } };
}

function connectivityCounts(c: CheckResult["connectivity"]) {
  return {
    unconnected: c.unconnected,
    links: c.links.length,
    nets: c.nets.length,
    islands: c.islands.length,
    shorts: c.shorts.length,
    dangling: c.dangling.length,
    isolated: c.isolated.length,
    unassigned: c.unassigned.length,
    missingPins: c.missingPins,
    netlist: c.netlist,
    zoneFill: c.zoneFill,
    zonesWithoutFill: c.zonesWithoutFill,
    undecided: c.undecided,
    touchingNotJoined: c.touchingNotJoined,
    join: c.join,
  };
}

/** The cross-check for JSON: our findings by id (they are listed in full beside it), KiCad's entries in full. */
function compactCrossCheck(c: CrossCheckResult) {
  if (!c.ran) return { ran: false, reason: c.reason };
  return {
    ran: true,
    kicad: c.kicad,
    ...(c.transform ? { transform: c.transform } : {}),
    totals: c.totals,
    differences: c.differences,
    categories: c.categories,
    unconnectedByNet: c.unconnectedByNet,
    matched: c.matched.length,
    ties: c.matched.filter((m) => m.tie).length,
    oursOnly: c.oursOnly.map((f) => f.id),
    borderline: c.borderline.map((f) => f.id),
    kicadOnly: c.kicadOnly,
    waived: (c.waived ?? []).map((w) => ({ finding: w.finding.id, waiver: w.waiver, kicad: w.kicad ?? null })),
  };
}

/** KiCad's counts beside ours with every difference named, or why no cross-check ran. */
function crossCheckLines(c: CrossCheckResult, format: ((c: CrossCheckResult) => string) | undefined): string[] {
  if (!c.ran) return [`KiCad cross-check not run: ${c.reason}`];
  const k = c.totals.kicad;
  const cmp = c.comparable;
  const n = (x: { unconnected: number; errors: number; warnings: number }) => `${x.unconnected} unconnected, ${x.errors} error${x.errors === 1 ? "" : "s"}, ${x.warnings} warning${x.warnings === 1 ? "" : "s"}`;
  const lines = [
    `like with like: ours ${n(cmp.ours)}; KiCad ${n(cmp.kicad)}  (KiCad ${c.kicad.version ?? "version unknown"}${c.kicad.durationMs !== undefined ? `, ${Math.round(c.kicad.durationMs)} ms` : ""})`,
    `apart: ours only ${c.oursOnlyCategories.count}, KiCad only ${c.kicadOnlyCategories.count}, not evaluated ${c.notEvaluated.rules.length} rule(s) with ${c.notEvaluated.kicadItems.length} KiCad item(s) under them, folded ${c.folded.length}, waived ${c.waived?.length ?? 0} (${c.waived?.filter((w) => w.kicad).length ?? 0} matched to a KiCad item)`,
    `KiCad raw: ${n(k)}${k.excluded ? `, ${k.excluded} excluded` : ""}`,
  ];
  if (format) lines.push(format(c));
  if (c.differences.length) lines.push(`differences (${c.differences.length}):`, ...c.differences.map((d) => `  - ${d}`));
  else lines.push("differences: none (every count and item matched)");
  return lines;
}

// ---------------------------------------------------------------- import-dxf

/** What `outline.import_dxf` reports (the board package's `DxfOutlineReport`). */
interface DxfReport {
  entities: number;
  loops: number;
  outline: { vertices: number; area: number };
  cutouts: number;
  skipped: { type: string; count: number; reason: string }[];
  open: number;
  units: string;
}

function dxfReportText(d: DxfReport): string {
  return [
    `  read: ${d.entities} entit${d.entities === 1 ? "y" : "ies"} in ${d.units}, ${d.loops} closed loop(s), ${d.open} open chain(s)`,
    `  outline: ${d.outline.vertices} vertices, ${+(d.outline.area / 1e12).toFixed(3)} mm²; cutouts: ${d.cutouts}`,
    ...(d.skipped.length ? d.skipped.map((s) => `  SKIPPED ${s.count} ${s.type}: ${s.reason}`) : ["  skipped: nothing"]),
  ].join("\n");
}

// ---------------------------------------------------------------- route and diagnose

/** A time budget in seconds (a positive number, at most an hour) as milliseconds; `fallback` seconds when absent. */
function seconds(s: string | undefined, fallback: number): number {
  if (s === undefined) return fallback * 1000;
  const v = Number(s);
  if (!/^\s*\d+(\.\d+)?\s*$/.test(s) || !(v > 0) || v > 3600) throw new UsageError(`--budget takes seconds, more than 0 and at most 3600 (got ${s.slice(0, 20)})`);
  return Math.round(v * 1000);
}

type NotAvailable = { status: "not-available"; message: string };
const scoreOf = (s: RouteModule.BoardScore) => ({ open: s.open, errors: s.errors, vias: s.vias, length: s.length, openNets: [...s.openNets] });
const ghostCount = (g: { segments: unknown[]; vias: unknown[] }) => ({ segments: g.segments.length, vias: g.vias.length });

/** The routing pieces a command needs: the host module, the router package, the routers and how they are described. */
async function routing(deps: RoutingDeps): Promise<NotAvailable | { host: typeof HostModule; route: typeof RouteModule; routers: RouteModule.Router[]; info: HostModule.RouterInfo[] }> {
  const host = await loadHost();
  if (!host || typeof host.loadRouteModule !== "function") return { status: "not-available", message: "the board analysis with routing is not installed (package views, pcb/host)" };
  const route = await host.loadRouteModule();
  if (!route) return { status: "not-available", message: "the autorouter is not installed (package board-route)" };
  const routers = deps.routers ?? (await host.defaultRouterList());
  if (!routers.length) return { status: "not-available", message: "no router is installed" };
  return { host, route, routers, info: await host.routerInfo(routers) };
}

export interface RouteOptions extends RoutingDeps {
  /** Route these nets (default: every net with open connections). */
  nets?: string[];
  /** Route the open connections inside this polygon, nanometers. */
  region?: { x: number; y: number }[];
  /** Wall clock per router run (default 60 s). */
  budgetMs?: number;
  /** Apply the proposal when its status is `proposed`, each step as its router. */
  apply?: boolean;
  /** Store a `proposed` result as service proposals (one per router step, one item per net, the scores kept) for a person to accept. */
  propose?: boolean;
  /** Who asked for the run (the steps are applied as their routers, never as this actor). */
  by?: Actor;
}

export type RouteReport = Awaited<ReturnType<typeof runRoute>>;

/**
 * `board route`: run the orchestrator on the board and report the scored proposal; with `apply`, apply a `proposed`
 * one step by step as each router (stopping at the first refusal) and verify every locked record byte for byte.
 * A rejected, unchanged, failed or cancelled proposal is never applied. Exported for tests (inject routers and a scorer).
 */
export async function boardRoute(dir: string, o: RouteOptions = {}): Promise<NotAvailable | RouteReport> {
  const r = await routing(o);
  if ("status" in r) return r;
  const scored = o.scorer ? { name: o.scorerName ?? "injected", scorer: o.scorer } : await r.host.productScorer();
  if (!scored) return { status: "not-available", message: "no scorer: the board checks and the router package are both missing" };
  return runRoute(dir, o, r.host, r.route, r.routers, r.info, scored);
}

async function runRoute(dir: string, o: RouteOptions, host: typeof HostModule, route: typeof RouteModule, routers: RouteModule.Router[], info: HostModule.RouterInfo[], scored: { name: string; scorer: RouteModule.BoardScorer }) {
  const budgetMs = o.budgetMs ?? 60_000;
  const scope = host.routeScope(o.region ? { kind: "region", region: o.region } : o.nets?.length ? { kind: "nets", nets: o.nets } : { kind: "open" });
  const by = o.by ?? HUMAN;
  // a run that only proposes reads the board (it is never opened for writing, so its files cannot change)
  return withBoard(
    dir,
    async (b) => {
      const s = await b.snapshot();
      for (const n of o.nets ?? []) if (!s.doc.nets.has(n)) throw new UsageError(`--nets: the board has no net ${n}`);
      const t0 = performance.now();
      const p = await route.routeBoard(s, { scope, routers, scorer: scored.scorer, budget: { timeMs: budgetMs }, diagnose: false });
      const routeMs = Math.round(performance.now() - t0);
      const locked = host.lockedRecords(s.doc);
      let applied: { by: string; replies: { actor: string; batchId: string; reply: Reply }[]; complete: boolean; locked: { checked: number; changed: string[] }; mode: string } | null = null;
      let exit: number = p.status === "proposed" ? BOARD_EXIT.ok : BOARD_EXIT.invalid;
      if (o.apply && p.status === "proposed") {
        const before = new Map(locked.map((id) => [id, canonicalRecord(s.doc.records.get(id)!)]));
        const replies: { actor: string; batchId: string; reply: Reply }[] = [];
        for (const st of p.steps) {
          // the label stays within the core's 3 to 8 words
          const tx: Transaction = { ...st.transaction, label: `${st.transaction.label} (accepted)` };
          const reply = await b.apply(tx, st.actor);
          replies.push({ actor: st.actor.id, batchId: tx.batchId, reply });
          if (reply.status !== "applied") break;
        }
        const after = (await b.snapshot()).doc;
        const changed = locked.filter((id) => {
          const rec = after.records.get(id);
          return !rec || canonicalRecord(rec) !== before.get(id);
        });
        const complete = replies.length === p.steps.length && replies.every((x) => x.reply.status === "applied");
        applied = { by: by.id, replies, complete, locked: { checked: locked.length, changed }, mode: b.mode };
        const bad = replies.find((x) => x.reply.status !== "applied");
        exit = changed.length ? BOARD_EXIT.usage : bad ? exitOf(bad.reply) : BOARD_EXIT.ok;
      }
      // --propose: the result as proposals a person accepts (only those that score better, say)
      const proposals = o.propose && p.status === "proposed" ? await proposeRoute(b, p, s.epoch) : null;
      if (proposals?.some((x) => "error" in x)) exit = BOARD_EXIT.invalid;
      return {
        status: p.status,
        runId: p.runId,
        dir,
        epoch: s.epoch,
        seq: s.seq,
        reasons: [...p.reasons],
        scope: p.scope,
        budgetMs,
        scorer: scored.name,
        routers: info,
        current: scoreOf(p.current),
        candidate: scoreOf(p.candidate),
        nets: [...p.nets],
        openNets: [...p.openNets],
        stages: p.stages.map((st) => ({
          stage: st.stage,
          router: st.router,
          version: st.version,
          status: st.status,
          kept: st.kept,
          ...(st.reason ? { reason: st.reason } : {}),
          durationMs: st.durationMs,
          nets: st.nets.length,
          added: { ...st.added },
          ...(st.routerReportedOpen !== undefined ? { routerReportedOpen: st.routerReportedOpen } : {}),
          messages: st.messages.slice(0, 10),
        })),
        fallback: p.fallback ? { from: p.fallback.from, to: [...p.fallback.to], reasons: [...p.fallback.reasons] } : null,
        added: { ...p.added },
        lockCheck: { ok: p.lockCheck.ok, changed: [...p.lockCheck.changed], checked: locked.length },
        locked,
        unexpressed: [...p.unexpressed],
        notes: [...p.notes],
        steps: p.steps.map((st) => ({ actor: st.actor.id, batchId: st.transaction.batchId, label: st.transaction.label, ops: st.transaction.ops.length })),
        applyRequested: !!o.apply,
        applied,
        proposeRequested: !!o.propose,
        proposals,
        ms: { route: routeMs },
        exit,
      };
    },
    o.apply ? "write" : "read",
  );
}

const scoreText = (s: { open: number; errors: number; vias: number; length: number }) => `${s.open} open, ${s.errors} error${s.errors === 1 ? "" : "s"}, ${s.vias} via${s.vias === 1 ? "" : "s"}, ${mmText(s.length)} of track`;

function routeText(r: RouteReport): string {
  const title = (id: string) => {
    const t = r.routers.find((x) => x.id === id)?.title;
    return t && t !== id ? `${id} (${t})` : id;
  };
  const head =
    r.status === "proposed"
      ? r.applied
        ? r.applied.complete
          ? "APPLIED"
          : "PROPOSED, APPLY STOPPED"
        : r.proposals
          ? "PROPOSED  (nothing changed; stored for a person to accept)"
          : "PROPOSED  (nothing changed; --apply applies it, --propose stores it for a person)"
      : `${r.status.toUpperCase()}  (nothing changed${r.applyRequested ? "; a result that is not proposed is never applied" : ""})`;
  const lines = [`${head}  ${r.runId}, seq ${r.seq}, epoch ${r.epoch}`];
  for (const x of r.reasons) lines.push(`  reason: ${x}`);
  lines.push(`  current:   ${scoreText(r.current)}`, `  candidate: ${scoreText(r.candidate)}`);
  lines.push(`  scope: ${r.scope.kind === "nets" ? `nets ${r.scope.nets.join(", ")}` : r.scope.kind === "region" ? "a region" : "every open net"}; ${r.nets.length} net(s) to route; budget ${r.budgetMs / 1000} s per router; scored by ${r.scorer}`);
  lines.push("  stages:");
  for (const st of r.stages) lines.push(`    ${st.stage + 1}. ${st.router} ${st.version || "?"}  ${st.status}${st.kept ? ", kept" : ", not kept"}${st.reason ? ` (${st.reason})` : ""}  ${st.nets} net(s), ${st.added.segments} segment(s), ${st.added.vias} via(s), ${st.durationMs} ms`);
  if (r.fallback) lines.push(`  FALLBACK: ${title(r.fallback.from)} ran first; ${r.fallback.to.map(title).join(", then ")} ran as the fallback`, ...r.fallback.reasons.map((x) => `    because ${x}`));
  else lines.push("  fallback: none ran");
  lines.push(`  copper added: ${r.added.segments} segment(s), ${r.added.vias} via(s), ${mmText(r.added.length)}`);
  lines.push(r.lockCheck.ok ? `  locked copper: no router changed any of the ${r.lockCheck.checked} locked record(s)` : `  locked copper: A ROUTER TRIED TO CHANGE ${r.lockCheck.changed.join(", ")}; that result was not kept`);
  if (r.openNets.length) lines.push(`  still open: ${r.openNets.join(", ")} (\`protoboard board diagnose <dir> <net>\` says why)`);
  if (r.unexpressed.length) lines.push("  unexpressed (checked after the run, not given to a router):", ...r.unexpressed.map((u) => `    - ${u}`));
  for (const n of r.notes) lines.push(`  note: ${n}`);
  if (r.proposals) {
    for (const x of r.proposals) lines.push("error" in x ? `  NOT PROPOSED: ${x.error}` : `  stored as proposal ${x.id}: ${JSON.stringify(x.title)}, ${x.items.length} item(s) (${x.items.map((i) => `${i.key} ${i.nets.join("+") || i.label}`).join(", ")})`);
    if (r.proposals.some((x) => !("error" in x))) lines.push("  a person accepts what scores better: `protoboard board proposal <dir> <id> --preview`, then `board accept <dir> <id> [--items ...]`");
  } else if (r.proposeRequested) lines.push("  nothing proposed: only a proposed result is stored as proposals");
  if (r.applied) {
    lines.push(`  applied as the routers (accepted by ${r.applied.by}${r.applied.mode === "local" ? "; no running service: opened here and saved" : ""}):`);
    for (const x of r.applied.replies) lines.push(`    ${x.actor}: ${replyText(x.reply, "service").split("\n")[0]}`);
    if (!r.applied.complete && r.applied.replies.at(-1)?.reply.status !== "applied") lines.push("    stopped at the first refusal; the steps after it were not applied");
    lines.push(r.applied.locked.changed.length ? `  LOCKED RECORDS CHANGED: ${r.applied.locked.changed.join(", ")}` : `  ${r.applied.locked.checked} locked records verified unchanged`);
  }
  return lines.join("\n");
}

export type DiagnoseReport = Awaited<ReturnType<typeof runDiagnose>>;

type DiagnosisProgress = Parameters<NonNullable<HostModule.DiagnoseOptions["onProgress"]>>[0];
type DiagnoseOptions = RoutingDeps & { budgetMs?: number; onProgress?: (p: DiagnosisProgress) => void; cache?: boolean };

/**
 * `board diagnose`: why one net does not route (the host's diagnosis), within one time budget for the whole diagnosis
 * (DEFAULT 8 s). Changes nothing on the board; the answer is cached under the board's build folder. Exported for tests
 * (inject routers and a scorer).
 */
export async function boardDiagnose(dir: string, net: string, o: DiagnoseOptions = {}): Promise<NotAvailable | DiagnoseReport> {
  const r = await routing(o);
  if ("status" in r) return r;
  return runDiagnose(dir, net, o, r.host, r.routers, r.info);
}

const VERDICT = { routes: "routes as is", rules: "rules, not placement", placement: "placement", connected: "connected", unknown: "not known (the budget ran out)" } as const;

/** Progress lines for a person (stderr): one per stage, and at most one a second within a stage. */
function diagnoseProgress(write: (s: string) => void): (p: DiagnosisProgress) => void {
  let stage = "";
  let at = 0;
  return (p) => {
    const now = Date.now();
    if (p.stage === stage && now - at < 1000 && p.stage !== "done") return;
    stage = p.stage;
    at = now;
    write(`  diagnose ${p.net}: ${p.stage} ${Math.round(p.fraction * 100)}%  ${(p.elapsedMs / 1000).toFixed(1)} of ${(p.budgetMs / 1000).toFixed(0)} s${p.router ? `  ${p.router}` : ""}${p.message ? `: ${p.message}` : ""}\n`);
  };
}
const TIERS = ["floor", "no_go", "target", "policy"] as const;

async function runDiagnose(dir: string, net: string, o: DiagnoseOptions, host: typeof HostModule, routers: RouteModule.Router[], info: HostModule.RouterInfo[]) {
  const budgetMs = o.budgetMs ?? 8_000;
  const s = await withBoard(dir, (b) => b.snapshot(), "read");
  if (!s.doc.nets.has(net)) throw new UsageError(`the board has no net ${net} (\`protoboard board inspect\` lists them)`);
  const v = await host.diagnoseNet(s, net, { budgetMs, routers, dir, ...(o.scorer ? { scorer: o.scorer, scorerName: o.scorerName ?? "injected" } : {}), ...(o.onProgress ? { onProgress: o.onProgress } : {}), ...(o.cache === false ? { cache: false } : {}) });
  return {
    status: "diagnosed" as const,
    dir,
    epoch: s.epoch,
    seq: s.seq,
    net,
    verdict: v.verdict,
    verdictText: VERDICT[v.verdict],
    summary: v.summary,
    budgetMs,
    routers: info,
    attempts: v.attempts.map((a) => ({ router: a.router, status: a.status, ...(a.reason ? { reason: a.reason } : {}), ms: a.ms, copper: ghostCount(a.ghost) })),
    probe: v.probe ? { router: v.probe.router, routed: v.probe.routed, length: v.probe.length, vias: v.probe.vias, floorViolations: v.probe.floorViolations, ms: v.probe.ms, copper: ghostCount(v.probe.ghost) } : null,
    blockers: v.blockers,
    areas: TIERS.map((tier) => ({ tier, areas: v.areas.filter((a) => a.tier === tier) })),
    options: v.options,
    links: v.links ?? null,
    pour: v.pour ?? null,
    stopped: v.stopped ?? [],
    notes: v.notes ?? [],
    cached: !!v.cached,
    hash: v.hash ?? null,
    ms: v.ms,
  };
}

function diagnoseText(r: DiagnoseReport): string {
  const lines = [`${r.net}: ${r.verdictText.toUpperCase()}  (seq ${r.seq}, epoch ${r.epoch}; nothing changed${r.cached ? "; from the cache" : ""})`];
  if (r.pour) lines.push(`  ${r.pour.note}`);
  lines.push(`  ${r.summary}`, `  budget ${r.budgetMs / 1000} s for the whole diagnosis; took ${(r.ms / 1000).toFixed(1)} s${r.links !== null ? `; ${r.links} open link(s) diagnosed` : ""}`);
  for (const x of r.stopped) lines.push(`  STOPPED ${x}`);
  lines.push(r.attempts.length ? "  attempts (every rule as it is):" : "  attempts: none (nothing to route)");
  for (const a of r.attempts) lines.push(`    ${a.router}  ${a.status}${a.reason ? ` (${a.reason})` : ""}  ${a.copper.segments} segment(s), ${a.copper.vias} via(s), ${a.ms} ms`);
  if (r.probe) lines.push(`  probe (the fab floor and no-go areas only): ${r.probe.router} ${r.probe.routed ? "routed" : "did not route"} the net, ${mmText(r.probe.length)}, ${r.probe.vias} via(s), ${r.probe.floorViolations} pair(s) under the floor clearance, ${r.probe.ms} ms`);
  else lines.push(`  probe: not run (${r.verdict === "routes" ? "the net routes as is" : r.verdict === "connected" ? "nothing is open" : "the budget ran out"})`);
  lines.push("  what blocks it:", ...r.blockers.map((b) => `    ${b.tier.padEnd(7)} ${b.rule}: ${b.what !== b.rule ? `${b.what}; ` : ""}${b.blocks}`));
  lines.push("  rule areas by tier:");
  for (const t of r.areas) lines.push(`    ${t.tier}: ${t.areas.length ? t.areas.map((a) => `${a.id}${a.name !== a.id ? ` (${a.name})` : ""}${a.blocks ? ` blocks ${a.blocks}` : ""}`).join("; ") : "none"}`);
  if (r.options.length) {
    lines.push("  relaxations (test-run on copies; none applied):");
    for (const x of r.options) {
      const res = x.result;
      lines.push(`    ${x.title}: ${x.detail}`, res.skipped ? `      -> not test-run: ${res.skipped}` : `      -> ${res.routed ? "routed" : "did not route"}: ${res.open} open, ${res.errors} error(s), ${res.vias} via(s), ${mmText(res.length)}, ${res.newFindings} new finding(s), ${res.ms} ms${res.note ? ` (${res.note})` : ""}`);
    }
  } else lines.push(`  relaxations: ${r.verdict === "routes" || r.verdict === "connected" ? "none needed" : "none to try (the plan is already at the floor; the floor is never relaxed)"}`);
  for (const x of r.notes) lines.push(`  note: ${x}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- optional packages, loaded when present

/** A package by name (once linked as a workspace), else from this repository's source tree; undefined when neither is there. */
async function loadOptional(name: string, repoPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(name)) as Record<string, unknown>;
  } catch {
    const file = fileURLToPath(new URL(repoPath, import.meta.url));
    if (!existsSync(file)) return undefined;
    try {
      return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (e) {
      process.stderr.write(`protoboard: ${name} is present but did not load: ${(e as Error).message.split("\n")[0]}\n`);
      return undefined;
    }
  }
}

const isImporter = (v: unknown): v is Importer => !!v && typeof v === "object" && typeof (v as Importer).id === "string" && typeof (v as Importer).accepts === "function" && typeof (v as Importer).import === "function";

/** What a module exports that passes `is`: the values themselves, arrays of them, and lists from zero-argument functions named like `listImporters`. */
function collect<T>(mod: Record<string, unknown>, is: (v: unknown) => v is T, lister: RegExp): T[] {
  const found: T[] = [];
  const take = (v: unknown) => {
    if (is(v)) found.push(v);
    else if (Array.isArray(v)) for (const x of v) if (is(x)) found.push(x);
  };
  for (const [k, v] of Object.entries(mod)) {
    if (typeof v === "function" && lister.test(k) && v.length === 0) {
      try {
        take((v as () => unknown)());
      } catch {
        /* not a lister after all */
      }
    } else take(v);
  }
  return [...new Map(found.map((x) => [(x as { id: string }).id, x])).values()];
}

/**
 * The installed importers: board-import's `availableImporters()` (KiCad, Circuit JSON, and the optional importer
 * packages it finds, such as EasyEDA Pro), else whatever importer objects the packages export.
 */
export async function loadImporters(): Promise<Importer[] | undefined> {
  const main = await loadOptional("@protoboardai/board-import", "../../board-import/src/index.ts");
  if (main && typeof main.availableImporters === "function") {
    const listed = await (main as unknown as typeof ImportModule).availableImporters();
    if (listed.length) return listed;
  }
  const mods = [main, await loadOptional("@protoboardai/board-import-easyeda", "../../board-import-easyeda/src/index.ts")].filter((m): m is Record<string, unknown> => !!m);
  const all = mods.flatMap((m) => collect(m, isImporter, /^(list|all|default)?[Ii]mporters$/));
  return all.length ? all : undefined;
}

/** The layout screen's Node side: the analysis `board check` shares with the dev servers and the editor, import records, fill conversion. */
export async function loadHost(): Promise<typeof HostModule | undefined> {
  const mod = await loadOptional("@protoboardai/views/pcb/host", "../../views/src/pcb/host/index.ts");
  return mod && typeof mod.analyzeBoard === "function" ? (mod as unknown as typeof HostModule) : undefined;
}

/** The agent scene (board-scene). */
export async function loadScene(): Promise<typeof SceneModule | undefined> {
  const mod = await loadOptional("@protoboardai/board-scene", "../../board-scene/src/index.ts");
  return mod && typeof mod.describeBoard === "function" ? (mod as unknown as typeof SceneModule) : undefined;
}

/**
 * What `render` hands the headless renderer (views pcb/headless, `HeadlessRenderOptions`). Typed here: the
 * renderer's page module is browser code (DOM types) that this package's type check does not load.
 */
export interface HeadlessOptions {
  width: number;
  height: number;
  /** Nanometers. */
  region?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Layer panel rows, or a preset name (all, routing, top, fab). */
  layers?: string[] | string;
  flip?: boolean;
  highlightNets?: string[];
  findings?: unknown[];
  ratsnest?: unknown[];
  fills?: unknown[];
  origin?: boolean;
}
interface HeadlessModule {
  renderBoardPng(board: BoardSnapshot, options: HeadlessOptions): Promise<Uint8Array>;
}

/** The headless renderer (views pcb/headless), loaded only when a render is asked for. */
export async function loadHeadless(): Promise<HeadlessModule | undefined> {
  const mod = await loadOptional("@protoboardai/views/pcb/headless", "../../views/src/pcb/headless/render.ts");
  return mod && typeof mod.renderBoardPng === "function" ? (mod as unknown as HeadlessModule) : undefined;
}
