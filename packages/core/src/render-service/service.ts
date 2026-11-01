/**
 * The render service (PB-1180): one warm headless browser per project, one
 * viewer page on the project's bundle, one job at a time.
 *
 * The CLI (`protoboard views service`, started on demand by `views capture`,
 * `views check` and the MCP server) builds one with the pieces only it has:
 * how to start a browser (`launchBrowser` from ../cdp.ts, GPU first) and how
 * to serve the viewer page (`protoboard dev`'s server without watching). The
 * service keeps both warm, rebuilds when the bundle on disk changed, and
 * idles out.
 *
 * A capture: the level's page and tab, the document mode (no chrome), the
 * size, the view state, the frame settled; then the plain frame (kept as the
 * tab's handoff snapshot), the legend from the viewer's own observe() and
 * pick, the overlay burned and as SVG, the encode loop under the transfer
 * limits, and a manifest a docs build can re-render from.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import type { BackendInfo, Browser, GlBackendRequest } from "../cdp.js";
import { captureSidecars, defaultCapturePath, removeServiceRecord, writeAtomic, writeServiceRecord, writeSnapshot } from "./files.js";
import { base64Bytes, firstEncode, loadTransferLimits, nextEncodeStep, planSize, type EncodeStep, type LoadedLimits } from "./limits.js";
import {
  activateTab,
  addOverlay,
  applyCadState,
  applyDiagramZoom,
  compareFrames,
  diagramExtent,
  hiddenAt,
  imageSize,
  levelUrl,
  matchTitle,
  observeCad,
  removeOverlay,
  setDocumentMode,
  viewRect,
  viewerProjection,
  waitDrawn,
  waitForTabs,
  viewStateOf,
  releaseDiagramZoom,
  FRAMES,
} from "./page.js";
import { buildLegend, fitState, OVERLAY_DARK, OVERLAY_LIGHT, overlaySvg, type RefNode } from "./project.js";
import { IdleTimer, SerialQueue } from "./queue.js";
import { CAPTURE_RESPONSE_SCHEMA, SERVICE_RECORD_SCHEMA, captureKey, imageKind, parseCaptureRequest, type CameraState, type CaptureRequest, type CaptureResponse, type ImageFormat, type LegendEntry, type ServiceRecord } from "./schema.js";

/** The viewer page the service drives: `protoboard dev`'s server for the project (watch off). */
export interface PageHost {
  url: string;
  bundleFile: string;
  /** Rebuild the bundle and push it into open pages; resolves when pushed. */
  rebuild(trigger?: string): Promise<unknown>;
  readonly version: number;
  close(): Promise<void>;
}

export interface RenderServiceOptions {
  root: string;
  launch: (options: { backend: GlBackendRequest; purpose: string; echoErrors: boolean }) => Promise<Browser>;
  startHost: () => Promise<PageHost>;
  /** A tab id's title at a level (the shells' rules: `@protoboardai/views/tabs`); undefined: match the titles shown. */
  tabTitle?: (level: string, view: string) => Promise<string | undefined>;
  backend?: GlBackendRequest;
  limits?: LoadedLimits;
  /** Idle timeout in ms (0: never). */
  idleMs?: number;
  onIdle?: () => void;
  log?: (line: string) => void;
  /** Seconds a tab may take to draw (default 120: a heavy model on SwiftShader). */
  drawTimeoutS?: number;
}

