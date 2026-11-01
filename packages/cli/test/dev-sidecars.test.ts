/**
 * `protoboard dev` serves the view sidecars (`X.view.glb`, `X.view.coarse.glb`,
 * `X.view.json`) beside every `X.glb` the bundle references, with the same
 * base, containment check and artifact headers as the GLB itself; nothing
 * beside a file the bundle does not reference, nothing through a link out of
 * the base. A VS Code webview reads them with CORS like any artifact.
 *
 * Since PB-1178 the dev server has no copy of its own: uhd-viewer's
 * `viewerHandler` serves them (its own unit cases are in uhd-viewer
 * test/serve.test.ts); these cases check them through `protoboard dev`.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDev, type DevServer } from "../src/dev/server.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp/dev-sidecars");
rmSync(TMP, { recursive: true, force: true });
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const write = (file: string, content: string) => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
};

function call(port: number, path: string, method = "GET", headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((ok, fail) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

describe("protoboard dev serves the sidecars", () => {
  let dir: string;
  let dev: DevServer;

  beforeAll(async () => {
    dir = join(TMP, "project");
    write(join(dir, "package.json"), JSON.stringify({ name: "dev-sidecars", private: true, type: "module" }));
    write(
      join(dir, "protoboard.config.ts"),
      `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "dev-sidecars", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`,
    );
    write(
      join(dir, "src", "sys.uhd.ts"),
      `import type { ModuleDef } from "@deltarobotics/uhd";
export const BODY: ModuleDef = { id: "body", name: "Body", interfaces: [], artifacts: [{ id: "cad", role: "geometry", format: "glb", filePath: "cad/body.glb" }] };
export const SYS: ModuleDef = { id: "sys", name: "Sys", interfaces: [], children: [{ id: "body", moduleDefId: "body" }] };
`,
    );
    write(join(dir, "cad", "body.glb"), "glb bytes");
    write(join(dir, "cad", "body.view.glb"), "view glb bytes");
    write(join(dir, "cad", "body.view.coarse.glb"), "coarse bytes");
    write(join(dir, "cad", "body.view.json"), JSON.stringify({ schema: "protoboard.view-model/v0" }));
    // a sidecar beside a file the bundle does not reference
    write(join(dir, "cad", "other.view.glb"), "not referenced");
    write(join(dir, "viewer-lib", "web-viewer.js"), "export function mountWebViewer() {}\n");
    write(join(dir, "viewer-lib", "web-viewer.css"), "body {}\n");
    dev = await startDev({ root: dir, port: 0, viewerLib: join(dir, "viewer-lib"), watch: false, record: false, log: () => {} });
  }, 60000);
  afterAll(async () => {
    await dev?.close();
  });

  it("answers the three files beside the referenced GLB, with the artifact headers", async () => {
    const glb = await call(dev.port, "/artifacts/project/cad/body.glb");
    expect(glb.status).toBe(200);
    const view = await call(dev.port, "/artifacts/project/cad/body.view.glb");
    expect(view).toMatchObject({ status: 200, body: "view glb bytes" });
    expect(view.headers["content-type"]).toBe("model/gltf-binary");
    expect(view.headers["content-security-policy"]).toBe(glb.headers["content-security-policy"]);
    expect(view.headers["x-content-type-options"]).toBe("nosniff");
    // (uhd-viewer's handler sends no last-modified; the dev server's own copy did, and is gone since PB-1178)
    expect((await call(dev.port, "/artifacts/project/cad/body.view.coarse.glb")).body).toBe("coarse bytes");
    const json = await call(dev.port, "/artifacts/project/cad/body.view.json");
    expect(json.status).toBe(200);
    expect(json.headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(json.body)).toEqual({ schema: "protoboard.view-model/v0" });
    const head = await call(dev.port, "/artifacts/project/cad/body.view.glb", "HEAD");
    expect(head).toMatchObject({ status: 200, body: "" });
    expect(head.headers["content-length"]).toBe(String("view glb bytes".length));
  });

  it("refuses a sidecar of an unreferenced file, a traversal, and writes", async () => {
    expect((await call(dev.port, "/artifacts/project/cad/other.view.glb")).status).toBe(404);
    expect((await call(dev.port, "/artifacts/project/cad/missing.view.json")).status).toBe(404);
    expect((await call(dev.port, "/artifacts/project/cad/../cad/body.view.glb")).status).not.toBe(500);
    expect((await call(dev.port, "/artifacts/project/%2e%2e/cad/body.view.glb")).status).toBe(404);
    expect((await call(dev.port, "/artifacts/project/cad/body.view.glb", "POST")).status).toBe(405);
  });

  it("a VS Code webview reads them like any artifact (CORS for its origin)", async () => {
    const r = await call(dev.port, "/artifacts/project/cad/body.view.glb", "GET", { origin: "vscode-webview://abc123" });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("vscode-webview://abc123");
    const other = await call(dev.port, "/artifacts/project/cad/body.view.glb", "GET", { origin: "http://evil.example" });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
