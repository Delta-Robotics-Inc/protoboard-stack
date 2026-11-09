/**
 * @protoboardai/board-export: manufacturing outputs from the board document of Protoboard's PCB editor. Industry
 * files stay standard (Gerber X2, Excellon, IPC-D-356, BOM and placement CSVs per fab, DXF); Protoboard's context
 * (manifest, origin, images, pre-flight) rides beside them, never inside them. Every export is a file plus an image of
 * it, and is read back and checked after writing.
 *
 *   const r = await exportFabPackage("path/to/board", "jlcpcb", { outDir: "out/jlcpcb" });
 *   r.preflight.verdict; r.files; // manifest.json, preflight.json, summary.md beside them
 */
export * from "./package.js";
export * from "./api.js";
export * from "./profiles.js";
export { placements, bomLines, writeBom, writeCpl, rotationCorrection, type PartInfo, type PartData, type PlacementRow, type BomLine, type Process, type AssemblyOptions } from "./assembly.js";
export { costDrivers, viasInPads, type CostDriver } from "./costs.js";
export { boardHoles, drillFiles, toolsOf, writeExcellon, readExcellon, type Hole, type DrillFile, type DrillOptions, type ExcellonRead, type ReadHole, type Tool } from "./drill.js";
export { writeDxf, type DxfOptions } from "./dxf.js";
export { resolveFill, type ResolvedFill, type FillChoice } from "./fill.js";
export { fracture, textStrokes, footprintTextStrokes, type Pt, type PathPt } from "./geom.js";
export { writeGerber, attrText, type GerberWriteOptions } from "./gerber/write.js";
export { readGerber, apertureShapes, countObjects, evalExpr, areaOf, type GerberRead, type GObject, type GAperture } from "./gerber/read.js";
export { gerbersToSvg, LAYER_COLORS, type SvgLayer, type SvgOptions } from "./gerber/svg.js";
export { writeIpc356, readIpc356, ipc356Records, type Ipc356Record, type Ipc356Read } from "./ipc356.js";
export { kicadAvailability, kicadCrossCheck, kicadExport, type KicadSource, type KicadAvailability, type CrossCheck, type CrossRow } from "./kicad.js";
export { plotBoard, padAperture, growAp, apertureRing, type Plot, type PlotLayer, type PlotObj, type PlotOptions, type ApertureShape, type ObjAttrs } from "./plot.js";
export { type PreflightItem, type Status, type Group, type LayerStats } from "./validate.js";
export { zip, unzipStored, crc32 } from "./zip.js";
export { mmText, safeName } from "./format.js";
