/** KiCad layer names to the board document's layers. */
import { COPPER_LAYERS, type AnyLayer, type CopperLayer } from "@protoboardai/board";
import { atomsOf, kid, str, isList, type SList } from "../sexpr.js";

const DRAWING: Record<string, AnyLayer> = {
  "F.SilkS": "top_silkscreen",
  "B.SilkS": "bottom_silkscreen",
  "F.Mask": "top_soldermask",
  "B.Mask": "bottom_soldermask",
  "F.Paste": "top_paste",
  "B.Paste": "bottom_paste",
  "F.Fab": "top_fabrication",
  "B.Fab": "bottom_fabrication",
  "F.CrtYd": "top_courtyard",
  "B.CrtYd": "bottom_courtyard",
  "Edge.Cuts": "edge_cuts",
};
/** KiCad's user layers, all drawn on `user_notes`. */
const USER = /^(Dwgs\.User|Cmts\.User|Eco1\.User|Eco2\.User|User\.\d+)$/;

const rank = (name: string) => (name === "F.Cu" ? -1 : name === "B.Cu" ? 1e6 : Number(name.replace(/\D/g, "")));

export class KicadLayers {
  /** KiCad copper layer names, top to bottom. */
  readonly copperNames: string[];
  private readonly copperMap = new Map<string, CopperLayer>();

  constructor(root: SList) {
    const names: string[] = [];
    for (const l of kid(root, "layers")?.slice(1) ?? []) {
      if (!isList(l)) continue;
      const n = str(l[1]);
      if (n && /\.Cu$/.test(n)) names.push(n);
    }
    names.sort((a, b) => rank(a) - rank(b));
    if (names.length > COPPER_LAYERS.length) throw new Error(`the board has ${names.length} copper layers; the board document holds at most ${COPPER_LAYERS.length}`);
    this.copperNames = names;
    names.forEach((n, i) => {
      const ours: CopperLayer = i === 0 ? "top" : i === names.length - 1 ? "bottom" : (`inner${i}` as CopperLayer);
      this.copperMap.set(n, ours);
    });
    if (names.length === 1) this.copperMap.set(names[0], "top");
  }

  get copper(): CopperLayer[] {
    return this.copperNames.map((n) => this.copperMap.get(n)!);
  }

  copperOf(name: string | undefined): CopperLayer | undefined {
    return name ? this.copperMap.get(name) : undefined;
  }

  /** A drawing or copper layer: undefined for layers with no home (adhesive, margin). */
  layerOf(name: string | undefined): { layer: AnyLayer; user?: boolean } | undefined {
    if (!name) return undefined;
    const c = this.copperMap.get(name);
    if (c) return { layer: c };
    const d = DRAWING[name];
    if (d) return { layer: d };
    if (USER.test(name)) return { layer: "user_notes", user: true };
    return undefined;
  }

  /** Expand wildcards (`*.Cu`, `F&B.Cu`, `*.Mask`, ...) into KiCad layer names. */
  expand(names: readonly string[]): string[] {
    const out = new Set<string>();
    for (const n of names) {
      if (n === "*.Cu") this.copperNames.forEach((c) => out.add(c));
      else if (n === "F&B.Cu") {
        out.add("F.Cu");
        out.add("B.Cu");
      } else if (n.startsWith("*.")) {
        out.add(`F.${n.slice(2)}`);
        out.add(`B.${n.slice(2)}`);
      } else if (n.startsWith("F&B.")) {
        out.add(`F.${n.slice(4)}`);
        out.add(`B.${n.slice(4)}`);
      } else out.add(n);
    }
    return [...out];
  }

  /** The copper layers of an item's `(layer ...)` or `(layers ...)`, in stack order. */
  copperLayersOf(e: SList): CopperLayer[] {
    const names = this.expand([...atomsOf(e, "layers"), ...atomsOf(e, "layer")]);
    const set = new Set(names.map((n) => this.copperMap.get(n)).filter((x): x is CopperLayer => !!x));
    return this.copper.filter((c) => set.has(c));
  }
}
