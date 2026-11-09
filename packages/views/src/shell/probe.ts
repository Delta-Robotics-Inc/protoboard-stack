/**
 * The cross-probe channel between the editor's screens: a selection of parts and nets, keyed by UHD instance path,
 * reference designator and net name (never by a screen's own ids), published by one screen and shown by the other.
 * In one page it is a module-level channel that keeps the last probe (a screen opened later shows it); across pages
 * and webviews of one origin it also travels on a BroadcastChannel. No Node.
 */
export interface ProbePart {
  path?: string;
  ref?: string;
}

export interface Probe {
  source: "schematic" | "layout";
  /** the UHD board the selection belongs to, when known */
  board?: string;
  parts: ProbePart[];
  nets: string[];
  at: number;
}

const listeners = new Set<(p: Probe) => void>();
let last: Probe | undefined;
const CHANNEL = "protoboard.cross-probe";
let bc: BroadcastChannel | undefined;
function channel(): BroadcastChannel | undefined {
  if (bc || typeof BroadcastChannel === "undefined") return bc;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (ev) => deliver(ev.data as Probe, false);
  } catch {
    bc = undefined;
  }
  return bc;
}

function deliver(p: Probe, broadcast: boolean) {
  if (!p || !Array.isArray(p.parts) || !Array.isArray(p.nets)) return;
  last = p;
  for (const l of [...listeners]) {
    try {
      l(p);
    } catch (e) {
      console.error(e);
    }
  }
  if (broadcast) channel()?.postMessage(p);
}

/** Publish a selection (an empty one clears the other screen's probe). */
export function publishProbe(p: Omit<Probe, "at">): void {
  deliver({ ...p, at: Date.now() }, true);
}

/** Probes from now on (a screen ignores its own by `source`). */
export function onProbe(listener: (p: Probe) => void): () => void {
  channel();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const lastProbe = (): Probe | undefined => last;

/** What the layout screen's view offers a probe: its selection and its lit nets (BoardView). */
export interface LayoutProbeView {
  setSelection(ids: readonly string[]): void;
  setHighlight(nets: readonly string[], dim?: boolean): void;
}

type FootprintLike = { kind: string; id: string; ref?: string; path?: string; net?: string };

/** The layout's footprint ids a probe names (by instance path, else by reference), and its nets. */
export function probeToLayout(p: Probe, records: Iterable<FootprintLike>): { ids: string[]; nets: string[] } {
  const paths = new Set(p.parts.flatMap((x) => (x.path ? [x.path] : [])));
  const refs = new Set(p.parts.flatMap((x) => (x.ref ? [x.ref] : [])));
  const ids: string[] = [];
  for (const r of records) {
    if (r.kind !== "footprint") continue;
    const byPath = !!r.path && paths.has(r.path);
    const byRef = !!r.ref && refs.has(r.ref) && !(r.path && paths.size && !paths.has(r.path) && p.parts.every((x) => x.path));
    if (byPath || byRef) ids.push(r.id);
  }
  return { ids, nets: [...p.nets] };
}

/** A probe from the layout's selection: the footprints' paths and references, and the nets of selected copper. */
export function probeFromLayout(ids: readonly string[], records: { get(id: string): FootprintLike | undefined }, board?: string): Omit<Probe, "at"> {
  const parts: ProbePart[] = [];
  const nets = new Set<string>();
  for (const id of ids) {
    const r = records.get(id);
    if (!r) continue;
    if (r.kind === "footprint") parts.push({ ...(r.path ? { path: r.path } : {}), ...(r.ref ? { ref: r.ref } : {}) });
    else if (r.net) nets.add(r.net);
  }
  return { source: "layout", ...(board ? { board } : {}), parts, nets: [...nets] };
}

/**
 * Show probes from the schematic on a layout view (selection outlines and lit nets) and publish the layout's own
 * selection: `attach` once the view exists, `selected` on each selection change. The layout screen itself is not
 * changed; its host wrapper wires this.
 */
export function layoutProbe(records: () => Iterable<FootprintLike> & { get?(id: string): FootprintLike | undefined }, board?: string) {
  let view: LayoutProbeView | undefined;
  let quiet = false;
  // the layout screen reports its empty selection when it opens: that clears nothing it did not set
  let had = false;
  const show = (p: Probe) => {
    if (!view || p.source === "layout") return;
    const m = probeToLayout(p, records());
    const v = view;
    // after the layout screen's own effects of this frame (its empty selection on opening would clear the probe)
    const paint = () => {
      quiet = true;
      v.setSelection(m.ids);
      v.setHighlight(m.nets, m.nets.length > 0);
      quiet = false;
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(paint, 0));
    else paint();
  };
  const unsub = onProbe(show);
  return {
    attach(v: LayoutProbeView) {
      view = v;
      const p = lastProbe();
      if (p) show(p);
    },
    selected(ids: readonly string[]) {
      if (quiet || (!ids.length && !had)) return;
      had = ids.length > 0;
      const recs = records();
      const map = new Map<string, FootprintLike>();
      for (const r of recs) map.set(r.id, r);
      publishProbe(probeFromLayout(ids, map, board));
    },
    close: unsub,
  };
}