export interface ServiceHealth {
  ok: true;
  pid: number;
  root: string;
  revision: number;
  bundleHash: string;
  backend?: BackendInfo;
  browser: "running" | "not started";
  busy: boolean;
  queued: number;
  idleForMs: number;
  idleMs: number;
  captures: number;
  uptimeMs: number;
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RenderService {
  readonly queue = new SerialQueue();
  readonly idle: IdleTimer;
  readonly limits: LoadedLimits;
  private browser?: Browser;
  private host?: PageHost;
  private page?: { url: string; view?: string; css?: string; doc?: boolean };
  revision = 0;
  bundleHash = "";
  private drawnHash = "";
  private captures = 0;
  private readonly started = Date.now();
  private last = new Map<string, { plain: Buffer; response: CaptureResponse }>();
  private closed = false;

  constructor(private readonly o: RenderServiceOptions) {
    this.limits = o.limits ?? loadTransferLimits();
    this.idle = new IdleTimer(o.idleMs ?? 0, () => o.onIdle?.());
  }

  private log(line: string) {
    this.o.log?.(line);
  }

  health(): ServiceHealth {
    return {
      ok: true,
      pid: process.pid,
      root: this.o.root,
      revision: this.revision,
      bundleHash: this.bundleHash,
      ...(this.browser ? { backend: this.browser.backend } : {}),
      browser: this.browser?.alive() ? "running" : "not started",
      busy: this.queue.busy,
      queued: this.queue.pending,
      idleForMs: this.idle.idleForMs,
      idleMs: this.idle.ms,
      captures: this.captures,
      uptimeMs: Date.now() - this.started,
    };
  }

  /** Runs `job` with the warm browser and page host, one job at a time (views check, the doctor's capture test). */
  withPage<T>(job: (browser: Browser, host: PageHost) => Promise<T>): Promise<T> {
    return this.queue.run(() =>
      this.idle.during(async () => {
        const { browser, host } = await this.ensure();
        try {
          return await job(browser, host);
        } finally {
          // the job navigated the page: the next capture opens its own
          this.page = undefined;
        }
      }),
    );
  }

  /** Starts (or restarts) the browser and the page host; rebuilds when the bundle on disk changed since it was drawn. */
  private async ensure(): Promise<{ browser: Browser; host: PageHost; stale: boolean }> {
    if (this.closed) throw new Error("the render service is shutting down");
    if (!this.browser || !this.browser.alive()) {
      if (this.browser) this.log("the browser went away; starting it again");
      await this.browser?.close().catch(() => undefined);
      this.browser = await this.o.launch({ backend: this.o.backend ?? "auto", purpose: "The render service draws the viewer in a headless Chromium-family browser", echoErrors: false });
      this.page = undefined;
      const b = this.browser.backend;
      this.log(`browser: ${b.kind}${b.gl ? ` (${b.gl.renderer})` : ""}${b.fallback ? `; ${b.fallback}` : ""}, started in ${b.startMs} ms`);
    }
    if (!this.host) {
      const t0 = Date.now();
      this.host = await this.o.startHost();
      this.bundleHash = this.diskHash();
      this.drawnHash = this.bundleHash;
      this.revision = 1;
      this.log(`viewer page: ${this.host.url} (bundle ${this.bundleHash.slice(7, 19)}, ${Date.now() - t0} ms)`);
    }
    let stale = false;
    const disk = this.diskHash();
    if (disk !== this.drawnHash) {
      this.log("the bundle changed on disk: rebuilding the page's bundle");
      try {
        await this.host.rebuild("render service: the bundle changed on disk");
        this.bundleHash = this.diskHash();
        this.drawnHash = this.bundleHash;
        this.revision++;
        // the page hot-swaps from the dev server's push; a full reload is the fallback the next open does
        this.page = undefined;
      } catch (e) {
        stale = true;
        this.log(`rebuild failed, drawing the last bundle: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    return { browser: this.browser, host: this.host, stale };
  }

  private diskHash(): string {
    const f = this.host?.bundleFile;
    return f && existsSync(f) ? `sha256:${sha256(readFileSync(f))}` : "";
  }

  /** One capture (queued behind any running job). */
  capture(input: unknown): Promise<CaptureResponse> {
    const req = parseCaptureRequest(input);
    const queued = Date.now();
    return this.queue.run(() => this.idle.during(() => this.doCapture(req, Date.now() - queued)));
  }

  private async doCapture(req: CaptureRequest, queueMs: number): Promise<CaptureResponse> {
    const t0 = Date.now();
    const warnings: string[] = [];
    const { browser: b, host, stale } = await this.ensure();
    const drawTimeout = (this.o.drawTimeoutS ?? 120) * 1000;
    const theme = req.theme ?? (req.document ? "protoboard-light" : "protoboard-dark");
    const url = levelUrl(host.url, req.level, theme);
    const css = `${req.size.width}x${req.size.height}@${req.size.dpr}`;

    // the page: the level, at the size, the tab
    if (this.page?.css !== css || this.page?.url !== url) await b.setViewport(req.size.width, req.size.height, req.size.dpr);
    if (this.page?.url !== url) {
      await b.navigate(url);
      this.page = { url, css };
    }
    this.page.css = css;
    const shown = await waitForTabs(b, 60000);
    const resolved = await this.o.tabTitle?.(req.level, req.view).catch(() => undefined);
    const title = matchTitle(req.view, shown, resolved);
    if (!title) throw new Error(`no ${req.view} tab at ${req.level || "the top level"} (tabs shown: ${shown.join(", ") || "none"})`);
    await activateTab(b, title);
    this.page.view = title;
    await setDocumentMode(b, req.document);
    await b.evaluate(FRAMES);
    b.takeErrors();
    const drawn = await waitDrawn(b, req.view, drawTimeout);
    if (drawn.timedOut) warnings.push(`the ${title} tab did not settle in ${Math.round(drawTimeout / 1000)} s; captured as it was`);
    const pageMs = Date.now() - t0;

    // the view state (3D), or the zoom (2D)
    const isCad = !!drawn.panel.cad;
    let settleMs = 0;
    let zoomed = false;
    let size = { ...req.size };
    if (isCad) {
      const state = { ...(req.state ?? {}) };
      if (state.labels === undefined && req.annotate.length) state.labels = false;
      // a document capture with no camera of its own frames what is drawn, from where the camera looks (DEFAULT)
      const ownCamera = ["azimuth", "elevation", "distance", "target", "camera"].some((k) => k in state);
      const fitAsked = req.document && !ownCamera && state.fit !== false;
      delete state.fit;
      settleMs = await applyCadState(b, state, drawTimeout);
      if (fitAsked) {
        // framed after the rest of the state (an explode moves the parts), from the bounds as drawn now
        const obs = await observeCad(b);
        const rect = await viewRect(b);
        const boxes = (obs?.nodes ?? []).filter((n) => n.bounds && n.visible !== false && (n.kind === "body" || n.kind === "harness")).map((n) => n.bounds!);
        const fit = obs ? fitState(obs.camera, boxes, rect.width / Math.max(1, rect.height)) : undefined;
        if (fit) settleMs += await applyCadState(b, { ...fit, ...(state.labels !== undefined ? { labels: state.labels } : {}) }, drawTimeout);
      }
    } else if (req.zoom !== undefined) {
      const ext = await diagramExtent(b);
      if (!ext) warnings.push("zoom: this tab has no diagram viewport; drawn at its own fit");
      else {
        size = { width: Math.max(16, Math.min(8000, Math.ceil((ext.maxX - ext.minX) * req.zoom + 2 * req.padding))), height: Math.max(16, Math.min(8000, Math.ceil((ext.maxY - ext.minY) * req.zoom + 2 * req.padding))), dpr: req.size.dpr };
        await b.setViewport(size.width, size.height, size.dpr);
        this.page.css = `${size.width}x${size.height}@${size.dpr}`;
        // let the view finish its own resize (React Flow fits again) before the extent is read and the zoom set
        await sleep(400);
        await b.evaluate(FRAMES);
        const again = (await diagramExtent(b)) ?? ext;
        await applyDiagramZoom(b, again, req.zoom, req.padding);
        zoomed = true;
      }
    } else if (req.state && Object.keys(req.state).length) warnings.push(`state: the ${title} tab takes no view state; ignored`);
    const settledAt = Date.now();

    // the plain frame: the snapshot, and what ifChanged compares
    const plan = planSize(size, this.limits.limits, { maxLongEdge: req.maxLongEdge, batch: req.batch });
    const clip = (scale: number) => ({ x: 0, y: 0, width: size.width, height: size.height, scale });
    const tc = Date.now();
    const plain = await b.capture({ format: "png", clip: clip(plan.scale) });
    const key = captureKey(req);
    const prev = this.last.get(key);
    const cmp = await compareFrames(b, prev?.plain, plain);
    if (cmp.ink < 0.002) warnings.push("the frame looks blank (under 0.2 % of pixels differ from the background)");
    const errors = b.takeErrors().filter((e) => !/favicon|ERR_ABORTED|EventSource/i.test(e));
    if (errors.length) warnings.push(`page error: ${errors[0].split("\n")[0].slice(0, 200)}`);
    const changed = !prev || cmp.changed >= 0.0005 || prev.response.bundleHash !== this.bundleHash;
    if (req.ifChanged && prev && !changed) {
      return { ...prev.response, changed: false, pixelsChangedShare: round4(cmp.changed), warnings, timings: { queueMs, pageMs, settleMs, captureMs: Date.now() - tc, encodeMs: 0, totalMs: Date.now() - t0 + queueMs } };
    }

    // the legend: refs → observe() nodes → projected through the camera the viewer reports
    let camera: CameraState | undefined;
    let viewerState: Record<string, unknown> | undefined;
    let legend: LegendEntry[] = [];
    if (isCad) {
      const obs = await observeCad(b);
      camera = obs?.camera;
      viewerState = await viewStateOf(b).catch(() => undefined);
      if (req.annotate.length && obs) {
        const rect = await viewRect(b);
        const outScale = size.dpr * plan.scale;
        const nodes = obs.nodes as RefNode[];
        // the viewer's own projection when it offers one; this module's math otherwise (same camera)
        const viaViewer = await viewerProjection(b, [[0, 0, 0]]).catch(() => undefined);
        if (!viaViewer) warnings.push("annotations projected from observe()'s camera (the viewer has no __cad.project yet)");
        legend = await buildLegend(req.annotate, nodes, obs.camera, { x: rect.x * outScale, y: rect.y * outScale, width: rect.width * outScale, height: rect.height * outScale }, async (node, px) => {
          const cssPx: [number, number] = [px[0] / outScale, px[1] / outScale];
          return hiddenAt(b, rect, node, cssPx, obs.camera);
        });
        for (const e of legend) if (!e.found) warnings.push(`annotate: no part "${e.ref}" in the 3D view`);
        else if (!e.anchorPx) warnings.push(`annotate: "${e.ref}" is behind the camera`);
      }
    } else if (req.annotate.length) warnings.push(`annotate: only the 3D tab can be annotated today; the ${title} tab was captured without marks`);

    // the overlay, burned into the image and as SVG
    const outW = plan.outWidth;
    const outH = plan.outHeight;
    const overlayTheme = /dark/.test(theme) ? OVERLAY_DARK : OVERLAY_LIGHT;
    const svg = legend.some((e) => e.anchorPx) && req.overlay !== "none" ? overlaySvg(outW, outH, legend, overlayTheme, Math.max(outW, outH) / 1600) : undefined;
    const kind = imageKind(req);

    // encode under the limits: quality down, then scale
    const te = Date.now();
    // an `out` named .png / .jpg / .webp asks for that format when the request names none
    const outExt = req.out ? extname(req.out).toLowerCase() : "";
    const asked: ImageFormat | undefined = req.format ?? (outExt === ".png" ? "png" : outExt === ".jpg" || outExt === ".jpeg" ? "jpeg" : outExt === ".webp" ? "webp" : undefined);
    let step: EncodeStep = firstEncode(kind, this.limits.limits, { format: asked, quality: req.quality });
    let image: Buffer = plain;
    let burned = false;
    for (;;) {
      const scale = plan.scale * step.scale;
      const needBurn = !!svg && req.overlay === "burned+svg";
      if (needBurn && !burned) {
        await addOverlay(b, svg!, size.width, size.height);
        burned = true;
      }
      image = step.format === "png" && step.scale === 1 && !needBurn ? plain : await b.capture({ format: step.format, ...(step.quality !== undefined ? { quality: step.quality } : {}), clip: clip(scale) });
      const verdict = nextEncodeStep(step, image.length, kind, this.limits.limits);
      if (verdict.action === "done") break;
      if (verdict.action === "accept") {
        warnings.push(`${image.length} B is over the ${this.limits.limits.policy.targetBytes} B target after ${step.step + 1} steps; under the hard cap, kept`);
        break;
      }
      if (verdict.action === "fail") {
        if (burned) await removeOverlay(b);
        throw new Error(`the image stays over the transfer limits after ${step.step + 1} steps (${image.length} B, ${step.format}); ask for a smaller size`);
      }
      step = verdict.next;
    }
    if (burned) await removeOverlay(b);
    if (zoomed) await releaseDiagramZoom(b);
    const encodeMs = Date.now() - te;
    const dims = imageSize(image) ?? { width: Math.round(outW * step.scale), height: Math.round(outH * step.scale) };
    const applied = [...plan.applied, ...(step.step ? [`encode step ${step.step}: ${step.format}${step.quality ? ` q${step.quality}` : ""}, scale ${round4(step.scale)}`] : [])];
    // legend coordinates in the final image's pixels
    if (step.scale !== 1)
      for (const e of legend) {
        if (e.anchorPx) e.anchorPx = [Math.round(e.anchorPx[0] * step.scale), Math.round(e.anchorPx[1] * step.scale)];
        if (e.boxPx) e.boxPx = e.boxPx.map((v) => Math.round(v * step.scale)) as [number, number, number, number];
      }

    // the files: image, overlay, manifest, and the tab's snapshot
    const imagePath = this.imagePath(req, step.format, warnings);
    const { svg: svgPath, manifest: manifestPath } = captureSidecars(imagePath);
    writeAtomic(imagePath, image);
    const finalSvg = svg ? overlaySvg(dims.width, dims.height, legend, overlayTheme, Math.max(dims.width, dims.height) / 1600) : undefined;
    if (finalSvg) writeAtomic(svgPath, finalSvg);
    const backend = b.backend;
    const gpu = backend.gl?.renderer ?? backend.kind;
    const viewState = { ...(req.state ?? {}), ...(camera ? { camera } : {}) };
    const snap = writeSnapshot(this.o.root, plain, {
      view: req.view,
      level: req.level,
      width: imageSize(plain)?.width ?? outW,
      height: imageSize(plain)?.height ?? outH,
      css: size,
      ...(camera ? { camera } : {}),
      viewState: viewerState ?? req.state ?? {},
      bundleHash: this.bundleHash,
      revision: this.revision,
      backend: backend.kind,
      gpu,
      theme,
      takenAt: new Date().toISOString(),
    });
    const response: CaptureResponse = {
      schema: CAPTURE_RESPONSE_SCHEMA,
      imagePath,
      ...(finalSvg ? { svgPath } : {}),
      manifestPath,
      snapshotPath: snap.png,
      width: dims.width,
      height: dims.height,
      bytes: image.length,
      base64Bytes: base64Bytes(image.length),
      format: step.format,
      ...(step.quality !== undefined ? { quality: step.quality } : {}),
      view: req.view,
      level: req.level,
      revision: this.revision,
      bundleHash: this.bundleHash,
      backend: backend.kind,
      gpu,
      stale: stale || this.diskHash() !== this.drawnHash,
      changed,
      pixelsChangedShare: prev ? round4(cmp.changed) : 1,
      legend,
      viewState,
      // the file's name only: the manifest sits beside committed images and must not carry a machine path
      limits: { file: this.limits.file === "built-in" ? "built-in" : basename(this.limits.file), checked: this.limits.limits.checked, applied },
      warnings,
      timings: { queueMs, pageMs, settleMs: settleMs || settledAt - t0 - pageMs, captureMs: te - tc, encodeMs, totalMs: Date.now() - t0 + queueMs },
    };
    writeAtomic(manifestPath, `${JSON.stringify(manifestOf(req, response, this.o.root), null, 2)}\n`);
    this.last.set(key, { plain, response });
    if (this.last.size > 64) this.last.delete(this.last.keys().next().value!);
    this.captures++;
    return response;
  }

  private imagePath(req: CaptureRequest, format: ImageFormat, warnings: string[]): string {
    const ext = format === "jpeg" ? "jpg" : format;
    if (!req.out) return defaultCapturePath(this.o.root, req.level, req.view, ext);
    const asked = isAbsolute(req.out) ? req.out : resolve(this.o.root, req.out);
    const have = extname(asked).toLowerCase();
    const want = format === "jpeg" ? [".jpg", ".jpeg"] : [`.${format}`];
    if (want.includes(have)) return asked;
    const fixed = (have ? asked.slice(0, -have.length) : asked) + `.${ext}`;
    if (have) warnings.push(`out: written as ${ext.toUpperCase()} (${fixed}), not ${have}: the encoder chose ${format} to stay under the limits`);
    return fixed;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.idle.stop();
    await this.browser?.close().catch(() => undefined);
    await this.host?.close().catch(() => undefined);
    this.browser = undefined;
    this.host = undefined;
  }
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export const CAPTURE_MANIFEST_SCHEMA = "protoboard.capture-manifest/v0";

/**
 * The manifest beside a capture (`x.capture.json`): the request to draw it
 * again (`protoboard views capture --from x.capture.json`), the camera and
 * legend as drawn, and the bundle hash, so a docs build re-renders a capture
 * whose bundle changed.
 */
export function manifestOf(req: CaptureRequest, r: CaptureResponse, root: string) {
  const rel = (p: string | undefined) => (p ? relative(root, p).split("\\").join("/") : undefined);
  const { out: _out, ...request } = req;
  return {
    schema: CAPTURE_MANIFEST_SCHEMA,
    request,
    image: rel(r.imagePath),
    ...(r.svgPath ? { overlay: rel(r.svgPath) } : {}),
    width: r.width,
    height: r.height,
    format: r.format,
    bytes: r.bytes,
    viewState: r.viewState,
    legend: r.legend,
    bundleHash: r.bundleHash,
    revision: r.revision,
    backend: r.backend,
    gpu: r.gpu,
    limits: r.limits,
    takenAt: new Date().toISOString(),
    rerender: `protoboard views capture --from ${rel(r.manifestPath)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// The loopback server

export const TOKEN_HEADER = "x-protoboard-render-token";

export interface ServeOptions {
  /** Extra routes the CLI adds (views check streams its lines). */
  routes?: Record<string, (body: unknown, res: ServerResponse) => Promise<void>>;
  version: string;
  token?: string;
  /** Shut down: close the service, the server, remove the record (the CLI exits after). */
  onShutdown?: () => void;
}

const LOOPBACK_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const MAX_BODY = 256 * 1024;

/**
 * Serves a render service on 127.0.0.1 (an ephemeral port), records it in
 * `.protoboard/local/render-service.json`, and answers only requests with
 * the session token and a loopback Host (no DNS rebinding):
 * `GET /health`, `POST /capture`, `POST /shutdown`, plus the CLI's routes.
 */
export async function serveRenderService(service: RenderService, root: string, opts: ServeOptions): Promise<{ server: Server; record: ServiceRecord; close: () => Promise<void> }> {
  const token = opts.token ?? randomBytes(24).toString("base64url");
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  let closing = false;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!LOOPBACK_HOSTS.test(req.headers.host ?? "")) return json(res, 403, { error: "loopback only" });
      if (!tokenMatches(req.headers[TOKEN_HEADER], token)) return json(res, 403, { error: "missing or wrong render-service token" });
      if (req.headers.origin) return json(res, 403, { error: "not for pages: no Origin" });
      const path = (req.url ?? "/").split("?")[0];
      if (req.method === "GET" && path === "/health") return json(res, 200, service.health());
      if (req.method !== "POST") return json(res, 405, { error: "POST" });
      if (!/^application\/json\b/.test(req.headers["content-type"] ?? "")) return json(res, 415, { error: "JSON body" });
      const body = await readBody(req);
      service.idle.touch();
      if (path === "/capture") {
        try {
          return json(res, 200, await service.capture(body));
        } catch (e) {
          return json(res, /capture request:/.test((e as Error).message) ? 400 : 500, { error: (e as Error).message });
        }
      }
      if (path === "/shutdown") {
        json(res, 200, { ok: true });
        if (!closing) {
          closing = true;
          setTimeout(() => opts.onShutdown?.(), 10);
        }
        return;
      }
      const route = opts.routes?.[path];
      if (route) return await route(body, res);
      return json(res, 404, { error: `no route ${path}` });
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
      else res.end();
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok());
  });
  const port = (server.address() as AddressInfo).port;
  const record: ServiceRecord = {
    schema: SERVICE_RECORD_SCHEMA,
    url: `http://127.0.0.1:${port}/`,
    port,
    pid: process.pid,
    token,
    root,
    startedAt: new Date().toISOString(),
    idleMs: service.idle.ms,
    version: opts.version,
  };
  writeServiceRecord(root, record);
  const close = async () => {
    removeServiceRecord(root, process.pid);
    await new Promise<void>((ok) => server.close(() => ok()));
    await service.close();
  };
  return { server, record, close };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new Error("request body over 256 kB");
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

/** Files a capture wrote, for a caller that wants to check them. */
export function captureFiles(r: CaptureResponse): string[] {
  return [r.imagePath, r.svgPath, r.manifestPath, r.snapshotPath].filter((f): f is string => !!f && existsSync(f) && statSync(f).isFile());
}

/** The session token compared in constant time (wave 2 gate). */
function tokenMatches(given: string | string[] | undefined, token: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
