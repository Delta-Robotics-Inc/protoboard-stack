/**
 * `protoboard views doctor` (PB-1180): proves rendering and capture
 * separately, the way agent-browser's doctor does, so a broken capture is
 * never mistaken for a broken renderer or the other way round.
 *
 * Rendering: a browser is found and starts; which GL backend it got (GPU or
 * SwiftShader, and why); WebGL 2 is there; a 64 px WebGL 2 frame draws the
 * colour asked for (read back with readPixels inside the page).
 * Capture: the same frame through `Page.captureScreenshot` comes back as a
 * 64 x 64 PNG of that colour. Also: the transfer-limits file and its age,
 * and whether a render service runs for the project.
 *
 * Every check is timed. WebGPU is reported but never used: a headless
 * WebGPU canvas captures black.
 */
import type { Browser, GlBackendRequest } from "../cdp.js";
import type { LoadedLimits } from "./limits.js";
import { imageSize } from "./page.js";

export type CheckLevel = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  group: "rendering" | "capture" | "setup";
  level: CheckLevel;
  title: string;
  detail: string;
  ms?: number;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  backend?: Browser["backend"];
  ok: boolean;
}

export interface DoctorOptions {
  findBrowser: () => { path: string; name: string; from: string } | undefined;
  launch: (o: { backend: GlBackendRequest; purpose: string; echoErrors: boolean }) => Promise<Browser>;
  backend?: GlBackendRequest;
  limits: () => LoadedLimits;
  /** The project's running service, if any (a line, not a check that can fail). */
  service?: () => Promise<string | undefined>;
}

/** The test colour (sRGB bytes): a red that is not the default clear colour of anything. */
export const PROBE_RGB: [number, number, number] = [214, 40, 57];

/** In the page: a 64 px WebGL 2 canvas at the top left, cleared to the probe colour and a triangle drawn; reads the centre pixel back. */
export const RENDER_PROBE = `(() => {
  document.body.style.margin = '0';
  document.body.style.background = '#ffffff';
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64; c.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px;';
  document.body.appendChild(c);
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return { ok: false, why: 'no WebGL 2 context' };
  const [r, g, b] = ${JSON.stringify(PROBE_RGB)}.map((v) => v / 255);
  gl.clearColor(r, g, b, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, '#version 300 es\\nin vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, '#version 300 es\\nprecision mediump float; out vec4 o; void main(){ o = vec4(1.0, 1.0, 1.0, 1.0); }'); gl.compileShader(fs);
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return { ok: false, why: 'shader link failed: ' + gl.getProgramInfoLog(pr) };
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  // a small triangle in the top-left corner: the centre stays the clear colour
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 1, -0.6, 1, -1, 0.6]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(4); gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const corner = new Uint8Array(4); gl.readPixels(2, 61, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, corner);
  return { ok: true, centre: [...px].slice(0, 3), corner: [...corner].slice(0, 3), error: gl.getError() };
})()`;

/** In the page: the colour at a point of a base64 image. */
export const PIXEL_AT = `async (b64, x, y) => {
  const i = new Image(); i.src = 'data:image/png;base64,' + b64; await i.decode();
  const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
  const g = c.getContext('2d'); g.drawImage(i, 0, 0);
  return [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
}`;

const near = (a: number[], b: number[], tol = 6) => a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);

