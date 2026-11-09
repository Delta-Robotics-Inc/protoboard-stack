/**
 * The headless render path: a board snapshot (or document) to a PNG, whole or a region, on chosen layers, through
 * headless Chrome. For the agent's images and for tests. Node only.
 *
 * It uses the stack's own DevTools client (@protoboardai/core/cdp: the browser core finds, SwiftShader WebGL by
 * default so it renders the same with or without a GPU; `PROTOBOARD_RENDER_BACKEND=gpu|auto` changes that) and
 * the same renderer the layout screen draws with, bundled once per process. One page is kept warm per renderer:
 * a run of crops is a view change each.
 *
 *   const r = await createHeadlessRenderer();
 *   const png = await r.render(service.snapshot(), { width: 1200, height: 900, layers: "routing" });
 *   await r.close();
 */
import { fileURLToPath } from "node:url";
import { launchBrowser, type Browser, type GlBackendRequest } from "@protoboardai/core/cdp";
import type { BoardDocument, BoardSnapshot } from "../board.js";
import { bundleBrowser } from "./bundle.js";
import type { PagePayload, PageRenderOptions } from "./page.js";

export type HeadlessRenderOptions = Partial<PageRenderOptions> & { width?: number; height?: number; dpr?: number };

export interface HeadlessRenderer {
  /** Load a board (when it is not the one loaded) and render it to PNG bytes. */
  render(board: BoardSnapshot | BoardDocument, options?: HeadlessRenderOptions): Promise<Buffer>;
  /** Pixel comparison of two PNGs of the same size: the fraction of pixels that differ by more than `threshold` (0-255 per channel). */
  diff(a: Buffer, b: Buffer, threshold?: number): Promise<{ sameSize: boolean; ratio: number; mean: number; nonBackground: number }>;
  /** What the last render reported (time in the page, view, renderer stats). */
  last?: unknown;
  readonly backend: Browser["backend"];
  close(): Promise<void>;
}

let bundled: Promise<string> | undefined;
/** The page's script (built once per process). */
export function pageScript(): Promise<string> {
  bundled ??= bundleBrowser(fileURLToPath(new URL("./page.ts", import.meta.url)));
  return bundled;
}

function payloadOf(board: BoardSnapshot | BoardDocument): { payload: PagePayload; key: string } {
  const snap = "doc" in board ? board : undefined;
  const doc: BoardDocument = snap ? snap.doc : (board as BoardDocument);
  const records = [...doc.records.values()];
  const payload: PagePayload = { records, ...(doc.netlist ? { netlist: doc.netlist } : {}), ...(snap ? { epoch: snap.epoch, seq: snap.seq } : {}) };
  // a document is immutable: the same object is the same board
  return { payload, key: snap ? `${snap.epoch}:${snap.seq}` : "" };
}

export async function createHeadlessRenderer(options: { backend?: GlBackendRequest } = {}): Promise<HeadlessRenderer> {
  const [script, browser] = await Promise.all([pageScript(), launchBrowser({ backend: options.backend ?? "swiftshader", purpose: "Board images are rendered with a headless Chromium-family browser", echoErrors: false })]);
  await browser.navigate("about:blank");
  await browser.evaluate(`${script};true`);
  let loaded: BoardDocument | undefined;
  let loadedKey = "";
  let dpr = 1;
  const r: HeadlessRenderer = {
    backend: browser.backend,
    async render(board, o = {}) {
      const width = Math.round(o.width ?? 1200);
      const height = Math.round(o.height ?? 900);
      const scale = o.dpr ?? 1;
      if (scale !== dpr || !loaded) {
        await browser.setViewport(Math.max(width, 64), Math.max(height, 64), scale);
        dpr = scale;
      } else await browser.setViewport(Math.max(width, 64), Math.max(height, 64), scale);
      const doc = "doc" in board ? board.doc : board;
      const { payload, key } = payloadOf(board);
      if (doc !== loaded || key !== loadedKey) {
        await browser.evaluate(`window.__pcb.load(${JSON.stringify(payload)})`);
        loaded = doc;
        loadedKey = key;
      }
      const { dpr: _d, ...rest } = o;
      r.last = await browser.evaluate(`window.__pcb.render(${JSON.stringify({ ...rest, width, height })})`);
      const errors = browser.takeErrors();
      if (errors.length) throw new Error(`the render page failed: ${errors.join("; ")}`);
      return browser.screenshot({ x: 0, y: 0, width, height, scale: 1 });
    },
    async diff(a, b, threshold = 24) {
      return browser.evaluate(`window.__pcb.diff(${JSON.stringify(a.toString("base64"))}, ${JSON.stringify(b.toString("base64"))}, ${threshold})`);
    },
    close: () => browser.close(),
  };
  return r;
}

/** One render with a fresh browser (for a single image; keep a renderer for several). */
export async function renderBoardPng(board: BoardSnapshot | BoardDocument, options: HeadlessRenderOptions = {}): Promise<Buffer> {
  const r = await createHeadlessRenderer();
  try {
    return await r.render(board, options);
  } finally {
    await r.close();
  }
}
