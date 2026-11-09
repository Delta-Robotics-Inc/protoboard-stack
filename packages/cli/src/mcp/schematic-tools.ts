/**
 * The schematic tools (PCB editor Phase 3): an agent's way to the schematic service, generated from the schematic
 * operation registry and the cleanup tools (`CLEANUP_TOOLS`), so their names, descriptions and inputs cannot drift
 * from them. Each runs the CLI's `protoboard schematic …` command, as every tool of this server runs the CLI, and
 * always as `agent:<client name>`: no tool takes an actor, so an agent never acts as a person. Write tools say
 * CHANGES FILES; every tool but the registry's loads the project for the circuit, so none of those is read-only.
 *
 * The CLI uses the schematic's running service when there is one (`protoboard schematic serve`), else it opens the
 * schematic for the one call (its circuit from the project's UHD) and saves what it changed. Undo history and leases
 * live in a running service.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CLEANUP_TOOLS, listOperations } from "@protoboardai/schematic";
import { agentActor } from "@protoboardai/board";
import { cliArgs, failure, readCliJson, RUNS_PROJECT_CODE, type ToolContext, type ToolOutcome, type ToolSpec } from "./tools.js";

const tool = <S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec => spec as unknown as ToolSpec;

/**
 * What the schematic tools' descriptions end with. The circuit comes from the project's UHD, so a tool that opens
 * the schematic (no service running) loads the project: it runs the project's code, and none is marked read-only
 * (PB-1048). The operation registry alone runs none. (A function: tools.ts imports this module, so its constant is
 * read when the tools are made, not when this module loads.)
 */
export const schematicRunsProjectCode = (): string => `It reads the circuit from the project's UHD. ${RUNS_PROJECT_CODE}`;
export const SCHEMATIC_NO_PROJECT_CODE = "Runs no project code: it reads only the schematic operation registry.";

const DIR = z.string().describe("The schematic folder, <module folder>/schematic beside the board's UHD file (it may not exist yet), absolute or relative to the folder the agent works in.");
const LEASE = z.number().int().optional().describe("The fencing token of your lease on this area, when you hold one (a running service grants leases).");
const GU_BOX = z.array(z.number()).length(4).describe("A box in grid units (1 gu = 2.54 mm, +Y down): [x0, y0, x1, y1].");

/** The schematic operations an agent may call: the registry's `all` audience. */
export const agentSchematicOperations = () => listOperations().filter((d) => d.audience === "all");

/** The actor every schematic tool acts as. */
export const schematicActor = (ctx: ToolContext) => agentActor(ctx.clientName?.() ?? "agent");

/** The CLI path of each cleanup tool: `protoboard schematic cleanup <dir> <sub>`. */
export const CLEANUP_SUBCOMMANDS: Record<(typeof CLEANUP_TOOLS)[number]["name"], string> = {
  schematic_list_defects: "list",
  schematic_propose_fixes: "propose",
  schematic_apply_fix: "apply",
  schematic_explain_defect: "explain",
  schematic_cleanup_pass: "pass",
};

