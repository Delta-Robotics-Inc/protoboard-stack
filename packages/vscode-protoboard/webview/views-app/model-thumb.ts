// Small still pictures of GLB models for the Inspector's artifact cards (PB-919, PB-940): one renderer, one model at
// a time, a three-quarter view fitted to the model on a transparent background (the card's own surface shows
// through), handed back as a PNG data URL and kept, so a model is read once. The Inspector asks only for models the
// extension marked small enough (inspectorFiles.ts), and only when their card scrolls into view.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const WIDTH = 224;
const HEIGHT = 168;

let renderer: THREE.WebGLRenderer | undefined;
let queue: Promise<unknown> = Promise.resolve();
const drawn = new Map<string, Promise<string>>();

function draw(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf: { scene: THREE.Object3D }) => {
        try {
          renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
          renderer.setPixelRatio(2);
          renderer.setSize(WIDTH, HEIGHT, false);
          renderer.setClearColor(0x000000, 0);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          const scene = new THREE.Scene();
          scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
          const key = new THREE.DirectionalLight(0xffffff, 1.6);
          key.position.set(3, 5, 4);
          scene.add(key);
          const root = gltf.scene;
          scene.add(root);
          const box = new THREE.Box3().setFromObject(root);
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, sphere.radius / 100, sphere.radius * 100);
          const dir = new THREE.Vector3(1, 0.75, 1.25).normalize();
          const fit = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
          camera.position.copy(sphere.center).addScaledVector(dir, fit * 1.02);
          camera.lookAt(sphere.center);
          renderer.render(scene, camera);
          const png = renderer.domElement.toDataURL("image/png");
          root.traverse((o: THREE.Object3D) => {
            const m = o as THREE.Mesh;
            m.geometry?.dispose();
            for (const mat of ([] as THREE.Material[]).concat(m.material ?? [])) mat.dispose();
          });
          resolve(png);
        } catch (e) {
          reject(e);
        }
      },
      undefined,
      reject,
    );
  });
}

/** The model at `url` as a small picture; models are drawn one after another. */
export function modelThumb(url: string): Promise<string> {
  let p = drawn.get(url);
  if (!p) {
    p = queue.then(() => draw(url));
    queue = p.catch(() => undefined);
    drawn.set(url, p);
    // a model that failed may be asked for again (the file can appear later)
    p.catch(() => drawn.delete(url));
  }
  return p;
}
