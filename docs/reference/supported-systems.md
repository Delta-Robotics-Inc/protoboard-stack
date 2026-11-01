# Supported systems

What Protoboard Stack (CLI, VS Code extension, viewer, CAD and PCB runtimes) runs on. Each row says whether it was **verified**: on which machine, how, and when. Rows that were not tested say **unverified**. Requirements come from the code: the `engines` fields, the managed runtime declarations, the renderer.

Started 2026-11-01 for PB-1198. The release checklist at the end keeps it current. Values marked DEFAULT were set overnight without Kevin (phase-1 plan.md) and are open to change.

The machine behind every `verified` row is "the dev laptop": Windows 11 Home 10.0.26300, Intel Core i7-10750H, 31.8 GiB RAM (34,166,947,840 B), Intel UHD Graphics (PCI id 0x9BC4, integrated) and NVIDIA GeForce RTX 3070 Laptop GPU. Headless Chrome used the Intel GPU in every run.

## Summary

| Area | Requirement | Status |
|---|---|---|
| OS | Windows 11 | verified (dev laptop, 2026-11-01) |
| OS | macOS, Linux | unverified |
| Node.js | >= 22 (CLI, core, every extension); the cloud client >= 22.13 | 24.11.0 verified (dev laptop, 2026-11-01) |
| VS Code | ^1.106.0 | 1.144.0 installed on the dev laptop; end-to-end in a webview unverified |
| Browser for the viewer | WebGL 2 (Chrome or Chromium-based) | Chrome 156.0.8078.79 headless verified (2026-11-01) |
| GPU | Any WebGL 2 GPU; integrated is enough for the examples | Intel UHD 0x9BC4 through ANGLE d3d11 verified (2026-11-01); discrete unverified |
| Python (CAD) | 3.11 to 3.14 (`>=3.11,<3.15`), build123d 0.13.0 | 3.14.6 with build123d 0.13.0 verified (2026-11-01) |
| KiCad (PCB) | KiCad 10 (`kicad-cli` major 10 or newer) | 10.0.5 verified (2026-11-01) |
| RAM | 8 GB minimum, 16 GB recommended (DEFAULT) | unverified as a minimum |
| Remote (SSH, containers, Codespaces) and WSL | n/a | unverified |

## Operating systems

| OS | Status | How |
|---|---|---|
| Windows 11 Home 10.0.26300, x64 | **verified** 2026-11-01 | Every phase-1 wave ran here: the stack test suites, `protoboard build`, `views check` and `views capture`, the headless probe (`docs/specs/cad-view-research/phase-1/baseline.md`, `progress.md`, `wave-3-review.md`). Known Windows-only test failures, recorded in `progress.md` (wave 0): POSIX path expectations in some suites. Not product defects. |
| Windows 10 | unverified | |
| macOS (Apple silicon or Intel) | unverified | The KiCad search covers `/Applications/KiCad*/KiCad*.app` (W1-D, tested with a fake file tree only) |
| Linux (x64) | unverified | The KiCad search covers `/usr/bin`, `/usr/local/bin`, `/usr/lib/kicad-nightly/bin` (fake file tree only) |

## Node.js

| Item | Value | Status |
|---|---|---|
| Required | `>=22` in `package.json` `engines` of the root, `packages/cli`, `core`, `views`, `web-viewer` and every `ext-*` package; `>=22.13` in `packages/cloud` | from the code (`grep '"node"' packages/*/package.json`, 2026-11-01) |
| This machine | v24.11.0 (`node --version`) | **verified** 2026-11-01 |
| Node 22.x | the lowest allowed | unverified (no run on 22 recorded) |

## VS Code

| Item | Value | Status |
|---|---|---|
| Required | `engines.vscode: ^1.106.0` (`packages/vscode-protoboard/package.json`) | from the code |
| This machine | 1.144.0 (`code --version`, commit 2c33b50b) | installed; the extension built (wave 0, `setup.md`) |
| The viewer in a VS Code webview | | **unverified**: every phase-1 builder and gate lists the webview as unverified (`wave-3-review.md`, "Unverified") |
| `navigator.gpu` in a VS Code webview | | **unverified**: to check before the r188 re-test below |
| VS Code telemetry off | also stops Protoboard's local recording (DEFAULT, `docs/reference/telemetry.md`) | unit-tested (`packages/core/test/telemetry.test.ts`) |