/** Run `protoboard schematic <sub>` with a JSON value written to a scratch file when given. */
async function schematic(ctx: ToolContext, dir: string, sub: string[], options: Record<string, string | number | undefined>, positionals: string[], file?: unknown): Promise<ToolOutcome> {
  let scratch: string | undefined;
  try {
    const pos = [dir, ...positionals];
    if (file !== undefined) {
      scratch = mkdtempSync(join(tmpdir(), "protoboard-schematic-"));
      const f = join(scratch, `${sub.join("-")}.json`);
      writeFileSync(f, JSON.stringify(file), { mode: 0o600 });
      pos.push(f);
    }
    // the command's own words (cleanup's tool) come after the folder
    const [command, ...rest] = sub;
    const r = readCliJson(await ctx.cli(dir, cliArgs(["schematic", command], options, [pos[0], ...rest, ...pos.slice(1)])));
    return r.ok ? { data: r.data } : failure(r.message, dir, r.code);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

function withImage(out: ToolOutcome, file: string | undefined, mimeType: string): ToolOutcome {
  if (out.isError || !file || !existsSync(file)) return out;
  return { ...out, images: [{ data: readFileSync(file).toString("base64"), mimeType }] };
}

export function schematicTools(): ToolSpec[] {
  const ops = agentSchematicOperations();
  const names = ops.map((d) => d.name) as [string, ...string[]];
  const opList = ops.map((d) => `${d.name} (${d.title.toLowerCase()})`).join("; ");
  const cleanup = <N extends (typeof CLEANUP_TOOLS)[number]["name"]>(name: N) => CLEANUP_TOOLS.find((t) => t.name === name)! as Extract<(typeof CLEANUP_TOOLS)[number], { name: N }>;
  const specs: ToolSpec[] = [
    tool({
      name: "schematic_operations",
      title: "Schematic operations",
      description: `Every operation an agent can apply to a schematic, from the schematic's operation registry: name, title, description, an example on the sample schematic, and the JSON Schema of its input. Coordinates are integer grid units (1 gu = 2.54 mm), +Y down. The schematic draws the UHD circuit; nets change only in UHD. The operations: ${opList}. Writes nothing.`,
      input: { all: z.boolean().optional().describe("Also list the system operations (hosts, undo and recovery only; not open to agents).") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ all }, ctx) => {
        const dir = await ctx.dir();
        const r = readCliJson(await ctx.cli(dir, cliArgs(["schematic", "ops"], { all: all ? "true" : undefined })));
        return r.ok ? { data: r.data } : failure(r.message, dir, r.code);
      },
    }),
    tool({
      name: "schematic_apply",
      title: "Apply schematic operations",
      description: `Apply one transaction to a schematic: up to 200 operations, all or none, one undo step. Each op is { op, ...input } as schematic_operations describes (${names.length} operations: ${names.join(", ")}). New labels, power symbols, wires and text take a \`handle\`; the reply maps handles to ids. Pass expectSeq or expectVersions so a change made since you looked refuses your write. The reply: applied (seq, changed, created, removed, versions), valid (dryRun), refused (stale-seq, stale-versions, pinned, needs-person, leased, lease-revoked), or invalid (error and the op index). Pinned (hand-placed) items refuse agents; prefer proposal.add for a person's view. CHANGES FILES: the schematic's (saved at once when no service is running). You act as agent:<your client name>.`,
      input: {
        dir: DIR,
        ops: z.array(z.object({ op: z.enum(names) }).passthrough()).min(1).max(200).describe("The operations, each { op: <name>, ...its input }."),
        label: z.string().optional().describe("3 to 8 words saying what the transaction does (default: from the operations)."),
        batchId: z.string().optional().describe("Your id for this transaction; sending it again returns the first reply."),
        changeSet: z.object({ id: z.string(), title: z.string().optional() }).optional().describe("Groups transactions for review and revert."),
        expectSeq: z.number().int().optional().describe("The schematic seq your read saw."),
        expectEpoch: z.string().optional().describe("The epoch your read saw."),
        expectVersions: z.record(z.number().int()).optional().describe("Object id to the version you read (0: must not exist)."),
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
          ...(a.lease !== undefined ? { leaseToken: a.lease } : {}),
          ...(a.dryRun ? { dryRun: true } : {}),
        };
        return schematic(ctx, dir, ["apply"], { as: schematicActor(ctx).id }, [], tx);
      },
    }),
    tool({
      name: "schematic_inspect",
      title: "Schematic summary",
      description: "A schematic's summary: the board it draws (parts, nets), whether it is laid out and whether the layout is current with the UHD circuit, its cards with their members, counts of symbols, wires, labels and power symbols, the readability score and open gates, pinned items, leases, and the version (epoch and seq) to quote in schematic_apply's expectSeq. Writes nothing.",
      input: { dir: DIR },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir }, ctx) => schematic(ctx, await ctx.dir(dir), ["inspect"], {}, []),
    }),
    tool({
      name: "schematic_query",
      title: "Find schematic records",
      description: "Records of a schematic by id, by net (its wires, labels, power symbols and the symbols on it), by card (the card and what sits in it) or in a region, each with its box in grid units (+Y down), card and net, plus the stored records and their versions. Give exactly one of ids, net, card, region. Writes nothing.",
      input: {
        dir: DIR,
        ids: z.array(z.string()).optional().describe("Record ids (sym:<part path>, wire:…, lbl:…, pwr:…, card:…)."),
        net: z.string().optional().describe("A net name."),
        card: z.string().optional().describe("A card id (card:<key>)."),
        region: GU_BOX.optional(),
        kinds: z.array(z.string()).optional().describe("With region: only these kinds (symbol, wire, label, power, card, text, noconnect, frame)."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const given = [a.ids?.length ? 1 : 0, a.net ? 1 : 0, a.card ? 1 : 0, a.region ? 1 : 0].reduce((x, y) => x + y, 0);
        if (given !== 1) return { data: { error: "give exactly one of ids, net, card, region" }, isError: true };
        return schematic(ctx, dir, ["query"], { id: a.ids?.length ? a.ids.join(",") : undefined, net: a.net, card: a.card, region: a.region ? `[${a.region.join(",")}]` : undefined, kinds: a.kinds?.length ? a.kinds.join(",") : undefined }, []);
      },
    }),
    tool({
      name: "schematic_undo",
      title: "Undo your last schematic change",
      description: "Undo your own last transaction on the schematic (never a person's or another agent's). Refused (stale-undo) when something you changed was changed since. Undo history lives in a running schematic service (protoboard schematic serve). CHANGES FILES: the schematic's.",
      input: { dir: DIR, lease: LEASE },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async ({ dir, lease }, ctx) => schematic(ctx, await ctx.dir(dir), ["undo"], { as: schematicActor(ctx).id, lease }, []),
    }),
    tool({
      name: "schematic_redo",
      title: "Redo your last undone schematic change",
      description: "Redo your own last undone transaction, while nothing it touched changed since. Needs a running schematic service. CHANGES FILES: the schematic's.",
      input: { dir: DIR, lease: LEASE },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async ({ dir, lease }, ctx) => schematic(ctx, await ctx.dir(dir), ["redo"], { as: schematicActor(ctx).id, lease }, []),
    }),
    tool({
      name: "schematic_layout",
      title: "Lay out the schematic",
      description: "Run the automatic layout from the UHD circuit (layout.run) and save: every card, or the cards in scope; mode fresh places unpinned symbols anew, tidy keeps them and redraws the wiring; pinned items never move. A folder without a schematic gets its first layout. Returns the reply, the files saved and the score with its open gates. CHANGES FILES: the schematic's. You act as agent:<your client name>.",
      input: {
        dir: DIR,
        scope: z.array(z.string()).optional().describe("Card ids to lay out (default: all)."),
        mode: z.enum(["fresh", "tidy"]).optional(),
        sheet: z.enum(["keep", "repack"]).optional().describe("keep (default): cards laid out before stay; repack packs the sheet anew."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => schematic(ctx, await ctx.dir(a.dir), ["layout"], { as: schematicActor(ctx).id, scope: a.scope?.length ? a.scope.join(",") : undefined, mode: a.mode, sheet: a.sheet }, []),
    }),
    tool({
      name: "schematic_check",
      title: "Check the schematic",
      description: "The electrical checks on the UHD circuit (unconnected pins, single-pin nets, conflicting outputs, voltage with the path that explains it) in plain words with reference designators and pin names, and the readability gates still open on the sheet. Writes nothing.",
      input: { dir: DIR },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async ({ dir }, ctx) => schematic(ctx, await ctx.dir(dir), ["check"], {}, []),
    }),
    tool({
      name: "schematic_describe",
      title: "Describe the schematic for an agent",
      description: "The schematic scene: compact JSON made for an agent (sheet, cards with digests, parts with pins and neighbors, nets with their style per card, numbered defects and electrical findings; grid units, +Y down) and a matching image whose marker numbers match the JSON's. Focus on one card or one net, or none for the whole sheet. Returns the scene and the paths of the files it wrote under .protoboard/build; `image: true` also returns the PNG. Writes nothing but those derived files.",
      input: {
        dir: DIR,
        card: z.string().optional().describe("One card id (card:<key>), cropped with a halo."),
        net: z.string().optional().describe("One net highlighted, the rest faded."),
        image: z.boolean().optional().describe("Also return the PNG in the reply."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        if (a.card && a.net) return { data: { error: "give at most one of card, net" }, isError: true };
        const out = await schematic(ctx, dir, ["describe"], { card: a.card, net: a.net }, []);
        return a.image ? withImage(out, (out.data as { files?: { png?: string } } | undefined)?.files?.png, "image/png") : out;
      },
    }),
    tool({
      name: "schematic_render",
      title: "Render the schematic",
      description: "The sheet as SVG (dark, or the paper theme), and as a PNG when asked, under .protoboard/build/schematic/<key>/. Returns the paths; `image: true` also returns the PNG. For a description an agent reads, prefer schematic_describe. Writes nothing but those derived files.",
      input: { dir: DIR, theme: z.enum(["dark", "paper"]).optional(), image: z.boolean().optional().describe("Write a PNG too and return it in the reply.") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => {
        const dir = await ctx.dir(a.dir);
        const out = await schematic(ctx, dir, ["render"], { theme: a.theme, png: a.image ? "true" : undefined }, []);
        return a.image ? withImage(out, (out.data as { files?: { png?: string } } | undefined)?.files?.png, "image/png") : out;
      },
    }),
    // the cleanup tools: names, descriptions and inputs from CLEANUP_TOOLS (contract section 8.4)
    tool({
      name: "schematic_list_defects",
      title: "List schematic defects",
      description: `${cleanup("schematic_list_defects").description} Writes nothing.`,
      input: { dir: DIR, ...cleanup("schematic_list_defects").input.shape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => schematic(ctx, await ctx.dir(a.dir), ["cleanup", "list"], { card: a.card, rules: a.rules?.length ? a.rules.join(",") : undefined, "include-info": a.includeInfo ? "true" : undefined, limit: a.limit }, []),
    }),
    tool({
      name: "schematic_propose_fixes",
      title: "Propose fixes for a defect",
      description: `${cleanup("schematic_propose_fixes").description} Writes nothing.`,
      input: { dir: DIR, ...cleanup("schematic_propose_fixes").input.shape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => schematic(ctx, await ctx.dir(a.dir), ["cleanup", "propose", String(a.defect)], { max: a.max }, []),
    }),
    tool({
      name: "schematic_apply_fix",
      title: "Apply a proposed fix",
      description: `${cleanup("schematic_apply_fix").description} CHANGES FILES: the schematic's. You act as agent:<your client name>.`,
      input: { dir: DIR, ...cleanup("schematic_apply_fix").input.shape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => schematic(ctx, await ctx.dir(a.dir), ["cleanup", "apply"], { as: schematicActor(ctx).id }, [], { title: a.title, ops: a.ops, ...(a.changeSet ? { changeSet: a.changeSet } : {}) }),
    }),
    tool({
      name: "schematic_explain_defect",
      title: "Explain a defect",
      description: `${cleanup("schematic_explain_defect").description} Writes nothing.`,
      input: { dir: DIR, ...cleanup("schematic_explain_defect").input.shape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      handler: async (a, ctx) => schematic(ctx, await ctx.dir(a.dir), ["cleanup", "explain", String(a.defect)], {}, []),
    }),
    tool({
      name: "schematic_cleanup_pass",
      title: "Clean up the schematic",
      description: `${cleanup("schematic_cleanup_pass").description} CHANGES FILES: the schematic's. You act as agent:<your client name>.`,
      input: { dir: DIR, ...cleanup("schematic_cleanup_pass").input.shape },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      handler: async (a, ctx) => schematic(ctx, await ctx.dir(a.dir), ["cleanup", "pass"], { as: schematicActor(ctx).id, budget: a.budget, "max-passes": a.maxPasses }, []),
    }),
  ];
  for (const s of specs) s.description = `${s.description} ${s.name === "schematic_operations" ? SCHEMATIC_NO_PROJECT_CODE : schematicRunsProjectCode()}`;
  return specs;
}
