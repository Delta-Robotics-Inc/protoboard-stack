/**
 * Candidate (a): WebGL2 through three.js 0.187, orthographic, one instanced mesh of rounded
 * boxes per layer (pads, tracks, vias, rings, text strokes: signed-distance shading, so edges
 * stay sharp at every zoom) plus one merged triangle mesh per layer (zones, custom pads,
 * filled shapes; 4x MSAA). Each layer is drawn into a multisampled target and composited
 * with the layer's opacity, so overlaps inside a layer never double-blend.
 *
 * Net highlight and dim-others: a per-net state texture read in the shaders (one texel write).
 * Drag: a footprint index and an offset uniform (live move with no buffer upload).
 */
import * as THREE from "three";
import { Earcut } from "three/src/extras/Earcut.js";
import { COLORS, toBoxes } from "./scene.js";
import { installHarness } from "./harness.js";

const PIX = new Uint8Array(4);
const BOX_VS = /* glsl */ `
precision highp float;
in vec2 position;
in vec4 iA; // cx cy hx hy
in vec4 iB; // angle corner ringInner net
in float iFp;
uniform vec4 uView; // cx cy s -
uniform vec2 uRes;
uniform float uDragFp;
uniform vec2 uDragOff;
uniform sampler2D uNet;
uniform vec3 uColor, uHi;
uniform float uDimOn;
out vec2 vLocal;
out vec2 vHalf;
out float vCorner, vRi, vPx;
out vec3 vColor;
void main() {
  float px = 1.0 / uView.z;
  vec2 half_ = max(iA.zw, vec2(0.5 * px));
  float corner = min(iB.y, min(half_.x, half_.y));
  if (iB.y >= min(iA.z, iA.w) - 1e-6) corner = min(half_.x, half_.y);
  vec2 local = position * (half_ + px);
  float c = cos(iB.x), s = sin(iB.x);
  vec2 w = vec2(local.x * c - local.y * s, local.x * s + local.y * c) + iA.xy;
  if (abs(iFp - uDragFp) < 0.5) w += uDragOff;
  vec2 clip = (w - uView.xy) * uView.z / (uRes * 0.5);
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local; vHalf = half_; vCorner = corner; vRi = iB.z; vPx = px;
  int n = int(iB.w + 0.5);
  float st = texelFetch(uNet, ivec2(n % 4096, n / 4096), 0).r;
  vColor = st > 0.5 ? uHi : (uDimOn > 0.5 ? uColor * 0.28 : uColor);
}`;
const BOX_FS = /* glsl */ `
precision highp float;
in vec2 vLocal;
in vec2 vHalf;
in float vCorner, vRi, vPx;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 q = abs(vLocal) - vHalf + vCorner;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - vCorner;
  if (vRi > 0.0) d = max(d, vRi - length(vLocal));
  float a = clamp(0.5 - d / vPx, 0.0, 1.0);
  if (a <= 0.0) discard;
  outColor = vec4(vColor, a);
}`;
const TRI_VS = /* glsl */ `
precision highp float;
in vec2 position;
in float aNet, aFp;
uniform vec4 uView;
uniform vec2 uRes;
uniform float uDragFp;
uniform vec2 uDragOff;
uniform sampler2D uNet;
uniform vec3 uColor, uHi;
uniform float uDimOn;
out vec3 vColor;
void main() {
  vec2 w = position;
  if (abs(aFp - uDragFp) < 0.5) w += uDragOff;
  vec2 clip = (w - uView.xy) * uView.z / (uRes * 0.5);
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  int n = int(aNet + 0.5);
  float st = texelFetch(uNet, ivec2(n % 4096, n / 4096), 0).r;
  vColor = st > 0.5 ? uHi : (uDimOn > 0.5 ? uColor * 0.28 : uColor);
}`;
const TRI_FS = /* glsl */ `
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }`;
const COMP_VS = /* glsl */ `
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
void main() { vec4 c = texture(uTex, vUv); outColor = c * uAlpha; }`;

const PARAMS = new URLSearchParams(location.search);
// 4x MSAA per layer target cost 80 ms a frame on the Intel UHD (versus 11 ms without): off by default;
// polygon edges get their antialiasing from a 1-pixel SDF outline instead
const SAMPLES = Number(PARAMS.get("msaa") ?? 0);
const DIRECT = PARAMS.get("direct") === "1";
THREE.ColorManagement.enabled = false;

