/**
 * Staleness (contract section 4.3): every result carries the hash of the input it read. The checks read every
 * record of the board (geometry, rules, net classes, the stackup), the netlist and the zone fill, so the input
 * hash covers all of them. Each record's own hash is cached on the frozen record object, so hashing a document
 * after a small change costs a hash of the changed records plus one pass over the ids.
 */
import { byCodeUnit, canonical, canonicalRecord, sha1Hex, sha256Hex, type BoardDocument, type BoardRecord } from "@protoboardai/board";
import type { ZoneFillSet } from "./fills.js";

/** Bumped when the checks' meaning changes, so a cached result from an older version reads as stale. */
export const CHECKS_VERSION = "board-checks/1";

const recordHashes = new WeakMap<BoardRecord, string>();
function recordHash(r: BoardRecord): string {
  let h = recordHashes.get(r);
  if (!h) {
    h = sha1Hex(canonicalRecord(r));
    recordHashes.set(r, h);
  }
  return h;
}

const fillHashes = new WeakMap<ZoneFillSet, string>();
/** The hash of a zone fill set ("none" without one). */
export function fillsHash(fills: ZoneFillSet | undefined): string {
  if (!fills) return "none";
  let h = fillHashes.get(fills);
  if (!h) {
    h = sha256Hex(canonical(fills));
    fillHashes.set(fills, h);
  }
  return h;
}

/** `sha256:<hex>` over the checks version, every record (by id), the netlist and the fill. */
export function inputHash(doc: BoardDocument, fills?: ZoneFillSet): string {
  const ids = [...doc.records.keys()].sort(byCodeUnit);
  const parts: string[] = [CHECKS_VERSION];
  for (const id of ids) parts.push(`${id}\u0000${recordHash(doc.records.get(id)!)}`);
  parts.push(`netlist\u0000${doc.netlist ? sha1Hex(canonical(doc.netlist)) : "none"}`);
  parts.push(`fills\u0000${fillsHash(fills)}`);
  return `sha256:${sha256Hex(parts.join("\n"))}`;
}

/** Whether a result computed from `hash` is stale for this document and fill. */
export const isStale = (hash: string, doc: BoardDocument, fills?: ZoneFillSet): boolean => hash !== inputHash(doc, fills);
