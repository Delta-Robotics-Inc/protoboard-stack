# The render service

One warm headless browser per project that draws the viewer for agents and documents: captures with numbered callouts, chrome-free document images at an exact zoom, `views check`, and the snapshot a visible viewer starts from (PB-1180, PB-1109). Code: `packages/core/src/render-service/` (core), `packages/cli/src/views-service.ts` and `views-capture.ts` (CLI), `packages/core/src/cdp.ts` (the browser).

## Commands

| Command | What it does |
|---|---|
| `protoboard views capture [flags]` | One capture through the project's service (started when none runs). Writes the image, `<name>.overlay.svg` when refs are annotated, and `<name>.capture.json` |
| `protoboard views capture --from x.capture.json` | Draws a capture again from its manifest (same request, same file) |
| `protoboard views check` | Opens every tab once, through the service; `--no-service` runs it in its own browser as before |
| `protoboard views doctor` | Checks rendering and capture separately (below); on the running service's browser when one runs |
| `protoboard views service` | Runs the service in the foreground (what `capture` starts detached) |
| `protoboard views status` / `stop` | Whether a service runs here; stop it |

Capture flags: `--view 3d|diagram|pcb|...` (a tab id; default `3d`), `--level <instance path>` (default the top), `--state '<json>'` or `--state @file.json`, `--annotate ref[=label],...` (repeatable), `--size 1600x1000`, `--dpr 1`, `--zoom 1` and `--padding 24` (2D tabs), `--format png|jpeg|webp` (or the `--out` extension), `--quality 85`, `--theme protoboard-light`, `--no-document`, `--overlay burned+svg|svg|none`, `--if-changed`, `--max-long-edge 2576`, `--batch N`, `--out <file>`, `--no-service`, `--json`.

```
protoboard views capture --view 3d --annotate battery,receiver --out docs/img/stack.png
protoboard views capture --view diagram --zoom 1 --padding 32 --out docs/img/system.png
```

## Process, transport, lifetime

- One service per project, started on demand by `views capture`, `views check` and (wave 3) the MCP server: `node <cli>/bin/protoboard.mjs views service --cwd <project>`, detached, its output in `.protoboard/local/render-service.log`.
- It listens on `127.0.0.1` on a free port and records itself in `.protoboard/local/render-service.json` (`protoboard.render-service/v0`: url, port, pid, token, root, startedAt, idleMs, version). The file is written owner-only in the git-ignored `.protoboard/local/`.
- Every request carries the session token in `x-protoboard-render-token`, a loopback `Host`, and no `Origin` (a web page cannot call it). Bodies are JSON, at most 256 kB (**DEFAULT**).
- Where it writes: a capture's `out` and `/check`'s `out` folder must resolve inside the project (no `..` out of it, no absolute path elsewhere, no symlink or junction that leads out); the request is refused with a message saying so. The one exception is a request with `allowOutsideProject: true`, which only the CLI sets, and only when the person passed `views capture --out` or `views check --out-dir` themselves. The MCP server never sets it, and a manifest read by `--from` cannot carry it.
- Routes: `GET /health`, `POST /capture`, `POST /check` (NDJSON: `{"log": ...}` lines, then `{"report": ...}`), `POST /doctor`, `POST /shutdown`.
- A client reads the record, checks `/health`, and starts a new service when nothing answers or the service is from another CLI version (`ensureRenderService` in `client.ts`).
- Idle timeout: 15 minutes with no request (**DEFAULT**; `PROTOBOARD_RENDER_IDLE_S` changes it). A warm SwiftShader Chrome holds a few hundred MB.
- One job at a time (`SerialQueue`): captures, checks and doctor probes never overlap, because they share one page, and because two SwiftShader browsers at once stalled in the baseline.
- The viewer page is `protoboard dev`'s server without watching and without `dev.json`, so a person's own `protoboard dev` is untouched. When the bundle on disk changed since the page drew it (someone ran `protoboard build`), the service rebuilds the page's bundle before the next capture and bumps `revision`; if that fails the capture says `stale: true`. The service does not watch sources: a capture shows the last built bundle.

## The GL backend

`launchBrowser({ backend })` in `cdp.ts`:

| Backend | Flags | When |
|---|---|---|
| `gpu` | Windows `--use-angle=d3d11`, macOS `--use-angle=metal`, Linux `--use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface` (UNVERIFIED on Linux); all with `--enable-gpu --ignore-gpu-blocklist` | |
| `swiftshader` | `--use-angle=swiftshader --enable-unsafe-swiftshader` | The documents' PDFs (unchanged default) |
| `auto` | `gpu`, then a WebGL 2 probe; a software renderer (SwiftShader, llvmpipe, Basic Render) or no WebGL 2 closes it and starts SwiftShader, recording why | The render service and the doctor |

`PROTOBOARD_RENDER_BACKEND=swiftshader|gpu|auto` overrides.