export async function runDoctor(o: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (c: DoctorCheck) => checks.push(c);
  const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
    const t = Date.now();
    const v = await fn();
    return [v, Date.now() - t];
  };

  // setup: the limits file
  try {
    const l = o.limits();
    add({ id: "limits", group: "setup", level: l.stale ? "warn" : "pass", title: "Transfer limits", detail: `${l.file === "built-in" ? "built-in copy" : l.file}, checked ${l.limits.checked} (${l.ageDays} days ago${l.stale ? `, over ${l.limits.recheckAfterDays}: recheck the sources it lists` : ""}); captures default to ${l.limits.policy.defaultLongEdgePx} px on the long edge` });
  } catch (e) {
    add({ id: "limits", group: "setup", level: "fail", title: "Transfer limits", detail: (e as Error).message });
  }
  if (o.service) {
    const s = await o.service().catch(() => undefined);
    add({ id: "service", group: "setup", level: "pass", title: "Render service", detail: s ?? "not running (it starts on the first capture and stops when idle)" });
  }

  // rendering
  const found = o.findBrowser();
  add({ id: "browser", group: "rendering", level: found ? "pass" : "fail", title: "Browser found", detail: found ? `${found.name}: ${found.path} (${found.from})` : "no Chromium-family browser: install Google Chrome, or set CHROME to one" });
  if (!found) return finish(checks);

  let browser: Browser | undefined;
  try {
    const [b, ms] = await timed(() => o.launch({ backend: o.backend ?? "auto", purpose: "`protoboard views doctor` starts a headless Chromium-family browser", echoErrors: false }));
    browser = b;
    add({ id: "start", group: "rendering", level: "pass", title: "Browser starts headless", detail: `${b.backend.product ?? found.name}, ${b.backend.startMs || ms} ms`, ms });
    const bk = b.backend;
    const gl = bk.gl ?? (await b.gl().catch(() => undefined));
    add({
      id: "backend",
      group: "rendering",
      level: bk.kind === "gpu" ? "pass" : "warn",
      title: "GL backend",
      detail: `${bk.kind === "gpu" ? "GPU" : "SwiftShader (CPU)"}: ${gl?.renderer ?? "renderer unknown"}; flags ${bk.flags.join(" ")}${bk.fallback ? `; GPU not used: ${bk.fallback}` : ""}${bk.kind === "swiftshader" ? ". Correct but slow: a heavy model takes seconds per frame" : ""}`,
    });
    add({ id: "webgl2", group: "rendering", level: gl?.webgl2 ? "pass" : "fail", title: "WebGL 2", detail: gl?.webgl2 ? "available" : gl?.webgl1 ? "only WebGL 1: the viewer (three.js r187) needs WebGL 2" : "no WebGL context at all" });
    add({ id: "webgpu", group: "rendering", level: "pass", title: "WebGPU", detail: `${gl?.webgpu ? "present" : "absent"}; not used for captures (a headless WebGPU canvas captures black), every capture names its GL backend` });

    await b.setViewport(64, 64, 1);
    await b.navigate("about:blank");
    const [probe, rms] = await timed(() => b.evaluate<{ ok: boolean; why?: string; centre?: number[]; corner?: number[]; error?: number }>(RENDER_PROBE));
    const drew = probe.ok && near(probe.centre ?? [], PROBE_RGB) && near(probe.corner ?? [], [255, 255, 255], 12);
    add({ id: "render", group: "rendering", level: drew ? "pass" : "fail", title: "A 64 px WebGL 2 frame draws", detail: probe.ok ? `centre ${JSON.stringify(probe.centre)} (want ${JSON.stringify(PROBE_RGB)}), triangle ${JSON.stringify(probe.corner)} (want white), GL error ${probe.error}` : probe.why ?? "failed", ms: rms });

    // capture, on its own: the same frame through the compositor and CDP
    const [png, cms] = await timed(() => b.capture({ format: "png", clip: { x: 0, y: 0, width: 64, height: 64, scale: 1 } }));
    const size = imageSize(png);
    const centre = size ? await b.evaluate<number[]>(`(${PIXEL_AT})(${JSON.stringify(png.toString("base64"))}, 32, 32)`) : [];
    const okSize = size?.width === 64 && size?.height === 64;
    const okColour = near(centre, PROBE_RGB, 10);
    add({ id: "capture", group: "capture", level: okSize && okColour ? "pass" : "fail", title: "A 64 px capture works", detail: `${size ? `${size.width} x ${size.height} PNG, ${png.length} B` : "not an image"}; centre ${JSON.stringify(centre)}${okColour ? "" : " (want the drawn colour: the capture does not see the WebGL frame)"}`, ms: cms });
    const [jpg, jms] = await timed(() => b.capture({ format: "jpeg", quality: 85, clip: { x: 0, y: 0, width: 64, height: 64, scale: 1 } }));
    const jsz = imageSize(jpg);
    add({ id: "capture-jpeg", group: "capture", level: jsz?.width === 64 ? "pass" : "fail", title: "JPEG encode", detail: jsz ? `${jsz.width} x ${jsz.height} JPEG q85, ${jpg.length} B` : "not an image", ms: jms });
    const [half, hms] = await timed(() => b.capture({ format: "png", clip: { x: 0, y: 0, width: 64, height: 64, scale: 0.5 } }));
    const hsz = imageSize(half);
    add({ id: "capture-scale", group: "capture", level: hsz?.width === 32 ? "pass" : "fail", title: "Downscaled capture (the limits' scale step)", detail: hsz ? `${hsz.width} x ${hsz.height} at scale 0.5` : "not an image", ms: hms });
  } catch (e) {
    add({ id: browser ? "probe" : "start", group: "rendering", level: "fail", title: browser ? "Render probe" : "Browser starts headless", detail: (e as Error).message.split("\n")[0] });
  } finally {
    await browser?.close().catch(() => undefined);
  }
  return finish(checks, browser?.backend);
}

function finish(checks: DoctorCheck[], backend?: Browser["backend"]): DoctorReport {
  return { checks, ...(backend ? { backend } : {}), ok: !checks.some((c) => c.level === "fail") };
}

/** The report for people: rendering, capture and setup, one line per check. */
export function formatDoctor(r: DoctorReport): string {
  const mark = { pass: "✓", warn: "!", fail: "✗", skip: "·" } as const;
  const lines: string[] = [];
  for (const group of ["rendering", "capture", "setup"] as const) {
    const cs = r.checks.filter((c) => c.group === group);
    if (!cs.length) continue;
    lines.push(group === "rendering" ? "Rendering" : group === "capture" ? "Capture" : "Setup");
    for (const c of cs) lines.push(`  ${mark[c.level]} ${c.title}: ${c.detail}${c.ms !== undefined ? ` (${c.ms} ms)` : ""}`);
  }
  lines.push("", r.ok ? "Rendering and capture work." : `${r.checks.filter((c) => c.level === "fail").length} check(s) failed.`);
  return lines.join("\n");
}
