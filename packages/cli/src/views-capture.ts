/**
 * `protoboard views capture | doctor | service | status | stop` (PB-1180,
 * PB-1109), and `views check` through the render service.
 *
 *   protoboard views capture --view 3d --state '{"azimuth":-58,"elevation":28}' --annotate battery,receiver --out shots/top.png
 *   protoboard views capture --view diagram --zoom 1 --padding 32 --out docs/diagram.png
 *   protoboard views capture --from docs/diagram.capture.json      (draw a capture again from its manifest)
 *   protoboard views doctor                                         (rendering and capture, checked separately)
 *
 * A capture is chrome-free by default (the document mode: no header,
 * panels, toolbars or toasts), at most 2,576 px on the long edge and never
 * over the limits in docs/reference/transfer-limits.json; it writes the
 * image, an SVG overlay when refs are annotated, and a `.capture.json`
 * manifest with the view state. The command reaches the project's warm
 * render service (starting it when none runs); `--no-service` draws in this
 * process and closes the browser after.
 *
 * The flags are read here from the command line (the CLI's shared flag table
 * is not this command's to change): `--view` is a tab id here, not build's
 * `--no-view`.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** DEFAULT (PB-1180): ms the CLI waits for a service it started (a cold Node start; the browser starts later). */
export const SERVICE_START_TIMEOUT_MS = 90000;

export interface CaptureArgs {
  request: Record<string, unknown>;
  noService: boolean;
  from?: string;
}

const VALUE_FLAGS = new Set(["view", "level", "module", "state", "annotate", "size", "dpr", "format", "quality", "zoom", "padding", "theme", "overlay", "out", "from", "max-long-edge", "batch", "kind", "cwd", "backend"]);

/** Flags after `views capture` from argv: `--name value`, `--name=value`, `--no-name`, booleans. Repeatable `--annotate`. */
export function parseViewsArgv(argv: string[]): { values: Map<string, string[]>; bools: Map<string, boolean> } {
  const values = new Map<string, string[]>();
  const bools = new Map<string, boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    let name = a.slice(2);
    let value: string | undefined;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (VALUE_FLAGS.has(name)) {
      if (value === undefined) {
        value = argv[i + 1];
        if (value === undefined || (value.startsWith("--") && value.length > 2)) throw new Error(`--${name} needs a value`);
        i++;
      }
      values.set(name, [...(values.get(name) ?? []), value]);
    } else if (name.startsWith("no-")) bools.set(name.slice(3), false);
    else bools.set(name, value === undefined ? true : value !== "false");
  }
  return { values, bools };
}

