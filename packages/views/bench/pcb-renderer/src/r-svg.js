/**
 * Candidate (d): plain SVG, the known-slow baseline. One element per geometry part, one group
 * per layer with the layer's opacity (a group, so no double blending), pan and zoom by the
 * viewBox. Net highlight: the net's elements cloned into an overlay group in the highlight
 * color; dim-others lowers the layer groups' opacity. Drag: the footprint's elements move into
 * a group whose transform changes each frame. Picking can also use the DOM (elementFromPoint).
 */
import { COLORS } from "./scene.js";
import { installHarness } from "./harness.js";

const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const f = (v) => +v.toFixed(4);
const pathD = (q, close) => {
  let d = `M${f(q[0])} ${f(q[1])}`;
  for (let i = 2; i < q.length; i += 2) d += `L${f(q[i])} ${f(q[i + 1])}`;
  return close ? d + "Z" : d;
};
function partSvg(p, id, n) {
  const a = `data-o="${id}" data-n="${n}"`;
  switch (p.k) {
    case "poly": return `<path ${a} d="${p.rings.map((r) => pathD(r, true)).join("")}" fill-rule="evenodd" stroke="none"/>`;
    case "seg": return `<line ${a} x1="${f(p.x1)}" y1="${f(p.y1)}" x2="${f(p.x2)}" y2="${f(p.y2)}" stroke-width="${p.w}" fill="none"/>`;
    case "path": return `<path ${a} d="${pathD(p.pts, p.closed)}" stroke-width="${p.w}" fill="none"/>`;
    case "text": return `<path ${a} d="${p.paths.map((q) => pathD(q, false)).join("")}" stroke-width="${f(p.w)}" fill="none"/>`;
    case "box": {
      const r = Math.min(p.c, p.hx, p.hy);
      return `<rect ${a} x="${f(p.cx - p.hx)}" y="${f(p.cy - p.hy)}" width="${f(2 * p.hx)}" height="${f(2 * p.hy)}"${r ? ` rx="${f(r)}"` : ""}${p.a ? ` transform="rotate(${f((p.a * 180) / Math.PI)} ${f(p.cx)} ${f(p.cy)})"` : ""} stroke="none"/>`;
    }
    case "ring":
      return p.ri > 0
        ? `<circle ${a} cx="${f(p.cx)}" cy="${f(p.cy)}" r="${f((p.r + p.ri) / 2)}" stroke-width="${f(p.r - p.ri)}" fill="none"/>`
        : `<circle ${a} cx="${f(p.cx)}" cy="${f(p.cy)}" r="${f(p.r)}" stroke="none"/>`;
  }
  return "";
}

async function createRenderer(host, W, H) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.style.background = css(COLORS.bg);
  svg.style.display = "block";
  host.appendChild(svg);
  let scene, groups = [], overlay, byObj, drag;

  return {
    async build(sc) {
      scene = sc;
      let html = "";
      for (const [i, layer] of sc.layers.entries()) {
        if (!layer.objects.length) continue;
        const c = css(layer.color);
        html += `<g data-layer="${i}" opacity="${layer.alpha}" fill="${c}" stroke="${c}" stroke-linecap="round" stroke-linejoin="round">`;
        for (const id of layer.objects) { const o = sc.objects[id]; for (const p of o.parts) html += partSvg(p, id, o.n); }
        html += `</g>`;
      }
      html += `<g data-overlay fill="${css(COLORS.highlight)}" stroke="${css(COLORS.highlight)}" stroke-linecap="round" stroke-linejoin="round"></g>`;
      svg.innerHTML = html;
      groups = [...svg.querySelectorAll("g[data-layer]")];
      overlay = svg.querySelector("g[data-overlay]");
      byObj = new Map();
      for (const el of svg.querySelectorAll("[data-o]")) {
        const id = +el.getAttribute("data-o");
        (byObj.get(id) ?? byObj.set(id, []).get(id)).push(el);
      }
    },
    setView(v) { svg.setAttribute("viewBox", `${v.cx - W / 2 / v.s} ${v.cy - H / 2 / v.s} ${W / v.s} ${H / v.s}`); },
    render() {},
    setHighlight(n, dim) {
      overlay.replaceChildren();
      if (n) for (const id of scene.byNet.get(n) ?? []) for (const el of byObj.get(id) ?? []) overlay.appendChild(el.cloneNode());
      for (const g of groups) g.setAttribute("opacity", scene.layers[+g.dataset.layer].alpha * (n && dim ? 0.3 : 1));
    },
    dragStart(fp) {
      drag = [];
      for (const id of scene.byFp.get(fp)) {
        const els = byObj.get(id) ?? [];
        if (!els.length) continue;
        const parent = els[0].parentNode;
        let g = drag.find((d) => d.parent === parent)?.g;
        if (!g) { g = document.createElementNS(NS, "g"); parent.appendChild(g); drag.push({ parent, g }); }
        for (const el of els) g.appendChild(el);
      }
    },
    dragMove(dx, dy) { for (const d of drag) d.g.setAttribute("transform", `translate(${dx} ${dy})`); },
    dragEnd() {
      for (const d of drag) { d.g.removeAttribute("transform"); while (d.g.firstChild) d.parent.appendChild(d.g.firstChild); d.g.remove(); }
      drag = undefined;
    },
    domPick(x, y) {
      const r = host.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + x, r.top + y)?.closest?.("[data-o]");
      return el ? scene.objects[+el.getAttribute("data-o")] : undefined;
    },
    info() { return { domNodes: svg.getElementsByTagName("*").length }; },
  };
}

installHarness(createRenderer);
