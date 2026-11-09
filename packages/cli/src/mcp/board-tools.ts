/**
 * The board tools (PCB editor Phase 1): an agent's way to the board service, generated from the operation
 * registry so their descriptions and the operation names they accept cannot drift from it. Each runs the CLI's
 * `protoboard board …` command, as every tool of this server runs the CLI, and always as `agent:<client name>`:
 * no tool takes an actor, so an agent can never act as a person.
 *
 * The CLI uses the board's running service when there is one (`protoboard board serve`), else it opens the board
 * for the one call and saves what it changed. Undo history, leases and presence live in a running service.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
        `Apply one transaction to a board: up to 200 operations, all or none. Each op is { op, ...input } as board_operations describes (${names.length} operations: ${names.join(", ")}). New copper, zones and keep-outs take a \`handle\`; the reply maps handles to ids, and later ops may refer to "$<handle>". Pass expectSeq (the seq you read) or expectVersions so a change made since you looked refuses your write instead of overwriting it. The reply: applied (seq, changed, created, removed, versions), valid (dryRun), refused (reason: stale-seq, stale-versions, locked, leased, lease-revoked, needs-person, with what you missed), or invalid (error and the op index). Locked objects are refused for agents; changes to nets need a person. CHANGES THE BOARD (saved at once when no service is running; else on the service's save). You act as agent:<your client name>.`,
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
        return board(ctx, dir, "apply", { as: boardActor(ctx).id }, [], tx);
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
  ];
  for (const s of specs) s.description = `${s.description} ${BOARD_NO_PROJECT_CODE}`;
  return specs;
}
