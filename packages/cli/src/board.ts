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
import {
  agentActor,
  BoardLockedError,
  boardKey,
  connectBoard,
  describeOperations,
  findProjectRoot,
  findService,
  HUMAN,
  importResultToTransaction,
  netClassOf,
  openBoardService,
  runChecks,
  serveBoard,
  toMm,
  writeBoardDir,
  writeNetlist,
  type Actor,
  type BoardClient,
  type BoardRecord,
  type BoardSnapshot,
  type Check,
  type Finding,
  type Importer,
  type ImportSource,
  type LeaseClaim,
  type QueryParams,
  type Reply,
  type Transaction,
} from "@protoboardai/board";

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
  { name: "apply", args: "<dir> [<ops.json> | -]", summary: "Apply a transaction file (or ops, or one op; - or no file reads stdin); --dry-run validates only", flags: ["as", "dry-run", "label", "batch-id", "change-set", "expect-seq", "expect-epoch", "lease"] },
  { name: "undo", args: "<dir>", summary: "Undo the actor's own last transaction (needs a running service to have history)", flags: ["as", "lease"] },
  { name: "redo", args: "<dir>", summary: "Redo the actor's last undone transaction", flags: ["as", "lease"] },
  { name: "revert", args: "<dir> <change set id>", summary: "Undo a whole change set, all or nothing", flags: ["as", "lease"] },
  { name: "claim", args: "<dir> [<claim.json>]", summary: "Take a lease: --purpose, and --roots, --nets or --region (needs a running service)", flags: ["as", "purpose", "roots", "nets", "region", "layers", "ttl"] },
  { name: "release", args: "<dir>", summary: "End the actor's leases (or --lease <id>)", flags: ["as", "lease"] },
  { name: "presence", args: "<dir>", summary: "Live leases and recent agent intents", flags: [] },
  { name: "save", args: "<dir>", summary: "Write the changed board files", flags: [] },
  { name: "checkpoint", args: "<dir> <label>", summary: "Save, then print the commit message for the caller to commit (never runs Git)", flags: [] },
  { name: "import", args: "<source> <dir>", summary: "Import a board through an installed importer (board-import packages)", flags: ["kind", "as"] },
  { name: "check", args: "<dir>", summary: "Run the installed board checks (board-checks package); exit 1 on errors", flags: [] },
  { name: "render", args: "<dir>", summary: "Render the board with the installed renderer (views pcb); --out <file>", flags: ["out"] },
];

export const BOARD_USAGE = [
  "usage: protoboard board <command> [args] [--json]",
  "",
  ...BOARD_COMMANDS.map((c) => `  ${`${c.name} ${c.args}`.padEnd(38)} ${c.summary}`),
  "",
  "  --as human | agent:<name>        who acts (default: the agent this runs under, else a person)",
  "  lengths are integer nanometers; a number with mm (1.5mm) is converted",
  "  exit codes: 0 applied or valid, 1 invalid (check: errors), 3 refused, 2 usage or failure",
].join("\n");

class UsageError extends Error {}

