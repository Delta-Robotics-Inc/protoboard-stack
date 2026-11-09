/**
 * Candidate (b): Canvas 2D. Each layer is drawn opaque into its own offscreen canvas (with a
 * margin around the view) and the layers are composited with their opacity. Pan and small
 * zoom steps blit the cached layers; past the margin or a 1.25x scale change the caches are
 * redrawn, and 150 ms after a zoom settles they are redrawn sharp. A drag redraws only the
 * dirty rectangle of the layers the footprint touches. Net highlight is an overlay of the
 * net's objects drawn at the current view; dim-others lowers the base layers' opacity.
 *
 * `?mode=full` redraws every layer every frame instead (no caching), for comparison.
 */
import Flatbush from "flatbush";
import { COLORS } from "./scene.js";
import { installHarness } from "./harness.js";

const css = (c, k = 1) => `rgb(${Math.round(c[0] * 255 * k)},${Math.round(c[1] * 255 * k)},${Math.round(c[2] * 255 * k)})`;
const MODE = new URLSearchParams(location.search).get("mode") ?? "cached";

/** Draw objects into ctx (its transform maps mm to pixels). `off(o)` gives a per-object offset. */
function drawObjects(ctx, objects, color, off) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const base = ctx.getTransform();
  // zones and filled polygons: one fill each (even-odd within the object)
  const lines = new Map();
  const fills = new Path2D();
  let anyFill = false;
  const rings = [];
  for (const o of objects) {
    const [ox, oy] = off ? off(o) : [0, 0];
    for (const p of o.parts) {
      if (p.k === "poly") {
        const path = new Path2D();
        for (const r of p.rings) {
          path.moveTo(r[0] + ox, r[1] + oy);
          for (let i = 2; i < r.length; i += 2) path.lineTo(r[i] + ox, r[i + 1] + oy);
          path.closePath();
        }
        ctx.fill(path, "evenodd");
      } else if (p.k === "seg") {
        let path = lines.get(p.w);
        if (!path) lines.set(p.w, (path = new Path2D()));
        path.moveTo(p.x1 + ox, p.y1 + oy);
        path.lineTo(p.x2 + ox, p.y2 + oy);
      } else if (p.k === "path" || p.k === "text") {
        let path = lines.get(p.w);
        if (!path) lines.set(p.w, (path = new Path2D()));
        for (const q of p.k === "text" ? p.paths : [p.pts]) {
          path.moveTo(q[0] + ox, q[1] + oy);
          for (let i = 2; i < q.length; i += 2) path.lineTo(q[i] + ox, q[i + 1] + oy);
          if (p.closed) path.closePath();
        }
      } else if (p.k === "box") {
        anyFill = true;
        const m = new DOMMatrix().translateSelf(p.cx + ox, p.cy + oy).rotateSelf((p.a * 180) / Math.PI);
        const local = new Path2D();
        local.roundRect(-p.hx, -p.hy, 2 * p.hx, 2 * p.hy, Math.min(p.c, p.hx, p.hy));
        fills.addPath(local, m);
      } else if (p.k === "ring") {
        if (p.ri > 0) rings.push([p.cx + ox, p.cy + oy, p.r, p.ri]);
        else {
          anyFill = true;
          fills.moveTo(p.cx + ox + p.r, p.cy + oy);
          fills.arc(p.cx + ox, p.cy + oy, p.r, 0, 2 * Math.PI);
        }
      }
    }
  }
  if (anyFill) ctx.fill(fills);
  for (const [w, path] of lines) {
    ctx.lineWidth = Math.max(w, 1 / Math.hypot(base.a, base.b));
    ctx.stroke(path);
  }
  for (const [cx, cy, r, ri] of rings) {
    ctx.lineWidth = r - ri;
    ctx.beginPath();
    ctx.arc(cx, cy, (r + ri) / 2, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

async function createRenderer(host, W, H) {
  const dpr = window.devicePixelRatio;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false });
  const M = MODE === "full" ? 0 : 160; // cache margin, CSS pixels
  const CW = (W + 2 * M) * dpr, CH = (H + 2 * M) * dpr;
  let scene, view, cache; // cache = { cx, cy, s } the caches were drawn at
  let layers = [];
  let net = 0, dim = false;
  let drag; // { fp, ids:Set, dx, dy, layers:Set, box }
  let allIndex, allObjs;
  let settleTimer;
  const overlay = document.createElement("canvas");
  overlay.width = W * dpr;
  overlay.height = H * dpr;
  const octx = overlay.getContext("2d");
  let redraws = 0;

  const setT = (c, v, margin) => c.setTransform(v.s * dpr, 0, 0, v.s * dpr, (W / 2 + margin - v.cx * v.s) * dpr, (H / 2 + margin - v.cy * v.s) * dpr);
  const offOf = (o) => (drag && drag.ids.has(o.id) ? [drag.dx, drag.dy] : [0, 0]);

  function drawLayer(l, v) {
    const c = l.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, CW, CH);
    setT(c, v, M);
    drawObjects(c, l.objs, css(l.layer.color), drag ? offOf : undefined);
  }
  function drawAll(v) {
    for (const l of layers) drawLayer(l, v);
    cache = { ...v };
    redraws++;
  }
  function drawOverlay() {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, W * dpr, H * dpr);
    if (!net) return;
    setT(octx, view, 0);
    const ids = scene.byNet.get(net) ?? [];
    drawObjects(octx, ids.map((i) => scene.objects[i]), css(COLORS.highlight), drag ? offOf : undefined);
  }
  /** Redraw one rectangle (mm) of the layers in `which`, at the cached view. */
  function redrawRect(box, which) {
    const [x0, y0, x1, y1] = box;
    const ids = allIndex.search(x0, y0, x1, y1);
    for (const l of layers) {
      if (!which.has(l.i)) continue;
      const c = l.ctx;
      c.save();
      setT(c, cache, M);
      c.beginPath();
      c.rect(x0, y0, x1 - x0, y1 - y0);
      c.clip();
      c.setTransform(1, 0, 0, 1, 0, 0);
      // clear the clip in device space
      c.globalCompositeOperation = "copy";
      c.fillStyle = "rgba(0,0,0,0)";
      c.fillRect(0, 0, CW, CH);
      c.globalCompositeOperation = "source-over";
      setT(c, cache, M);
      const objs = [];
      for (const k of ids) { const o = allObjs[k]; if (o.L === l.i && !(drag && drag.ids.has(o.id))) objs.push(o); }
      if (drag) for (const id of drag.ids) { const o = scene.objects[id]; if (o.L === l.i) objs.push(o); }
      drawObjects(c, objs, css(l.layer.color), drag ? offOf : undefined);
      c.restore();
    }
  }
  function composite() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = css(COLORS.bg);
    ctx.fillRect(0, 0, W * dpr, H * dpr);
    const k = view.s / cache.s;
    const x0 = ((cache.cx - (W / 2 + M) / cache.s - view.cx) * view.s + W / 2) * dpr;
    const y0 = ((cache.cy - (H / 2 + M) / cache.s - view.cy) * view.s + H / 2) * dpr;
    for (const l of layers) {
      ctx.globalAlpha = l.layer.alpha * (net && dim ? 0.3 : 1);
      ctx.drawImage(l.canvas, x0, y0, CW * k, CH * k);
    }
    ctx.globalAlpha = 1;
    if (net) ctx.drawImage(overlay, 0, 0);
  }

  return {
    async build(sc) {
      scene = sc;
      layers = sc.layers.map((layer, i) => ({ i, layer, objs: layer.objects.map((id) => sc.objects[id]) })).filter((l) => l.objs.length);
      for (const l of layers) {
        l.canvas = document.createElement("canvas");
        l.canvas.width = CW;
        l.canvas.height = CH;
        l.ctx = l.canvas.getContext("2d");
      }
      allObjs = sc.objects;
      allIndex = new Flatbush(allObjs.length);
      for (const o of allObjs) allIndex.add(o.box[0], o.box[1], o.box[2], o.box[3]);
      allIndex.finish();
    },
    setView(v) {
      view = { ...v };
      if (MODE === "full" || !cache) return drawAll(view);
      const k = view.s / cache.s;
      // the screen, in cache pixels, must lie inside the cache
      const sx0 = (view.cx - W / 2 / view.s - cache.cx) * cache.s + W / 2 + M;
      const sy0 = (view.cy - H / 2 / view.s - cache.cy) * cache.s + H / 2 + M;
      const inside = sx0 >= 0 && sy0 >= 0 && sx0 + W / k <= W + 2 * M && sy0 + H / k <= H + 2 * M;
      if (!inside || k < 0.8 || k > 1.25) drawAll(view);
      else if (k !== 1) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => { drawAll(view); drawOverlay(); composite(); }, 150);
      }
    },
    render() {
      if (net) drawOverlay();
      composite();
    },
    setHighlight(n, d) { net = n; dim = !!d; },
    dragStart(fp) {
      const ids = new Set(scene.byFp.get(fp));
      drag = { fp, ids, dx: 0, dy: 0, layers: new Set([...ids].map((i) => scene.objects[i].L)), box: undefined };
      let b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const i of ids) { const o = scene.objects[i].box; b = [Math.min(b[0], o[0]), Math.min(b[1], o[1]), Math.max(b[2], o[2]), Math.max(b[3], o[3])]; }
      drag.base = b;
      drag.box = b;
    },
    dragMove(dx, dy) {
      if (MODE === "full") { drag.dx = dx; drag.dy = dy; drawAll(view); return; }
      const pad = 2 / cache.s;
      const nb = [drag.base[0] + dx, drag.base[1] + dy, drag.base[2] + dx, drag.base[3] + dy];
      const dirty = [Math.min(drag.box[0], nb[0]) - pad, Math.min(drag.box[1], nb[1]) - pad, Math.max(drag.box[2], nb[2]) + pad, Math.max(drag.box[3], nb[3]) + pad];
      drag.dx = dx;
      drag.dy = dy;
      drag.box = nb;
      redrawRect(dirty, drag.layers);
    },
    dragEnd() {
      const b = drag.box;
      const which = drag.layers;
      drag.dx = 0; drag.dy = 0;
      if (MODE !== "full") redrawRect([Math.min(b[0], drag.base[0]) - 0.1, Math.min(b[1], drag.base[1]) - 0.1, Math.max(b[2], drag.base[2]) + 0.1, Math.max(b[3], drag.base[3]) + 0.1], which);
      drag = undefined;
      if (MODE === "full") drawAll(view);
    },
    // no sync(): a 1-pixel readback each frame moves Chrome's canvas off the GPU (measured 150 to 400 ms
    // frames), so Canvas 2D frame cost is read from vsync-paced frame delivery instead
    info() {
      return { mode: MODE, layerCaches: layers.length, cacheMB: +((layers.length * CW * CH * 4) / 1048576).toFixed(1), fullRedraws: redraws };
    },
  };
}

installHarness(createRenderer);