/** A capture request from `views capture`'s flags (the service validates it again). */
export function captureArgs(argv: string[], cwd: string): CaptureArgs {
  const { values, bools } = parseViewsArgv(argv);
  const one = (k: string) => values.get(k)?.at(-1);
  const num = (k: string) => {
    const v = one(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${k} takes a number, not "${v}"`);
    return n;
  };
  const request: Record<string, unknown> = {};
  const from = one("from");
  if (from) {
    const file = resolve(cwd, from);
    if (!existsSync(file)) throw new Error(`--from: no manifest at ${file}`);
    const m = JSON.parse(readFileSync(file, "utf8")) as { schema?: string; request?: Record<string, unknown>; image?: string };
    if (m.schema !== "protoboard.capture-manifest/v0" || !m.request) throw new Error(`--from: ${file} is not a capture manifest (protoboard.capture-manifest/v0)`);
    // the manifest's own `out` and opt-in are not trusted (a manifest sits beside committed images and may be
    // hand-edited): the image is drawn again where the manifest says it is, and only inside the project (wave 2 gate)
    const { out: _ignored, allowOutsideProject: _notTrusted, ...kept } = m.request;
    Object.assign(request, kept);
    if (m.image && !one("out")) {
      // project-relative, forward slashes, no `..`, no drive or absolute path, no NUL
      const parts = m.image.split("/");
      if (isAbsolute(m.image) || /^[A-Za-z]:|[\\\0]/.test(m.image) || parts.includes("..")) throw new Error(`--from: the manifest's image ${JSON.stringify(m.image)} is outside the project`);
      request.out = m.image;
    }
  }
  const view = one("view");
  if (view !== undefined) request.view = view;
  const level = one("level") ?? one("module");
  if (level !== undefined) request.level = level;
  const state = one("state");
  if (state !== undefined) {
    const text = state.startsWith("@") ? readFileSync(resolve(cwd, state.slice(1)), "utf8") : state;
    try {
      request.state = JSON.parse(text);
    } catch (e) {
      throw new Error(`--state: not JSON (${(e as Error).message}); give an object such as '{"azimuth":-58,"elevation":28}' or @file.json`);
    }
  }
  const annotate = (values.get("annotate") ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  if (annotate.length) request.annotate = annotate.map((a) => {
    const [ref, label] = a.split("=");
    return label ? { ref, label } : ref;
  });
  const size = one("size");
  const dpr = num("dpr");
  if (size !== undefined || dpr !== undefined) {
    const m = size ? /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size) : null;
    if (size && !m) throw new Error(`--size takes WIDTHxHEIGHT in CSS px (1600x1000), not "${size}"`);
    request.size = { ...((request.size as object) ?? {}), ...(m ? { width: Number(m[1]), height: Number(m[2]) } : {}), ...(dpr !== undefined ? { dpr } : {}) };
  }
  const format = one("format");
  if (format !== undefined && format !== "json" && format !== "text") request.format = format === "jpg" ? "jpeg" : format;
  for (const [flag, key] of [["quality", "quality"], ["zoom", "zoom"], ["padding", "padding"], ["max-long-edge", "maxLongEdge"], ["batch", "batch"]] as const) {
    const n = num(flag);
    if (n !== undefined) request[key] = n;
  }
  for (const [flag, key] of [["theme", "theme"], ["overlay", "overlay"], ["kind", "kind"]] as const) {
    const v = one(flag);
    if (v !== undefined) request[key] = v;
  }
  const out = one("out");
  if (out !== undefined) {
    request.out = isAbsolute(out) ? out : resolve(cwd, out);
    // the person named this file themselves: it may be outside the project (the MCP server never sets this)
    request.allowOutsideProject = true;
  }
  if (bools.has("document")) request.document = bools.get("document");
  if (bools.has("if-changed")) request.ifChanged = bools.get("if-changed");
  return { request, noService: bools.get("service") === false, ...(from ? { from } : {}) };
}

/** The capture for people: the files, the facts, the legend, the warnings. */
export function formatCapture(r: import("@protoboardai/core/render-service").CaptureResponse, root: string): string {
  const rel = (p: string) => {
    const x = relative(root, p);
    return x.startsWith("..") ? p : x;
  };
  const lines = [
    `${r.changed ? "" : "(unchanged) "}${rel(r.imagePath)}  ${r.width} x ${r.height} ${r.format.toUpperCase()}${r.quality ? ` q${r.quality}` : ""}, ${(r.bytes / 1000).toFixed(0)} kB (${(r.base64Bytes / 1000).toFixed(0)} kB base64)`,
    ...(r.svgPath ? [`${rel(r.svgPath)}  overlay`] : []),
    `${rel(r.manifestPath)}  manifest (re-render: protoboard views capture --from ${rel(r.manifestPath)})`,
    `${r.view} tab at ${r.level || "the top level"}; drawn on ${r.backend === "gpu" ? "the GPU" : "SwiftShader"} (${r.gpu}); revision ${r.revision}, bundle ${r.bundleHash.slice(7, 19)}${r.stale ? ", STALE: the bundle on disk is newer" : ""}; ${r.changed ? `changed ${(r.pixelsChangedShare * 100).toFixed(1)} % of pixels` : "no change"}`,
    `${(r.timings.totalMs / 1000).toFixed(1)} s (queue ${r.timings.queueMs} ms, page ${r.timings.pageMs} ms, settle ${r.timings.settleMs} ms, capture ${r.timings.captureMs} ms, encode ${r.timings.encodeMs} ms); limits ${r.limits.checked}: ${r.limits.applied.join("; ") || "none applied"}`,
  ];
  for (const e of r.legend) lines.push(`  ${e.n}. ${e.label} (${e.ref})${e.found ? (e.anchorPx ? ` at ${e.anchorPx.join(", ")} px${e.occluded ? ", hidden behind another part" : ""}` : ", behind the camera") : ", not found"}`);
  for (const w of r.warnings) lines.push(`  ! ${w}`);
  return lines.join("\n");
}

