/**
 * One wire method run on a schematic service (params already checked): shared by the server (`serveSchematic`)
 * and a client's local mode (`localClient`), so a method means the same thing in both.
 */
import type { Actor, LeaseClaim } from "@protoboardai/board";
import { applyFix, cleanupPass, explainDefect, listDefects, proposeFixes, revertCleanup } from "../cleanup.ts";
import type { Transaction } from "../engine.ts";
import type { SchematicService } from "../service.ts";
import { describeSchematicOperations, runQuery, sceneToWire, snapshotToWire, type SchematicMethod, type SchematicQueryParams } from "./protocol.ts";

type P = Record<string, unknown> & { actor: Actor };

export function callSchematicService(svc: SchematicService, method: SchematicMethod, params: unknown): unknown {
  const p = (params ?? {}) as P;
  const meta = p.meta as { batchId?: string; leaseToken?: number } | undefined;
  switch (method) {
    case "schematic.snapshot":
      return snapshotToWire(svc.snapshot());
    case "schematic.apply":
      return svc.apply(p.tx as unknown as Transaction, p.actor);
    case "schematic.undo":
      return svc.undo(p.actor, meta);
    case "schematic.redo":
      return svc.redo(p.actor, meta);
    case "schematic.revertChangeSet":
      return svc.revertChangeSet(p.actor, p.id as string, meta);
    case "schematic.claim":
      return svc.claim(p.actor, p.claim as unknown as LeaseClaim);
    case "schematic.release":
      return svc.release(p.actor, p.leaseId as string | undefined);
    case "schematic.takeOver":
      return svc.takeOver(p.by as Actor | undefined);
    case "schematic.presence":
      return svc.presence();
    case "schematic.save":
      return svc.save();
    case "schematic.checkpoint":
      return svc.checkpoint(p.label as string);
    case "schematic.operations":
      return describeSchematicOperations({ all: p.all === true });
    case "schematic.log":
      return svc.log(p.since as number | undefined);
    case "schematic.changeSets":
      return svc.changeSets();
    case "schematic.score":
      return svc.score();
    case "schematic.checks":
      return svc.checks();
    case "schematic.scene":
      return sceneToWire(svc.scene(p as never));
    case "schematic.query":
      return runQuery(svc.snapshot(), params as SchematicQueryParams);
    case "schematic.listDefects": {
      const o = p as { card?: string; rules?: string[]; includeInfo?: boolean; limit?: number };
      return listDefects(svc.snapshot().doc, { ...o, score: svc.score() });
    }
    case "schematic.proposeFixes": {
      const o = p as unknown as { defect: string | number; max?: number };
      return proposeFixes(svc.snapshot().doc, o.defect, { ...(o.max !== undefined ? { max: o.max } : {}), score: svc.score() });
    }
    case "schematic.applyFix": {
      const o = p as unknown as { actor: Actor; title: string; ops: Transaction["ops"]; changeSet?: { id: string; title?: string }; batchId?: string };
      return applyFix(svc, { title: o.title, ops: o.ops }, { actor: o.actor, ...(o.changeSet ? { changeSet: o.changeSet } : {}), ...(o.batchId ? { batchId: o.batchId } : {}) });
    }
    case "schematic.explainDefect":
      return { text: explainDefect(svc.snapshot().doc, (p as unknown as { defect: string | number }).defect) };
    case "schematic.cleanupPass": {
      const o = p as unknown as { actor: Actor; budget?: number; maxPasses?: number; perPass?: number; changeSet?: { id: string; title?: string } };
      return cleanupPass(svc, { actor: o.actor, ...(o.budget !== undefined ? { budget: o.budget } : {}), ...(o.maxPasses !== undefined ? { maxPasses: o.maxPasses } : {}), ...(o.perPass !== undefined ? { perPass: o.perPass } : {}), ...(o.changeSet ? { changeSet: o.changeSet } : {}) });
    }
    case "schematic.revertCleanup": {
      const o = p as unknown as { actor: Actor; changeSet: { id: string; title?: string; transactions: number; ops?: number } };
      return { undone: revertCleanup(svc, { changeSet: { id: o.changeSet.id, title: o.changeSet.title ?? o.changeSet.id, transactions: o.changeSet.transactions, ops: o.changeSet.ops ?? 0 } }, o.actor) };
    }
    case "schematic.shutdown":
      throw new Error("only a serving process can be stopped (protoboard schematic serve); this schematic is open in this process");
  }
}
