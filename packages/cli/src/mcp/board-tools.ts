/**
 * The board tools (PCB editor Phase 1): an agent's way to the board service, generated from the operation
 * registry so their descriptions and the operation names they accept cannot drift from it. Each runs the CLI's
 * `protoboard board …` command, as every tool of this server runs the CLI, and always as `agent:<client name>`:
 * no tool takes an actor, so an agent can never act as a person.
 *
 * The CLI uses the board's running service when there is one (`protoboard board serve`), else it opens the board
 * for the one call and saves what it changed. Undo history, leases and presence live in a running service.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agentActor, listOperations } from "@protoboardai/board";
import { cliArgs, failure, readCliJson, type ToolContext, type ToolOutcome, type ToolSpec } from "./tools.js";

const tool = <S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec => spec as unknown as ToolSpec;

/** What every board tool's description ends with (they read and write board files, never the project's code). */
export const BOARD_NO_PROJECT_CODE = "Runs no project code: it reads and writes only the board's files.";

const DIR = z.string().describe("The board folder (the one holding board.jsonl), absolute or relative to the folder the agent works in.");
const LEASE = z.number().int().optional().describe("The fencing token of your lease on this area (board_claim gives it). Needed when you hold a lease; a person's edit inside the lease revokes it.");
const BOX = z.object({ minX: z.number().int(), minY: z.number().int(), maxX: z.number().int(), maxY: z.number().int() }).strict();

/** The operations an agent may call: the registry's `all` audience. */
export const agentOperations = () => listOperations().filter((d) => d.audience === "all");

/** The actor every board tool acts as. */
export const boardActor = (ctx: ToolContext) => agentActor(ctx.clientName?.() ?? "agent");

