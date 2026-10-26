/// <reference path="./three.d.ts" />
/**
 * A part's body model in a small orbiting scene (the part detail's CAD
 * section): three.js (the viewer's own copy, already in every shell's
 * bundle); the scene's background is the page's, its light neutral.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EmptyState, Icon } from "@deltarobotics/uhd-viewer/components";

export function GlbPreview({ url, label }: { url: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ kind: "loading" | "ready" } | { kind: "error"; message: string }>({ kind: "loading" });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    setState({ kind: "loading" });
    void (async () => {
      try {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        // the 3D view's look (uhd-viewer src/cad/scene.ts): filmic tone, a sky/ground fill, a key and a warm rim light (PB-899)
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setClearColor(0x000000, 0);
        el.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, 0.0001, 100);
        scene.add(new THREE.HemisphereLight(0xf5f5f4, 0x1c1917, 1.4));
        // positions in glTF's Y-up: the 3D view's key (200, -150, 400) and rim (-300, 250, 120) in its Z-up
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(200, 400, 150);
        const rim = new THREE.DirectionalLight(0xffedd5, 0.8);
        rim.position.set(-300, 120, -250);
        scene.add(key, rim);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.2;
        controls.addEventListener("start", () => (controls.autoRotate = false));
        const resize = () => {
          const w = el.clientWidth || 300;
          const h = el.clientHeight || 220;
          renderer.setSize(w, h, false);
          renderer.domElement.style.width = "100%";
          renderer.domElement.style.height = "100%";
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(el);
        resize();
        let frame = 0;
        const tick = () => {
          frame = requestAnimationFrame(tick);
          controls.update();
          renderer.render(scene, camera);
        };
        tick();
        cleanup = () => {
          cancelAnimationFrame(frame);
          ro.disconnect();
          controls.dispose();
          renderer.dispose();
          el.replaceChildren();
        };
        const gltf = await new GLTFLoader().loadAsync(url);
        if (disposed) return cleanup();
        // a mesh without a material of its own (glTF's default white) gets the 3D view's neutral satin, not a glossy white
        gltf.scene.traverse((mesh: { isMesh?: boolean; material?: { map?: unknown; name?: string; color?: { r: number; g: number; b: number } } | unknown[] }) => {
          const m = mesh.material;
          if (mesh.isMesh && m && !Array.isArray(m) && !m.map && m.color && m.color.r > 0.98 && m.color.g > 0.98 && m.color.b > 0.98 && !m.name)
            mesh.material = new THREE.MeshStandardMaterial({ color: 0x8b8b8b, roughness: 0.55, metalness: 0.1 });
        });
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3()).length() || 1;
        const center = box.getCenter(new THREE.Vector3());
        gltf.scene.position.sub(center);
        scene.add(gltf.scene);
        camera.near = size / 100;
        camera.far = size * 100;
        camera.position.set(size * 0.9, size * 0.7, size * 0.9);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        setState({ kind: "ready" });
      } catch (e) {
        if (!disposed) setState({ kind: "error", message: (e as Error).message || "WebGL is not available here" });
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [url]);
  return (
    <div className="relative size-full">
      <div ref={host} role="img" aria-label={`${label}: 3D model`} className="size-full" />
      {state.kind !== "ready" && (
        <div className="absolute inset-0 grid place-items-center">
          {state.kind !== "error" ? (
            <Icon name="loader" size={20} className="animate-spin text-fg-muted" aria-label="Loading the model" />
          ) : (
            <EmptyState icon={<Icon name="box" size={24} strokeWidth={1.25} />} title="The model does not show here">
              {state.message}
            </EmptyState>
          )}
        </div>
      )}
    </div>
  );
}
