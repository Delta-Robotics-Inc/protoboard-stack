/**
 * The view sidecars beside a body GLB (phase 1, W1-A writes them, W1-C reads
 * them): for every `X.glb` the bundle references, `protoboard dev` also
 * serves `X.view.glb`, `X.view.coarse.glb` and `X.view.json` from the same
 * folder. The viewer's own handler (@deltarobotics/uhd-viewer/serve) answers
 * only files the bundle names, so a sidecar request is answered here, under
 * the same rules:
 *
 * - the sibling `X.glb` must be an artifact of the current bundle (its key in
 *   the bundle's plan), so nothing the bundle does not reference is reachable;
 * - the sidecar's real path (symlinks and junctions resolved) must be inside
 *   the real path of the artifact's base (zip-slip and link escapes refused);
 * - it is sent with the artifact headers (a sandboxing CSP, nosniff).
 *
 * The coarse tier may be `X.view.glb` itself (`tiers.coarse.file` in
 * `X.view.json`, W1-A's `same-as-fine`): then no `X.view.coarse.glb` exists
 * and its request is a 404 like any missing file.
 */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, sep } from "node:path";

/** The sidecar names, by suffix replacing `.glb`. */
export const SIDECAR_SUFFIXES = [".view.coarse.glb", ".view.glb", ".view.json"] as const;

/** What the viewer's bundle plan offers (`planBundle` in uhd-viewer's bin/serve.mjs). */
export interface ArtifactPlan {
  mounts: Map<string, string>;
  files: Map<string, string>;
}

/**
 * For an artifact key (`<mount>/<path>`) naming a sidecar, the key of the
 * GLB it belongs to and the suffix; undefined for anything else.
 */
export function sidecarOf(key: string): { glbKey: string; suffix: (typeof SIDECAR_SUFFIXES)[number] } | undefined {
  for (const suffix of SIDECAR_SUFFIXES) {
    if (key.length > suffix.length && key.toLowerCase().endsWith(suffix)) {
      const stem = key.slice(0, -suffix.length);
      // one level only: the stem names a GLB, never another sidecar
      if (/\.view(\.coarse)?$/i.test(stem)) return undefined;
      return { glbKey: `${stem}.glb`, suffix };
    }
  }
  return undefined;
}

/** `dir` contains `file` (both absolute, real). */
const inside = (dir: string, file: string) => file === dir || file.startsWith(dir.endsWith(sep) ? dir : dir + sep);

const TYPES: Record<string, string> = { ".glb": "model/gltf-binary", ".json": "application/json; charset=utf-8" };

export interface SidecarResult {
  status: number;
  file?: string;
}

/**
 * Where a sidecar request leads: the file to send (status 200), or why not
 * (404: not a sidecar of a referenced GLB, or missing; 403: outside the base).
 */
export async function resolveSidecar(plan: ArtifactPlan, key: string): Promise<SidecarResult> {
  const side = sidecarOf(key);
  if (!side) return { status: 404 };
  const glb = plan.files.get(side.glbKey);
  if (!glb) return { status: 404 };
  const mount = plan.mounts.get(side.glbKey.split("/")[0]);
  if (!mount) return { status: 404 };
  const name = side.glbKey.split("/").pop()!;
  const file = join(dirname(glb), name.slice(0, -".glb".length) + side.suffix);
  const [base, real] = await Promise.all([realpath(mount).catch(() => undefined), realpath(file).catch(() => undefined)]);
  if (!base || !real) return { status: 404 };
  if (!inside(base, real)) return { status: 403 };
  const info = await stat(real).catch(() => undefined);
  return info?.isFile() ? { status: 200, file: real } : { status: 404 };
}

/** Answers a sidecar request (GET or HEAD) with `headers` (the artifact headers) on every response. */
export async function sendSidecar(req: IncomingMessage, res: ServerResponse, plan: ArtifactPlan, key: string, headers: Record<string, string>): Promise<void> {
  const r = await resolveSidecar(plan, key);
  if (r.status !== 200 || !r.file) {
    res.writeHead(r.status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache", ...headers });
    return void res.end(r.status === 403 ? "outside the artifact base" : "not found");
  }
  const info = await stat(r.file);
  const ext = r.file.slice(r.file.lastIndexOf(".")).toLowerCase();
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream", "content-length": info.size, "cache-control": "no-cache", "last-modified": info.mtime.toUTCString(), ...headers });
  if (req.method === "HEAD") return void res.end();
  createReadStream(r.file).pipe(res);
}