/** Run `protoboard board <sub>` with values written to a scratch file when they are JSON. */
async function board(ctx: ToolContext, dir: string, sub: string, options: Record<string, string | number | undefined>, positionals: string[], file?: unknown): Promise<ToolOutcome> {
  let scratch: string | undefined;
  try {
    const pos = [dir, ...positionals];
    if (file !== undefined) {
      scratch = mkdtempSync(join(tmpdir(), "protoboard-board-"));
      const f = join(scratch, `${sub}.json`);
      writeFileSync(f, JSON.stringify(file), { mode: 0o600 });
      pos.push(f);
    }
    const r = readCliJson(await ctx.cli(dir, cliArgs(["board", sub], options, pos)));
    return r.ok ? { data: r.data } : failure(r.message, dir, r.code);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

const STATUS = z.enum(["open", "stale", "accepted", "partial", "rejected"]);
const OPS_ITEM = z.object({ op: z.string() }).passthrough();

/**
 * Proposals and the corridor (Phase 2 editing): an agent proposes and reads proposals; no tool accepts, rejects,
 * pauses or resumes (a person's calls, made in the editor or with the CLI in a person's terminal).
 */
function editingTools(): ToolSpec[] {
  return [
    tool({
      name: "board_propose",
      title: "Propose a board change",
      description:
        "Store a change as a proposal for a person to review and accept, instead of applying it: a title (3 to 12 words) and items, each a short label and the operations it applies (as board_apply takes them; each item must apply on its own and all together). The reply is the stored proposal: id, items with their nets and change summary, counts before and after, the areas it touches. Changes nothing on the board (a person's accept applies it as their own transaction, keeping your provenance). Proposals are taken even while a person has paused agents. You act as agent:<your client name>.",
      input: {
        dir: DIR,
        title: z.string().min(1).max(160).describe("3 to 12 words saying what the proposal does."),
        items: z
          .array(z.object({ key: z.string().optional().describe("Default i<n>; letters, digits, _ . -"), label: z.string().min(1).max(160).describe("What this item does."), ops: z.array(OPS_ITEM).min(1).max(200).describe("Operations, each { op, ...input }.") }).strict())
          .min(1)
          .max(200)
          .describe("The items: a person may accept some and reject others."),
        changeSet: z.object({ id: z.string(), title: z.string().optional() }).optional().describe("The change set the accepted items join."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        return board(ctx, dir, "propose", { as: boardActor(ctx).id }, [], { title: a.title, items: a.items, ...(a.changeSet ? { changeSet: a.changeSet } : {}) });
      },
    }),
    tool({
      name: "board_proposals",
      title: "List board proposals",
      description: "The proposals stored on a board, newest first: id, title, who proposed (agent, router, host), status (open, stale, accepted, partial, rejected), items with nets and change summaries, scores (a router's current and candidate), and why one is stale. Writes nothing.",
      input: { dir: DIR, status: STATUS.optional().describe("Only proposals with this status.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, status }, ctx) => board(ctx, await ctx.dir(dir), "proposals", { status }, []),
    }),
    tool({
      name: "board_proposal",
      title: "Read one board proposal",
      description: "One proposal: title, proposer, status, items (key, label, ops, status, nets, change summary), counts before and after, touched ids, scores, the stale reason or the rejection. `preview: true` adds the diff against the board as it is now (records added, removed and changed, and whether it still applies). Writes nothing.",
      input: { dir: DIR, id: z.string().min(1).describe("The proposal id (p.<epoch>.<n>)."), preview: z.boolean().optional().describe("Add the diff against the current board.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, id, preview }, ctx) => board(ctx, await ctx.dir(dir), "proposal", { preview: preview ? "true" : undefined }, [id]),
    }),
    tool({
      name: "board_corridor",
      title: "Find a free corridor",
      description:
        "Ask whether a track can pass between two places on one copper layer: from and to are points in millimeters ([x, y], +Y up, origin at the board center) or object ids (a pad, via or footprint: its center); the net's own copper is not an obstacle (default: the net of a pad or via end). Returns found, the centerline path and its length (mm), the widest track that fits along it, or where it got stuck and the objects blocking it. A guide for planning a route, not a route: nothing is changed (commit one with board_apply and track.route). Writes nothing.",
      input: {
        dir: DIR,
        from: z.union([z.array(z.number()).length(2), z.string()]).describe("[x, y] in millimeters, or a pad, via or footprint id."),
        to: z.union([z.array(z.number()).length(2), z.string()]).describe("[x, y] in millimeters, or a pad, via or footprint id."),
        layer: z.string().describe("A copper layer: top, bottom, inner1, ..."),
        net: z.string().optional().describe("The net the track would carry."),
        width: z.number().positive().optional().describe("Track width in millimeters (default: the board's target width)."),
        clearance: z.number().nonnegative().optional().describe("Clearance in millimeters (default: the board's target clearance)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const end = (v: number[] | string) => (typeof v === "string" ? v : `[${v.map((x) => `${x}mm`).join(",")}]`);
        return board(ctx, dir, "corridor", { from: end(a.from), to: end(a.to), layer: a.layer, net: a.net, width: a.width !== undefined ? `${a.width}mm` : undefined, clearance: a.clearance !== undefined ? `${a.clearance}mm` : undefined }, []);
      },
    }),
  ];
}

/** A reply with the PNG it names attached (when the command wrote one). */
function withPng(out: ToolOutcome, pick: (d: { file?: string; files?: { png?: string } }) => string | undefined): ToolOutcome {
  if (out.isError) return out;
  const file = pick((out.data ?? {}) as { file?: string; files?: { png?: string } });
  if (!file || !file.toLowerCase().endsWith(".png") || !existsSync(file)) return out;
  return { ...out, images: [{ data: readFileSync(file).toString("base64"), mimeType: "image/png" }] };
}

export function boardTools(): ToolSpec[] {
  const ops = agentOperations();
  const names = ops.map((d) => d.name) as [string, ...string[]];
  const opList = ops.map((d) => `${d.name} (${d.title.toLowerCase()})`).join("; ");
  const specs: ToolSpec[] = [
    tool({
      name: "board_operations",
      title: "Board operations",
      description: `Every operation an agent can apply to a board, from the board's operation registry: name, title, description, a valid example on the sample board, and the JSON Schema of its input. Lengths are integer nanometers (1 mm = 1000000), angles integer millidegrees, +Y up. The operations: ${opList}. Writes nothing.`,
      input: { all: z.boolean().optional().describe("Also list the system operations (hosts and undo only; not open to agents).") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ all }, ctx) => {
        const dir = await ctx.dir();
        const r = readCliJson(await ctx.cli(dir, cliArgs(["board", "ops"], { all: all ? "true" : undefined })));
        return r.ok ? { data: r.data } : failure(r.message, dir, r.code);
      },
    }),
    tool({
      name: "board_apply",
      title: "Apply board operations",
      description:
        `Apply one transaction to a board: up to 200 operations, all or none. Each op is { op, ...input } as board_operations describes (${names.length} operations: ${names.join(", ")}). New copper, zones and keep-outs take a \`handle\`; the reply maps handles to ids, and later ops may refer to "$<handle>". Pass expectSeq (the seq you read) or expectVersions so a change made since you looked refuses your write instead of overwriting it. The reply: applied (seq, changed, created, removed, versions), valid (dryRun), refused (reason: stale-seq, stale-versions, locked, leased, lease-revoked, needs-person, held, paused, with what you missed), or invalid (error and the op index). Locked objects are refused for agents; changes to nets, unlocks and waivers need a person: such a transaction is refused needs-person and stored as a proposal (its id in the reply) for a person to accept. While a person has paused agents, writes are refused paused (waitSeconds waits it out). CHANGES THE BOARD (saved at once when no service is running; else on the service's save). You act as agent:<your client name>.`,
      input: {
        dir: DIR,
        ops: z.array(z.object({ op: z.enum(names) }).passthrough()).min(1).max(200).describe("The operations, each { op: <name>, ...its input }."),
        label: z.string().optional().describe("3 to 8 words saying what the transaction does (default: from the operations)."),
        batchId: z.string().optional().describe("Your id for this transaction; sending it again returns the first reply, never applies twice."),
        changeSet: z.object({ id: z.string(), title: z.string().optional() }).optional().describe("Groups transactions for review and revert."),
        expectSeq: z.number().int().optional().describe("The board seq your read saw; refused if anything changed since."),
        expectEpoch: z.string().optional().describe("The epoch your read saw (a restart of the service changes it)."),
        expectVersions: z.record(z.number().int()).optional().describe("Object id to the version you read (0: must not exist)."),
        expectRegion: z.object({ box: BOX, layers: z.array(z.string()).optional(), seq: z.number().int() }).optional().describe("A region you read at a seq: refused if anything there changed since."),
        lease: LEASE,
        dryRun: z.boolean().optional().describe("Validate everything, commit nothing: status valid."),
        waitSeconds: z.number().positive().max(3600).optional().describe("When a person has paused agents (refused: paused) or is dragging what you change (refused: held), wait up to this many seconds and send the same transaction again until it goes through."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const tx = {
          ops: a.ops,
          ...(a.label ? { label: a.label } : {}),
          ...(a.batchId ? { batchId: a.batchId } : {}),
          ...(a.changeSet ? { changeSet: a.changeSet } : {}),
          ...(a.expectSeq !== undefined ? { expectSeq: a.expectSeq } : {}),
          ...(a.expectEpoch ? { expectEpoch: a.expectEpoch } : {}),
          ...(a.expectVersions ? { expectVersions: a.expectVersions } : {}),
          ...(a.expectRegion ? { expectRegion: a.expectRegion } : {}),
          ...(a.lease !== undefined ? { leaseToken: a.lease } : {}),
          ...(a.dryRun ? { dryRun: true } : {}),
        };
        return board(ctx, dir, "apply", { as: boardActor(ctx).id, wait: a.waitSeconds }, [], tx);
      },
    }),
    tool({
      name: "board_inspect",
      title: "Board summary",
      description: "A board's summary: name, stackup layers, counts of footprints, pads, tracks, vias, zones and keep-outs, every net with its class and copper, net classes, rules (tier, check, values in nanometers), locked objects, leases, and the version (epoch and seq) to quote in board_apply's expectSeq. Writes nothing.",
      input: { dir: DIR },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir }, ctx) => board(ctx, await ctx.dir(dir), "inspect", {}, []),
    }),
    tool({
      name: "board_query",
      title: "Find board objects",
      description: "Objects on a board by id, by net, in a region (a box) or at a point, with their boxes, layers and nets; `records: true` adds the stored records and their versions (by id they always come). Pads are `pad:<footprint key>:<number>`. Coordinates are integer nanometers, +Y up, origin at the board center. Give exactly one of ids, net, region, point. Writes nothing.",
      input: {
        dir: DIR,
        ids: z.array(z.string()).optional().describe("Object or pad ids."),
        net: z.string().optional().describe("A net name: its pads, tracks, vias and zones."),
        region: BOX.optional().describe("Objects whose boxes meet this box."),
        point: z.object({ x: z.number().int(), y: z.number().int() }).optional().describe("Objects whose boxes contain this point."),
        tolerance: z.number().int().nonnegative().optional().describe("With point: grow boxes by this much (nm)."),
        layers: z.array(z.string()).optional().describe("With region or point: only these layers."),
        kinds: z.array(z.string()).optional().describe("With region or point: only these kinds (footprint, pad, track, via, zone, keepout, ...)."),
        records: z.boolean().optional().describe("Add the stored records and versions."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const given = [a.ids?.length ? 1 : 0, a.net ? 1 : 0, a.region ? 1 : 0, a.point ? 1 : 0].reduce((x, y) => x + y, 0);
        if (given !== 1) return { data: { error: "give exactly one of ids, net, region, point" }, isError: true };
        const filt = { ...(a.layers ? { layers: a.layers } : {}), ...(a.kinds ? { kinds: a.kinds } : {}), ...(a.records ? { records: true } : {}) };
        const q = a.ids?.length ? { by: "id", ids: a.ids, records: true } : a.net ? { by: "net", name: a.net, ...(a.records ? { records: true } : {}) } : a.region ? { by: "region", box: a.region, ...filt } : { by: "at", point: a.point, ...(a.tolerance !== undefined ? { tolerance: a.tolerance } : {}), ...filt };
        return board(ctx, dir, "query", {}, [], q);
      },
    }),
    tool({
      name: "board_undo",
      title: "Undo your last board change",
      description: "Undo your own last transaction on the board (never a person's or another agent's). Refused (stale-undo, with the conflicts) when something you changed was changed since by someone else. Undo history lives in a running board service (protoboard board serve); with none running there is nothing to undo. CHANGES THE BOARD.",
      input: { dir: DIR, lease: LEASE },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async ({ dir, lease }, ctx) => board(ctx, await ctx.dir(dir), "undo", { as: boardActor(ctx).id, lease }, []),
    }),
    tool({
      name: "board_redo",
      title: "Redo your last undone board change",
      description: "Redo your own last undone transaction, while nothing it touched changed since the undo and you have committed nothing newer. Needs a running board service. CHANGES THE BOARD.",
      input: { dir: DIR, lease: LEASE },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async ({ dir, lease }, ctx) => board(ctx, await ctx.dir(dir), "redo", { as: boardActor(ctx).id, lease }, []),
    }),
    tool({
      name: "board_claim",
      title: "Lease an area of the board",
      description: "Take a lease so others (agents, routers) cannot change what you are working on: footprints under UHD instance paths (roots), the copper of nets, or objects in a region. Returns the lease and its fencing token: pass it as `lease` with your writes. Leases last ttlMs (default 120 s, at most 10 min) and are renewed by each write quoting the token. A person's edit inside your lease revokes it. Needs a running board service (protoboard board serve). Changes no board object.",
      input: {
        dir: DIR,
        purpose: z.string().min(1).max(200).describe("What you will do there, in a few words."),
        roots: z.array(z.string()).optional().describe("UHD instance path subtrees, such as power (\"\" is the whole board)."),
        nets: z.array(z.string()).optional().describe("Net names."),
        region: z.object({ box: BOX, layers: z.array(z.string()).optional() }).optional().describe("A box (nm), optionally on some layers."),
        ttlMs: z.number().int().optional().describe("Lease length in milliseconds (1000 to 600000; default 120000)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async ({ dir, ...claim }, ctx) => board(ctx, await ctx.dir(dir), "claim", { as: boardActor(ctx).id }, [], claim),
    }),
    tool({
      name: "board_release",
      title: "End your board leases",
      description: "End your leases on the board (all of them, or the one leaseId names), so others may work there. Needs a running board service. Changes no board object.",
      input: { dir: DIR, leaseId: z.string().optional().describe("One lease to end (default: all of yours).") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir, leaseId }, ctx) => board(ctx, await ctx.dir(dir), "release", { as: boardActor(ctx).id, lease: leaseId }, []),
    }),
    tool({
      name: "board_presence",
      title: "Who is working on the board",
      description: "The board's live leases (holder, purpose, what they cover, until when) and recent agent intents, with the current seq and epoch: look before you claim or edit an area. Writes nothing.",
      input: { dir: DIR },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir }, ctx) => board(ctx, await ctx.dir(dir), "presence", {}, []),
    }),
    tool({
      name: "board_check",
      title: "Check the board",
      description:
        "Run the board's connectivity and design rule checks on its zone fill: every finding (id, check, severity, message, objects, location in nm), the checks not run and why, caveats, connectivity counts, and summary.line (N unconnected, M errors, K warnings; `incomplete` when something is left out). When the board was imported from a KiCad file (or `kicad` names one) and kicad-cli is installed, KiCad's DRC runs on that file and crossCheck gives KiCad's counts beside ours with every difference named; otherwise crossCheck says why it did not run. Finding ids work in board_describe's `finding`. Writes nothing.",
      input: {
        dir: DIR,
        kicad: z.string().optional().describe("A KiCad board file (.kicad_pcb) of the same board to cross-check against (default: the file the board was imported from)."),
        kicadRoot: z.string().optional().describe("The folder kicad-cli's run copies (default: the KiCad file's folder; it must hold the project and rule files)."),
        crossCheck: z.boolean().optional().describe("false: skip KiCad's DRC (it takes seconds)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        return board(ctx, dir, "check", { kicad: a.kicad ? await ctx.dir(a.kicad) : undefined, "kicad-root": a.kicadRoot ? await ctx.dir(a.kicadRoot) : undefined, "no-cross-check": a.crossCheck === false ? "true" : undefined }, []);
      },
    }),
    tool({
      name: "board_describe",
      title: "Describe the board for an agent",
      description:
        "The board scene: compact JSON made for an agent (board, view, counts, footprints with neighbors, nets with completion, ratsnest links, copper, vias, zones, keep-outs, locks, congestion; millimeters, +Y up, origin at the board center) and a matching PNG whose marker numbers match the JSON's. Connectivity and finding markers come from the board checks. Give at most one focus: region (mm box), net, object (an id), or finding (an id from board_check); none describes the whole board. Returns the scene and the paths of the files it wrote under .protoboard/build; `image: true` also returns the PNG. Writes only those derived files.",
      input: {
        dir: DIR,
        region: z.array(z.number()).length(4).optional().describe("A box in millimeters: [x1, y1, x2, y2]."),
        net: z.string().optional().describe("A net name: its pads, copper and missing links."),
        object: z.string().optional().describe("An object id (fp:…, pad:…, trk:…, via:…, zone:…)."),
        finding: z.string().optional().describe("A finding id from board_check (f:<check>:<hash>)."),
        image: z.boolean().optional().describe("Also return the PNG in the reply."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const given = [a.region ? 1 : 0, a.net ? 1 : 0, a.object ? 1 : 0, a.finding ? 1 : 0].reduce((x, y) => x + y, 0);
        if (given > 1) return { data: { error: "give at most one of region, net, object, finding" }, isError: true };
        const out = await board(ctx, dir, "describe", { region: a.region ? `[${a.region.join(",")}]` : undefined, net: a.net, object: a.object, finding: a.finding }, []);
        return a.image ? withPng(out, (d) => d.files?.png) : out;
      },
    }),
    tool({
      name: "board_render",
      title: "Render the board to a PNG",
      description:
        "A PNG of the board as the layout screen draws it (headless Chrome; several seconds), with its zone fill, ratsnest and the checks' finding markers: the whole board or a region (nm box), chosen layers, flipped to the bottom, nets highlighted. Returns the file it wrote under .protoboard/build and what it drew; `image: true` also returns the PNG. For a description an agent reads, prefer board_describe. Writes only that derived file.",
      input: {
        dir: DIR,
        region: BOX.optional().describe("The area to draw, nanometers (default: the whole board)."),
        layers: z.union([z.enum(["all", "routing", "top", "fab"]), z.array(z.string())]).optional().describe("A preset (all, routing, top, fab) or layer panel rows such as cu:top, silk:top, pads."),
        flip: z.boolean().optional().describe("View from the bottom."),
        nets: z.array(z.string()).optional().describe("Nets to highlight."),
        width: z.number().int().min(16).max(8192).optional().describe("Pixels (default 1200)."),
        height: z.number().int().min(16).max(8192).optional().describe("Pixels (default 900)."),
        image: z.boolean().optional().describe("Also return the PNG in the reply."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const out = await board(
          ctx,
          dir,
          "render",
          {
            region: a.region ? `[${[a.region.minX, a.region.minY, a.region.maxX, a.region.maxY].join(",")}]` : undefined,
            layers: a.layers === undefined ? undefined : typeof a.layers === "string" ? a.layers : a.layers.join(","),
            flip: a.flip ? "true" : undefined,
            net: a.nets?.length ? a.nets.join(",") : undefined,
            width: a.width,
            height: a.height,
          },
          [],
        );
        return a.image ? withPng(out, (d) => d.file) : out;
      },
    }),
    tool({
      name: "board_import",
      title: "Import a board",
      description:
        "Import a board file into a board folder: a KiCad board (.kicad_pcb, with the .kicad_pro and .kicad_dru beside it), Circuit JSON, or EasyEDA Pro when its importer is installed. A whole board needs an empty or new folder; it writes the board files, the netlist, the source's zone fill and an import record (so board_check can cross-check against the source with KiCad). Returns the import report: what was dropped or approximated and why, counts, and the coordinate offset. An importer that gives operations instead applies them to the board there as host import:<importer>. CHANGES FILES.",
      input: {
        source: z.string().describe("The file to import, absolute or relative to the folder the agent works in."),
        dir: DIR,
        format: z.string().optional().describe("The source format when its name does not say: kicad_pcb, circuit-json, epro2."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const source = await ctx.dir(a.source);
        const r = readCliJson(await ctx.cli(dir, cliArgs(["board", "import"], { kind: a.format }, [source, dir])));
        return r.ok ? { data: r.data } : failure(r.message, dir, r.code);
      },
    }),
    tool({
      name: "board_import_dxf",
      title: "Import the board outline from DXF",
      description:
        "Set a board's outline and cutouts from an ASCII DXF drawing (one outline.import_dxf operation). LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE are read (bulges become arcs); ends within the tolerance join into closed loops; the largest loop becomes the outline, centered on (0, 0), and the loops inside it replace the board's cutouts. Returns the reply and the report: entities read, loops, the outline (vertices, area in nm²), cutouts, what was skipped and why, open chains, and the units used. CHANGES FILES (the board's outline and cutouts). You act as agent:<your client name>.",
      input: {
        dir: DIR,
        path: z.string().describe("The .dxf file, absolute or relative to the folder the agent works in."),
        units: z.enum(["mm", "in", "auto"]).optional().describe("Drawing units (default auto: the file's $INSUNITS, else mm)."),
        layers: z.array(z.string()).optional().describe("DXF layer names to read (default: all)."),
        tolerance: z.number().int().positive().optional().describe("Join ends closer than this, nanometers (default 10000)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const file = await ctx.dir(a.path);
        return board(ctx, dir, "import-dxf", { as: boardActor(ctx).id, units: a.units, layers: a.layers?.length ? a.layers.join(",") : undefined, tolerance: a.tolerance }, [file]);
      },
    }),
    tool({
      name: "board_export_kicad",
      title: "Export the board to KiCad",
      description:
        "Write a board as a KiCad board: the .kicad_pcb at `out`, with the .kicad_pro (board setup minimums, net classes and their nets) and .kicad_dru (custom rules) beside it. Footprints with their pads, tracks and arcs, vias, zones with their fill, keep-outs as rule areas, the outline and cutouts, graphics and texts; coordinates go through the board's import record offset when it has one, objects the source gave one KiCad UUID share one again (unless uniqueIds), and the export is noted in the import record, so board_check with `kicad` set to the export cross-checks it with KiCad's DRC as it would the source. Returns the files written, counts, and the report: what was approximated or dropped and why. CHANGES FILES: it writes the export only, and notes it in the import record (the board is not changed).",
      input: {
        dir: DIR,
        out: z.string().describe("The .kicad_pcb file to write, absolute or relative to the folder the agent works in; the .kicad_pro and .kicad_dru go beside it (existing ones are overwritten)."),
        uniqueIds: z.boolean().optional().describe("Give every object its own UUID, even objects the source gave one UUID (default false: they share one again, as in the source)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        return board(ctx, dir, "export-kicad", { "unique-ids": a.uniqueIds ? "true" : undefined }, [await ctx.dir(a.out)]);
      },
    }),
    tool({
      name: "board_route",
      title: "Autoroute the board",
      description:
        "Run the autorouter on a board and return its scored proposal: status (proposed, rejected, unchanged, failed, cancelled) with the reasons, the current and candidate scores (open connections, errors, vias, track length in nm), each router stage (router, version, status, kept, reason, duration), the fallback when one ran (tscircuit's autorouter runs first, Freerouting as the fallback), the copper added, the locked-copper check, the nets still open, and what the routers could not express. Scope: every open net (default), some nets, or the open connections in a region (mm box). Each router run takes up to `budget` seconds (default 60). Without apply it writes nothing. With apply: true, a proposed result is applied step by step as each router (router:<id>), stopping at the first refusal, and every locked record is verified byte-identical afterwards (applied.locked); CHANGES THE BOARD (only with apply). A rejected or otherwise unproposed result is never applied. For a net that stays open, board_diagnose says why.",
      input: {
        dir: DIR,
        nets: z.array(z.string()).optional().describe("Route these nets only."),
        region: z.array(z.number()).length(4).optional().describe("Route the open connections in this box, millimeters: [x1, y1, x2, y2]."),
        budget: z.number().positive().max(3600).optional().describe("Seconds per router run (default 60)."),
        apply: z.boolean().optional().describe("Apply the proposal when its status is proposed (default false: report only)."),
        propose: z.boolean().optional().describe("Store a proposed result as board proposals (one per router run, one item per net, the scores kept) for a person to accept; changes nothing."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        if (a.nets?.length && a.region) return { data: { error: "give nets or region, not both (neither: every open net)" }, isError: true };
        if (a.apply && a.propose) return { data: { error: "give apply or propose, not both" }, isError: true };
        return board(ctx, dir, "route", { as: boardActor(ctx).id, nets: a.nets?.length ? a.nets.join(",") : undefined, region: a.region ? `[${a.region.map((v) => `${v}mm`).join(",")}]` : undefined, budget: a.budget, apply: a.apply ? "true" : undefined, propose: a.propose ? "true" : undefined }, []);
      },
    }),
    tool({
      name: "board_diagnose",
      title: "Why a net does not route",
      description:
        "Diagnose one net that does not route: the verdict (routes: it routes as is; rules: with only the fab floor and no-go areas it routes, so a rule above the floor blocks it; placement: even then it does not route, so the parts or a no-go area block it; connected: nothing of it is open; unknown: the budget ran out before the probe), a summary sentence, the open links diagnosed (only the net's missing connections; a net with a zone is left to its pour, and only the links its fill does not make are routed: pour), the router attempts, the probe run with the fab floor and no-go areas only, what blocks it (rules by tier), the rule areas by tier (outlines in nm), and relaxations (target rules for this net only) test-run on copies with their results (skipped says why one was not test-run). One time budget of `budget` seconds (default 8) covers the whole diagnosis; stopped lists what it cut. Answers are cached by the board content, net and options (cached: true). Writes nothing but that cache under .protoboard/build; a relaxation takes effect only if its rules (rule.set inputs) are then applied with board_apply, which is a design decision to confirm with the person first.",
      input: {
        dir: DIR,
        net: z.string().min(1).describe("The net name."),
        budget: z.number().positive().max(3600).optional().describe("Seconds for the whole diagnosis (default 8)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        return board(ctx, dir, "diagnose", { budget: a.budget }, [a.net]);
      },
    }),
    ...editingTools(),
  ];
  for (const s of specs) s.description = `${s.description} ${BOARD_NO_PROJECT_CODE}`;
  return specs;
}
