/// <reference path="../parts/three.d.ts" />
/**
 * The board renderer: WebGL2 through three.js, orthographic, in the form that won the Phase 0 renderer
 * benchmark. Per draw layer, one instanced mesh of rotated rounded boxes shaded by a
 * signed-distance function (pads, tracks, vias, rings, text strokes: edges exact at every zoom, no MSAA) and one
 * triangle mesh (filled polygons, their edges antialiased by hairline boxes). A layer with partial opacity is drawn
 * into an offscreen target and composited as a group, so overlaps inside it never double-blend; an opaque layer is
 * drawn straight to the screen. Net highlight is a per-net texture (one texel per net); a live drag is a footprint
 * index and an offset uniform. Selection and hover are outline overlays built from the selected objects' cached
 * geometry. Picking is not done here (pick.ts).
 *
 * The renderer only reads: it is given a scene and its buffers, and uploads the ranges the buffers mark dirty.
 */
import * as THREE from "three";
import { SceneBuffers, type LayerBuffer } from "./buffers.js";
import { BOARD_COLORS, GROUND, layerStyle } from "./colors.js";
import { INSTANCE_FLOATS, VERTEX_FLOATS } from "./geom.js";
import { drawOrder, type DrawLayerId } from "./layers.js";
import type { CopperLayer } from "./board.js";
import type { Scene } from "./scene.js";
import { gridStep, type View } from "./view.js";

const NET_TEX_W = 4096;

const COMMON_VS = /* glsl */ `
precision highp float;
uniform vec4 uView;   // center x, y (mm), device px per mm, 1 or -1 (flip)
uniform vec2 uRes;    // drawing buffer size, device px
uniform float uCss;   // CSS px per mm (labels' minimum scale)
uniform float uDragFp;
uniform vec2 uDragOff;
uniform sampler2D uNet;
uniform float uDimOn;
uniform float uDimmable;
uniform vec3 uColor;
vec4 toClip(vec2 w) {
  vec2 clip = (w - uView.xy) * uView.z / (uRes * 0.5);
  return vec4(clip.x * uView.w, clip.y, 0.0, 1.0);
}
vec3 styled(vec3 col, float net, int f) {
  if ((f & 2) != 0) col = mix(col, vec3(1.0), 0.16);
  if ((f & 8) != 0) col *= 0.7;
  int n = int(net + 0.5);
  float st = texelFetch(uNet, ivec2(n % ${NET_TEX_W}, n / ${NET_TEX_W}), 0).r;
  return st > 0.5 ? mix(col, vec3(1.0), 0.42) : (uDimOn * uDimmable > 0.5 ? col * 0.3 : col);
}
`;

const BOX_VS = /* glsl */ `${COMMON_VS}
in vec2 position;
in vec4 iA; // cx cy hx hy
in vec4 iB; // angle corner ringInner net
in vec4 iC; // object footprint flags minScale
uniform float uExpand;
out vec2 vLocal;
out vec2 vHalf;
out float vCorner, vRi, vPx, vFlags;
out vec3 vColor;
void main() {
  if (uCss < iC.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float px = 1.0 / uView.z;
  vec2 half_ = max(iA.zw, vec2(0.5 * px));
  float corner = min(iB.y, min(half_.x, half_.y));
  if (iB.y >= min(iA.z, iA.w) - 1e-6) corner = min(half_.x, half_.y);
  vec2 local = position * (half_ + px * uExpand);
  float c = cos(iB.x), s = sin(iB.x);
  vec2 w = vec2(local.x * c - local.y * s, local.x * s + local.y * c) + iA.xy;
  if (abs(iC.y - uDragFp) < 0.5) w += uDragOff;
  gl_Position = toClip(w);
  vLocal = local; vHalf = half_; vCorner = corner; vRi = iB.z; vPx = px; vFlags = iC.z;
  vColor = styled(uColor, iB.w, int(iC.z + 0.5));
}`;

