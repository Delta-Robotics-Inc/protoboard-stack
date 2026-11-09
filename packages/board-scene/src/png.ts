/**
 * PNG output through @resvg/resvg-js (already used by the stack's circuit tools), loaded on first use so the rest of
 * the package works where the native module is missing. The SVG carries no text elements (labels are stroke
 * paths), so no fonts are loaded and the PNG is the same on every machine with the same resvg version.
 */
import { createRequire } from "node:module";

type ResvgCtor = new (svg: string, options?: Record<string, unknown>) => { render(): { asPng(): Uint8Array; width: number; height: number } };
let ctor: ResvgCtor | undefined;

/** Whether PNG output is available here. */
export function pngAvailable(): boolean {
  try {
    load();
    return true;
  } catch {
    return false;
  }
}

function load(): ResvgCtor {
  if (!ctor) {
    const require = createRequire(import.meta.url);
    ctor = (require("@resvg/resvg-js") as { Resvg: ResvgCtor }).Resvg;
  }
  return ctor;
}

export interface PngOptions {
  /** Output width in pixels (default: the SVG's own size). */
  width?: number;
}

/** Rasterize an SVG made by `renderSvg`. */
export function svgToPng(svg: string, options: PngOptions = {}): { png: Uint8Array; width: number; height: number } {
  const Resvg = load();
  const r = new Resvg(svg, { fitTo: options.width ? { mode: "width", value: options.width } : { mode: "original" }, font: { loadSystemFonts: false }, shapeRendering: 2, imageRendering: 0 }).render();
  return { png: r.asPng(), width: r.width, height: r.height };
}
