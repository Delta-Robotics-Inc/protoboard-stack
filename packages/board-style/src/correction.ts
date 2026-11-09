/**
 * "I'd rather it look like this": the mechanical half. The agent interprets the user's words as token changes; this
 * checks them (unknown tokens, values, electrical tokens that never change for looks), lets the guard rails act
 * (a text height under the fab floor is kept at the floor, and the decision says so), restyles a scratch copy of the
 * board with the new values, renders before and after, and either asks for the scope or, given one, writes the
 * decision and the token values into that layer. The real board is not touched: the change sets come back for the
 * agent to propose.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical, sha1Hex, type BoardDocument } from "@protoboardai/board";
import type { StyleChangeSet } from "./changeset.js";
import { recordDecision, type RecordDecisionResult } from "./decisions.js";
import type { Scope } from "./paths.js";
import { renderPng } from "./render.js";
import { resolveStyle, type ResolvedStyle, type ResolveOptions } from "./resolve.js";
import { planRestyle, type RestyleOptions } from "./restyle.js";
import { checkTokenValue, tokenDef, type TokenValue } from "./tokens.js";

export interface CorrectionContext {
  doc: BoardDocument;
  /** How the board's style resolves (board folder, project, user folder). */
  resolve?: ResolveOptions;
  /** Where the before and after images go (required to write them). */
  evidenceDir?: string;
  /** File name stem for the images (default: a hash of the change). */
  name?: string;
  /** The scope; absent: the call returns `needs-scope` with the question and the renders. */
  scope?: Scope;
  /** Allow changes to electrical tokens (the user asked for an electrical change, not a look). */
  allowElectrical?: boolean;
  /** A rule that is not a token, recorded with the decision. */
  rule?: string;
  source?: string;
  date?: string;
  restyle?: RestyleOptions;
  /** Image width in pixels (default 900). */
  width?: number;
}

export interface CorrectionResult {
  status: "needs-scope" | "recorded" | "refused";
  /** Why it was refused. */
  errors: string[];
  /** Guard rails that acted (values kept at a fab floor). */
  guards: string[];
  question?: string;
  choices?: Scope[];
  before: { top?: string; bottom?: string };
  after: { top?: string; bottom?: string };
  /** The restyle with the new values, for the agent to propose on the real board. */
  changeSets: StyleChangeSet[];
  style?: ResolvedStyle;
  decision?: RecordDecisionResult;
}

/** Apply a correction: `text` is the user's words verbatim, `changes` the agent's reading of them as tokens. */
export function applyCorrection(text: string, changes: { path: string; to: TokenValue }[], ctx: CorrectionContext): CorrectionResult {
  const errors: string[] = [];
  if (!text.trim()) errors.push("the user's words are required");
  if (!changes.length && !ctx.rule) errors.push("no token changes and no rule: restate the words as token changes first");
  for (const c of changes) {
    const def = tokenDef(c.path);
    if (!def) {
      errors.push(`unknown token ${c.path}`);
      continue;
    }
    const why = checkTokenValue(c.path, c.to);
    if (why) errors.push(why);
    if (def.class === "electrical" && !ctx.allowElectrical) errors.push(`${c.path} is electrical: it never changes for looks (pass allowElectrical when the user asked for the electrical change itself)`);
  }
  const empty = { before: {}, after: {}, changeSets: [] as StyleChangeSet[] };
  if (errors.length) return { status: "refused", errors, guards: [], ...empty };
  const before = resolveStyle(ctx.doc, ctx.resolve ?? {});
  const overrides = Object.fromEntries(changes.map((c) => [c.path, c.to]));
  const after = resolveStyle(ctx.doc, { ...(ctx.resolve ?? {}), overrides: { ...(ctx.resolve?.overrides ?? {}), ...overrides } });
  const guards = changes.filter((c) => after.tokens[c.path].clamp).map((c) => `${c.path}: ${after.tokens[c.path].clamp!.reason}; kept at ${canonical(after.tokens[c.path].effective)}`);
  // the board after: each tool updates what it drew before with the new values (on a scratch copy)
  const plan = planRestyle(ctx.doc, after, ctx.restyle ?? {});
  const result: CorrectionResult = { status: "needs-scope", errors: [], guards, before: {}, after: {}, changeSets: plan.steps.filter((s) => !s.empty), style: after };
  if (ctx.evidenceDir) {
    mkdirSync(ctx.evidenceDir, { recursive: true });
    const stem = ctx.name ?? `correction-${sha1Hex(canonical(changes)).slice(0, 8)}`;
    const w = ctx.width ?? 900;
    for (const side of ["top", "bottom"] as const) {
      const b = join(ctx.evidenceDir, `${stem}-before-${side}.png`);
      const a = join(ctx.evidenceDir, `${stem}-after-${side}.png`);
      writeFileSync(b, renderPng(ctx.doc, before, { side, width: w, caption: `before: ${before.theme.name}, ${side}` }));
      writeFileSync(a, renderPng(plan.doc, after, { side, width: w, caption: `after, ${side}` }));
      result.before[side] = b;
      result.after[side] = a;
    }
  }
  if (!ctx.scope) {
    result.question = "Apply this to this board, this project, or all your boards?";
    result.choices = ["board", "project", "user"];
    return result;
  }
  const evidence = [result.before.top, result.before.bottom, result.after.top, result.after.bottom].filter((x): x is string => !!x);
  result.decision = recordDecision(after.places, {
    said: text,
    tokens: changes,
    scope: ctx.scope,
    evidence,
    ...(guards.length ? { guards } : {}),
    ...(ctx.rule ? { rule: ctx.rule } : {}),
    ...(ctx.source ? { source: ctx.source } : {}),
    ...(ctx.date ? { date: ctx.date } : {}),
  });
  result.status = "recorded";
  result.style = resolveStyle(ctx.doc, ctx.resolve ?? {});
  return result;
}
