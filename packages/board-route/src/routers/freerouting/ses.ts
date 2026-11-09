/**
 * The Specctra session (SES) reader: the wires and vias a router wrote, as routed copper in nanometers. Wires and
 * vias marked `fix` or `protect` are copper the job supplied and are skipped. Written from the public Specctra
 * format description.
 */
import type { RoutedSegment, RoutedVia } from "../../ops.js";
import { parseViaPadstackName } from "./dsn.js";
import { child, children, parseSExpr, type SNode } from "./sexpr.js";

const NM_PER_UNIT: Record<string, number> = { um: 1_000, mm: 1_000_000, mil: 25_400, inch: 25_400_000, cm: 10_000_000 };

/** Nanometers per file unit from a `(resolution <unit> <n>)` node: values are integers of 1/n unit. */
export function resolutionScale(node: SNode[] | undefined): number {
  if (!node) return NM_PER_UNIT.um / 10;
  const unit = String(node[1]).toLowerCase();
  const per = Number(node[2]);
  const nm = NM_PER_UNIT[unit];
  if (!nm || !(per > 0)) throw new Error(`unknown resolution ${String(node[1])} ${String(node[2])}`);
  return nm / per;
}

export interface SesRead {
  segments: RoutedSegment[];
  vias: RoutedVia[];
  messages: string[];
  /** Wires and vias skipped because they were marked fix or protect (job copper). */
  skipped: number;
}

/**
 * Read a session file. `nets` maps net names in the file to ours; `stack` is the board's copper layers in order
 * (to give vias their span from the padstack's shapes); `defaultHole` is used when a padstack's name does not
 * carry its hole.
 */
export function parseSes(text: string, nets: Map<string, string>, stack: readonly string[], defaultHole: number): SesRead {
  const root = parseSExpr(text).find((n): n is SNode[] => Array.isArray(n) && n[0] === "session");
  if (!root) throw new Error("not a Specctra session file: no (session ...)");
  const routes = child(root, "routes");
  const messages: string[] = [];
  const segments: RoutedSegment[] = [];
  const vias: RoutedVia[] = [];
  let skipped = 0;
  if (!routes) return { segments, vias, messages: ["the session has no routes"], skipped };
  const scale = resolutionScale(child(routes, "resolution"));
  const v = (s: SNode) => Math.round(Number(s) * scale);
  // via padstacks from the library: diameter and layers
  const stacks = new Map<string, { outer: number; layers: string[] }>();
  for (const ps of children(child(routes, "library_out"), "padstack")) {
    const name = String(ps[1]);
    const shapes = children(ps, "shape").map((s) => s[1]).filter((x): x is SNode[] => Array.isArray(x));
    const circles = shapes.filter((s) => s[0] === "circle");
    if (!circles.length) continue;
    stacks.set(name, { outer: Math.max(...circles.map((c) => v(c[2]))), layers: circles.map((c) => String(c[1])) });
  }
  const typeOf = (n: SNode[]) => {
    const t = child(n, "type");
    return t ? String(t[1]) : undefined;
  };
  let unknownNets = 0;
  for (const netNode of children(child(routes, "network_out"), "net")) {
    const fileNet = String(netNode[1]);
    const net = nets.get(fileNet);
    if (!net) {
      unknownNets++;
      continue;
    }
    for (const w of children(netNode, "wire")) {
      const t = typeOf(w);
      if (t === "fix" || t === "protect") {
        skipped++;
        continue;
      }
      const path = child(w, "path") ?? child(w, "polyline_path");
      if (!path) {
        messages.push(`a wire of net ${net} has no path (arcs and other shapes are not read)`);
        continue;
      }
      const layer = String(path[1]);
      const width = v(path[2]);
      const coords = path.slice(3).filter((x) => !Array.isArray(x)).map((x) => v(x));
      for (let i = 0; i + 3 < coords.length; i += 2)
        segments.push({ net, layer, width, start: { x: coords[i], y: coords[i + 1] }, end: { x: coords[i + 2], y: coords[i + 3] } });
    }
    for (const vn of children(netNode, "via")) {
      const t = typeOf(vn);
      if (t === "fix" || t === "protect") {
        skipped++;
        continue;
      }
      const name = String(vn[1]);
      const x = v(vn[2]);
      const y = v(vn[3]);
      const fromName = parseViaPadstackName(name);
      const lib = stacks.get(name);
      const outer = fromName?.outer ?? lib?.outer;
      if (!outer) {
        messages.push(`via ${name} of net ${net}: unknown padstack size, skipped`);
        continue;
      }
      const layers = (fromName?.layers ?? lib?.layers ?? []).filter((l) => stack.includes(l)).sort((a, b) => stack.indexOf(a) - stack.indexOf(b));
      vias.push({ net, x, y, outer, hole: fromName?.hole ?? defaultHole, ...(layers.length >= 2 ? { from: layers[0], to: layers[layers.length - 1] } : {}) });
    }
  }
  if (unknownNets) messages.push(`${unknownNets} net(s) in the session are not in this job; their copper was not read`);
  return { segments, vias, messages, skipped };
}
