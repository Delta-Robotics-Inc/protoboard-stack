/**
 * Board service proposals for a page (Node): the service's `Proposal` without the items' operations
 * (`pageProposal`), a preview as the ghost to draw (`pagePreview`), and a router's result as the inputs of the
 * service's proposals (`routeProposalInputs`, through `proposeRouteResult` of `@protoboardai/board-edit/service`, so
 * a host that is only a service's client makes the same proposals the service's own process would).
 */
import type { Actor, BoardRecord, BoardService, Proposal, ProposalPreview, ProposeInput } from "@protoboardai/board/node";
import type * as EditService from "@protoboardai/board-edit/service";
import type * as RouteModule from "@protoboardai/board-route";
import type { GhostCopper, PageActor, PageProposal, PageProposalPreview, PageScore } from "../types.js";

let editModule: Promise<typeof EditService | undefined> | undefined;
/** The editing kernel's service side (live checks, router results as proposals), when it is installed. */
export function loadEditModule(): Promise<typeof EditService | undefined> {
  editModule ??= import("@protoboardai/board-edit/service").then(
    (m) => m as typeof EditService,
    () => undefined,
  );
  return editModule;
}

const actorOf = (a: Actor): PageActor => ({ kind: a.kind, id: a.id, ...(a.name ? { name: a.name } : {}) });

const scoreOf = (v: unknown): PageScore | undefined => {
  const s = v as Partial<PageScore> | undefined;
  if (!s || typeof s.open !== "number") return undefined;
  return { open: s.open, errors: Number(s.errors ?? 0), vias: Number(s.vias ?? 0), length: Number(s.length ?? 0), openNets: Array.isArray(s.openNets) ? s.openNets.map(String) : [] };
};

/** A proposal as a page lists it (no operations). */
export function pageProposal(p: Proposal): PageProposal {
  const current = scoreOf(p.scores?.current);
  const candidate = scoreOf(p.scores?.candidate);
  return {
    id: p.id,
    title: p.title,
    actor: actorOf(p.actor),
    source: p.source,
    base: { ...p.base },
    status: p.status,
    items: p.items.map((i) => ({ key: i.key, label: i.label, status: i.status, nets: [...i.nets], summary: i.summary, ops: i.ops.length, ...(i.acceptedSeq !== undefined ? { acceptedSeq: i.acceptedSeq } : {}) })),
    summary: p.summary,
    before: { ...p.before },
    after: { ...p.after },
    touched: p.touched.length,
    ...(current || candidate ? { scores: { ...(current ? { current } : {}), ...(candidate ? { candidate } : {}) } } : {}),
    changeSet: { ...p.changeSet },
    ...(p.stale ? { stale: { seq: p.stale.seq, actor: actorOf(p.stale.actor), changed: p.stale.changed.slice(0, 20) } } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
    ...(p.rejected ? { rejected: { by: actorOf(p.rejected.by), ...(p.rejected.reason ? { reason: p.rejected.reason } : {}) } } : {}),
    createdAt: p.createdAt,
  };
}

/** The copper among records (tracks and vias), as the ghost draws it. */
export function copperOf(records: readonly BoardRecord[]): GhostCopper {
  const g: GhostCopper = { segments: [], vias: [] };
  for (const r of records) {
    if (r.kind === "track") g.segments.push({ ...(r.net ? { net: r.net } : {}), layer: r.layer, width: r.width, start: { x: r.start.x, y: r.start.y }, end: { x: r.end.x, y: r.end.y } });
    else if (r.kind === "via") g.vias.push({ ...(r.net ? { net: r.net } : {}), x: r.x, y: r.y, outer_diameter: r.outer_diameter });
  }
  return g;
}

/** A preview as the page draws it: what is added (the blue ghost), what is removed (marked), what changes in place. */
export function pagePreview(pv: ProposalPreview, items?: string[]): PageProposalPreview {
  // a moved track is a change: its new place is drawn as added copper, its old one as removed
  const movedAfter = pv.changed.map((c) => c.after);
  const movedBefore = pv.changed.map((c) => c.before);
  return {
    id: pv.id,
    seq: pv.seq,
    stale: pv.stale,
    valid: pv.valid,
    ...(pv.error ? { error: pv.error } : {}),
    ...(items ? { items } : {}),
    added: copperOf([...pv.added, ...movedAfter]),
    removed: { ...copperOf([...pv.removed, ...movedBefore]), ids: pv.removed.map((r) => r.id) },
    changed: pv.changed.map((c) => c.after.id),
    counts: { added: pv.added.length, removed: pv.removed.length, changed: pv.changed.length },
  };
}

/**
 * The proposals a router's result becomes (one per router step, one item per net), as `proposeRouteResult` makes
 * them: their actors and inputs, for a host to send to the service it is a client of.
 */
export async function routeProposalInputs(rp: RouteModule.RouteProposal, epoch: string): Promise<{ actor: Actor; input: ProposeInput }[] | { error: string }> {
  const mod = await loadEditModule();
  if (!mod) return { error: "the editing kernel is not installed (package @protoboardai/board-edit)" };
  const calls: { actor: Actor; input: ProposeInput }[] = [];
  // the kernel's function reads the service's epoch and calls `propose` once per step; this records the calls
  const recorder = {
    epoch,
    propose(actor: Actor, input: ProposeInput) {
      calls.push({ actor, input });
      return { status: "invalid" as const, error: "recorded" };
    },
  } as unknown as BoardService;
  const r = mod.proposeRouteResult(recorder, rp);
  if (!calls.length) return { error: r.find((x) => x.status === "invalid")?.status === "invalid" ? (r[0] as { error: string }).error : "the route result made no proposal" };
  return calls;
}
