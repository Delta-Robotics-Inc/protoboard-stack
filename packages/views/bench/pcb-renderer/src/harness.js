/**
 * The benchmark harness every candidate page shares. A candidate supplies a renderer:
 *
 *   build(scene)            create its drawing of every layer
 *   setView({ cx, cy, s })  center in mm, s = pixels per mm
 *   render()                draw a frame (no-op where the DOM draws itself)
 *   setHighlight(net, dim)  recolor every object on `net` (0 = none), dim the rest when `dim`
 *   dragStart(fp) / dragMove(dx, dy) / dragEnd()   move one footprint live
 *   domPick?(x, y)          optional: the renderer's own picking at a screen point
 *   info()                  what it holds (draw calls, buffers, DOM nodes)
 *
 * The harness drives it from puppeteer through `window.bench` and measures with
 * requestAnimationFrame deltas (Chrome is started without the frame-rate cap).
 */
import { buildScene, pick, pickBrute } from "./scene.js";

const raf = () => new Promise((r) => requestAnimationFrame(r));
const frames = async (n) => { for (let i = 0; i < n; i++) await raf(); };
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] : NaN; };
const summary = (arr) => ({ n: arr.length, median: +q(arr, 0.5).toFixed(3), p95: +q(arr, 0.95).toFixed(3), max: +Math.max(...arr).toFixed(3), mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) });

