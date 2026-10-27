// The CAD viewer's webview (PB-906): one STEP or GLB in uhd-viewer's
// ModelView (the 3D view's scene, lights, materials and toolbar), in the
// VS Code theme (Kode Mono only under a Protoboard colour theme). A STEP is converted here with occt-import-js (loaded from
// the extension, never a CDN). Bundled into dist/cad-viewer.js by esbuild.mjs.
import "@deltarobotics/uhd-viewer/components.css";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { IconButton, ModelView, ThemeProvider } from "@deltarobotics/uhd-viewer/components";
import { vscodeViewThemeAdapter } from "@protoboardai/views/theme";

interface Config {
  model: string;
  kind: "glb" | "step";
  name: string;
  /** A STEP drawn from the GLB the build wrote with it. */
  via?: string;
  occt: string;
  wasm: string;
}

interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  attributes: { position: { array: number[] }; normal?: { array: number[] } };
  index?: { array: number[] };
}

declare const acquireVsCodeApi: () => { postMessage(m: unknown): void };
declare global {
  interface Window {
    pbCad: Config;
    occtimportjs?: (o: { locateFile: (f: string) => string }) => Promise<{ ReadStepFile(content: Uint8Array, params: unknown): { success: boolean; meshes: OcctMesh[] } }>;
  }
}

const vscode = acquireVsCodeApi();
const config = window.pbCad;

function loadScript(src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    s.onload = () => ok();
    s.onerror = () => fail(new Error("the STEP reader could not load"));
    document.head.append(s);
  });
}

/** A STEP file as three.js meshes, in its own millimetres (the 3D view's CAD coordinates). */
async function readStep(url: string): Promise<THREE.Object3D> {
  await loadScript(config.occt);
  if (!window.occtimportjs) throw new Error("the STEP reader did not start");
  const occt = await window.occtimportjs({ locateFile: () => config.wasm });
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const result = occt.ReadStepFile(bytes, null);
  if (!result.success) throw new Error("the file is not a STEP model the reader understands");
  const group = new THREE.Group();
  for (const m of result.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) g.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    if (m.index) g.setIndex(new THREE.Uint32BufferAttribute(Uint32Array.from(m.index.array), 1));
    if (!m.attributes.normal) g.computeVertexNormals();
    const colour = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0x8b8b8b);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, metalness: 0.1 }));
    mesh.name = m.name ?? "";
    group.add(mesh);
  }
  return group;
}

function App() {
  // VS Code's colours and the faces of the colour theme in use (Kode Mono only under a Protoboard one), as every Protoboard webview
  const adapter = useMemo(() => vscodeViewThemeAdapter(undefined, { viewFaint: false }), []);
  const [object, setObject] = useState<THREE.Object3D | null | undefined>(config.kind === "step" ? null : undefined);
  const [error, setError] = useState<string>();
  useEffect(() => {
    vscode.postMessage({ type: "page" });
    if (config.kind !== "step") return;
    readStep(config.model)
      .then(setObject)
      .catch((e: Error) => {
        setError(e.message);
        vscode.postMessage({ type: "error", message: e.message });
      });
  }, []);
  const detail = config.via ? `STEP · drawn from ${config.via}, exported with it` : config.kind === "step" ? (object ? "STEP · converted in the viewer" : "STEP · converting…") : "GLB";
  return (
    <ThemeProvider adapter={adapter} className="h-full">
      <ModelView
        url={config.kind === "glb" ? config.model : undefined}
        object={config.kind === "step" ? object : undefined}
        name={config.name}
        detail={detail}
        error={error}
        onReady={(info) => vscode.postMessage({ type: "ready", message: `${info.meshes} meshes` })}
        actions={
          <>
            <IconButton icon="external-link" label="Open in the system's application" tooltipSide="top" onClick={() => vscode.postMessage({ type: "openExternal" })} />
            <IconButton icon="folder-open" label="Reveal in the file manager" tooltipSide="top" onClick={() => vscode.postMessage({ type: "reveal" })} />
          </>
        }
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