const BOOLEAN = new Set(["json", "dry-run", "all", "records", "recover", "autosave"]);
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
const lengths = (s: string, n: number, what: string) => {
  const parts = s.split(",");
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
    try {
      let recovered: number | undefined;
      const pending = svc.recoverable();
      if (pending && c.a.has("recover")) recovered = svc.recover().replayed;
      else if (pending) c.stderr(`protoboard: ${pending} journal entr${pending === 1 ? "y" : "ies"} of an earlier session are not in the files; \`board serve --recover\` replays them\n`);
      const stop = new AbortController();
      const origins = c.a.all("origin");
      const port = int(c.a.one("port"), "--port");
      server = await serveBoard(svc, { ...(port !== undefined ? { port } : {}), ...(origins.length ? { origins } : {}), onShutdown: () => stop.abort() });
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
      const saved = svc.save();
      svc.close({ save: false });
      if (c.json) c.write(JSON.stringify({ status: "stopped", seq: saved.seq, written: saved.written, refused: saved.refused }) + "\n");
      else c.write(`stopped at seq ${saved.seq}; ${saved.written.length ? `saved ${saved.written.join(", ")}` : "no file changed"}${saved.refused.length ? `; NOT saved (changed on disk by someone else): ${saved.refused.join(", ")}` : ""}\n`);
      return saved.refused.length ? BOARD_EXIT.refused : BOARD_EXIT.ok;
    } finally {
      await server?.close();
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
    const { r, mode } = await withBoard(dir, async (b) => ({ r: await b.apply(tx, actor), mode: b.mode }));
    c.out(r, () => replyText(r, mode));
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
    const result = await imp.import(src, exists ? { current: (await withBoard(dir, (b) => b.snapshot(), "read")).doc } : {});
    const report = result.report;
    let outcome: Record<string, unknown>;
    let code: number = BOARD_EXIT.ok;
    if (result.document) {
      if (exists) throw new Error(`${dir} already holds a board; importing a whole board needs an empty folder`);
      mkdirSync(dir, { recursive: true });
      const w = writeBoardDir(dir, result.document);
      if (result.netlist && result.netlist.source !== "uhd") writeNetlist(dir, result.netlist);
      outcome = { status: "written", files: w.written, records: result.document.records.size };
    } else if (result.ops?.length) {
      if (!exists) throw new Error(`${dir} has no board to import into, and ${imp.id} gave operations, not a board`);
      const tx = importResultToTransaction(imp.id, result);
      const host: Actor = { kind: "host", id: `import:${imp.id.replace(/[^A-Za-z0-9_.@-]/g, "-")}`, name: imp.id };
      const r = await withBoard(dir, (b) => b.apply(tx, host));
      outcome = { status: r.status, reply: r };
      code = exitOf(r);
    } else outcome = { status: "nothing", message: `${imp.id} gave neither a board nor operations` };
    const data = { importer: imp.id, source, dir, ...outcome, report };
    const count = (l: string) => report.filter((x) => x.level === l).length;
    c.out(data, () => [`${String(outcome.status).toUpperCase()}  ${imp.id}: ${source} -> ${dir}`, `  report: ${count("dropped")} dropped, ${count("approximated")} approximated, ${count("info")} info`, ...report.filter((x) => x.level !== "info").map((x) => `  ${x.level.toUpperCase()} ${x.message}${x.source ? ` (${x.source})` : ""}`)].join("\n"));
    return code;
  },

  async check(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const checks = await loadChecks();
    if (!checks) return notAvailable(c, "check", "no board checks are installed (package board-checks)");
    const s = await withBoard(dir, (b) => b.snapshot(), "read");
    const r = checks.run(s);
    const findings = r.findings;
    const count = (sev: string) => findings.filter((f) => f.severity === sev).length;
    c.out({ seq: s.seq, epoch: s.epoch, checks: checks.ids, findings, errors: count("error"), warnings: count("warning"), ...(r.notRun ? { notRun: r.notRun } : {}), ...(r.notes ? { notes: r.notes } : {}) }, () =>
      [
        ...findings.map((f) => `${f.severity.toUpperCase().padEnd(7)} ${f.check}  ${f.message}  [${f.objects.join(", ")}] at ${mmText(f.location.x)}, ${mmText(f.location.y)}${f.location.layer ? ` on ${f.location.layer}` : ""}`),
        ...(r.notRun ?? []).map((n) => `NOT RUN ${n.check}: ${n.reason}`),
        `${count("error")} error(s), ${count("warning")} warning(s), ${count("info")} info; ${checks.ids.length} check(s) at seq ${s.seq}`,
      ].join("\n"),
    );
    return count("error") ? BOARD_EXIT.invalid : BOARD_EXIT.ok;
  },

  async render(c: Ctx): Promise<number> {
    const dir = c.path(c.pos[0]);
    const renderer = await loadRenderer();
    if (!renderer) return notAvailable(c, "render", "no board renderer that draws to a file is installed (views pcb)");
    const s = await withBoard(dir, (b) => b.snapshot(), "read");
    const result = await renderer.fn(s, {});
    const isSvg = typeof result === "string" && /<svg[\s>]/.test(result);
    const isBytes = result instanceof Uint8Array;
    if (!isSvg && !isBytes) return notAvailable(c, "render", `the installed renderer's ${renderer.name} did not return an SVG text or image bytes`);
    const root = findProjectRoot(dir);
    const outFile = c.a.one("out") ? resolve(c.io.cwd, c.a.one("out")!) : join(root, ".protoboard", "build", "board", boardKey(root, dir), isSvg ? "render.svg" : "render.png");
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, isSvg ? (result as string) : (result as Uint8Array));
    c.out({ status: "written", file: outFile, renderer: renderer.name, seq: s.seq }, () => `wrote ${outFile} (${renderer.name}, seq ${s.seq})`);
    return BOARD_EXIT.ok;
  },
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
const isCheck = (v: unknown): v is Check => !!v && typeof v === "object" && typeof (v as Check).id === "string" && typeof (v as Check).run === "function";

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

