/**
 * The editing commands of `protoboard board` (PCB editor Phase 2, docs/specs/pcb-editor/phase2-editing.md section 9,
 * and the pause and waivers of P2-E): proposals (list, show, propose, accept, reject), pause and resume, a free
 * corridor query for agents, `apply --wait`, `route --propose` and the editing attachment of `board serve`.
 *
 * board.ts registers these beside its own commands and hands them its helpers (`EditingDeps`), so this module
 * needs nothing from it at load time. Optional packages (board-edit's service side, board-scene) load when present.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as EditModule from "@protoboardai/board-edit/service";
import type * as RouteModule from "@protoboardai/board-route";
import type * as SceneModule from "@protoboardai/board-scene";
import { copperLayers, toMm, type Actor, type BoardClient, type BoardService, type ExtensionMethod, type Proposal, type ProposalPreview, type ProposeInput, type ProposeReply, type Reply, type Transaction } from "@protoboardai/board/node";

type Out = (data: unknown, text: () => string) => void;

/** What a command gets from board.ts (its `Ctx`, structurally). */
export interface EditCtx {
  a: { has(name: string): boolean; one(name: string): string | undefined; all(name: string): string[] };
  pos: string[];
  out: Out;
  json: boolean;
  env: NodeJS.ProcessEnv;
  stderr: (s: string) => void;
  write: (s: string) => void;
  io: { cwd: string };
  path(p: string | undefined, what?: string): string;
}

/** board.ts's helpers, handed over when it registers these commands. */
export interface EditingDeps {
  withBoard<T>(dir: string, fn: (c: BoardClient) => Promise<T>, how?: "write" | "read" | "service"): Promise<T>;
  resolveActor(as: string | undefined, env: NodeJS.ProcessEnv): Actor;
  parseLength(s: string, what: string): number;
  replyText(r: Reply, mode: string): string;
  exitOf(r: Reply): number;
  readJson(file: string, what: string): unknown;
  usage(message: string): Error;
  loadScene(): Promise<typeof SceneModule | undefined>;
  notAvailable(c: EditCtx, command: string, why: string): number;
}

const EXIT = { ok: 0, invalid: 1, usage: 2, refused: 3 } as const;

/** The editing commands' entries in `protoboard board help` (the parity test runs each with --json). */
export const EDITING_COMMANDS = [
  { name: "proposals", args: "<dir>", summary: "Proposals stored on the board (newest first): title, who, status, items; --status open|stale|accepted|partial|rejected", flags: ["status"] },
  { name: "proposal", args: "<dir> <id>", summary: "One proposal: items with nets and change summary, counts before and after, scores, why stale; --preview adds the diff against the board now", flags: ["preview"] },
  { name: "propose", args: "<dir> <proposal.json>", summary: "Store a change as a proposal ({ title, items: [{ label, ops }] }) instead of applying it; changes nothing", flags: ["as"] },
  { name: "accept", args: "<dir> <id>", summary: "A person accepts a proposal (all items, or --items a,b) as their own transaction; --allow-stale revalidates a stale one; --as human only", flags: ["items", "allow-stale", "as"] },
  { name: "reject", args: "<dir> <id>", summary: "Reject a proposal (all items, or --items a,b) with --reason; a proposer may withdraw its own", flags: ["items", "reason", "as"] },
  { name: "pause", args: "<dir>", summary: "A person pauses agents and routers on a running service (their writes are refused until resume); --reason, --ttl <seconds>", flags: ["reason", "ttl", "as"] },
  { name: "resume", args: "<dir>", summary: "A person lets agents and routers write again", flags: ["as"] },
  { name: "corridor", args: "<dir>", summary: "Is there a free corridor from --from to --to (x,y in nm or mm, or a pad, via or footprint id) on --layer, for --net at --width? Changes nothing", flags: ["from", "to", "layer", "net", "width", "clearance"] },
] as const;

/** Flags of these commands that take no value. */
export const EDITING_BOOLEAN = ["preview", "allow-stale", "propose"] as const;

const STATUSES = ["open", "stale", "accepted", "partial", "rejected"] as const;
const mmText = (nm: number) => `${+toMm(nm).toFixed(4)} mm`;
const list = (s: string | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined);