DevTools is carried over a pipe by default (`--remote-debugging-pipe`: NUL-terminated JSON on the browser's fds 3 and 4), so the warm browser opens no local port for its 15 minutes; the page is one target attached with a flattened session. `PROTOBOARD_CDP_TRANSPORT=port` (or `launchBrowser({ transport: "port" })`) uses `--remote-debugging-port=0` and a WebSocket on 127.0.0.1 instead, and a pipe that does not come up is tried once on a port (`backend.transport`, `backend.transportFallback` say which and why). On this machine (Intel UHD, Windows 11, Chrome 156) `auto` gets the GPU: `ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)`. Every capture response and every `views check` report names the backend and renderer. WebGPU is never used for captures: a headless WebGPU canvas captures black.

## Capture request and response

Request (`protoboard.capture-request/v0`, `schema.ts`; unknown fields are refused, every problem is named at once):

```jsonc
{ "view": "3d", "level": "", "state": { "azimuth": -58, "elevation": 28, "distance": 520, "target": [0, 0, 18], "explode": 0 },
  "annotate": ["battery", { "ref": "@arm_fr/motor", "label": "Motor FR" }],
  "size": { "width": 1600, "height": 1000, "dpr": 1 }, "format": "png", "quality": 85, "ifChanged": false,
  "document": true, "zoom": 1, "padding": 24, "theme": "protoboard-light", "overlay": "burned+svg",
  "out": "docs/img/x.png", "allowOutsideProject": false, "kind": "annotated", "maxLongEdge": 2576, "batch": 1 }
```

`state` takes the 3D tab's `window.__cad.set` keys and, since W2-A's view state, its keys (`camera`, `selection`, `highlight`, `isolation`, `visibility`, `sections`); other keys pass through. A document capture with no camera of its own frames what is drawn from the direction the camera looks (**DEFAULT**; `"fit": false` keeps the opening camera).

Response (`protoboard.capture/v0`): `imagePath`, `svgPath`, `manifestPath`, `snapshotPath`, `width`, `height`, `bytes`, `base64Bytes`, `format`, `quality`, `view`, `level`, `revision`, `bundleHash`, `backend` (`gpu` | `swiftshader`), `gpu` (the renderer string), `stale`, `changed`, `pixelsChangedShare`, `legend` (`n`, `ref`, `label`, `instancePath`, `found`, `anchorPx`, `boxPx`, `occluded`), `records` (each annotation record in the view state as the viewer's layer drew it: `id`, `kind`, `status` `placed` | `pinned` | `occluded` | `offscreen` | `hidden` | `orphan`, `ref`, `anchorPx`; also in the manifest; a warning names each one not in the picture), `viewState` (the request's state plus the camera as drawn), `limits` (`file`, `checked`, `applied`), `warnings`, `timings` (queue, page, settle, capture, encode, total ms).

`ifChanged`: when the frame equals the last one for the same request (under 0.05 % of pixels differ, same bundle), no file is written and the last response comes back with `changed: false`.

## Document mode (PB-1109)

On by default for captures (`--no-document` turns it off). A stylesheet makes the active tab fill the page and hides the header, the tab and level bars, the hierarchy, inspector, toolbars, legends, the 3D scope card, React Flow's attribution and background, toasts and the dev pill (`DOC_CSS` in `page.ts`; `[data-chrome]` is honoured too). The theme defaults to `protoboard-light` for documents. `zoom` on a 2D tab sets React Flow's viewport to exactly that scale with `padding` around the drawing, sizes the page to the drawing, and holds the transform while the frame is taken. Measured: the drone's system diagram at zoom 1 is 1,879 x 1,456 px in about 2-3 s with a warm service, no toast. The selectors are class names today; the request for `data-chrome` attributes and `?chrome=none&panel=none&zoom=` on the page is in `phase-1/handoffs.md`.

## Annotations

Positions come from the scene, never from pixels. Each ref resolves to a node of `window.__cad.observe()` (exact id or instance path, `@` ignored, or a unique path tail such as `esp32_s3`). Its bounds (mm, Z up, as drawn) are projected through the camera the viewer reports (three's `lookAt` with the vertical `fov`, the canvas aspect). Whether it is hidden is asked of the viewer's own pick (its BVH) at the anchor: hidden when the nearest hit is another part clearly in front of it. The same numbers draw the burned PNG, the SVG overlay and the manifest's legend: a ring around the projected box (dashed when hidden), a numbered badge, a label card beside it with a halo. The accent is the selection blue (**DEFAULT**; orange stays for DRC risk). When the viewer offers `__cad.project(points)` (requested from W2-A) the service will use it; until then the response carries a warning saying the projection came from `observe()`'s camera. Checked on the drone: the battery's anchor picks the battery.

## Transfer limits and the retry-once rule

`docs/reference/transfer-limits.json` (`protoboard.transfer-limits/v1`, checked 2026-11-01, every route with its source URLs; all URLs answered 200 on 2026-11-01) is read at run time from the copy shipped in `@protoboardai/core` (`packages/core/reference/`, the same bytes; `PROTOBOARD_TRANSFER_LIMITS` names another file), then the checkout's `docs/reference/`, then the built-in copy in `limits.ts`; tests keep all three equal. `views doctor` warns when `checked` is older than `recheckAfterDays` (60).

- Size: the view's CSS size times dpr, scaled down (never up) to `policy.defaultLongEdgePx` (2,576 px) on the long edge, never above the route's 8,000 px per side, and 3,000 px when `batch` says the send holds more than 20 images.
- Encode: PNG for annotated, line, flat and diagram images; JPEG q85 for shaded ones (or what the request or the `--out` extension asks). Over `targetBytes` (2 MB): JPEG steps to q75, q65, then scales by 0.85 per step; annotated line art stays PNG and scales; a flat PNG over the hard cap (3.75 MB raw, Bedrock's 5 MB base64) becomes JPEG. After `maxSteps` (8) an image under the hard cap is kept with a warning; over it the capture fails and says so.
- Retry once (`sendWithRetryOnce`, `fixForSendError`): on a failed send the caller inspects the error. "image dimensions exceed max allowed size": scale to the route's side limit. "many-image requests": every image to 3,000 px, or split the batch to 20. 413, `request_too_large` or "Request too large (max 32MB)": recompress at the next JPEG quality and scale by 0.75. Anything else (auth, rate limit, network): no change, report. It retries once; a second failure stops and reports both errors, the sizes tried and the route.

## Headless to headed: the handoff

Rendering is headless by default. When a person opens the tab, the visible viewer starts from the service's last snapshot and view state, then goes live.

**Why the GPU state cannot move.** A WebGL context belongs to one document in one renderer process; its buffers, textures and compiled programs exist only inside that context, and there is no web API to export one. The headless Chrome is another browser with its own GPU process and, often, another backend (SwiftShader, or D3D11 in another process) from the VS Code webview (Electron). The bytes would not mean the same thing even if they could be copied. What can move: the view state (JSON), the snapshot (a PNG), and the content-hashed GLBs and sidecars on disk, which the visible viewer loads from the same files.

**The closest seamless path** (snapshot first, then live):

1. The service writes a save point on every settle (every capture): `.protoboard/local/snapshots/<key>.png` and `<key>.json`, `<key>` = `snapshotKey(level, view)` (`files.ts`), written image first, then the record, each by temp file and rename. The key is `<level>__<tab id>`, encoded so two levels never share one: the top level is `root` (`root__3d`); a level's `/` becomes `.` (`arm_fr/motor` is `arm_fr.motor__3d`, `arm/fr_motor` is `arm.fr_motor__3d`); every other character outside lower-case letters, digits, `-` and the level's `_` becomes `~` and two hex digits (`a b` is `a~20b`, `Arm` is `~41rm`, a view's `_` is `~5f`). A key never holds a character Windows refuses, never ends in a dot or space, never has a device name (`con`, `nul`, `com1`, ...) as its stem, and a level or view past 96 or 48 characters (**DEFAULT**) is cut and ends in `~~` and 16 hex digits of its sha256. A reader still checks the record's `level` and `view`. The record (`protoboard.snapshot/v0`, `files.ts` `SnapshotMeta`): `view`, `level`, `image`, `width`, `height`, `css` (`width`, `height`, `dpr`), `camera` (position, target, up, fov: W2-A's `CameraState`), `viewState` (W2-A's `__cad.get()` when present), `bundleHash`, `revision`, `backend`, `gpu`, `theme`, `takenAt`, `source` (`render-service`, or `viewer` when the visible viewer writes its own on settle and hide).
2. The host (dev server or extension) serves the snapshot and sends the viewer one message, `uhd-viewer:snapshot` (the exact request is in `phase-1/handoffs.md`, W2-D to W2-A).
3. The viewer paints the PNG under the canvas at once, scaled to the panel's height and centred (the vertical field of view is what both share, so the picture lines up for the same camera at any width), with "Getting your model ready" (or "Updating to the latest build" when `bundleHash` differs from the bundle it loads). Orbit and zoom on the picture are queued.
4. It sets the camera to the snapshot's `camera` exactly before its first frame (no jump), loads from the disk cache, and when its first frame after `settled` is drawn it cross-fades 150 ms (camera unchanged) or replaces the picture (camera moved), then applies the queued input.
5. From then on the visible viewer owns the view state: W2-A's debounced `.protoboard/local/viewer-state.json`, and its own snapshot on settle and hide in the same layout. The service keeps answering agents without moving the person's camera.

Optional bridge, not built: stream the warm headless page with CDP `Page.startScreencast` and forward pointer events while the visible scene loads; only worth it for very heavy models on fast CPUs.

## views doctor

Rendering: browser found; starts headless (time); GL backend (GPU or SwiftShader, flags, why not GPU); WebGL 2; WebGPU (reported, not used); a 64 px WebGL 2 frame draws the probe colour (read back in the page). Capture, separately: the same frame captured as a 64 x 64 PNG has that colour; JPEG encode; a scale 0.5 capture is 32 x 32. Setup: the limits file and its age; whether a service runs. Exit 1 when any check fails. On this machine every check passes on the GPU (about 7 s, most of it the browser start).

## Measured (2026-11-01, Intel UHD, Windows 11)

See `docs/specs/cad-view-research/phase-1/progress.md`, "W2-D".
