/**
 * The public tool surface for the CLI and MCP bindings: one entry per tool with its name, title, description, input
 * schema (zod; MCP uses `input.shape`), what it may change, and a handler. Drawing tools return change sets and never
 * write the board: the binding proposes them (`proposeStyleChange`) for a person to accept. Tools marked `files`
 * write style files (decisions, layer tokens, STYLE.md, examples index, asset registry), never board files.
 */
import { z } from "zod";
import { type BoardDocument } from "@protoboardai/board";
import { loadAssets, registerAsset } from "./assets.js";
import { removeStyle, STYLE_TOOLS } from "./changeset.js";
import { checkStyle } from "./check.js";
import { applyCorrection } from "./correction.js";
import { listDecisions, promoteDecision, promotionCandidates, recordDecision } from "./decisions.js";
import { exampleDirs, indexExamples, searchExamples } from "./examples.js";
import { styleGuide, writeStyleGuide } from "./guide.js";
import { renderAsBuilt } from "./render.js";
import { explainToken, resolveStyle, type ResolveOptions } from "./resolve.js";
import { planRestyle, runStyleTool } from "./restyle.js";
import { shippedTheme, shippedThemeIds } from "./theme.js";
import { alignParts } from "./tools/align.js";
import { HAZARD_KINDS, TOKENS } from "./tokens.js";

export interface StyleApiContext {
  doc: BoardDocument;
  boardDir?: string;
  projectRoot?: string;
  userDir?: string | false;
}

export interface StyleApiTool<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** MCP tool name; the CLI command is `protoboard board style <cli>`. */
  name: string;
  cli: string;
  title: string;
  description: string;
  /** none: read only; proposes: returns change sets for a proposal; files: writes style files (never board files). */
  changes: "none" | "proposes" | "files";
  input: I;
  run(input: z.infer<I>, ctx: StyleApiContext): unknown;
}

const Theme = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).optional().describe("Preview another shipped theme instead of the board's own");
const Scope = z.enum(["board", "project", "user"]);
const TokenChange = z.object({ path: z.string(), to: z.unknown() }).strict();
const Force = z.boolean().optional().describe("Redraw records a person edited by hand (default: keep them and report)");

const ro = (ctx: StyleApiContext, theme?: string): ResolveOptions => ({ ...(ctx.boardDir ? { boardDir: ctx.boardDir } : {}), ...(ctx.projectRoot ? { projectRoot: ctx.projectRoot } : {}), ...(ctx.userDir !== undefined ? { userDir: ctx.userDir } : {}), ...(theme ? { theme } : {}) });
const style = (ctx: StyleApiContext, theme?: string) => resolveStyle(ctx.doc, ro(ctx, theme));

const drawTool = (name: string, cli: string, tool: (typeof STYLE_TOOLS)[number], title: string, description: string, extra: z.ZodRawShape = {}): StyleApiTool => {
  const input = z.object({ theme: Theme, force: Force, ...extra }).strict();
  return {
    name,
    cli,
    title,
    description: `${description} Returns a change set to propose (ordinary operations, plus host operations when footprint texts move); re-running updates what it drew before.`,
    changes: "proposes",
    input,
    run: (i: z.infer<typeof input>, ctx) => {
      const { theme, force, ...rest } = i as { theme?: string; force?: boolean } & Record<string, unknown>;
      return runStyleTool(tool, ctx.doc, style(ctx, theme), { ...(force ? { force } : {}), [tool]: rest });
    },
  };
};