export function installHarness(createRenderer) {
  const host = document.getElementById("host");
  const W = host.clientWidth, H = host.clientHeight;
  let board, scene, R, view, fit;

  async function loop(n, step) {
    const dts = [], js = [], synced = [];
    let last;
    for (let i = 0; i < n; i++) {
      await new Promise((resolve) => requestAnimationFrame((t) => {
        const now = performance.now();
        if (last !== undefined) dts.push(now - last);
        last = now;
        const a = performance.now();
        step(i);
        R.render();
        js.push(performance.now() - a);
        if (R.sync) { R.sync(); synced.push(performance.now() - a); }
        resolve();
      }));
    }
    await raf();
    const warm = 10;
    return { frame: summary(dts.slice(warm)), js: summary(js.slice(warm)), ...(synced.length ? { synced: summary(synced.slice(warm)) } : {}) };
  }

  window.bench = {
    async load(name) {
      const res = await fetch(`/data/${name}.json`);
      board = JSON.parse(await res.text());
      return { name: board.name };
    },
    async init() {
      const t0 = performance.now();
      scene = buildScene(board);
      const t1 = performance.now();
      R = await createRenderer(host, W, H);
      await R.build(scene);
      const t2 = performance.now();
      const [x0, y0, x1, y1] = scene.box;
      fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s: Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92 };
      view = { ...fit };
      R.setView(view);
      R.render();
      const t3 = performance.now();
      await frames(2);
      const t4 = performance.now();
      window.__scene = scene;
      return { prepMs: +(t1 - t0).toFixed(1), buildMs: +(t2 - t1).toFixed(1), firstFrameJsMs: +(t3 - t2).toFixed(1), firstPaintMs: +(t4 - t0).toFixed(1), objects: scene.objects.length };
    },
    setView(v) { view = { ...view, ...v }; R.setView(view); R.render(); },
    fit() { view = { ...fit }; R.setView(view); R.render(); return fit; },
    async settle() { await frames(3); },
    /** Pan at 2x the fit zoom, on a circle a quarter of the board across. */
    async pan(n = 190) {
      const [x0, y0, x1, y1] = scene.box;
      const rad = Math.min(x1 - x0, y1 - y0) * 0.25;
      const s = fit.s * 2;
      const res = await loop(n, (i) => {
        const t = (i / n) * 2 * Math.PI;
        view = { cx: fit.cx + rad * Math.cos(t), cy: fit.cy + rad * Math.sin(t), s };
        R.setView(view);
      });
      return res;
    },
    /** Zoom from the fit view to 8x and back, about the board center. */
    async zoom(n = 190) {
      return loop(n, (i) => {
        const z = Math.pow(8, (1 - Math.cos((i / n) * 2 * Math.PI)) / 2);
        view = { cx: fit.cx, cy: fit.cy, s: fit.s * z };
        R.setView(view);
      });
    },
    /** Pan with the whole board in view (the worst case for drawing). */
    async panFit(n = 190) {
      const [x0, , x1] = scene.box;
      const rad = (x1 - x0) * 0.05;
      return loop(n, (i) => {
        const t = (i / n) * 2 * Math.PI;
        view = { cx: fit.cx + rad * Math.cos(t), cy: fit.cy + rad * Math.sin(t), s: fit.s };
        R.setView(view);
      });
    },
    /** Drag the footprint with the most pads in a 2 mm circle, at 2x fit zoom centered on it. */
    async drag(n = 190) {
      if (!R.dragStart) return { unsupported: true };
      let fp = -1, most = -1;
      for (const [k, ids] of scene.byFp) {
        if (scene.board.footprints[k].ref.endsWith("_1")) continue; // synthetic copies: stay in copy 0
        const c = ids.filter((i) => scene.objects[i].type === "pad").length;
        if (c > most) { most = c; fp = k; }
      }
      const f = scene.board.footprints[fp];
      view = { cx: f.p[0], cy: f.p[1], s: fit.s * 2 };
      R.setView(view);
      R.render();
      await frames(2);
      const a = performance.now();
      R.dragStart(fp);
      const startMs = performance.now() - a;
      R.render();
      const res = await loop(n, (i) => {
        const t = (i / n) * 2 * Math.PI;
        R.dragMove(2 * Math.cos(t) - 2, 2 * Math.sin(t));
      });
      const b = performance.now();
      R.dragEnd();
      const endMs = performance.now() - b;
      R.render();
      await frames(2);
      return { ...res, footprint: f.ref, objects: scene.byFp.get(fp).length, dragStartMs: +startMs.toFixed(2), dragEndMs: +endMs.toFixed(2) };
    },
    /** Net highlight with dim-others: time from the call to the second frame after it. 12 nets, largest first. */
    async highlight(count = 12) {
      view = { ...fit };
      R.setView(view);
      R.render();
      await frames(3);
      const nets = [...scene.byNet.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, count);
      const lat = [], js = [];
      for (const [n] of nets) {
        const t0 = performance.now();
        R.setHighlight(n, true);
        R.render();
        R.sync?.();
        const t1 = performance.now();
        await frames(2);
        lat.push(performance.now() - t0);
        js.push(t1 - t0);
        await frames(2);
      }
      const t0 = performance.now();
      R.setHighlight(0, false);
      R.render();
      await frames(2);
      const clearMs = performance.now() - t0;
      return { latency: summary(lat), js: summary(js), clearMs: +clearMs.toFixed(2), largestNet: scene.nets[nets[0][0]], largestNetObjects: nets[0][1].length };
    },
    /** Pick under a point: Flatbush plus exact geometry, 20,000 random points; agreement with brute force on 400. */
    hitTest(n = 20000) {
      const [x0, y0, x1, y1] = scene.box;
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const pts = Array.from({ length: n }, () => [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)]);
      let hits = 0;
      const t0 = performance.now();
      for (const [x, y] of pts) if (pick(scene, x, y)) hits++;
      const per = (performance.now() - t0) / n;
      let agree = 0;
      const m = Math.min(400, n);
      for (let i = 0; i < m; i++) if (pick(scene, pts[i][0], pts[i][1])?.id === pickBrute(scene, pts[i][0], pts[i][1])?.id) agree++;
      const out = { perQueryUs: +(per * 1000).toFixed(2), hitRate: +(hits / n).toFixed(3), agreement: +(agree / m).toFixed(3) };
      if (R.domPick) {
        // the renderer's own picking at the same points, on screen
        view = { ...fit };
        R.setView(view);
        R.render();
        const W2 = W / 2, H2 = H / 2;
        const sp = pts.slice(0, 2000).map(([x, y]) => [(x - view.cx) * view.s + W2, (y - view.cy) * view.s + H2]);
        const t1 = performance.now();
        let same = 0;
        const res = sp.map(([sx, sy]) => R.domPick(sx, sy));
        out.domPerQueryUs = +(((performance.now() - t1) / sp.length) * 1000).toFixed(2);
        res.forEach((r, i) => { const g = pick(scene, pts[i][0], pts[i][1]); if ((r?.n ?? 0) === (g?.n ?? 0)) same++; });
        out.domNetAgreement = +(same / sp.length).toFixed(3);
      }
      return out;
    },
    /** Light the `rank`-th largest net (0 = clear) with dim-others, at the fit view. */
    async lightNet(rank) {
      view = { ...fit };
      R.setView(view);
      const nets = [...scene.byNet.entries()].sort((a, b) => b[1].length - a[1].length);
      const n = rank ? nets[rank - 1][0] : 0;
      R.setHighlight(n, !!n);
      R.render();
      await frames(3);
      return scene.nets[n];
    },
    info() { return { ...R.info(), view }; },
    /** Screen position of the designator `ref`, and a view that makes its text `px` pixels tall. */
    designatorView(ref, px = 140) {
      const t = scene.board.texts.find((x) => x.designator && x.t === ref) ?? scene.board.texts.find((x) => x.designator);
      return { cx: t.p[0], cy: t.p[1], s: px / t.s, ref: t.t };
    },
  };
}