## Browsers and graphics

| Item | Value | Status |
|---|---|---|
| Renderer | three.js `WebGLRenderer`, r187 (`three` 0.187.0 in uhd-viewer, the extension, web-viewer, ext-docs, ext-tscircuit; `>=0.187.0` in views) | from the code |
| WebGL | **WebGL 2 required** | from the code |
| WebGPU | **not used**: `WebGPURenderer` is not in the build | by design |
| Chrome | 156.0.8078.79 (registry `HKCU\Software\Google\Chrome\BLBeacon` `version`; `chrome.exe --version` prints nothing on Windows) | **verified** headless 2026-11-01 |
| Chrome headless, GPU | `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`: `ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)` | **verified** 2026-11-01 (render service log, probe) |
| Chrome headless, software | SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`), as `views check` uses | **verified** 2026-11-01; about 6 fps on the drone before wave 1 (baseline) |
| Edge, other Chromium | | unverified |
| Firefox, Safari | | unverified |
| Device pixel ratio 2 (HiDPI) | | **unverified**: every probe ran at dpr 1 |
| Discrete GPU | RTX 3070 Laptop present, never selected by headless Chrome | **unverified** |

### Re-test WebGPU at three r188 (PB-1198)

three PR #32243 is expected in r188. When it lands:

1. In a VS Code webview (the extension's viewer panel), check `navigator.gpu` and `await navigator.gpu?.requestAdapter()`. Record the VS Code version, the result and the adapter info here.
2. Only if an adapter comes back, try `WebGPURenderer` behind a flag on the drone and ClientX, and compare draw calls, time to settled and orbit frame time with the WebGL rows below.
3. Keep WebGL 2 as the default until both projects match.

## GPU, measured

Headless Chrome 1440x900, dpr 1, ANGLE d3d11 on the Intel UHD 0x9BC4, after wave 3 (`wave-3-review.md`, "Measured", 2026-11-01):

| | Drone (`examples/quadcopter-5in`) | ClientX (control board, 31.8 MB board GLB) |
|---|---:|---:|
| Draw calls (instanced) | 231 (139) | 71 (22) |
| Triangles | 329,652 | 870,905 |
| Time to settled | 1.30 to 1.71 s | 2.35 to 2.56 s |
| Orbit frame median (toon and ink) | 8.5 ms | 13.1 ms |
| Idle, 5 s | 0 draws | 0 draws |
| JS heap after orbit | 25.5 MB | 19.3 to 28.6 MB |
| `views capture` cold / warm | 11.0 / 1.9 s | 11.9 / 1.9 s |

Before wave 1 (`baseline.md`), ClientX drew 70,160 calls and 2,003,252 triangles at about 4 fps on this GPU with about 1.09 GB of JS heap. One of two GPU runs lost the WebGL context. The view sidecars (W1-A) brought that down to the table above. A loss of context has not been recorded since, but nobody has gone looking for one.

| Item | Status |
|---|---|
| Integrated GPU (Intel UHD 0x9BC4) | **verified** 2026-11-01 (the numbers above) |
| Software rendering (SwiftShader) | **verified** 2026-11-01: works, slow; `views check` uses it |
| Minimum GPU | DEFAULT: any GPU with WebGL 2; nothing slower than the Intel UHD (0x9BC4) above was tested. **unverified** |
| Discrete GPU, the "60 fps on discrete" target | **unverified** |

## Python (CAD runtimes)

| Item | Value | Status |
|---|---|---|
| Required | `"python": ">=3.11,<3.15"` and `build123d==0.13.0` in the `python-build123d` runtime of `packages/ext-frame-cad/protoboard-extension.json`. `protoboard tools install cad` makes a project venv with these pins; `PROTOBOARD_PYTHON` points at another interpreter | from the code |
| This machine | Python 3.14.6, build123d 0.13.0 (ClientX's `protoboard tools` CAD runtime, `.protoboard/tools/cad/Scripts/python.exe`; `python -I -c "import sys, build123d"`) | **verified** 2026-11-01 |
| Python 3.11, 3.12, 3.13 | | unverified |
| Byte-for-byte CAD regeneration on Windows | some committed outputs differ (non-ASCII in `json.dumps`; `progress.md` wave 0) | known |

## KiCad (PCB)

| Item | Value | Status |
|---|---|---|
| Required | `kicad-cli` with major version 10 or newer (W1-D; KiCad 11 accepted with a note) | from the code (`packages/ext-tscircuit/lib/kicad/detect.cjs`) |
| This machine | 10.0.5 at `C:\Program Files\KiCad\10.0\bin\kicad-cli.exe` (`kicad-cli version`) | **verified** 2026-11-01 |
| Memory note | KiCad 10's `_pcbnew.dll` failed with "error 1455: The paging file is too small" under the full test run (`progress.md`, wave 0). Give Windows a system-managed paging file | observed 2026-11-01 |

## Memory (RAM)

| Item | Status |
|---|---|
| The dev laptop: 31.8 GiB | **verified** 2026-11-01 |
| Minimum 8 GB, recommended 16 GB | **DEFAULT, unverified**. Basis: the viewer's JS heap is now 20 to 30 MB on both examples (above), but VS Code, headless Chrome for the render service, Python with build123d and KiCad run side by side, and KiCad 10 hit the paging-file limit once. No run on an 8 GB machine |

## Remote and WSL

| Setup | Status |
|---|---|
| VS Code Remote SSH, Dev Containers, Codespaces | **unverified**. The viewer's dev server and the render service listen on loopback only, so a remote host needs the editor's port forwarding |
| WSL 2 | **unverified**. WSL 2 with Ubuntu 24.04 is installed on the dev laptop, but Protoboard has not run inside it |

## Known limits from the phase-1 waves

| Limit | Value | Source |
|---|---|---|
| Largest board GLB tested | 31,774,432 B (ClientX `pcb-b1-4` `body.glb`: 68,849 primitives, 751,282 triangles) | `baseline.md` |
| Largest scene tested | ClientX: 2,003,252 triangles as drawn before the sidecars, 870,905 after | `baseline.md`, `wave-3-review.md` |
| Image to an agent | long edge 2,576 px by default (`--max-long-edge`); at most 8,000 px per side, 3,000 px when more than 20 images go in one request; at most 10 MB of base64 per image on the Claude API route | `docs/reference/transfer-limits.json` (checked 2026-11-01) |
| Live-tab reply | over 64 kB unverified since keepalive was dropped | `wave-3-review.md` |
| `views check` | do not run two SwiftShader browsers at once: one hung for 14 min on ClientX | `baseline.md` |
| Coarse and boxes tiers | no example crosses the pre-flight limits; unit-tested only | `wave-3-review.md` |

## Release checklist: keeping this current

Before each release, the release owner:

1. Updates every `from the code` row from the code. Run `grep '"node"' packages/*/package.json` and `grep '"vscode"' packages/vscode-protoboard/package.json`, and check the `three` versions and the `python` and pins of the `python-build123d` runtime.
2. Re-measures the GPU table on the drone and ClientX: the probe in `phase-1/baseline.md`, or `protoboard views capture`. Puts in the new numbers with the date.
3. Turns an `unverified` row into `verified` only with the machine, the command and the date. Every machine that runs a release check adds its own line under "Operating systems" (macOS and Linux first).
4. Records the installed Chrome, VS Code, Node, Python and KiCad versions of each machine that ran the check.
5. Checks the WebGPU item: has three r188 (PR #32243) shipped, and what does `navigator.gpu` say in the VS Code version of the day?
6. Rechecks `docs/reference/transfer-limits.json` when its `checked` date is older than its `recheckAfterDays`.
7. Dates the change at the top of this file.
