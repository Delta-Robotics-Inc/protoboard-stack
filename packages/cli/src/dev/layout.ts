/**
 * Layout edits from the viewer → `.protoboard/display.json` (PB-815).
 *
 * The viewer reports what the user changed as a `ViewerLayout`: dragged node
 * positions and link layouts (waypoints, label and harness-tab placement) per
 * drill level. The project keeps its diagram layout as display hints:
 * `diagram.layouts[<level>]`, a `LevelLayout` whose top-level nodes are
 * absolute and whose nodes inside a container are relative to it. This module
 * folds the first into the second.
 *
 * Two facts about the viewer (uhd-viewer 0.1.0) shape it:
 *
 * - Dragged positions arrive in absolute canvas coordinates for every node,
 *   children included (its Canvas adds the parent's offset before reporting a
 *   move). A child's relative position is its absolute position minus its
 *   container's, where the container is placed as the viewer places it: by
 *   its own edit, else by its hand position inside its own container.
 * - A level with a hand layout is not laid out automatically: a top-level
 *   node the hand layout does not name is put at the free spot nearest what
 *   it links to (uhd-viewer's fillMissing), and that spot moves whenever the
 *   rest of the layout does. So the first save of a level that has no hand
 *   layout yet names every node of the level, which pins them all.
 *   Those positions come from the page (`LayoutSnapshot`, read from the
 *   rendered diagram); without a snapshot that covers the edits, the level is
 *   not written and is reported as skipped.
 */

/** As in the viewer's host contract (`@deltarobotics/uhd-viewer`, `LinkLayout`). */
export interface LinkLayout {
  waypoints?: [number, number][];
  labelT?: number;
  labelFlip?: boolean;
  tabT?: number;
  tabFlip?: boolean;
}

/** As in the viewer's host contract (`ViewerLayout`): both maps keyed by drill level ("" = top). */
export interface ViewerLayout {
  positions: Record<string, Record<string, { x: number; y: number }>>;
  links: Record<string, Record<string, LinkLayout>>;
}

/** One level of `diagram.layouts` in display.json, as the viewer reads it. */
export interface LevelLayout {
  nodes: Record<string, { x?: number; y?: number; w?: number; h?: number }>;
  ports?: Record<string, string>;
  links?: Record<string, LinkLayout>;
}

export interface DisplayFile {
  schema?: string;
  diagram?: { layouts?: Record<string, LevelLayout>; [key: string]: unknown };
  [key: string]: unknown;
}

/** What the page sees on the canvas when it sends a layout: the level on screen. */
export interface LayoutSnapshot {
  /** Absolute position of every node drawn, by node id. */
  nodes: Record<string, { x: number; y: number }>;
  /** Ids of the edges drawn (a link's edges start with its id). */
  edges: string[];
}

export const DISPLAY_SCHEMA = "uhd.display/v0";

export interface LayoutMerge {
  display: DisplayFile;
  /** Levels whose layout changed. */
  levels: string[];
  /** Levels with edits that could not be written, and why. */
  skipped: { level: string; reason: string }[];
}

const parentOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : undefined);
const depth = (id: string) => id.split("/").length;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the snapshot shows the level these edits were made on. */
function shows(snapshot: LayoutSnapshot | undefined, nodes: string[], links: string[]): boolean {
  if (!snapshot) return false;
  if (!nodes.every((id) => snapshot.nodes[id])) return false;
  return links.every((id) => snapshot.edges.some((e) => e === id || e.startsWith(id)));
}

/**
 * Folds the viewer's edits into a display file. Returns a new display (the
 * input is not modified); `levels` is empty when nothing changed.
 */
