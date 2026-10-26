/**
 * A part's status (PB-932, decision of 2026-10-06): where it stands between
 * "only in this project" and "maintained by the Protoboard team". One
 * definition for every view: the dot on a module in the diagram, the Project
 * Parts list and page, and the parts Inspector.
 *
 * | state      | colour | meaning                                                        |
 * | ---------- | ------ | -------------------------------------------------------------- |
 * | local      | gray   | only in this project (researched or designed here)             |
 * | unverified | yellow | in a library, not verified                                     |
 * | verified   | green  | in a library, verified through the protocol's verification     |
 * | official   | blue   | maintained by the Protoboard team                              |
 *
 * `partTrust` is the one mapping from today's data to these states. What it
 * reads, in order:
 *
 * 1. **Not from a library** (the project's researched and designed parts,
 *    tiers `project-researched` and `project-specific`): `local`. A
 *    researched part published to a library stays local here until the
 *    project takes it from the library (`parts add`).
 * 2. **What the library reports** (`reported`): used as given. No library
 *    reports a status today; the field is where one would arrive (see below).
 * 3. **The revision's verification record**: a library revision may carry
 *    evidence of kind `verification` (protoboard-cloud's envelope,
 *    `evidence[].kind`), a `verification.json` whose `audit` says how many
 *    facts were checked, how many were wrong, and whether the auditor was
 *    independent of the author. `verified` when the record has an audit by an
 *    independent auditor and no wrong fact left without a recorded repair:
 *    the same reading as ext-hardware's evidence check
 *    (HW_VERIFICATION_SELF_AUDIT, HW_VERIFICATION_WRONG). Otherwise
 *    `unverified`: no record, a self-audit only, an unrepaired wrong fact, or
 *    a record that could not be read.
 *
 * What today's data cannot tell apart:
 *
 * - **official from verified.** Nothing a library serves says who maintains
 *   a part. A revision's `publisher.name` is the account that published it,
 *   and a library's id says where a copy came from; neither says the
 *   Protoboard team maintains the part, so neither is read here. `official`
 *   is returned only when a library reports it. The library would need to
 *   record a status per part (for example `status: "unverified" | "verified"
 *   | "official"` on the part summary and the revision, set by the service,
 *   not by the publisher) for blue to appear.
 * - **"verified through the protocol's verification process" from "carries
 *   an independent audit record".** The verification process is not built
 *   yet (out of scope of PB-932); the audit record is the nearest thing a
 *   library records today. When the process exists, the library's reported
 *   status (2) takes over and this reading (3) becomes the fallback for
 *   libraries that do not report one.
 * - **A search hit's state.** The search response (the part summary) carries
 *   no evidence, so a result card cannot show a state without fetching each
 *   revision; the library views show it on a part's detail only.
 *
 * No Node API here: the views bundle it for the browser.
 */

export const PART_TRUST_STATES = ["local", "unverified", "verified", "official"] as const;
export type PartTrust = (typeof PART_TRUST_STATES)[number];

/** A verification record (`verification.json`) as far as the mapping reads it. */
export interface VerificationRecord {
  audit?: { independent?: boolean; wrong?: number } | null;
  /** What was repaired after the audit found wrong facts. */
  repairs?: unknown;
}

export interface PartTrustFacts {
  /** The part comes from a library (a vendored revision, or a part shown from a library). */
  inLibrary: boolean;
  /** The status the library reports for the part, when it reports one. */
  reported?: string;
  /**
   * The revision's verification record: the parsed `verification.json`,
   * `null` when the revision carries one that could not be read, absent when
   * it carries none.
   */
  verification?: VerificationRecord | null;
}

export interface PartTrustResult {
  trust: PartTrust;
  /** Why, in a few words, for the tooltip ("independent audit recorded"). */
  basis: string;
}

const REPORTED = new Set<string>(["unverified", "verified", "official"]);

