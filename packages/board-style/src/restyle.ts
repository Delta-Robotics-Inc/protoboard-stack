/**
 * A whole restyle: the drawing tools in their order (frames, hazard zones, nameplate, the edge ring, marks, then
 * designators, which avoid everything drawn before them), each computed on the board as the earlier ones leave it.
 * Planning runs on a scratch copy; the change sets apply to the real board in the same order (each tool edits only
 * its own records, so the order is all they need).
 */
import type { BoardDocument } from "@protoboardai/board";
import { applyStyleChange, RESTYLE_ORDER, scratchService, type StyleChangeSet, type StyleTool } from "./changeset.js";
import type { ResolvedStyle } from "./resolve.js";
import { styleDesignators, type DesignatorOptions } from "./tools/designators.js";
import { styleEdgeText, type EdgeTextOptions } from "./tools/edge-text.js";
import { styleFrames, type FramesOptions } from "./tools/frames.js";
import { styleHazard, type HazardOptions } from "./tools/hazard.js";
import { styleMarks, type MarksOptions } from "./tools/marks.js";
import { styleNameplate, type NameplateOptions } from "./tools/nameplate.js";

export { RESTYLE_ORDER };

export interface RestyleOptions {
  tools?: StyleTool[];
  frames?: FramesOptions;
  hazard?: HazardOptions;
  nameplate?: NameplateOptions;
  marks?: MarksOptions;
  edgeText?: EdgeTextOptions;
  designators?: DesignatorOptions;
  force?: boolean;
}

/** Run one drawing tool. */
export function runStyleTool(tool: StyleTool, doc: BoardDocument, style: ResolvedStyle, o: RestyleOptions = {}): StyleChangeSet {
  const f = o.force ? { force: true } : {};
  switch (tool) {
    case "frames":
      return styleFrames(doc, style, { ...o.frames, ...f });
    case "hazard":
      return styleHazard(doc, style, { ...o.hazard, ...f });
    case "nameplate":
      return styleNameplate(doc, style, { ...o.nameplate, ...f });
    case "marks":
      return styleMarks(doc, style, { ...o.marks, ...f });
    case "edgeText":
      return styleEdgeText(doc, style, { ...o.edgeText, ...f });
    case "designators":
      return styleDesignators(doc, style, { ...o.designators, ...f });
    default:
      throw new Error(`${tool} is not a drawing tool (alignParts runs only on request)`);
  }
}

/** Plan a restyle: every change set in order, and the board as it would be after all of them. */
export function planRestyle(doc: BoardDocument, style: ResolvedStyle, o: RestyleOptions = {}): { steps: StyleChangeSet[]; doc: BoardDocument; failed?: { tool: StyleTool; reply: unknown } } {
  const svc = scratchService(doc);
  const steps: StyleChangeSet[] = [];
  for (const tool of o.tools ?? RESTYLE_ORDER) {
    const cs = runStyleTool(tool, svc.snapshot().doc, style, o);
    steps.push(cs);
    if (cs.empty) continue;
    const r = applyStyleChange(svc, cs);
    if (r.status !== "applied") return { steps, doc: svc.snapshot().doc, failed: { tool, reply: r } };
  }
  return { steps, doc: svc.snapshot().doc };
}
