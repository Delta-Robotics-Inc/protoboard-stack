/**
 * @protoboardai/board-edit: the interactive editing kernel of Protoboard's PCB editor (contract
 * docs/specs/pcb-editor/phase2-editing.md, sections 7 and 8). Browser-safe: it imports only
 * `@protoboardai/board/browser`. Live checks, diagnosis and router proposals are in `@protoboardai/board-edit/service`.
 *
 *   const kernel = createEditKernel(snapshot);
 *   const s = kernel.startRoute({ from: { pad: "pad:status/r1:1" } });
 *   s.move(cursor); s.click(); s.changeLayer(); const { tx } = s.finish();   // then service.apply(tx, person)
 */
export { createEditKernel, STEP_BUDGET_MS, type EditKernel, type KernelSnapshot } from "./kernel.js";
export { RouteSession, WalkaroundPlanner, highlightPlan, type CopperRef, type DraftPoint, type HeadPlan, type HeadPlanner, type PlanInput, type Pt, type RouteCandidate, type RouteFinish, type RouteOptions, type RouteStart } from "./route.js";
export { DragSession, type DragCandidate, type DragStart } from "./drag.js";
export { RouteWorld, type LayerContext, type Slack } from "./world.js";
export { RuleResolver, EDIT_DEFAULTS, type Resolved } from "./rules.js";
