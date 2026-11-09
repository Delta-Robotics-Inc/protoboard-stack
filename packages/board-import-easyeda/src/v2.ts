/**
 * Format 2 (`.epro`) records: JSON arrays whose positions are fixed per type (EasyEDA "PCB document format", file
 * format 2.2, sections 2, 5, 6, 8 and 10). Each is turned into the keyed record format 3 uses, with the key names
 * format 3 exports carry, so one converter reads both. Documented trailing fields that newer writers append (the
 * hidden inner layers of pads and vias, a region's name) are read when present.
 */
import type { Json, Obj } from "./project.js";

/** Field names by position, after the type name at position 0. `id` is the record id. */
const FIELDS: Record<string, string[]> = {
  LAYER: ["layerId", "layerType", "layerName", "status", "activeColor", "activateTransparency", "inactiveColor", "inactiveTransparency"],
  LAYER_PHYS: ["layerId", "material", "thickness", "permittivity", "lossTangent", "isKeepIsland"],
  NET: ["id", "netType", "specialColor", "hideRetLine", "differentialName", "isPositiveNet", "equalLengthGroupName"],
  VIA: ["id", "groupId", "netName", "ruleName", "centerX", "centerY", "holeDiameter", "viaDiameter", "viaType", "topSolderExpansion", "bottomSolderExpansion", "locked", "unusedInnerLayers"],
  PAD: [
    "id",
    "groupId",
    "netName",
    "layerId",
    "num",
    "centerX",
    "centerY",
    "padAngle",
    "hole",
    "defaultPad",
    "specialPad",
    "padOffsetX",
    "padOffsetY",
    "relativeAngle",
    "plated",
    "padType",
    "topSolderExpansion",
    "bottomSolderExpansion",
    "topPasteExpansion",
    "bottomPasteExpansion",
    "locked",
    "connectMode",
    "spokeSpace",
    "spokeWidth",
    "spokeAngle",
    "unusedInnerLayers",
  ],
  LINE: ["id", "groupId", "netName", "layerId", "startX", "startY", "endX", "endY", "width", "locked"],
  ARC: ["id", "groupId", "netName", "layerId", "startX", "startY", "endX", "endY", "angle", "width", "locked"],
  CARC: ["id", "groupId", "netName", "layerId", "startX", "startY", "endX", "endY", "angle", "width", "locked"],
  POLY: ["id", "groupId", "netName", "layerId", "width", "path", "locked"],
  FILL: ["id", "groupId", "netName", "layerId", "width", "fillStyle", "path", "locked"],
  REGION: ["id", "groupId", "layerId", "width", "prohibitType", "path", "locked", "name"],
  POUR: ["id", "groupId", "netName", "layerId", "width", "name", "order", "path", "pourType", "keepIsland", "locked"],
  POURED: ["id", "targetId", "strokeWidth", "fill", "path"],
  STRING: ["id", "groupId", "layerId", "x", "y", "text", "fontFamily", "fontSize", "strokeWidth", "bold", "italic", "origin", "angle", "reverse", "expansion", "mirror", "locked"],
  ATTR: ["id", "groupId", "parentId", "layerId", "x", "y", "key", "value", "keyVisible", "valueVisible", "fontFamily", "fontSize", "strokeWidth", "bold", "italic", "origin", "angle", "reverse", "expansion", "mirror", "locked"],
  COMPONENT: ["id", "groupId", "layerId", "x", "y", "angle", "attrs", "locked"],
  PAD_NET: ["componentId", "padNum", "padNet", "padId"],
  RULE: ["ruleType", "ruleName", "ruleState", "ruleContext"],
  RULE_SELECTOR: ["ruleSelect", "ruleOrder", "ruleKeyValue"],
  IMAGE: ["id", "groupId", "layerId", "startX", "startY", "width", "height", "angle", "mirror", "path", "locked"],
  OBJ: ["id", "groupId", "layerId", "fileName", "startX", "startY", "width", "height", "angle", "mirror", "path", "locked"],
  DIMENSION: ["id", "type", "layerId", "unit", "strokeWidth", "precision", "textFollow", "coords", "locked"],
  TEARDROP: ["id", "netName", "layerId", "path", "locked"],
  CONNECT: ["id", "relatedIds"],
  PROP: ["id", "color"],
  GROUP: ["id", "groupName"],
};