/** Every style tool, for binding. */
export const STYLE_API: StyleApiTool[] = [
  {
    name: "style_themes",
    cli: "themes",
    title: "List board themes",
    description: "The shipped board themes (id, name, what each looks like) and the tokens a theme can set.",
    changes: "none",
    input: z.object({ tokens: z.boolean().optional().describe("Also list every token with its class, type and guard") }).strict(),
    run: (i: { tokens?: boolean }) => ({ themes: shippedThemeIds().map((id) => ({ id, name: shippedTheme(id).name, extends: shippedTheme(id).extends, description: shippedTheme(id).description })), ...(i.tokens ? { tokens: TOKENS } : {}) }),
  },
  {
    name: "style_resolve",
    cli: "resolve",
    title: "Resolve the board's style",
    description: "Every token's value for this board through the cascade (default, shipped theme, user, project, board), with the layer and decision that set it, effective values after fab floors, and the guard rails tripped.",
    changes: "none",
    input: z.object({ theme: Theme, class: z.enum(["cosmetic", "fab", "electrical", "placement"]).optional() }).strict(),
    run: (i: { theme?: string; class?: string }, ctx) => {
      const s = style(ctx, i.theme);
      return { theme: s.theme, fab: s.fab.name, derived: s.derived, guards: s.guards, tokens: Object.values(s.tokens).filter((t) => !i.class || t.class === i.class) };
    },
  },
  {
    name: "style_explain",
    cli: "explain",
    title: "Explain a style token",
    description: "Why a token has its value: each layer that set it, the decision, the guard rail and what it did.",
    changes: "none",
    input: z.object({ path: z.string().describe("Token path, for example frame.style"), theme: Theme }).strict(),
    run: (i: { path: string; theme?: string }, ctx) => explainToken(style(ctx, i.theme), i.path),
  },
  {
    name: "style_check",
    cli: "check",
    title: "Check the board's style",
    description: "Drift from the resolved theme as findings that never block (style.*), and fab guard rails (style.fab.*) that are errors where they are real fab limits.",
    changes: "none",
    input: z.object({ theme: Theme, rev: z.string().optional(), date: z.string().optional(), openHardware: z.boolean().optional(), fab: z.object({ maskTop: z.string().optional(), maskBottom: z.string().optional(), silkTop: z.string().optional(), silkBottom: z.string().optional(), finish: z.string().optional() }).strict().optional() }).strict(),
    run: (i: { theme?: string; rev?: string; date?: string; openHardware?: boolean; fab?: Record<string, string> }, ctx) =>
      checkStyle(ctx.doc, style(ctx, i.theme), { nameplate: { ...(i.rev ? { rev: i.rev } : {}), ...(i.date ? { date: i.date } : {}) }, marks: { ...(i.openHardware ? { openHardware: true } : {}) }, ...(i.fab ? { fab: i.fab } : {}) }),
  },
  {
    name: "style_restyle",
    cli: "restyle",
    title: "Plan a whole restyle",
    description: "Every drawing tool in order (frames, hazard, nameplate, edge ring, marks, designators), each planned on the board as the earlier ones leave it. Returns the change sets to propose in that order.",
    changes: "proposes",
    input: z.object({ theme: Theme, rev: z.string().optional(), date: z.string().optional(), openHardware: z.boolean().optional(), force: Force }).strict(),
    run: (i: { theme?: string; rev?: string; date?: string; openHardware?: boolean; force?: boolean }, ctx) =>
      planRestyle(ctx.doc, style(ctx, i.theme), { nameplate: { ...(i.rev ? { rev: i.rev } : {}), ...(i.date ? { date: i.date } : {}) }, marks: { ...(i.openHardware ? { openHardware: true } : {}) }, ...(i.force ? { force: true } : {}) }).steps,
  },
  drawTool("style_frames", "frames", "frames", "Draw group frames", "Frames around each UHD group's parts with knockout or plain titles, in the theme's corner style, clear of pads, other parts and the edge.", { titles: z.record(z.string()).optional().describe("Titles by group key") }),
  drawTool("style_designators", "designators", "designators", "Place designators by policy", "Shows the designators the theme's policy wants (all, bench-needed, none) where they clear pads, vias, silk and parts, reading horizontally or bottom-up; the rest leave the silkscreen.", { show: z.array(z.string()).optional(), hide: z.array(z.string()).optional() }),
  drawTool("style_nameplate", "nameplate", "nameplate", "Place the nameplate", "The board name and revision (and date when the theme asks) as a tag or plain text with the theme's decor, at the free spot nearest the board's center on the theme's side.", { rev: z.string().optional(), date: z.string().optional().describe("YYYY-MM-DD; never taken from the clock"), name: z.string().optional() }),
  drawTool("style_hazard", "hazard", "hazard", "Stripe hazard zones", "The theme's one stripe pattern on declared no-go keep-outs of the kinds it lists, with a knockout tag, clear of pads.", { kinds: z.record(z.enum(HAZARD_KINDS)).optional().describe("Hazard kind by keep-out id") }),
  drawTool("style_edge_text", "edge-text", "edgeText", "Lay text along the edge", "The theme's edge text runs along the outline, sliding around pads and parts, on straight or curved outlines.", { vars: z.record(z.string()).optional() }),
  drawTool("style_marks", "marks", "marks", "Place logos and marks", "Maker, company, open hardware (when released as such) and easter egg marks from the asset registry within their size limits, and the motto; per brand mode.", { openHardware: z.boolean().optional(), allowUnresolved: z.boolean().optional() }),
  {
    name: "style_align",
    cli: "align",
    title: "Align parts (on request)",
    description: "Only when the user asks: snap parts to the placement grid and line up rows, before routing unless told otherwise; moves that lengthen a critical net past the limit are reported and not made. Returns a change set of footprint moves to propose.",
    changes: "proposes",
    input: z.object({ ids: z.array(z.string()).optional(), group: z.string().optional(), afterRouting: z.boolean().optional(), force: z.boolean().optional(), theme: Theme }).strict(),
    run: (i: { ids?: string[]; group?: string; afterRouting?: boolean; force?: boolean; theme?: string }, ctx) => {
      const { theme, ...rest } = i;
      return alignParts(ctx.doc, style(ctx, theme), rest);
    },
  },
  {
    name: "style_remove",
    cli: "remove",
    title: "Remove style drawing",
    description: "A change set removing everything one style tool (or all of them) drew, putting footprint designators back on the silkscreen.",
    changes: "proposes",
    input: z.object({ tool: z.enum(["frames", "hazard", "nameplate", "marks", "edgeText", "designators"]).optional() }).strict(),
    run: (i: { tool?: (typeof STYLE_TOOLS)[number] }, ctx) => removeStyle(ctx.doc, i.tool),
  },
  {
    name: "style_render",
    cli: "render",
    title: "Render the board as built",
    description: "An SVG of one side as the fab makes it in the theme's colors (bottom seen from below).",
    changes: "none",
    input: z.object({ side: z.enum(["top", "bottom"]), theme: Theme }).strict(),
    run: (i: { side: "top" | "bottom"; theme?: string }, ctx) => renderAsBuilt(ctx.doc, style(ctx, i.theme), { side: i.side }),
  },
  {
    name: "style_correct",
    cli: "correct",
    title: "Apply a style correction",
    description:
      "The mechanical half of \"I'd rather it look like this\": give the user's words verbatim and your reading of them as token changes. It refuses electrical tokens changed for looks, lets fab floors act, restyles a copy, renders before and after, and without a scope asks which one; with a scope it records the decision and writes the tokens into that layer.",
    changes: "files",
    input: z.object({ said: z.string().min(1), changes: z.array(TokenChange), scope: Scope.optional(), evidenceDir: z.string().optional(), rule: z.string().optional(), date: z.string().optional(), allowElectrical: z.boolean().optional() }).strict(),
    run: (i: { said: string; changes: { path: string; to: unknown }[]; scope?: "board" | "project" | "user"; evidenceDir?: string; rule?: string; date?: string; allowElectrical?: boolean }, ctx) => {
      const r = applyCorrection(i.said, i.changes as never, { doc: ctx.doc, resolve: ro(ctx), ...(i.scope ? { scope: i.scope } : {}), ...(i.evidenceDir ? { evidenceDir: i.evidenceDir } : {}), ...(i.rule ? { rule: i.rule } : {}), ...(i.date ? { date: i.date } : {}), ...(i.allowElectrical ? { allowElectrical: true } : {}) });
      const { style: _s, ...rest } = r;
      return rest;
    },
  },
  {
    name: "style_decisions",
    cli: "decisions",
    title: "List style decisions",
    description: "The decisions log (user, project and this board's), oldest first, with superseded ones marked, and project changes made twice that could be promoted to the user layer.",
    changes: "none",
    input: z.object({ scope: Scope.optional(), token: z.string().optional() }).strict(),
    run: (i: { scope?: "board" | "project" | "user"; token?: string }, ctx) => {
      const s = style(ctx);
      return { decisions: listDecisions(s.places, { ...(i.scope ? { scope: i.scope } : {}), ...(i.token ? { token: i.token } : {}), ...(s.places.board ? { board: s.places.board.key } : {}) }), promotion: promotionCandidates(s.places) };
    },
  },
  {
    name: "style_record_decision",
    cli: "decide",
    title: "Record a style decision",
    description: "Append a decision (the user's words, token changes, scope, evidence images, an optional rule) to the scope's log and write the tokens into its layer. Use style_correct to get the renders first.",
    changes: "files",
    input: z.object({ said: z.string().min(1), tokens: z.array(TokenChange), scope: Scope, evidence: z.array(z.string()).optional(), rule: z.string().optional(), date: z.string().optional() }).strict(),
    run: (i: { said: string; tokens: { path: string; to: unknown }[]; scope: "board" | "project" | "user"; evidence?: string[]; rule?: string; date?: string }, ctx) =>
      recordDecision(style(ctx).places, { said: i.said, tokens: i.tokens as never, scope: i.scope, ...(i.evidence ? { evidence: i.evidence } : {}), ...(i.rule ? { rule: i.rule } : {}), ...(i.date ? { date: i.date } : {}) }),
  },
  {
    name: "style_promote",
    cli: "promote",
    title: "Promote a decision to the user layer",
    description: "After the person approves: record a project change made twice as a user decision for all their boards.",
    changes: "files",
    input: z.object({ path: z.string(), said: z.string().min(1), date: z.string().optional() }).strict(),
    run: (i: { path: string; said: string; date?: string }, ctx) => {
      const s = style(ctx);
      const c = promotionCandidates(s.places).find((x) => x.path === i.path);
      if (!c) return { status: "none", message: `no project change to ${i.path} was made twice` };
      return promoteDecision(s.places, c, { said: i.said, ...(i.date ? { date: i.date } : {}) });
    },
  },
  {
    name: "style_guide",
    cli: "guide",
    title: "Write STYLE.md",
    description: "Generate the agent-facing style guide from the resolved theme, decisions, examples and assets (written to the project's style folder, or returned).",
    changes: "files",
    input: z.object({ write: z.boolean().optional() }).strict(),
    run: (i: { write?: boolean }, ctx) => (i.write ? { file: writeStyleGuide(style(ctx)) } : { text: styleGuide(style(ctx)) }),
  },
  {
    name: "style_examples",
    cli: "examples",
    title: "Search style examples",
    description: "Example images with captions (theme, user and project folders) by tag or words; with reindex, rewrites each folder's index.json.",
    changes: "none",
    input: z.object({ tags: z.array(z.string()).optional(), text: z.string().optional(), reindex: z.boolean().optional() }).strict(),
    run: (i: { tags?: string[]; text?: string; reindex?: boolean }, ctx) => {
      const s = style(ctx);
      const dirs = exampleDirs(s.theme.id, s.places);
      if (i.reindex) for (const d of dirs.filter((x) => x.layer !== "shipped")) indexExamples(d.dir);
      return searchExamples(dirs, { ...(i.tags ? { tags: i.tags } : {}), ...(i.text ? { text: i.text } : {}) });
    },
  },
  {
    name: "style_assets",
    cli: "assets",
    title: "List style assets",
    description: "The asset registry (shipped placeholders, the user's and the project's marks): file, hash check, source, license, status.",
    changes: "none",
    input: z.object({}).strict(),
    run: (_i: Record<string, never>, ctx) => [...loadAssets(style(ctx).places).values()].map((a) => ({ ...a.entry, layer: a.layer, verified: a.verified })),
  },
  {
    name: "style_register_asset",
    cli: "register-asset",
    title: "Register a logo or mark",
    description: "Copy a polygon asset file into the user's or project's asset folder with its hash, source and license (unknown license: unresolved, never drawn by default).",
    changes: "files",
    input: z.object({ scope: z.enum(["project", "user"]), id: z.string(), kind: z.enum(["maker", "company", "oshw", "easterEgg", "icon"]), path: z.string(), source: z.string().min(1), license: z.string(), traced: z.boolean().optional() }).strict(),
    run: (i: { scope: "project" | "user"; id: string; kind: "maker" | "company" | "oshw" | "easterEgg" | "icon"; path: string; source: string; license: string; traced?: boolean }, ctx) => {
      const p = style(ctx).places;
      const dir = i.scope === "user" ? p.user?.assets : p.project?.assets;
      if (!dir) throw new Error(`no ${i.scope} style folder`);
      return registerAsset(dir, { id: i.id, kind: i.kind, path: i.path, source: i.source, license: i.license, ...(i.traced ? { traced: true } : {}) });
    },
  },
];

/** One tool by name. */
export const styleApiTool = (name: string): StyleApiTool | undefined => STYLE_API.find((t) => t.name === name);
