/**
 * Types of the Phase 2 service additions (contract docs/specs/pcb-editor/phase2-editing.md, sections 4 to 6):
 * proposals and the derived state published after each commit. Plain data, safe in a page.
 */
import type { Finding } from "./extensions.js";
import type { Box } from "./geometry.js";
import type { Actor, OpCall } from "./ops/registry.js";
import type { BoardRecord, Provenance } from "./schema.js";

export interface ChangeSummary {
  /** Records added, by kind. */
  added: Record<string, number>;
  removed: Record<string, number>;
  changed: Record<string, number>;
  /** Track length added and removed, nanometers. */
  length: { added: number; removed: number };
}

export interface ProposalItemInput {
  /** Default `i<n>`. Letters, digits, `_`, `.`, `-`; unique in the proposal. */
  key?: string;
  label: string;
  ops: OpCall[];
}

export interface ProposeInput {
  /** 3 to 12 words. */
  title: string;
  items: ProposalItemInput[];
  changeSet?: { id: string; title?: string };
  scores?: Record<string, unknown>;
  /** Routers and hosts only: what accepted records carry. */
  provenance?: Provenance;
  /** The seq the proposal was computed on (default: the current seq). */
  expectSeq?: number;
}

export type ProposalStatus = "open" | "stale" | "accepted" | "partial" | "rejected";
export type ProposalItemStatus = "open" | "stale" | "accepted" | "rejected";

export interface ProposalItem {
  key: string;
  label: string;
  ops: OpCall[];
  status: ProposalItemStatus;
  /** Nets the item's copper is on. */
  nets: string[];
  summary: ChangeSummary;
  acceptedSeq?: number;
}

export interface BoardCounts {
  records: number;
  tracks: number;
  vias: number;
}

export interface Proposal {
  id: string;
  title: string;
  actor: Actor;
  source: "agent" | "router" | "host" | "person" | "needs-person";
  base: { epoch: string; seq: number };
  status: ProposalStatus;
  items: ProposalItem[];
  summary: ChangeSummary;
  before: BoardCounts;
  after: BoardCounts;
  touched: string[];
  areas: { box: Box; layers: string[] }[];
  scores?: Record<string, unknown>;
  provenance: Provenance;
  changeSet: { id: string; title?: string };
  stale?: { seq: number; actor: Actor; changed: string[] };
  reason?: string;
  rejected?: { by: Actor; reason?: string };
  createdAt: number;
}

export type ProposeReply = { status: "proposed"; proposal: Proposal } | { status: "invalid"; error: string; item?: string };

export interface ProposalPreview {
  id: string;
  /** The current seq the preview was computed on. */
  seq: number;
  stale: boolean;
  valid: boolean;
  error?: string;
  /** Handles to the scratch ids of the preview (not the ids an accept will issue). */
  created: Record<string, string>;
  added: BoardRecord[];
  removed: BoardRecord[];
  changed: { before: BoardRecord; after: BoardRecord }[];
}

export interface DerivedSummary {
  line: string;
  unconnected: number;
  errors: number;
  warnings: number;
  infos: number;
  /** Findings a person waived (left out of the counts above); absent when none. */
  waived?: number;
  incomplete: boolean;
  caveats: string[];
}

/** What a live checker publishes after a commit (contract section 6.1). */
export interface DerivedState {
  epoch: string;
  seq: number;
  summary: DerivedSummary;
  findings: { added: Finding[]; removed: string[]; total: number };
  fill: { refilled: string[]; stale: string[] };
  stale: { checks: boolean; fill: string[] };
  timing: { checksMs: number; fillMs: number; totalMs: number; mode: "incremental" | "full" };
}