async function createRenderer(host, W, H) {
  const canvas = document.createElement("canvas");
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const dpr = window.devicePixelRatio;
  const rt = new THREE.WebGLRenderTarget(W * dpr, H * dpr, { samples: SAMPLES, type: THREE.UnsignedByteType });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const quad = new THREE.BufferGeometry();
  quad.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), 2));
  const compMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: COMP_VS, fragmentShader: COMP_FS, uniforms: { uTex: { value: rt.texture }, uAlpha: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
  const compScene = new THREE.Scene();
  const compMesh = new THREE.Mesh(quad, compMat);
  compMesh.frustumCulled = false;
  compScene.add(compMesh);

  const BG = new THREE.Color(...COLORS.bg);
  let netTex, netData;
  const shared = { uView: { value: new THREE.Vector4() }, uRes: { value: new THREE.Vector2(W, H) }, uDragFp: { value: -1 }, uDragOff: { value: new THREE.Vector2() }, uNet: { value: null }, uHi: { value: new THREE.Color(...COLORS.highlight) }, uDimOn: { value: 0 } };
  const layerScenes = [];
  let scene;
  let lastNet = 0;
  let bytes = 0, instances = 0, triangles = 0;

  return {
    async build(sc) {
      scene = sc;
      const rows = Math.ceil(sc.nets.length / 4096);
      netData = new Uint8Array(4096 * rows * 4);
      netTex = new THREE.DataTexture(netData, 4096, rows, THREE.RGBAFormat);
      netTex.needsUpdate = true;
      shared.uNet.value = netTex;
      const unit = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
      for (const layer of sc.layers) {
        const boxes = [];
        const tri = [], triNet = [], triFp = [];
        // front to back is not needed: each layer is one color, composited as a group
        for (const id of layer.objects) {
          const o = sc.objects[id];
          for (const p of o.parts) {
            if (p.k === "poly") {
              for (const ring of p.rings) {
                const idx = Earcut.triangulate(ring, undefined, 2);
                for (const k of idx) { tri.push(ring[2 * k], ring[2 * k + 1]); triNet.push(o.n); triFp.push(o.fp); }
                if (!SAMPLES) toBoxes({ k: "path", pts: ring, w: 0, closed: true }, boxes, o.fp, o.n); // 1 px antialiased edge
              }
            } else toBoxes(p, boxes, o.fp, o.n);
          }
        }
        const s3 = new THREE.Scene();
        const uniforms = { ...shared, uColor: { value: new THREE.Color(...layer.color) } };
        const nBox = boxes.length / 9;
        if (nBox) {
          const g = new THREE.InstancedBufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(unit, 2));
          const A = new Float32Array(nBox * 4), B = new Float32Array(nBox * 4), F = new Float32Array(nBox);
          for (let i = 0; i < nBox; i++) {
            const o = i * 9;
            A[i * 4] = boxes[o]; A[i * 4 + 1] = boxes[o + 1]; A[i * 4 + 2] = boxes[o + 2]; A[i * 4 + 3] = boxes[o + 3];
            B[i * 4] = boxes[o + 4]; B[i * 4 + 1] = boxes[o + 5]; B[i * 4 + 2] = boxes[o + 6]; B[i * 4 + 3] = boxes[o + 7];
            F[i] = boxes[o + 8];
          }
          g.setAttribute("iA", new THREE.InstancedBufferAttribute(A, 4));
          g.setAttribute("iB", new THREE.InstancedBufferAttribute(B, 4));
          g.setAttribute("iFp", new THREE.InstancedBufferAttribute(F, 1));
          g.instanceCount = nBox;
          const m = new THREE.Mesh(g, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BOX_VS, fragmentShader: BOX_FS, uniforms, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
          m.frustumCulled = false;
          s3.add(m);
          bytes += A.byteLength + B.byteLength + F.byteLength;
          instances += nBox;
        }
        if (tri.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tri), 2));
          g.setAttribute("aNet", new THREE.BufferAttribute(new Float32Array(triNet), 1));
          g.setAttribute("aFp", new THREE.BufferAttribute(new Float32Array(triFp), 1));
          const m = new THREE.Mesh(g, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: TRI_VS, fragmentShader: TRI_FS, uniforms, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
          m.frustumCulled = false;
          s3.add(m);
          bytes += tri.length * 4 + triNet.length * 8;
          triangles += tri.length / 6;
        }
        // zones under boxes: draw the triangle mesh first
        s3.children.sort((a, b) => (a.geometry.isInstancedBufferGeometry ? 1 : 0) - (b.geometry.isInstancedBufferGeometry ? 1 : 0));
        layerScenes.push({ s3, alpha: layer.alpha, visible: s3.children.length > 0 });
      }
    },
    setView(v) { shared.uView.value.set(v.cx, v.cy, v.s, 0); },
    render() {
      renderer.setRenderTarget(null);
      renderer.setClearColor(BG, 1);
      renderer.clear();
      for (const l of layerScenes) {
        if (!l.visible) continue;
        if (DIRECT) { renderer.render(l.s3, camera); continue; }
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(l.s3, camera);
        renderer.setRenderTarget(null);
        compMat.uniforms.uAlpha.value = l.alpha;
        renderer.render(compScene, camera);
      }
    },
    setHighlight(net, dim) {
      if (lastNet) netData[lastNet * 4] = 0;
      if (net) netData[net * 4] = 255;
      lastNet = net;
      netTex.needsUpdate = true;
      shared.uDimOn.value = net && dim ? 1 : 0;
    },
    dragStart(fp) { shared.uDragFp.value = fp; },
    dragMove(dx, dy) { shared.uDragOff.value.set(dx, dy); },
    dragEnd() { shared.uDragFp.value = -1; shared.uDragOff.value.set(0, 0); },
    sync() { renderer.getContext().readPixels(0, 0, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, PIX); },
    info() {
      const i = renderer.info;
      return { msaa: SAMPLES, direct: DIRECT, drawCalls: i.render.calls, gpuBufferMB: +(bytes / 1048576).toFixed(2), instances, triangles, layers: layerScenes.filter((l) => l.visible).length, webgl2: renderer.capabilities.isWebGL2, gpu: renderer.getContext().getParameter(renderer.getContext().getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? 0x1f01) };
    },
  };
}

installHarness(createRenderer);