const BOX_FS = /* glsl */ `
precision highp float;
in vec2 vLocal;
in vec2 vHalf;
in float vCorner, vRi, vPx, vFlags;
in vec3 vColor;
uniform float uMode;      // 0 draw, 1 selection outline, 2 hover outline
uniform vec3 uOutline;
out vec4 outColor;
void main() {
  vec2 q = abs(vLocal) - vHalf + vCorner;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vCorner;
  if (vRi > 0.0) d = max(d, vRi - length(vLocal));
  if (uMode > 0.5) {
    float ringW = (uMode > 1.5 ? 1.25 : 2.0) * vPx;
    float outer = clamp(0.5 - (d - ringW) / vPx, 0.0, 1.0);
    if (outer <= 0.0) discard;
    float inside = clamp(0.5 - d / vPx, 0.0, 1.0);
    float a = outer * mix(1.0, uMode > 1.5 ? 0.0 : 0.2, inside);
    if (a <= 0.0) discard;
    outColor = vec4(uOutline * a, a);
    return;
  }
  float a = clamp(0.5 - d / vPx, 0.0, 1.0);
  if (a <= 0.0) discard;
  int f = int(vFlags + 0.5);
  vec3 col = vColor;
  if ((f & 4) != 0 && mod(vLocal.x / vPx + 4096.0, 10.0) > 5.5) discard;
  // hand copper: a fine center line, once the track is wide enough on screen to carry one
  if ((f & 1) != 0 && vHalf.y > 2.5 * vPx && abs(vLocal.y) < max(0.55 * vPx, 0.08 * vHalf.y) && abs(vLocal.x) < vHalf.x - vHalf.y * 0.5) col = mix(col, vec3(1.0), 0.5);
  if ((f & 16) != 0) { float r = length(vLocal) / vHalf.x; if (r > 0.52 && r < 0.7) col *= 0.35; }
  outColor = vec4(col, a);
}`;

const TRI_VS = /* glsl */ `${COMMON_VS}
in vec2 position;
in vec4 aMeta; // net footprint object flags
out vec3 vColor;
void main() {
  vec2 w = position;
  if (abs(aMeta.y - uDragFp) < 0.5) w += uDragOff;
  gl_Position = toClip(w);
  vColor = styled(uColor, aMeta.x, int(aMeta.w + 0.5));
}`;

const TRI_FS = /* glsl */ `
precision highp float;
in vec3 vColor;
uniform float uMode;
uniform vec3 uOutline;
out vec4 outColor;
void main() {
  if (uMode > 1.5) discard;
  outColor = uMode > 0.5 ? vec4(uOutline * 0.2, 0.2) : vec4(vColor, 1.0);
}`;

const QUAD_VS = /* glsl */ `
precision highp float;
in vec2 position;
out vec2 vUv;
void main() { vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`;