/** Format 2 numbers for enumerations, as the names format 3 exports use. */
const FILL_STYLE = ["SOLID", "GRID", "INNER_PLANE"];
const VIA_TYPE = ["NORMAL", "SUTURE"];
const ORIGIN = ["LEFT_TOP", "CENTER_TOP", "RIGHT_TOP", "LEFT_MIDDLE", "CENTER_MIDDLE", "RIGHT_MIDDLE", "LEFT_BOTTOM", "CENTER_BOTTOM", "RIGHT_BOTTOM"];
/** Region prohibition codes 1 to 8 (1 and 4 are deprecated combinations the documentation asks readers to accept). */
export const PROHIBIT_V2: Record<number, string[]> = { 1: ["TRACK", "FILL"], 2: ["COMPONENT"], 3: ["VIA"], 4: ["COPPER", "PLANE"], 5: ["TRACK"], 6: ["FILL"], 7: ["COPPER"], 8: ["PLANE"] };

const isNum = (v: Json | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** A format 2 pad or hole shape array as the keyed form: `["RECT", w, h, r]` to `{ padType: "RECT", width, height, radius }`. */
export function shapeArrayToKeyed(a: Json, hole: boolean): Json {
  if (!Array.isArray(a) || typeof a[0] !== "string") return a;
  const kind = a[0];
  if (hole) return { holeType: kind, width: a[1] ?? 0, height: a[2] ?? a[1] ?? 0 };
  if (kind === "POLY" || kind === "POLYGON") return { padType: "POLYGON", path: a[1] ?? [] };
  if (kind === "NGON") return { padType: "NGON", diameter: a[1] ?? 0, sides: a[2] ?? 0 };
  const out: Obj = { padType: kind, width: a[1] ?? 0, height: a[2] ?? a[1] ?? 0 };
  if (a.length > 3) out.radius = a[3] ?? 0;
  return out;
}

/** One format 2 line as `{ type, id, data }`, or undefined for lines that carry no record (DOCTYPE, HEAD). */
export function v2RecordToKeyed(arr: Json[]): { type: string; id: string; data: Obj } | undefined {
  const type = String(arr[0]);
  const names = FIELDS[type];
  const data: Obj = {};
  if (!names) {
    // undocumented or settings records: kept by type only, so they are counted
    data.raw = arr.slice(1);
    return { type, id: `${type}#${typeof arr[1] === "string" || typeof arr[1] === "number" ? arr[1] : ""}`, data };
  }
  names.forEach((n, i) => {
    if (i + 1 < arr.length) data[n] = arr[i + 1];
  });
  let id: string;
  switch (type) {
    case "LAYER":
    case "LAYER_PHYS":
      id = JSON.stringify([type, data.layerId]);
      if (type === "LAYER") data.use = isNum(data.status) ? (data.status & 1) === 1 : true;
      break;
    case "NET":
      id = JSON.stringify([type, data.id]);
      break;
    case "PAD_NET":
      id = JSON.stringify([type, data.componentId, data.padNum, data.padId ?? null]);
      break;
    case "RULE":
      id = JSON.stringify([type, data.ruleType, data.ruleName]);
      break;
    case "RULE_SELECTOR":
      id = JSON.stringify([type, data.ruleSelect]);
      break;
    default:
      id = String(data.id ?? `${type}#`);
  }
  delete data.id;
  if (type === "PAD") {
    if (data.hole !== undefined && data.hole !== null) data.hole = shapeArrayToKeyed(data.hole, true);
    if (data.defaultPad !== undefined) data.defaultPad = shapeArrayToKeyed(data.defaultPad, false);
  }
  if (type === "FILL" && isNum(data.fillStyle)) data.fillStyle = FILL_STYLE[data.fillStyle] ?? String(data.fillStyle);
  if (type === "VIA" && isNum(data.viaType)) data.viaType = VIA_TYPE[data.viaType] ?? String(data.viaType);
  if ((type === "STRING" || type === "ATTR") && isNum(data.origin)) data.origin = ORIGIN[data.origin] ?? "LEFT_BOTTOM";
  if (type === "REGION" && Array.isArray(data.prohibitType)) data.prohibitType = data.prohibitType.flatMap((c) => (isNum(c) ? (PROHIBIT_V2[c] ?? [`CODE_${c}`]) : [String(c)]));
  if (type === "POUR" && Array.isArray(data.pourType)) {
    const p = data.pourType;
    data.pourType = p[0] === "LINE" ? { pourType: "LINE", mode: p[1] ?? 0, angle: p[2] ?? 0, lineWidth: p[3] ?? 0, lineGap: p[4] ?? 0 } : { pourType: String(p[0] ?? "SOLID"), fineness: p[1] ?? 0 };
  }
  if (type === "POURED") data.pourFill = [{ strokeWidth: data.strokeWidth ?? 0, fill: data.fill ?? true, path: data.path ?? [] }];
  return { type, id, data };
}
