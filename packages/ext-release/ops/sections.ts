/**
 * The release's own contributions to each section (package:<section>), from
 * the model and the collected files. Other extensions declare the same
 * operation ids to add to a section. `protoboard release` calls them once
 * per unit with a SectionContext; run on their own they only say so.
 */
import type { OperationResult } from "@protoboardai/core";
import { BASELINE } from "../lib/sections/baseline.ts";
import type { SectionContext, SectionFn } from "../lib/types.ts";

const section =
  (id: string): SectionFn =>
  (ctx) =>
    "unit" in ctx && ctx.unit
      ? BASELINE[id](ctx)
      : ({ status: "failed", summary: `package:${id} contributes to the Manufacturing Package once per unit; run \`protoboard release\`` } as OperationResult as never);

export const spec = section("spec");
export const bom = section("bom");
export const workOrder = section("work-order");
export const assembly = section("assembly");
export const testPlan = section("test-plan");
export type { SectionContext };
