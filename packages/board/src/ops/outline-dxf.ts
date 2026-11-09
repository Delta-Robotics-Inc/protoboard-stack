/** outline.import_dxf: the board outline and cutouts from a DXF drawing (Phase 2 contract, section 2.2). */
import { z } from "zod";
import { recordsOfKind } from "../document.js";
import { DxfError, dxfOutline } from "../dxf.js";
import { PositiveNm, type CutoutRec, type OutlineRec } from "../schema.js";
import { change, edited, OpError, registerOperation } from "./registry.js";

/** A tiny drawing for the example: a 40 x 30 mm rounded rectangle (1 mm corners, bulges) with one 3.2 mm hole. */
const EXAMPLE_DXF = [
  "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LWPOLYLINE", "8", "OUTLINE", "90", "8", "70", "1",
  "10", "-19", "20", "-15", "42", "0",
  "10", "19", "20", "-15", "42", "0.41421356237",
  "10", "20", "20", "-14", "42", "0",
  "10", "20", "20", "14", "42", "0.41421356237",
  "10", "19", "20", "15", "42", "0",
  "10", "-19", "20", "15", "42", "0.41421356237",
  "10", "-20", "20", "14", "42", "0",
  "10", "-20", "20", "-14", "42", "0.41421356237",
  "0", "CIRCLE", "8", "OUTLINE", "10", "-17", "20", "-12", "40", "1.6",
  "0", "ENDSEC", "0", "EOF",
].join("\n") + "\n";

registerOperation({
  name: "outline.import_dxf",
  title: "Import the outline from DXF",
  description:
    "Set the board outline and cutouts from an ASCII DXF drawing (the file's text in `dxf`). LINE, ARC, CIRCLE, LWPOLYLINE and POLYLINE are read (bulges become arcs); ends within `tolerance` nanometers (default 10000) join into closed loops. The largest loop is the outline; loops inside it replace the board's cutouts (ids cutout:dxf.1, .2, ... by decreasing area). `units`: mm, in, or auto ($INSUNITS, else mm). `layers` limits the DXF layers read. `origin` center (default) moves the outline's box center to (0, 0). A CAD-driven outline only changes with detach: true. The report lists what was skipped and why.",
  input: z
    .object({
      dxf: z.string().min(1).max(5_000_000),
      units: z.enum(["mm", "in", "auto"]).optional(),
      layers: z.array(z.string().min(1).max(255)).min(1).max(1000).optional(),
      tolerance: PositiveNm.optional(),
      origin: z.enum(["center", "keep"]).optional(),
      cutouts: z.boolean().optional(),
      detach: z.boolean().optional(),
    })
    .strict(),
  audience: "all",
  phase: 2,
  example: { dxf: EXAMPLE_DXF },
  apply(doc, input, ctx) {
    const old = doc.records.get("outline") as OutlineRec | undefined;
    if (old && old.source.kind === "cad" && !input.detach) throw new OpError(`the outline is driven by CAD (${old.source.ref}); pass detach: true to take it over here`);
    let read;
    try {
      read = dxfOutline(input.dxf, { units: input.units ?? "auto", ...(input.layers ? { layers: input.layers } : {}), tolerance: input.tolerance ?? 10_000, origin: input.origin ?? "center", cutouts: input.cutouts ?? true });
    } catch (e) {
      if (e instanceof DxfError) throw new OpError(e.message);
      throw e;
    }
    const outline: OutlineRec = old ? edited({ ...old, outline: read.outline, source: { kind: "board" } }, ctx) : { kind: "outline", id: "outline", outline: read.outline, source: { kind: "board" }, provenance: ctx.provenance };
    const removes = recordsOfKind(doc, "cutout").map((c) => c.id);
    const cutouts: CutoutRec[] = read.cutouts.map((c, i) => ({ kind: "cutout", id: `cutout:dxf.${i + 1}`, outline: c, provenance: ctx.provenance }));
    return change(doc, [outline, ...cutouts], removes, undefined, { ...read.report });
  },
});

export {};
