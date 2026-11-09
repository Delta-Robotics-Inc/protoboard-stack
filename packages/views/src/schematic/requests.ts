/**
 * What a page may ask its schematic host (`SchematicRequest`), checked field by field before the host acts on it.
 * Shared by the dev servers' route and a VS Code relay. A request never names an actor: the host decides who acts
 * (a person), so anything that tries (`actor`, `by`, `provenance`, `leaseToken`) is refused, as is an unknown method.
 * The schematic service checks the operations themselves. Pure; no DOM, no Node.
 */
import type { SchematicRequest } from "./types.js";

const FORBIDDEN = ["actor", "by", "provenance", "leaseToken"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const int = (v: unknown, lim = 100_000): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= lim;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length >= 1 && v.length <= 2000 && v.every((x) => str(x, 300));
const points = (v: unknown): boolean => Array.isArray(v) && v.length >= 2 && v.length <= 1000 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6));

function only(o: Record<string, unknown>, allowed: string[], where: string): string | undefined {
  for (const k of Object.keys(o)) {
    if (FORBIDDEN.includes(k)) return `${where}: a page never sends ${k} (the host decides who acts)`;
    if (!allowed.includes(k)) return `${where}: unknown field ${k}`;
  }
  return undefined;
}

function forbiddenDeep(v: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (Array.isArray(v)) {
    for (const x of v) {
      const b = forbiddenDeep(x, depth + 1);
      if (b) return b;
    }
  } else if (isObj(v))
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN.includes(k)) return `a page never sends ${k}`;
      const b = forbiddenDeep(x, depth + 1);
      if (b) return b;
    }
  return undefined;
}

export function parseSchematicRequest(value: unknown): { ok: true; request: SchematicRequest } | { ok: false; error: string } {
  if (!isObj(value)) return { ok: false, error: "a request is an object with a method" };
  const m = value.method;
  const v = value;
  const check = (allowed: string[]) => only(v, ["method", ...allowed], String(m));
  let bad: string | undefined;
  switch (m) {
    case "apply": {
      bad = check(["tx"]);
      const t = v.tx;
      if (!bad && !isObj(t)) bad = "tx: a transaction object";
      if (!bad && isObj(t)) {
        bad = only(t, ["batchId", "label", "ops"], "tx");
        if (!bad && (!str(t.batchId, 200) || !/^[A-Za-z0-9_.:-]+$/.test(t.batchId))) bad = "tx.batchId: 1 to 200 of A-Z a-z 0-9 _ . : -";
        if (!bad && !str(t.label, 160)) bad = "tx.label: a short text";
        if (!bad && (!Array.isArray(t.ops) || t.ops.length < 1 || t.ops.length > 200 || t.ops.some((o) => !isObj(o) || !str(o.op, 60)))) bad = "tx.ops: 1 to 200 operations";
        if (!bad && Array.isArray(t.ops) && t.ops.some((o) => isObj(o) && /^(record|proposal)\./.test(String(o.op)))) bad = "tx.ops: record and proposal operations are the host's";
        if (!bad) bad = forbiddenDeep(t.ops);
      }
      break;
    }
    case "move":
      bad = check(["ids", "dx", "dy"]) ?? (!ids(v.ids) ? "ids: object ids" : !int(v.dx) || !int(v.dy) ? "dx, dy: whole grid units" : undefined);
      break;
    case "rotate":
      bad = check(["ids", "angle"]) ?? (!ids(v.ids) ? "ids: symbol ids" : ![90, 180, 270].includes(v.angle as number) ? "angle: 90, 180 or 270" : undefined);
      break;
    case "mirror":
      bad = check(["ids"]) ?? (!ids(v.ids) ? "ids: symbol ids" : undefined);
      break;
    case "moveField":
      bad = check(["id", "dx", "dy"]) ?? (!str(v.id, 300) ? "id: a symbol id" : !int(v.dx) || !int(v.dy) ? "dx, dy: whole grid units" : undefined);
      break;
    case "drawWire":
      bad = check(["net", "card", "points"]) ?? (!str(v.net, 200) ? "net: a net name" : !str(v.card, 300) ? "card: a card id" : !points(v.points) ? "points: two or more points" : undefined);
      break;
    case "editWire":
      bad = check(["id", "points"]) ?? (!str(v.id, 300) ? "id: a wire id" : !points(v.points) ? "points: two or more points" : undefined);
      break;
    case "undo":
    case "redo":
    case "save":
      bad = check([]);
      break;
    case "checkpoint":
      bad = check(["label"]) ?? (!str(v.label, 200, 0) ? "label: up to 200 characters" : undefined);
      break;
    case "fixes":
      bad = check(["defect"]) ?? (!str(v.defect, 200) ? "defect: a defect id" : undefined);
      break;
    case "acceptFix":
      bad = check(["defect", "index"]) ?? (!str(v.defect, 200) ? "defect: a defect id" : !int(v.index, 20) || (v.index as number) < 0 ? "index: a fix number" : undefined);
      break;
    case "cleanupPreview":
      bad = check(["budget", "card"]) ?? (v.budget !== undefined && (!int(v.budget, 200) || (v.budget as number) < 1) ? "budget: 1 to 200 operations" : v.card !== undefined && !str(v.card, 300) ? "card: a card id" : undefined);
      break;
    case "cleanupApply":
    case "cleanupRevert":
      bad = check(["id"]) ?? (!str(v.id, 120) ? "id: a cleanup preview id" : undefined);
      break;
    default:
      return { ok: false, error: `unknown method ${typeof m === "string" ? m.slice(0, 40) : "(none)"}` };
  }
  return bad ? { ok: false, error: bad } : { ok: true, request: value as unknown as SchematicRequest };
}