const COMP_FS = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv) * uAlpha; }`;

const GRID_FS = /* glsl */ `
precision highp float;
uniform vec4 uView;
uniform vec2 uRes;
uniform float uStep;
uniform vec3 uDot, uMajor;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 frag = gl_FragCoord.xy - uRes * 0.5;
  vec2 w = vec2(uView.x + uView.w * frag.x / uView.z, uView.y + frag.y / uView.z);
  vec2 g = w / uStep;
  vec2 nearest = floor(g + 0.5);
  vec2 dpx = abs(g - nearest) * uStep * uView.z;
  float r = max(dpx.x, dpx.y);
  bool major = mod(nearest.x, 5.0) == 0.0 && mod(nearest.y, 5.0) == 0.0;
  float a = clamp((major ? 1.4 : 0.9) - r, 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = vec4((major ? uMajor : uDot) * a, a);
}`;

/** Layers whose objects dim when a net is lit with dim-others: copper and what sits on it. */
const DIMMABLE = /^(cu:|pads:|vias$|labels:|ratsnest$)/;

const PREMULT = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
const UNIT_QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

interface GpuLayer {
  id: DrawLayerId;
  scene: any;
  uColor: { value: any };
  uDimmable: { value: number };
  boxBuf?: any;
  boxMesh?: any;
  triBuf?: any;
  triMesh?: any;
  boxCount: number;
  triCount: number;
}

export interface RendererState {
  view: View;
  active: CopperLayer;
  grayInactive: boolean;
  visible: (layer: DrawLayerId) => boolean;
  /** The base grid (mm); 0 hides the grid. */
  grid: number;
}

export interface RendererStats {
  /** Floats sent to the GPU since the renderer was made. */
  uploadedFloats: number;
  drawCalls: number;
  instances: number;
  vertices: number;
  webgl2: boolean;
  gpu: string;
}

export class BoardRenderer {
  readonly gl: any;
  private readonly three: any;
  private readonly camera: any;
  private rt: any;
  private readonly compScene: any;
  private readonly compMat: any;
  private readonly gridScene: any;
  private readonly gridMat: any;
  private readonly shared: Record<string, { value: any }>;
  private netTex: any;
  private netData = new Uint8Array(NET_TEX_W * 4);
  private litNets: number[] = [];
  private gpu = new Map<DrawLayerId, GpuLayer>();
  private overlays: { select?: GpuLayer; hover?: GpuLayer } = {};
  private scene?: Scene;
  private buffers?: SceneBuffers;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private lost = false;
  uploadedFloats = 0;
  state: RendererState;

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: { preserveDrawingBuffer?: boolean } = {},
  ) {
    THREE.ColorManagement.enabled = false;
    this.three = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
    this.three.autoClear = false;
    this.three.sortObjects = false;
    this.three.info.autoReset = false;
    this.three.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl = this.three.getContext();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { samples: 0, type: THREE.UnsignedByteType });
    this.netTex = new THREE.DataTexture(this.netData, NET_TEX_W, 1, THREE.RGBAFormat);
    this.netTex.needsUpdate = true;
    this.shared = {
      uView: { value: new THREE.Vector4(0, 0, 1, 1) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uCss: { value: 1 },
      uDragFp: { value: -1 },
      uDragOff: { value: new THREE.Vector2() },
      uNet: { value: this.netTex },
      uDimOn: { value: 0 },
    };
    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.BufferAttribute(UNIT_QUAD, 2));
    quad.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    this.compMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: QUAD_VS, fragmentShader: COMP_FS, uniforms: { uTex: { value: this.rt.texture }, uAlpha: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, ...PREMULT });
    this.compScene = new THREE.Scene();
    const cm = new THREE.Mesh(quad, this.compMat);
    cm.frustumCulled = false;
    this.compScene.add(cm);
    this.gridMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VS,
      fragmentShader: GRID_FS,
      uniforms: { uView: this.shared.uView, uRes: this.shared.uRes, uStep: { value: 1 }, uDot: { value: new THREE.Color(...BOARD_COLORS.grid) }, uMajor: { value: new THREE.Color(...BOARD_COLORS.gridMajor) } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      ...PREMULT,
    });
    this.gridScene = new THREE.Scene();
    const gm = new THREE.Mesh(quad, this.gridMat);
    gm.frustumCulled = false;
    this.gridScene.add(gm);
    this.state = { view: { cx: 0, cy: 0, s: 10, flip: false }, active: "top", grayInactive: true, visible: () => true, grid: 0.25 };
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private onRestored = () => {
    this.lost = false;
    if (this.scene && this.buffers) this.setScene(this.scene, this.buffers);
  };

  get stats(): RendererStats {
    const info = this.three.info;
    let instances = 0;
    let vertices = 0;
    for (const g of this.gpu.values()) {
      instances += g.boxCount;
      vertices += g.triCount;
    }
    const dbg = this.gl.getExtension("WEBGL_debug_renderer_info");
    return { uploadedFloats: this.uploadedFloats, drawCalls: info.render.calls, instances, vertices, webgl2: this.three.capabilities.isWebGL2, gpu: String(this.gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : this.gl.RENDERER)) };
  }

  /** Size in CSS pixels and the device pixel ratio. */
  resize(width: number, height: number, dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = dpr;
    this.three.setPixelRatio(dpr);
    this.three.setSize(this.width, this.height, false);
    const bw = Math.max(1, Math.round(this.width * dpr));
    const bh = Math.max(1, Math.round(this.height * dpr));
    this.rt.setSize(bw, bh);
    this.shared.uRes.value.set(bw, bh);
  }

  private material(kind: "box" | "tri", g: GpuLayer, overlay?: { mode: number; color: number[] }) {
    const uniforms = { ...this.shared, uColor: g.uColor, uDimmable: g.uDimmable, uExpand: { value: overlay ? 3 : 1 }, uMode: { value: overlay?.mode ?? 0 }, uOutline: { value: new THREE.Color(...(overlay?.color ?? [1, 1, 1])) } };
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: kind === "box" ? BOX_VS : TRI_VS,
      fragmentShader: kind === "box" ? BOX_FS : TRI_FS,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(overlay ? PREMULT : {}),
    });
  }

  private makeLayer(id: DrawLayerId): GpuLayer {
    return { id, scene: new THREE.Scene(), uColor: { value: new THREE.Color(1, 1, 1) }, uDimmable: { value: 0 }, boxCount: 0, triCount: 0 };
  }

  /** (Re)create a layer's meshes from packed arrays. */
  private fill(g: GpuLayer, boxes: Float32Array, tris: Float32Array, overlay?: { mode: number; color: number[] }): void {
    for (const m of [g.triMesh, g.boxMesh]) {
      if (!m) continue;
      g.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    g.boxMesh = g.triMesh = g.boxBuf = g.triBuf = undefined;
    g.triCount = tris.length / VERTEX_FLOATS;
    g.boxCount = boxes.length / INSTANCE_FLOATS;
    if (g.triCount) {
      const geo = new THREE.BufferGeometry();
      const buf = new THREE.InterleavedBuffer(tris, VERTEX_FLOATS);
      buf.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("position", new THREE.InterleavedBufferAttribute(buf, 2, 0));
      geo.setAttribute("aMeta", new THREE.InterleavedBufferAttribute(buf, 4, 2));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      const mesh = new THREE.Mesh(geo, this.material("tri", g, overlay));
      mesh.frustumCulled = false;
      g.scene.add(mesh);
      g.triMesh = mesh;
      g.triBuf = buf;
    }
    if (g.boxCount) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(UNIT_QUAD, 2));
      const buf = new THREE.InstancedInterleavedBuffer(boxes, INSTANCE_FLOATS, 1);
      buf.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("iA", new THREE.InterleavedBufferAttribute(buf, 4, 0));
      geo.setAttribute("iB", new THREE.InterleavedBufferAttribute(buf, 4, 4));
      geo.setAttribute("iC", new THREE.InterleavedBufferAttribute(buf, 4, 8));
      geo.instanceCount = g.boxCount;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      const mesh = new THREE.Mesh(geo, this.material("box", g, overlay));
      mesh.frustumCulled = false;
      g.scene.add(mesh);
      g.boxMesh = mesh;
      g.boxBuf = buf;
    }
    this.uploadedFloats += boxes.length + tris.length;
  }

  private upload(b: LayerBuffer): void {
    let g = this.gpu.get(b.id);
    if (!g) this.gpu.set(b.id, (g = this.makeLayer(b.id)));
    if (b.dirtyBoxes === "all" || b.dirtyTris === "all" || !g.boxBuf !== !b.boxes.length || !g.triBuf !== !b.tris.length) this.fill(g, b.boxes, b.tris);
    else {
      for (const [start, count] of b.dirtyBoxes) {
        g.boxBuf.addUpdateRange(start, count);
        g.boxBuf.needsUpdate = true;
        this.uploadedFloats += count;
      }
      for (const [start, count] of b.dirtyTris) {
        g.triBuf.addUpdateRange(start, count);
        g.triBuf.needsUpdate = true;
        this.uploadedFloats += count;
      }
    }
    this.buffers?.uploaded(b.id);
  }

  /** Take a new scene (a new board, or a stackup change). */
  setScene(scene: Scene, buffers: SceneBuffers): void {
    this.scene = scene;
    this.buffers = buffers;
    for (const g of this.gpu.values()) this.fill(g, new Float32Array(0), new Float32Array(0));
    this.gpu.clear();
    for (const b of buffers.layers.values()) this.upload(b);
    this.ensureNetTexture();
  }

  /** Upload the layers a commit touched (buffers.update's result). */
  sync(touched: Iterable<DrawLayerId>): void {
    if (!this.buffers) return;
    for (const id of touched) {
      const b = this.buffers.layers.get(id);
      if (b) this.upload(b);
      else {
        const g = this.gpu.get(id);
        if (g) this.fill(g, new Float32Array(0), new Float32Array(0));
      }
    }
    this.ensureNetTexture();
  }

  private ensureNetTexture(): void {
    const n = this.scene?.nets.length ?? 1;
    const rows = Math.max(1, Math.ceil(n / NET_TEX_W));
    if (this.netData.length >= rows * NET_TEX_W * 4) return;
    this.netData = new Uint8Array(rows * NET_TEX_W * 4);
    for (const i of this.litNets) this.netData[i * 4] = 255;
    this.netTex.dispose();
    this.netTex = new THREE.DataTexture(this.netData, NET_TEX_W, rows, THREE.RGBAFormat);
    this.netTex.needsUpdate = true;
    this.shared.uNet.value = this.netTex;
  }

  /** Light these nets (indices into scene.nets); `dim` darkens everything else. */
  setHighlight(nets: readonly number[], dim: boolean): void {
    for (const i of this.litNets) this.netData[i * 4] = 0;
    this.litNets = nets.filter((i) => i > 0);
    for (const i of this.litNets) this.netData[i * 4] = 255;
    this.netTex.needsUpdate = true;
    this.shared.uDimOn.value = this.litNets.length && dim ? 1 : 0;
  }

  /** Outline these objects (selection) and one more lightly (hover). */
  setOutlines(selected: readonly string[], hover: readonly string[]): void {
    if (!this.buffers) return;
    const vis = (l: DrawLayerId) => this.state.visible(l);
    const sel = this.buffers.geometryOf(selected, vis);
    const SEL = { mode: 1, color: BOARD_COLORS.select };
    const HOV = { mode: 2, color: BOARD_COLORS.hover };
    this.overlays.select ??= this.makeLayer("select");
    this.fill(this.overlays.select, sel.boxes, sel.tris, SEL);
    const hov = this.buffers.geometryOf(hover, vis);
    this.overlays.hover ??= this.makeLayer("hover");
    this.fill(this.overlays.hover, hov.boxes, hov.tris, HOV);
  }

  /** Move one footprint's drawing by an offset (millimeters) without touching buffers: a live drag. */
  setDrag(fpIndex: number, dx: number, dy: number): void {
    this.shared.uDragFp.value = fpIndex;
    this.shared.uDragOff.value.set(dx, dy);
  }

  render(): void {
    if (this.lost) return;
    const st = this.state;
    const v = st.view;
    this.shared.uView.value.set(v.cx, v.cy, v.s * this.dpr, v.flip ? -1 : 1);
    this.shared.uCss.value = v.s;
    const r = this.three;
    r.info.reset();
    r.setRenderTarget(null);
    r.setClearColor(new THREE.Color(...GROUND), 1);
    r.clear();
    if (st.grid > 0) {
      this.gridMat.uniforms.uStep.value = gridStep(st.grid, v.s, 14);
      r.render(this.gridScene, this.camera);
    }
    if (!this.scene) return;
    for (const id of drawOrder(this.scene.copper, st.active, v.flip)) {
      const g = this.gpu.get(id);
      if (!g || (!g.boxCount && !g.triCount) || !st.visible(id)) continue;
      const style = layerStyle(id, st.active, st.grayInactive);
      g.uColor.value.setRGB(...style.color);
      g.uDimmable.value = DIMMABLE.test(id) ? 1 : 0;
      if (style.alpha >= 0.999) {
        r.render(g.scene, this.camera);
        continue;
      }
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(g.scene, this.camera);
      r.setRenderTarget(null);
      this.compMat.uniforms.uAlpha.value = style.alpha;
      r.render(this.compScene, this.camera);
    }
    for (const g of [this.overlays.hover, this.overlays.select]) if (g && (g.boxCount || g.triCount)) r.render(g.scene, this.camera);
  }

  /** Wait for the GPU to finish the last frame (perf measurement and captures). */
  finish(): void {
    const px = new Uint8Array(4);
    this.gl.readPixels(0, 0, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, px);
  }

  dispose(): void {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    for (const g of [...this.gpu.values(), this.overlays.select, this.overlays.hover]) if (g) this.fill(g, new Float32Array(0), new Float32Array(0));
    this.rt.dispose();
    this.netTex.dispose();
    this.three.dispose();
  }
}