// ---------------------------------------------------------------- text

const who = (a: Actor) => (a.kind === "human" ? `person ${a.id}` : `${a.kind} ${a.id}`);

/** A change summary in words: "added 2 track, 1 via; removed 1 track; +3.2 mm of track". */
export function changeText(s: Proposal["summary"]): string {
  const part = (label: string, m: Record<string, number>) => (Object.keys(m).length ? `${label} ${Object.entries(m).map(([k, n]) => `${n} ${k}`).join(", ")}` : "");
  const len = [s.length.added ? `+${mmText(s.length.added)}` : "", s.length.removed ? `-${mmText(s.length.removed)}` : ""].filter(Boolean).join(" ");
  return [part("added", s.added), part("removed", s.removed), part("changed", s.changed), len ? `${len} of track` : ""].filter(Boolean).join("; ") || "no change";
}

/** Router scores ({ current, candidate }) in words, else the scores as JSON. */
function scoresText(scores: Record<string, unknown>): string {
  const sc = (x: unknown) => {
    const v = x as { open?: number; errors?: number; vias?: number; length?: number };
    return v && typeof v.open === "number" ? `${v.open} open, ${v.errors} error(s), ${v.vias} via(s), ${mmText(v.length ?? 0)}` : JSON.stringify(x);
  };
  if (scores.current !== undefined || scores.candidate !== undefined) return `current ${sc(scores.current)}; candidate ${sc(scores.candidate)}${scores.runId ? ` (run ${String(scores.runId)})` : ""}`;
  return JSON.stringify(scores);
}

function proposalLine(p: Proposal): string {
  const open = p.items.filter((i) => i.status === "open" || i.status === "stale").length;
  return `${p.id}  ${p.status.toUpperCase().padEnd(8)} ${JSON.stringify(p.title)}  by ${who(p.actor)}; ${p.items.length} item(s)${open !== p.items.length ? `, ${open} open` : ""}; ${changeText(p.summary)}`;
}

export function proposalText(p: Proposal, preview?: ProposalPreview | null): string {
  const lines = [`${p.id}  ${p.status.toUpperCase()}  ${JSON.stringify(p.title)}`, `  by ${who(p.actor)} (source ${p.source}), computed on seq ${p.base.seq}, epoch ${p.base.epoch}; change set ${p.changeSet.id}`];
  if (p.reason) lines.push(`  waits for a person: ${p.reason}`);
  lines.push("  items:");
  for (const it of p.items) lines.push(`    ${it.key.padEnd(6)} ${it.status.padEnd(8)} ${it.label}${it.nets.length ? `  nets ${it.nets.join(", ")}` : ""}`, `           ${changeText(it.summary)}; ${it.ops.length} op(s)${it.acceptedSeq !== undefined ? `; accepted at seq ${it.acceptedSeq}` : ""}`);
  lines.push(`  before: ${p.before.records} records, ${p.before.tracks} tracks, ${p.before.vias} vias; after: ${p.after.records} records, ${p.after.tracks} tracks, ${p.after.vias} vias`);
  if (p.scores) lines.push(`  scores: ${scoresText(p.scores)}`);
  if (p.stale) lines.push(`  STALE since seq ${p.stale.seq} by ${who(p.stale.actor)}${p.stale.changed.length ? ` (changed ${p.stale.changed.slice(0, 8).join(", ")}${p.stale.changed.length > 8 ? ", ..." : ""})` : " (an earlier session of the board)"}; accept with --allow-stale revalidates it`);
  if (p.rejected) lines.push(`  rejected by ${who(p.rejected.by)}${p.rejected.reason ? `: ${p.rejected.reason}` : ""}`);
  if (preview) {
    lines.push(`  preview on seq ${preview.seq}: ${preview.valid ? "applies" : `DOES NOT APPLY (${preview.error})`}${preview.stale ? " (stale proposal)" : ""}`);
    if (preview.valid) {
      const ids = (xs: { id: string }[]) => (xs.length ? `: ${xs.slice(0, 10).map((x) => x.id).join(", ")}${xs.length > 10 ? ", ..." : ""}` : "");
      lines.push(`    added ${preview.added.length}${ids(preview.added)}`, `    removed ${preview.removed.length}${ids(preview.removed)}`, `    changed ${preview.changed.length}${ids(preview.changed.map((c) => c.after))}`);
    }
  } else if (p.status === "open" || p.status === "stale") lines.push("  --preview shows the diff against the board now");
  return lines.join("\n");
}

