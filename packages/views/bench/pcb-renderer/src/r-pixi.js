/**
 * Candidate (c): PixiJS 8.22.0 (WebGL), loaded from the scratch install, not a repo dependency.
 * One Graphics per layer, built with Pixi's own shape API (rounded rectangles under a
 * transform, circles, polygons, round-capped strokes batched by width). Coordinates are in
 * micrometers: Pixi tessellates curves in local units, so millimeters would give 2-segment
 * circles. Layer opacity as a group needs an AlphaFilter per layer (an offscreen pass each).
 *
 * Net highlight: an overlay Graphics of the net's objects, rebuilt on each change; dim-others
 * lowers the layer filters' alpha. Each footprint has its own Graphics per layer (board-level
 * copper shares one per layer), so a drag moves those by position each frame.
 */
import { Application, Container, Graphics, AlphaFilter } from "pixi.js";
import { COLORS } from "./scene.js";
import { installHarness } from "./harness.js";

const U = 1000; // micrometers
const hex = (c, k = 1) => (Math.round(c[0] * 255 * k) << 16) | (Math.round(c[1] * 255 * k) << 8) | Math.round(c[2] * 255 * k);

function drawInto(g, objects, color) {
  const lines = new Map();
  let boxes = 0;
  for (const o of objects) {
    for (const p of o.parts) {
      if (p.k === "poly") {
        for (const r of p.rings) g.poly(r.map((v) => v * U), true);
        g.fill({ color });
      } else if (p.k === "seg") {
        (lines.get(p.w) ?? lines.set(p.w, []).get(p.w)).push([p.x1, p.y1, p.x2, p.y2]);
      } else if (p.k === "path" || p.k === "text") {
        for (const q of p.k === "text" ? p.paths : [p.closed ? [...p.pts, p.pts[0], p.pts[1]] : p.pts]) (lines.get(p.w) ?? lines.set(p.w, []).get(p.w)).push(q);
      }
    }
  }
  // pads and disks: one fill for all
  for (const o of objects) {
    for (const p of o.parts) {
      if (p.k === "box") {
        const c = Math.cos(p.a), s = Math.sin(p.a);
        g.setTransform(c, s, -s, c, p.cx * U, p.cy * U);
        g.roundRect(-p.hx * U, -p.hy * U, 2 * p.hx * U, 2 * p.hy * U, Math.min(p.c, p.hx, p.hy) * U);
        boxes++;
      } else if (p.k === "ring" && !(p.ri > 0)) {
        g.resetTransform();
        g.circle(p.cx * U, p.cy * U, p.r * U);
        boxes++;
      }
    }
  }
  g.resetTransform();
  if (boxes) g.fill({ color });
  for (const o of objects) for (const p of o.parts) if (p.k === "ring" && p.ri > 0) g.circle(p.cx * U, p.cy * U, ((p.r + p.ri) / 2) * U).stroke({ width: (p.r - p.ri) * U, color });
  for (const [w, list] of lines) {
    for (const q of list) {
      g.moveTo(q[0] * U, q[1] * U);
      for (let i = 2; i < q.length; i += 2) g.lineTo(q[i] * U, q[i + 1] * U);
    }
    g.stroke({ width: w * U, color, cap: "round", join: "round" });
  }
}

async function createRenderer(host, W, H) {
  const app = new Application();
  await app.init({ width: W, height: H, background: hex(COLORS.bg), antialias: true, resolution: window.devicePixelRatio, autoDensity: true, preference: "webgl", autoStart: false, sharedTicker: false, preserveDrawingBuffer: true });
  app.ticker?.stop();
  host.appendChild(app.canvas);
  const root = new Container();
  app.stage.addChild(root);
  let scene, layers = [], overlay, net = 0, dim = false, drag;
  const fpGraphics = new Map();

  const PIX = new Uint8Array(4);
  return {
    async build(sc) {
      scene = sc;
      for (const [i, layer] of sc.layers.entries()) {
        const objs = layer.objects.map((id) => sc.objects[id]);
        if (!objs.length) continue;
        const c = new Container();
        const f = new AlphaFilter({ alpha: layer.alpha });
        c.filters = [f];
        const color = hex(layer.color);
        // board-level objects (zones, tracks, vias, board graphics) in one Graphics; each footprint in its own
        const loose = objs.filter((o) => o.fp < 0);
        if (loose.length) { const g = new Graphics(); drawInto(g, loose, color); c.addChild(g); }
        const byFp = new Map();
        for (const o of objs) if (o.fp >= 0) (byFp.get(o.fp) ?? byFp.set(o.fp, []).get(o.fp)).push(o);
        for (const [fp, list] of byFp) {
          const g = new Graphics();
          drawInto(g, list, color);
          c.addChild(g);
          (fpGraphics.get(fp) ?? fpGraphics.set(fp, []).get(fp)).push(g);
        }
        root.addChild(c);
        layers.push({ i, layer, c, f });
      }
      overlay = new Graphics();
      root.addChild(overlay);
    },
    setView(v) {
      const s = v.s / U;
      root.scale.set(s);
      root.position.set(W / 2 - v.cx * v.s, H / 2 - v.cy * v.s);
    },
    render() { app.render(); },
    setHighlight(n, d) {
      net = n;
      dim = !!d;
      overlay.clear();
      if (n) drawInto(overlay, (scene.byNet.get(n) ?? []).map((i) => scene.objects[i]), hex(COLORS.highlight));
      for (const l of layers) l.f.alpha = l.layer.alpha * (n && dim ? 0.3 : 1);
    },
    dragStart(fp) { drag = fpGraphics.get(fp) ?? []; },
    dragMove(dx, dy) { for (const g of drag) g.position.set(dx * U, dy * U); },
    dragEnd() { for (const g of drag) g.position.set(0, 0); drag = undefined; },
    sync() { const gl = app.renderer.gl; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIX); },
    info() { return { renderer: app.renderer.name, layers: layers.length, graphics: layers.reduce((n, l) => n + l.c.children.length, 0), version: "pixi.js 8.22.0" }; },
  };
}

installHarness(createRenderer);