export async function loadImporters(): Promise<Importer[] | undefined> {
  const mods = [await loadOptional("@protoboardai/board-import", "../../board-import/src/index.ts"), await loadOptional("@protoboardai/board-import-easyeda", "../../board-import-easyeda/src/index.ts")].filter((m): m is Record<string, unknown> => !!m);
  const all = mods.flatMap((m) => collect(m, isImporter, /^(list|all|default)?[Ii]mporters$/));
  return all.length ? all : undefined;
}

export interface ChecksRun {
  ids: string[];
  run(s: BoardSnapshot): { findings: Finding[]; notRun?: { check: string; reason: string }[]; notes?: string[] };
}

/**
 * The installed board checks: the package's own runner (`runBoardChecks`, which also says what did not run), else
 * contract `Check` objects (`createBoardChecks()`, or exported checks) through `runChecks`.
 */
export async function loadChecks(): Promise<ChecksRun | undefined> {
  const mod = await loadOptional("@protoboardai/board-checks", "../../board-checks/src/index.ts");
  if (!mod) return undefined;
  const make = typeof mod.createBoardChecks === "function" ? (mod.createBoardChecks as () => unknown)() : undefined;
  const checks = Array.isArray(make) ? make.filter(isCheck) : collect(mod, isCheck, /^(list|all|default)?[Cc]hecks$/);
  if (typeof mod.runBoardChecks === "function") {
    const runner = mod.runBoardChecks as (s: BoardSnapshot) => { findings: Finding[]; notRun?: { check: string; reason: string }[]; notes?: string[] };
    return { ids: checks.map((k) => k.id), run: (s) => runner(s) };
  }
  return checks.length ? { ids: checks.map((k) => k.id), run: (s) => ({ findings: runChecks(s, checks) }) } : undefined;
}

const RENDER_NAMES = ["renderBoardSvg", "renderPcbSvg", "boardToSvg", "renderSvg", "renderBoardPng", "renderPcbPng", "renderBoard"];
export async function loadRenderer(): Promise<{ name: string; fn: (s: BoardSnapshot, o: object) => unknown } | undefined> {
  const mod =
    (await loadOptional("@protoboardai/views/pcb", "../../views/src/pcb/index.ts")) ??
    (await loadOptional("@protoboardai/views/pcb-headless", "../../views/src/pcb/headless/render.ts"));
  if (!mod) return undefined;
  const name = RENDER_NAMES.find((n) => typeof mod[n] === "function");
  return name ? { name, fn: mod[name] as (s: BoardSnapshot, o: object) => unknown } : undefined;
}