// ---------------------------------------------------------------- optional packages

async function loadOptional(name: string, repoPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    return (await import(name)) as Record<string, unknown>;
  } catch {
    const file = fileURLToPath(new URL(repoPath, import.meta.url));
    if (!existsSync(file)) return undefined;
    try {
      return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
}

/** board-edit's service side (live checks, diagnosis, router proposals), when installed. */
export async function loadEditService(): Promise<typeof EditModule | undefined> {
  const mod = await loadOptional("@protoboardai/board-edit/service", "../../board-edit/src/service.ts");
  return mod && typeof mod.attachEditing === "function" ? (mod as unknown as typeof EditModule) : undefined;
}

/**
 * `board serve`'s editing attachment: live checks that publish `derived` events after each commit, and the
 * `board.diagnose` wire method. Undefined (and a note) when board-edit is not installed.
 */
export async function attachServeEditing(svc: BoardService, note: (s: string) => void): Promise<{ methods: Record<string, ExtensionMethod>; stop(): void } | undefined> {
  const mod = await loadEditService();
  if (!mod) {
    note("protoboard: the editing kernel (package board-edit) is not installed: no live checks or board.diagnose on this service\n");
    return undefined;
  }
  try {
    const e = mod.attachEditing(svc);
    return { methods: e.methods, stop: () => e.stop() };
  } catch (err) {
    note(`protoboard: live checks did not start (${(err as Error).message.split("\n")[0]}); the service runs without them\n`);
    return undefined;
  }
}

/**
 * Store a route result as service proposals through board-edit's `proposeRouteResult` (one proposal per router
 * step, one item per net, the scores kept). It runs against a stand-in service that records each proposal, which
 * then goes to the board's service through the client (a client's calls are asynchronous; the function's are not).
 */
export async function proposeRoute(b: BoardClient, rp: RouteModule.RouteProposal, epoch: string): Promise<({ id: string; title: string; items: { key: string; label: string; nets: string[] }[]; status: string } | { error: string })[]> {
  const mod = await loadEditService();
  if (!mod) return [{ error: "the editing kernel (package board-edit) is not installed: nothing was proposed" }];
  const calls: { actor: Actor; input: ProposeInput }[] = [];
  const stand = {
    epoch,
    propose(actor: Actor, input: ProposeInput): ProposeReply {
      calls.push({ actor, input });
      return { status: "invalid", error: "recorded" };
    },
  } as unknown as BoardService;
  const local = mod.proposeRouteResult(stand, rp);
  if (!calls.length) return local.map((x) => ({ error: x.status === "invalid" ? x.error : "nothing to propose" }));
  const out: ({ id: string; title: string; items: { key: string; label: string; nets: string[] }[]; status: string } | { error: string })[] = [];
  for (const c of calls) {
    const r = await b.propose(c.actor, c.input);
    out.push(r.status === "proposed" ? { id: r.proposal.id, title: r.proposal.title, status: r.proposal.status, items: r.proposal.items.map((i) => ({ key: i.key, label: i.label, nets: i.nets })) } : { error: r.error });
  }
  return out;
}

/** Apply, and while the reply is a `paused` or `held` refusal, wait and send the same batch again until `waitMs` runs out. */
export async function applyWithWait(b: BoardClient, tx: Transaction, actor: Actor, waitMs: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ r: Reply; waited: { ms: number; tries: number } }> {
  const t0 = Date.now();
  const end = t0 + waitMs;
  let tries = 1;
  let r = await b.apply(tx, actor);
  while (r.status === "refused" && (r.reason === "paused" || r.reason === "held") && Date.now() < end) {
    const left = end - Date.now();
    const next = r.retryAfterMs !== undefined ? r.retryAfterMs + 50 : 1000;
    await sleep(Math.max(50, Math.min(left, next)));
    r = await b.apply(tx, actor);
    tries++;
  }
  return { r, waited: { ms: Date.now() - t0, tries } };
}

/** `--wait <seconds>`: more than 0, at most an hour. */
export function waitSeconds(s: string | undefined, usage: (m: string) => Error): number | undefined {
  if (s === undefined) return undefined;
  const v = Number(s);
  if (!/^\s*\d+(\.\d+)?\s*$/.test(s) || !(v > 0) || v > 3600) throw usage(`--wait takes seconds, more than 0 and at most 3600 (got ${s.slice(0, 20)})`);
  return Math.round(v * 1000);
}

// ---------------------------------------------------------------- the commands

/** A duration: seconds, or a number with s, m or ms. */
function duration(s: string, what: string, usage: (m: string) => Error): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m)?\s*$/i.exec(s);
  if (!m) throw usage(`${what} takes seconds (or a number with s, m or ms), got ${s.slice(0, 20)}`);
  const v = Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000 }[(m[2] ?? "s").toLowerCase() as "ms" | "s" | "m"]);
  if (!(v > 0) || v > 86_400_000) throw usage(`${what} must be more than 0 and at most a day`);
  return Math.round(v);
}

