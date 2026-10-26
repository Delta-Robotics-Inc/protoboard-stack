/**
 * Tiny static file server for the doc renderer and the print step.
 *
 *   /project/<path>          files of the project (documents, local CAD)
 *   /pkg/<package>/<path>    files of an installed package that a catalog
 *                            definition's artifacts resolve against
 *                            (the package name is one URL-encoded segment)
 *   /three/<path>            the three.js package (see resolveThree)
 *   /page/<path>             the render page (lib/render/page)
 *
 * Bound to 127.0.0.1 on a random port; closed when the build finishes.
 */
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_DIR = fileURLToPath(new URL("./page/", import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** Where served paths point: the project root, and installed packages by name. */
export interface ServerRoots {
  project: string;
  packageRoot: (name: string) => string | undefined;
}

/** "project/<rel>" for a project file; "pkg/<encoded name>/<rel>" for a package file. */
export const projectPath = (rel: string) => `project/${rel}`;
export const packagePath = (name: string, rel: string) => `pkg/${encodeURIComponent(name)}/${rel}`;

/** The absolute file a served path names, or undefined outside the roots. */
export function resolveServed(roots: ServerRoots, served: string): string | undefined {
  const [mount, ...rest] = served.split("/").filter(Boolean);
  let root: string | undefined;
  let parts = rest;
  if (mount === "project") root = roots.project;
  else if (mount === "pkg" && rest.length) {
    root = roots.packageRoot(decodeURIComponent(rest[0]));
    parts = rest.slice(1);
  }
  if (!root) return undefined;
  const file = normalize(join(root, ...parts.map(decodeURIComponent)));
  return file.startsWith(normalize(root)) ? file : undefined;
}

/**
 * three.js serves the render page. Use, in order: $PROTOBOARD_THREE_DIR (or
 * the older $UHD_THREE_DIR), the project's own three, then this extension's
 * dependency.
 */
export function resolveThree(projectRoot: string): string {
  // node_modules/three from `base` upward (three's exports do not include package.json)
  const installed = (base: string) => {
    for (let dir = base; ; dir = dirname(dir)) {
      const c = join(dir, "node_modules", "three");
      if (existsSync(join(c, "build/three.module.js"))) return c;
      if (dirname(dir) === dir) return undefined;
    }
  };
  const candidates = [process.env.PROTOBOARD_THREE_DIR, process.env.UHD_THREE_DIR, installed(projectRoot), installed(PACKAGE_DIR)].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(join(c, "build/three.module.js"))) return c;
  throw new Error(`three.js not found. Install @protoboardai/ext-docs's dependencies, or set PROTOBOARD_THREE_DIR to a three@>=0.160 package directory (tried: ${candidates.join(", ") || "none"}).`);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export interface StaticServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(roots: ServerRoots): Promise<StaticServer> {
  const fixed: Record<string, string> = { three: resolveThree(roots.project), page: PAGE_DIR };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const [mount, ...rest] = url.pathname.split("/").filter(Boolean);
    const file = fixed[mount] ? normalize(join(fixed[mount], ...rest.map(decodeURIComponent))) : resolveServed(roots, url.pathname);
    const inside = file && (!fixed[mount] || file.startsWith(fixed[mount]));
    if (!file || !inside || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
