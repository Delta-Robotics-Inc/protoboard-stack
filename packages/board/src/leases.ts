/**
 * Leases with fencing tokens (contract section 9.5), ported from the 3D viewer's lease table
 * (@deltarobotics/uhd-viewer, src/cad/state/leases.ts, Apache-2.0) and extended for a board: a lease covers UHD
 * instance path subtrees, nets, or a region of the board on some layers.
 *
 * - `claim` grants a lease when no other actor's live lease overlaps; the holder's own overlapping lease is
 *   replaced. The fencing token rises with every grant and every revocation, so a paused holder whose lease
 *   ended cannot write with it.
 * - A lease expires after `ttlMs` (DEFAULT 120 s, 1 s to 10 min) unless a write quoting its token renews it.
 * - A person's edit inside an agent's or router's lease revokes it; `revokeAll` is "take over".
 * - The last 64 ended leases are kept so a holder quoting an old token learns what happened.
 */
import { boxesMeet, type Box } from "./geometry.js";
import type { Actor } from "./ops/registry.js";

export const DEFAULT_LEASE_TTL_MS = 120_000;
export const MAX_LEASE_TTL_MS = 600_000;
export const MIN_LEASE_TTL_MS = 1_000;
export const MAX_LEASE_ROOTS = 32;
export const MAX_LEASES = 64;
const ENDED_KEPT = 64;

export interface LeaseRegion {
  box: Box;
  /** Absent: every layer. */
  layers?: string[];
}

export interface Lease {
  id: string;
  token: number;
  holder: Actor;
  /** UHD instance path subtrees ("" is the whole board). */
  roots: string[];
  nets: string[];
  region?: LeaseRegion;
  purpose: string;
  grantedAt: number;
  expiresAt: number;
  ttlMs: number;
}

export interface EndedLease extends Lease {
  endedAt: number;
  reason: "released" | "expired" | "revoked" | "taken-over";
  by?: Actor;
  detail?: string;
}

export interface LeaseClaim {
  roots?: string[];
  nets?: string[];
  region?: LeaseRegion;
  purpose: string;
  ttlMs?: number;
}

/** What a changed object touches, for lease checks: its footprint path (or reference), its nets, its box and layers. */
export interface Scope {
  id: string;
  paths: string[];
  nets: string[];
  box?: Box;
  layers: string[];
}

const norm = (p: string) => p.split("/").filter(Boolean).join("/");
export const covers = (root: string, p: string): boolean => {
  const r = norm(root);
  const q = norm(p);
  return r === "" || q === r || q.startsWith(`${r}/`);
};
const sameActor = (a: Actor, b: Actor) => a.kind === b.kind && a.id === b.id;
const layersMeet = (a: string[] | undefined, b: string[] | undefined) => !a || !b || a.some((l) => b.includes(l));

/** Whether a lease covers a scope. */
export function leaseCovers(l: Pick<Lease, "roots" | "nets" | "region">, s: Scope): boolean {
  if (l.roots.some((r) => s.paths.some((p) => covers(r, p)))) return true;
  if (l.nets.some((n) => s.nets.includes(n))) return true;
  if (l.region && s.box && boxesMeet(l.region.box, s.box) && layersMeet(l.region.layers, s.layers)) return true;
  return false;
}

function leasesOverlap(a: Pick<Lease, "roots" | "nets" | "region">, b: Pick<Lease, "roots" | "nets" | "region">): boolean {
  if (a.roots.some((x) => b.roots.some((y) => covers(x, y) || covers(y, x)))) return true;
  if (a.nets.some((n) => b.nets.includes(n))) return true;
  if (a.region && b.region && boxesMeet(a.region.box, b.region.box) && layersMeet(a.region.layers, b.region.layers)) return true;
  return false;
}

export type ClaimResult = { lease: Lease } | { refused: Lease } | { error: string };

export interface LeaseTable {
  live(): Lease[];
  ended(): EndedLease[];
  claim(holder: Actor, claim: LeaseClaim): ClaimResult;
  release(holder: Actor, id?: string): EndedLease[];
  /** Another actor's live lease covering one of the scopes. */
  blocking(actor: Actor, scopes: Scope[]): Lease | undefined;
  /** Whether `actor` may write the scopes with `token` (undefined: it may). */
  fence(actor: Actor, scopes: Scope[], token: number | undefined): { lease?: Lease | EndedLease; message: string } | undefined;
  renew(actor: Actor, token: number): void;
  /** A person's edit: every agent or router lease covering a scope is revoked. */
  revokeCovering(scopes: Scope[], by: Actor, detail: string): EndedLease[];
  revokeAll(by: Actor): EndedLease[];
  readonly fenceToken: number;
}