export function editingCommands(d: EditingDeps): Record<(typeof EDITING_COMMANDS)[number]["name"], (c: EditCtx) => Promise<number>> {
  const person = (c: EditCtx, command: string): Actor | undefined => {
    // `--as human` (or none) asks for a person; under an agent's environment it is still that agent, refused below
    const as = c.a.one("as");
    const ambient = d.resolveActor(undefined, c.env);
    const actor = as === undefined || as === "human" || as === "person" ? ambient : d.resolveActor(as, c.env);
    if (actor.kind === "human") return actor;
    const message = `board ${command} is a person's call; this command runs as ${actor.id}, and an agent never acts as a person`;
    c.out({ status: "refused", reason: "not-a-person", message }, () => `REFUSED  not-a-person: ${message}`);
    return undefined;
  };
  const localNote = (mode: string) => (mode === "local" ? " (no running service: proposals of earlier sessions are stale; `board serve` keeps them live)" : "");

  return {
    async proposals(c) {
      const dir = c.path(c.pos[0]);
      const status = c.a.one("status");
      if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) throw d.usage(`--status takes ${STATUSES.join(", ")}`);
      const { ps, mode } = await d.withBoard(dir, async (b) => ({ ps: await b.proposals(status ? { status: status as Proposal["status"] } : {}), mode: b.mode }), "read");
      c.out({ dir, mode, proposals: ps }, () => [`${ps.length} proposal(s)${status ? ` ${status}` : ""}${localNote(mode)}`, ...ps.map((p) => `  ${proposalLine(p)}`)].join("\n"));
      return EXIT.ok;
    },

    async proposal(c) {
      const dir = c.path(c.pos[0]);
      const id = c.pos[1];
      if (!id) throw d.usage("usage: protoboard board proposal <dir> <id>  (missing <id>; `board proposals` lists them)");
      const preview = c.a.has("preview");
      const r = await d.withBoard(dir, async (b) => ({ p: await b.proposal(id), pv: preview ? await b.previewProposal(id) : undefined, mode: b.mode }), "read");
      if (!r.p) {
        c.out({ status: "invalid", error: `no proposal ${id}` }, () => `INVALID  no proposal ${id} (\`protoboard board proposals ${c.pos[0]}\` lists them)`);
        return EXIT.invalid;
      }
      c.out({ ...r.p, ...(preview ? { preview: r.pv ?? null } : {}), mode: r.mode }, () => proposalText(r.p!, r.pv) + (r.mode === "local" && r.p!.status === "stale" ? "\n  (no running service: open proposals of an earlier session read as stale)" : ""));
      return EXIT.ok;
    },

    async propose(c) {
      const dir = c.path(c.pos[0]);
      const file = c.path(c.pos[1], "<proposal.json>");
      const input = d.readJson(file, "the proposal") as ProposeInput;
      if (!input || typeof input !== "object" || Array.isArray(input)) throw d.usage("the proposal file holds { title, items: [{ key?, label, ops }], changeSet?, scores? }");
      const actor = d.resolveActor(c.a.one("as"), c.env);
      const { r, mode } = await d.withBoard(dir, async (b) => ({ r: await b.propose(actor, input), mode: b.mode }), "read");
      c.out({ ...r, mode }, () => (r.status === "proposed" ? `PROPOSED  ${proposalLine(r.proposal)}\n  nothing changed; a person accepts it with \`protoboard board accept ${c.pos[0]} ${r.proposal.id}\`${localNote(mode)}` : `INVALID  ${r.item ? `item ${r.item}: ` : ""}${r.error}`));
      return r.status === "proposed" ? EXIT.ok : EXIT.invalid;
    },

    async accept(c) {
      const dir = c.path(c.pos[0]);
      const id = c.pos[1];
      if (!id) throw d.usage("usage: protoboard board accept <dir> <id>  (missing <id>)");
      const actor = person(c, "accept");
      if (!actor) return EXIT.refused;
      const items = list(c.a.one("items"));
      const { r, mode } = await d.withBoard(dir, async (b) => ({ r: await b.acceptProposal(actor, id, { ...(items ? { items } : {}), ...(c.a.has("allow-stale") ? { allowStale: true } : {}) }), mode: b.mode }));
      c.out({ ...r, mode }, () => {
        const lines = [d.replyText(r, mode)];
        const p = r.proposalState;
        if (p && r.status === "applied") lines.push(`  proposal ${p.id} is now ${p.status}: ${p.items.map((i) => `${i.key} ${i.status}`).join(", ")}`);
        if (r.status === "refused" && r.reason === "stale-proposal") lines.push("  --allow-stale revalidates it and applies what still applies");
        return lines.join("\n");
      });
      return d.exitOf(r);
    },

    async reject(c) {
      const dir = c.path(c.pos[0]);
      const id = c.pos[1];
      if (!id) throw d.usage("usage: protoboard board reject <dir> <id>  (missing <id>)");
      const actor = d.resolveActor(c.a.one("as"), c.env);
      const items = list(c.a.one("items"));
      const reason = c.a.one("reason");
      const r = await d.withBoard(dir, (b) => b.rejectProposal(actor, id, { ...(items ? { items } : {}), ...(reason ? { reason } : {}) }));
      c.out(r, () => (r.status === "rejected" ? `REJECTED  ${proposalLine(r.proposal)}` : `INVALID  ${r.error}`));
      return r.status === "rejected" ? EXIT.ok : EXIT.invalid;
    },

    async pause(c) {
      const dir = c.path(c.pos[0]);
      const actor = person(c, "pause");
      if (!actor) return EXIT.refused;
      const reason = c.a.one("reason");
      const ttl = c.a.one("ttl") !== undefined ? duration(c.a.one("ttl")!, "--ttl", d.usage) : undefined;
      const r = await d.withBoard(dir, (b) => b.pause(actor, { ...(reason ? { reason } : {}), ...(ttl !== undefined ? { ttlMs: ttl } : {}) }), "service");
      c.out(r, () => (r.status === "paused" ? `PAUSED  agents and routers are refused until ${r.pause.until !== undefined ? new Date(r.pause.until).toISOString() : "you resume (`protoboard board resume`)"}${r.pause.reason ? `; reason: ${r.pause.reason}` : ""}\n  proposals are still taken; people and hosts write as before` : `INVALID  ${r.error}`));
      return r.status === "paused" ? EXIT.ok : EXIT.invalid;
    },

    async resume(c) {
      const dir = c.path(c.pos[0]);
      const actor = person(c, "resume");
      if (!actor) return EXIT.refused;
      const r = await d.withBoard(dir, (b) => b.resume(actor), "service");
      c.out(r, () => (r.status === "resumed" ? (r.was ? `RESUMED  agents and routers may write again (paused since ${new Date(r.was.since).toISOString()} by ${who(r.was.by)})` : "RESUMED  nothing was paused") : `INVALID  ${r.error}`));
      return r.status === "resumed" ? EXIT.ok : EXIT.invalid;
    },

    async corridor(c) {
      const dir = c.path(c.pos[0]);
      const end = (flag: "from" | "to"): [number, number] | string => {
        const v = c.a.one(flag);
        if (!v) throw d.usage(`board corridor needs --${flag} x,y (nm, or with mm) or an object id (a pad, via or footprint)`);
        const s = v.trim().replace(/^\[(.*)\]$/, "$1");
        if (/^[a-z]+:/.test(s)) return s;
        const parts = s.split(",");
        if (parts.length !== 2) throw d.usage(`--${flag} takes x,y (two lengths) or an object id`);
        return [toMm(d.parseLength(parts[0], `--${flag}`)), toMm(d.parseLength(parts[1], `--${flag}`))];
      };
      const from = end("from");
      const to = end("to");
      const layer = c.a.one("layer");
      if (!layer) throw d.usage("board corridor needs --layer (a copper layer: top, bottom, inner1, ...)");
      const width = c.a.one("width") !== undefined ? d.parseLength(c.a.one("width")!, "--width") : undefined;
      const clearance = c.a.one("clearance") !== undefined ? d.parseLength(c.a.one("clearance")!, "--clearance") : undefined;
      if ((width !== undefined && width <= 0) || (clearance !== undefined && clearance < 0)) throw d.usage("--width must be more than 0 and --clearance not below 0");
      const net = c.a.one("net");
      const scene = await d.loadScene();
      if (!scene || typeof scene.findCorridor !== "function") return d.notAvailable(c, "corridor", "the board scene is not installed (package board-scene)");
      const s = await d.withBoard(dir, (b) => b.snapshot(), "read");
      if (!(copperLayers(s.doc) as string[]).includes(layer)) throw d.usage(`--layer: ${layer} is not a copper layer of this board (${copperLayers(s.doc).join(", ")})`);
      if (net !== undefined && !s.doc.nets.has(net)) throw d.usage(`--net: the board has no net ${net}`);
      const t0 = performance.now();
      let r: SceneModule.Corridor;
      try {
        r = scene.findCorridor(scene.buildModel(s), { from, to, layer, ...(net ? { net } : {}), ...(width !== undefined ? { width: toMm(width) } : {}), ...(clearance !== undefined ? { clearance: toMm(clearance) } : {}) });
      } catch (e) {
        throw d.usage((e as Error).message);
      }
      const data = { dir, epoch: s.epoch, seq: s.seq, units: "mm", ...r, ms: Math.round(performance.now() - t0) };
      const pt = (p: { x: number; y: number }) => `${+p.x.toFixed(3)}, ${+p.y.toFixed(3)}`;
      c.out(data, () =>
        [
          r.found
            ? `FOUND  a free corridor on ${r.layer}${r.net ? ` for ${r.net}` : ""}: ${+(r.length ?? 0).toFixed(3)} mm through ${r.path?.length ?? 0} point(s); the widest track along it is ${+(r.maxWidth ?? 0).toFixed(3)} mm`
            : `BLOCKED  no free corridor on ${r.layer}${r.net ? ` for ${r.net}` : ""}: stuck at ${r.stuckAt ? pt(r.stuckAt) : "?"} mm${r.blockedBy?.length ? `, blocked by ${r.blockedBy.join(", ")}` : ""}`,
          `  from ${pt(r.from)} to ${pt(r.to)} mm, track ${+r.width.toFixed(3)} mm at ${+r.clearance.toFixed(3)} mm clearance (grid ${r.res} mm)${r.startShift || r.endShift ? `; the ends moved ${+r.startShift.toFixed(3)} and ${+r.endShift.toFixed(3)} mm to free space` : ""}`,
          ...(r.found && r.path ? [`  path: ${r.path.map(pt).join(" -> ")}`] : []),
          "  millimeters, +Y up; changes nothing (a guide, not a route: `board apply` with track.route commits one)",
        ].join("\n"),
      );
      return r.found ? EXIT.ok : EXIT.invalid;
    },
  };
}