/** `views capture`: through the warm service, or in this process with `--no-service`. */
export async function viewsCapture(argv: string[], cwd: string, version: string): Promise<{ response: import("@protoboardai/core/render-service").CaptureResponse; root: string; started: boolean }> {
  const { findProjectRoot } = await import("@protoboardai/core");
  const root = findProjectRoot(cwd);
  if (!root) throw new Error(`no protoboard.config.ts in ${cwd} or its parents (run \`protoboard init\`)`);
  const args = captureArgs(argv, cwd);
  const core = await import("@protoboardai/core/render-service");
  // check the request here: a bad flag is said before a browser starts
  core.parseCaptureRequest(args.request);
  if (args.noService) {
    const { createProjectRenderService } = await import("./views-service.js");
    const { service } = await createProjectRenderService({ root, version, idleMs: 0 });
    try {
      return { response: await service.capture(args.request), root, started: true };
    } finally {
      await service.close();
    }
  }
  const { spawnRenderService } = await import("./views-service.js");
  const client = await core.ensureRenderService(root, { spawn: () => spawnRenderService(root), version, timeoutMs: SERVICE_START_TIMEOUT_MS });
  return { response: await client.capture(args.request), root, started: client.started };
}

/**
 * `views check` through the warm service (log lines streamed). For the CLI only: `opts.out` is the
 * person's own `--out-dir`, so it may be outside the project (the request carries the opt-in). The MCP
 * server posts `/check` itself, without the opt-in, and its folder must be inside the project.
 */
export async function viewsCheckViaService(root: string, version: string, opts: { module?: string; out?: string; timeout?: number }, log?: (line: string) => void) {
  const core = await import("@protoboardai/core/render-service");
  const { spawnRenderService } = await import("./views-service.js");
  const client = await core.ensureRenderService(root, { spawn: () => spawnRenderService(root), version, timeoutMs: SERVICE_START_TIMEOUT_MS });
  const body = { ...opts, ...(opts.out !== undefined ? { allowOutsideProject: true } : {}) };
  const last = await client.stream<{ report: import("./views-check.js").ViewsCheckReport }>("/check", body, (line) => {
    const l = line as { log?: string };
    if (l.log !== undefined) log?.(l.log);
  });
  if (!last?.report) throw new Error("render service: views check returned no report");
  return last.report;
}

/** `views doctor`: on the warm service's browser when one runs, else with a browser of its own. */
export async function viewsDoctor(cwd: string, opts: { backend?: "auto" | "gpu" | "swiftshader" } = {}) {
  const core = await import("@protoboardai/core/render-service");
  const { findBrowser, findProjectRoot } = await import("@protoboardai/core");
  const { describeHealth } = await import("./views-service.js");
  const root = findProjectRoot(cwd);
  const running = root ? await core.connectRenderService(root) : undefined;
  if (running && !opts.backend) {
    const r = await fetch(new URL("doctor", running.record.url), { method: "POST", headers: { [core.TOKEN_HEADER]: running.record.token, "content-type": "application/json" }, body: "{}" });
    if (r.ok) return { report: (await r.json()) as import("@protoboardai/core/render-service").DoctorReport, viaService: true };
  }
  const report = await core.runDoctor({
    findBrowser: () => findBrowser(),
    launch: async (o) => (await import("@protoboardai/core/cdp")).launchBrowser({ ...o, backend: opts.backend ?? o.backend }),
    ...(opts.backend ? { backend: opts.backend } : {}),
    limits: () => core.loadTransferLimits(),
    ...(root ? { service: async () => (running ? describeHealth(await running.health()) : undefined) } : {}),
  });
  return { report, viaService: false };
}