export function createLeaseTable(now: () => number = () => Date.now()): LeaseTable {
  let leases: Lease[] = [];
  let ended: EndedLease[] = [];
  let token = 0;
  let serial = 0;
  const copy = (l: Lease): Lease => ({ ...l, roots: [...l.roots], nets: [...l.nets], holder: { ...l.holder }, ...(l.region ? { region: { box: { ...l.region.box }, ...(l.region.layers ? { layers: [...l.region.layers] } : {}) } } : {}) });
  const end = (l: Lease, reason: EndedLease["reason"], by?: Actor, detail?: string): EndedLease => {
    const e: EndedLease = { ...copy(l), endedAt: now(), reason, ...(by ? { by: { ...by } } : {}), ...(detail ? { detail } : {}) };
    ended.push(e);
    if (ended.length > ENDED_KEPT) ended = ended.slice(-ENDED_KEPT);
    return e;
  };
  const sweep = () => {
    const t = now();
    const gone = leases.filter((l) => l.expiresAt <= t);
    if (!gone.length) return;
    leases = leases.filter((l) => l.expiresAt > t);
    for (const l of gone) end(l, "expired");
  };
  return {
    live() {
      sweep();
      return leases.map(copy);
    },
    ended: () => ended.map((e) => ({ ...e })),
    claim(holder, c) {
      sweep();
      if (holder.kind === "human" || holder.kind === "system") return { error: "only agents, routers and hosts take leases (the person never needs one)" };
      const roots = c.roots ?? [];
      const nets = c.nets ?? [];
      if (roots.length > MAX_LEASE_ROOTS || nets.length > 1000) return { error: `a lease names at most ${MAX_LEASE_ROOTS} roots and 1000 nets` };
      if (!roots.every((r) => typeof r === "string" && r.length <= 512 && !/[\u0000-\u001f]/.test(r))) return { error: "roots are UHD instance paths" };
      if (!nets.every((n) => typeof n === "string" && n.length > 0 && n.length <= 200)) return { error: "nets are net names" };
      if (!roots.length && !nets.length && !c.region) return { error: "a lease covers roots, nets or a region" };
      const purpose = typeof c.purpose === "string" ? c.purpose.replace(/[\u0000-\u001f]/g, " ").trim() : "";
      if (!purpose || purpose.length > 120) return { error: "purpose must say in a few words what you will do there (at most 120 characters)" };
      const ttl = c.ttlMs === undefined ? DEFAULT_LEASE_TTL_MS : Number(c.ttlMs);
      if (!Number.isFinite(ttl) || ttl < MIN_LEASE_TTL_MS || ttl > MAX_LEASE_TTL_MS) return { error: `ttlMs must be between ${MIN_LEASE_TTL_MS} and ${MAX_LEASE_TTL_MS}` };
      const want = { roots: [...new Set(roots.map(norm))], nets: [...new Set(nets)], ...(c.region ? { region: c.region } : {}) };
      const other = leases.find((l) => !sameActor(l.holder, holder) && leasesOverlap(l, want));
      if (other) return { refused: copy(other) };
      const replaced = leases.filter((l) => sameActor(l.holder, holder) && leasesOverlap(l, want));
      if (leases.length - replaced.length >= MAX_LEASES) return { error: `at most ${MAX_LEASES} live leases on one board` };
      for (const l of replaced) end(l, "released", holder, "replaced by a new claim");
      leases = leases.filter((l) => !replaced.includes(l));
      const t = now();
      const lease: Lease = { id: `lease-${++serial}`, token: ++token, holder: { ...holder }, ...want, purpose, grantedAt: t, expiresAt: t + ttl, ttlMs: ttl };
      leases.push(lease);
      return { lease: copy(lease) };
    },
    release(holder, id) {
      sweep();
      const mine = leases.filter((l) => sameActor(l.holder, holder) && (id === undefined || l.id === id));
      leases = leases.filter((l) => !mine.includes(l));
      return mine.map((l) => end(l, "released", holder));
    },
    blocking(actor, scopes) {
      sweep();
      return leases.find((l) => !sameActor(l.holder, actor) && scopes.some((s) => leaseCovers(l, s)));
    },
    fence(actor, scopes, given) {
      sweep();
      let rest = scopes;
      if (given !== undefined) {
        const live = leases.find((l) => l.token === given);
        if (!live || !sameActor(live.holder, actor)) {
          const old = ended.find((e) => e.token === given && sameActor(e.holder, actor));
          return { ...(old ? { lease: old } : {}), message: old ? `lease ${old.id} (token ${given}) ${old.reason === "revoked" ? "was revoked by the person (see lease.detail)" : old.reason === "taken-over" ? "ended: the person took over" : old.reason}; re-read, then claim again` : `token ${given} names no live lease of yours; claim again` };
        }
        rest = scopes.filter((s) => !leaseCovers(live, s));
        if (!rest.length) return undefined;
      }
      const held = leases.find((l) => sameActor(l.holder, actor) && rest.some((s) => leaseCovers(l, s)));
      if (held) return { lease: copy(held), message: `you hold lease ${held.id} over this: quote its leaseToken ${held.token}` };
      const was = [...ended].reverse().find((e) => sameActor(e.holder, actor) && rest.some((s) => leaseCovers(e, s)));
      if (was && was.reason !== "released") return { lease: was, message: `your lease ${was.id} here ${was.reason === "expired" ? "expired" : was.reason === "taken-over" ? "ended when the person took over" : "was revoked by the person (see lease.detail)"}; re-read, then claim again before writing here` };
      return undefined;
    },
    renew(actor, given) {
      sweep();
      const l = leases.find((x) => x.token === given && sameActor(x.holder, actor));
      if (l) l.expiresAt = now() + l.ttlMs;
    },
    revokeCovering(scopes, by, detail) {
      sweep();
      const hit = leases.filter((l) => (l.holder.kind === "agent" || l.holder.kind === "router") && scopes.some((s) => leaseCovers(l, s)));
      leases = leases.filter((l) => !hit.includes(l));
      if (hit.length) token++;
      return hit.map((l) => end(l, "revoked", by, detail));
    },
    revokeAll(by) {
      sweep();
      const hit = leases.filter((l) => l.holder.kind === "agent" || l.holder.kind === "router");
      leases = leases.filter((l) => !hit.includes(l));
      if (hit.length) token++;
      return hit.map((l) => end(l, "taken-over", by));
    },
    get fenceToken() {
      return token;
    },
  };
}