export function applyViewerLayout(input: DisplayFile, layout: ViewerLayout, snapshot?: LayoutSnapshot): LayoutMerge {
  const display: DisplayFile = structuredClone(input ?? {});
  display.schema ??= DISPLAY_SCHEMA;
  display.diagram ??= {};
  display.diagram.layouts ??= {};
  const layouts = display.diagram.layouts;
  const levels: string[] = [];
  const skipped: LayoutMerge["skipped"] = [];

  for (const level of [...new Set([...Object.keys(layout.positions ?? {}), ...Object.keys(layout.links ?? {})])].sort()) {
    const moved = layout.positions?.[level] ?? {};
    const linkEdits = layout.links?.[level] ?? {};
    if (!Object.keys(moved).length && !Object.keys(linkEdits).length) continue;
    const before = layouts[level];
    let hand: LevelLayout;
    if (before) hand = structuredClone(before);
    else {
      // first save of an automatically laid out level: name every node it shows
      if (!shows(snapshot, Object.keys(moved), Object.keys(linkEdits))) {
        skipped.push({ level, reason: `level "${level}" has no saved layout yet and is not the one on screen; its edits stay in the viewer until it is saved from that level` });
        continue;
      }
      hand = { nodes: {} };
      const abs = snapshot!.nodes;
      for (const id of Object.keys(abs).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
        const parent = parentOf(id);
        const origin = parent && abs[parent] ? abs[parent] : { x: 0, y: 0 };
        hand.nodes[id] = { x: abs[id].x - origin.x, y: abs[id].y - origin.y };
      }
    }

    // absolute placement as the viewer computes it: a node's own edit, else its container's placement plus its hand offset
    const placed = new Map<string, { x: number; y: number }>();
    const absolute = (id: string): { x: number; y: number } => {
      const hit = placed.get(id);
      if (hit) return hit;
      const parent = parentOf(id);
      const own = moved[id];
      let at: { x: number; y: number };
      if (own) at = { x: own.x, y: own.y };
      else {
        const base = parent ? absolute(parent) : { x: 0, y: 0 };
        at = { x: base.x + (hand.nodes[id]?.x ?? 0), y: base.y + (hand.nodes[id]?.y ?? 0) };
      }
      placed.set(id, at);
      return at;
    };
    // containers before their children, so a child is placed against its container's new position
    for (const id of Object.keys(moved).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
      const parent = parentOf(id);
      const origin = parent ? absolute(parent) : { x: 0, y: 0 };
      const at = absolute(id);
      hand.nodes[id] = { ...hand.nodes[id], x: at.x - origin.x, y: at.y - origin.y };
    }
    if (Object.keys(linkEdits).length) {
      hand.links ??= {};
      for (const [id, edit] of Object.entries(linkEdits)) hand.links[id] = { ...hand.links[id], ...edit };
    }
    if (same(before, hand)) continue;
    layouts[level] = hand;
    levels.push(level);
  }
  return { display, levels, skipped };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The layout and snapshot from a request body, or a reason to refuse it. */
export function parseLayoutRequest(body: unknown): { layout: ViewerLayout; snapshot?: LayoutSnapshot; client?: string } | { error: string } {
  if (!record(body) || !record(body.layout)) return { error: "expected { layout: { positions, links } }" };
  const { positions = {}, links = {} } = body.layout as Record<string, unknown>;
  if (!record(positions) || !record(links)) return { error: "layout.positions and layout.links must be objects" };
  for (const [level, nodes] of Object.entries(positions)) {
    if (!record(nodes)) return { error: `positions["${level}"] must be an object` };
    for (const [id, p] of Object.entries(nodes)) if (!record(p) || !finite(p.x) || !finite(p.y)) return { error: `positions["${level}"]["${id}"] needs numeric x and y` };
  }
  for (const [level, byLink] of Object.entries(links)) {
    if (!record(byLink)) return { error: `links["${level}"] must be an object` };
    for (const [id, l] of Object.entries(byLink)) {
      if (!record(l)) return { error: `links["${level}"]["${id}"] must be an object` };
      const unknown = Object.keys(l).filter((k) => !["waypoints", "labelT", "labelFlip", "tabT", "tabFlip"].includes(k));
      if (unknown.length) return { error: `links["${level}"]["${id}"] has unknown keys ${unknown.join(", ")}` };
      if (l.waypoints !== undefined && !(Array.isArray(l.waypoints) && l.waypoints.every((w) => Array.isArray(w) && w.length === 2 && w.every(finite)))) return { error: `links["${level}"]["${id}"].waypoints must be [x, y] pairs` };
      for (const k of ["labelT", "tabT"] as const) if (l[k] !== undefined && !finite(l[k])) return { error: `links["${level}"]["${id}"].${k} must be a number` };
      for (const k of ["labelFlip", "tabFlip"] as const) if (l[k] !== undefined && typeof l[k] !== "boolean") return { error: `links["${level}"]["${id}"].${k} must be a boolean` };
    }
  }
  let snapshot: LayoutSnapshot | undefined;
  if (body.snapshot !== undefined) {
    const s = body.snapshot;
    if (!record(s) || !record(s.nodes) || !Array.isArray(s.edges) || !s.edges.every((e) => typeof e === "string")) return { error: "snapshot must be { nodes, edges }" };
    for (const [id, p] of Object.entries(s.nodes)) if (!record(p) || !finite(p.x) || !finite(p.y)) return { error: `snapshot.nodes["${id}"] needs numeric x and y` };
    snapshot = s as unknown as LayoutSnapshot;
  }
  return {
    layout: { positions: positions as ViewerLayout["positions"], links: links as ViewerLayout["links"] },
    ...(snapshot ? { snapshot } : {}),
    ...(typeof body.client === "string" ? { client: body.client.slice(0, 64) } : {}),
  };
}

/**
 * The display file's text: two-space JSON. When the file on disk escapes
 * non-ASCII characters (`…`, as Python's json module writes it) and
 * holds none literally, the new text escapes them too, so a layout save
 * does not rewrite lines nobody edited.
 */
export function formatDisplay(display: DisplayFile, previous?: string): string {
  const text = JSON.stringify(display, null, 2) + "\n";
  const escaped = previous !== undefined && /\\u(?:00[89a-fA-F][0-9a-fA-F]|0[1-9a-fA-F][0-9a-fA-F]{2}|[1-9a-fA-F][0-9a-fA-F]{3})/.test(previous) && !/[^\x00-\x7f]/.test(previous);
  return escaped ? text.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) : text;
}