/** A part's status from what is known about it today (see the file's header for the rules and their limits). */
export function partTrust(f: PartTrustFacts): PartTrustResult {
  if (!f.inLibrary) return { trust: "local", basis: "not in a library" };
  if (f.reported !== undefined && REPORTED.has(f.reported)) return { trust: f.reported as PartTrust, basis: "reported by the library" };
  if (f.verification === undefined) return { trust: "unverified", basis: "no verification record" };
  if (f.verification === null) return { trust: "unverified", basis: "its verification record could not be read" };
  const audit = f.verification.audit;
  if (!audit) return { trust: "unverified", basis: "its verification record has no audit" };
  if (audit.independent !== true) return { trust: "unverified", basis: "self-audit only: an independent audit is still owed" };
  if ((audit.wrong ?? 0) > 0 && !f.verification.repairs) return { trust: "unverified", basis: "its audit found wrong facts with no recorded repair" };
  return { trust: "verified", basis: "independent audit recorded" };
}

/** A verification record from its file's text; `null` when it is not one. */
export function parseVerificationRecord(text: string): VerificationRecord | null {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const a = o.audit && typeof o.audit === "object" ? (o.audit as Record<string, unknown>) : undefined;
    return {
      ...(a ? { audit: { ...(typeof a.independent === "boolean" ? { independent: a.independent } : {}), ...(typeof a.wrong === "number" ? { wrong: a.wrong } : {}) } } : {}),
      ...(o.repairs ? { repairs: o.repairs } : {}),
    };
  } catch {
    return null;
  }
}

/** The states' names and what each means: the labels and tooltips of every view. */
export const PART_TRUST_TEXT: Record<PartTrust, { label: string; meaning: string }> = {
  local: { label: "Local", meaning: "Only in this project: researched or designed here, not in a library." },
  unverified: { label: "Unverified", meaning: "In a library, but not verified: check its facts against the datasheet before relying on them." },
  verified: { label: "Verified", meaning: "In a library and verified: its facts went through the protocol's verification process." },
  official: { label: "Official", meaning: "An official part, maintained by the Protoboard team." },
};

/** "Verified: In a library and verified… (independent audit recorded)": a state's tooltip. */
export function partTrustTooltip(trust: PartTrust, basis?: string, blank = false): string {
  if (blank) return `${BLANK_BLOCK_TEXT.label}. ${BLANK_BLOCK_TEXT.meaning}`;
  const t = PART_TRUST_TEXT[trust];
  return `${t.label}. ${t.meaning}${basis && trust !== "local" ? ` (${basis.charAt(0).toUpperCase()}${basis.slice(1)}.)` : ""}`;
}

/**
 * A blank block (the 2026-10-08 first builds, item 5): a module of the
 * project that stands for a part nobody has chosen yet. It has a name and
 * interfaces so the system can be drawn and checked at concept level, and
 * nothing behind it. It is not a fifth status: a blank block is `local` (it
 * exists only in this project), and the views draw the same gray as a ring
 * instead of a dot and say "Blank block" in place of "Local".
 *
 * What makes a definition one, from what a project holds today (no field of
 * UHD says it; a project-level fidelity setting and a file per placeholder
 * are later work): it is the project's own (not from a library), a plain
 * module with nothing inside it, and it names no part and says nothing
 * about one: no `manufacturer`, no `part_number`, no artifact, and no
 * engineering data (`domains`, `traits`, `requirements`, `constraints`). A
 * researched part names its part; a designed one (a board, an enclosure, a
 * bracket) has its children or its model; a board's pads and an assembly's
 * materials are described by their package or their specification.
 */
export interface BlankBlockFacts {
  /** The part comes from a library. */
  inLibrary: boolean;
  /** The definition's UHD kind (absent: a module). */
  kind?: string;
  manufacturer?: string;
  partNumber?: string;
  /** How many modules it holds, and how many artifacts it declares. */
  children: number;
  artifacts: number;
  /** How many entries of engineering data it carries (`domains`, `traits`, `requirements`, `constraints`). */
  details: number;
}

export function isBlankBlock(f: BlankBlockFacts): boolean {
  if (f.inLibrary || (f.kind !== undefined && f.kind !== "module")) return false;
  return f.children === 0 && f.artifacts === 0 && f.details === 0 && !f.manufacturer?.trim() && !f.partNumber?.trim();
}

/** A blank block's name and what it means: the label and tooltip of every view. */
export const BLANK_BLOCK_TEXT = {
  label: "Blank block",
  meaning: "No part chosen yet: a placeholder with a name and interfaces only. Pick a part from the library, or research one, to make it real.",
} as const;
