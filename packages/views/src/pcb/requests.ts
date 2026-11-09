/**
 * What a page may ask its host (`BoardRequest`), checked field by field before the host acts on it. Shared by the
 * dev servers' route and the VS Code relay. A request never names an actor: the host decides who acts, so anything
 * that tries to (an `actor`, `by`, `provenance` or `leaseToken` field) is refused, as is an unknown method. The
 * board service checks the transaction itself (operation names, audiences, schemas); this only keeps the envelope
 * to what a page may send. Pure; no DOM, no Node.
 */
import type { BoardRequest, PageTransaction } from "./types.js";

const METHODS = new Set(["apply", "undo", "redo", "revertChangeSet", "takeOver", "save", "checkpoint", "commit", "at", "routers", "route", "routeCancel", "routeAccept", "routeReject", "diagnose", "waive", "unwaive"]);
/** Fields a page may never send at any level of the envelope: the host decides who acts and with what authority. */
const FORBIDDEN = ["actor", "by", "provenance", "leaseToken"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1): v is string => typeof v === "string" && v.length >= min && v.length <= max;
const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function only(o: Record<string, unknown>, allowed: string[], where: string): string | undefined {
  for (const k of Object.keys(o)) {
    if (FORBIDDEN.includes(k)) return `${where}: a page never sends ${k} (the host decides who acts)`;
    if (!allowed.includes(k)) return `${where}: unknown field ${k}`;
  }
  return undefined;
}

function checkTx(tx: unknown): string | undefined {
  if (!isObj(tx)) return "tx: a transaction object";
  const bad = only(tx, ["batchId", "label", "ops", "changeSet", "expectEpoch", "expectSeq", "expectVersions", "dryRun"], "tx");
  if (bad) return bad;
  const t = tx as Partial<PageTransaction>;
  if (!str(t.batchId, 200) || !/^[A-Za-z0-9_.:-]+$/.test(t.batchId)) return "tx.batchId: 1 to 200 of A-Z a-z 0-9 _ . : -";
  if (!str(t.label, 160)) return "tx.label: a short text";
  if (!Array.isArray(t.ops) || t.ops.length < 1 || t.ops.length > 200) return "tx.ops: 1 to 200 operations";
  for (const [i, op] of t.ops.entries()) {
    if (!isObj(op) || !str(op.op, 60)) return `tx.ops[${i}]: an operation with a name`;
    for (const k of FORBIDDEN) if (k in op) return `tx.ops[${i}]: a page never sends ${k}`;
  }
  if (t.changeSet !== undefined && (!isObj(t.changeSet) || !str(t.changeSet.id, 200) || (t.changeSet.title !== undefined && !str(t.changeSet.title, 200)))) return "tx.changeSet: { id, title? }";
  if (t.expectEpoch !== undefined && !str(t.expectEpoch, 40)) return "tx.expectEpoch: text";
  if (t.expectSeq !== undefined && (!int(t.expectSeq) || t.expectSeq < 0)) return "tx.expectSeq: a whole number";
  if (t.expectVersions !== undefined) {
    if (!isObj(t.expectVersions)) return "tx.expectVersions: id to version";
    const e = Object.entries(t.expectVersions);
    if (e.length > 1000 || e.some(([k, v]) => !str(k, 300) || !int(v) || v < 0)) return "tx.expectVersions: id to version";
  }
  if (t.dryRun !== undefined && typeof t.dryRun !== "boolean") return "tx.dryRun: true or false";
  return undefined;
}

/** The request when it is one a page may make; else why not. */
export function parseBoardRequest(value: unknown): { ok: true; request: BoardRequest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isObj(value)) return fail("a request is an object with a method");
  const m = value.method;
  if (typeof m !== "string" || !METHODS.has(m)) return fail(`unknown method ${typeof m === "string" ? m.slice(0, 40) : "(none)"}`);
  const v = value;
  const check = (allowed: string[]) => only(v, ["method", ...allowed], m);
  let bad: string | undefined;
  switch (m) {
    case "apply":
      bad = check(["tx"]) ?? checkTx(v.tx);
      break;
    case "undo":
    case "redo":
      bad = check(["batchId"]) ?? (v.batchId !== undefined && !str(v.batchId, 200) ? "batchId: text" : undefined);
      break;
    case "revertChangeSet":
      bad = check(["id", "batchId"]) ?? (!str(v.id, 200) ? "id: a change set id" : undefined);
      break;
    case "takeOver":
    case "save":
    case "routers":
      bad = check([]);
      break;
    case "checkpoint":
      bad = check(["label"]) ?? (!str(v.label, 200, 0) ? "label: up to 200 characters" : undefined);
      break;
    case "commit":
      bad = check(["message"]) ?? (!str(v.message, 4000) ? "message: 1 to 4000 characters" : undefined);
      break;
    case "at":
      bad = check(["seq"]) ?? (!int(v.seq) || v.seq < 0 ? "seq: a whole number" : undefined);
      break;
    case "route": {
      bad = check(["scope", "budgetMs", "preset"]);
      const s = v.scope;
      if (!bad && (!isObj(s) || !["open", "nets", "region"].includes(String(s.kind)))) bad = "scope: { kind: open | nets | region }";
      if (!bad && isObj(s) && s.kind === "nets" && (!Array.isArray(s.nets) || !s.nets.length || s.nets.length > 2000 || s.nets.some((n) => !str(n, 200)))) bad = "scope.nets: net names";
      if (!bad && isObj(s) && s.kind === "region" && (!Array.isArray(s.region) || s.region.length < 3 || s.region.length > 1000 || s.region.some((p) => !isObj(p) || typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)))) bad = "scope.region: three or more points";
      if (!bad && v.budgetMs !== undefined && (!int(v.budgetMs) || v.budgetMs < 1000 || v.budgetMs > 600_000)) bad = "budgetMs: 1 s to 10 min";
      if (!bad && v.preset !== undefined && v.preset !== "balanced") bad = "preset: balanced";
      break;
    }
    case "routeCancel":
    case "routeAccept":
    case "routeReject":
      bad = check(["run"]) ?? (!str(v.run, 100) ? "run: a run id" : undefined);
      break;
    case "diagnose":
      bad = check(["net", "budgetMs"]) ?? (!str(v.net, 200) ? "net: a net name" : v.budgetMs !== undefined && (!int(v.budgetMs) || v.budgetMs < 1000 || v.budgetMs > 600_000) ? "budgetMs: 1 s to 10 min" : undefined);
      break;
    case "waive":
      bad = check(["finding", "reason"]) ?? (!str(v.finding, 200) ? "finding: a finding id" : !str(v.reason, 400) || !String(v.reason).trim() ? "reason: why it is not a problem (1 to 400 characters)" : undefined);
      break;
    case "unwaive":
      bad = check(["finding"]) ?? (!str(v.finding, 200) ? "finding: a finding id" : undefined);
      break;
  }
  return bad ? fail(bad) : { ok: true, request: value as unknown as BoardRequest };
}
