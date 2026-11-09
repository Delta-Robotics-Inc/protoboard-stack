/**
 * The layout screen's dev server: bundles page.tsx (the screen, the renderer and the board core with browser
 * shims) and serves it on 127.0.0.1 with the viewer's Kode Mono faces. It also reads board folders for the page
 * (`/api/board?path=<folder>`): any folder holding board.jsonl, in the core's on-disk format.
 *
 *   npx tsx packages/views/bench/pcb-screen/serve.ts [--port 5470]
 *   then open http://127.0.0.1:5470/ (the fixture) or /?board=<board folder>
 *
 * The bundle is rebuilt on every page load, so an edit shows on reload.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadBoardDir } from "../../../board/src/format.js";
import { bundleBrowser } from "../../src/pcb/headless/bundle.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..");

function fontsDir(): string | undefined {
  try {
    const viewer = dirname(createRequire(join(REPO, "package.json")).resolve("@deltarobotics/uhd-viewer/package.json"));
    const dir = join(viewer, "src", "styles", "fonts");
    return existsSync(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>layout</title>
<style>
@font-face { font-family: "Kode Mono"; src: url(/fonts/KodeMono-Regular.woff2) format("woff2"); font-weight: 400; }
@font-face { font-family: "Kode Mono"; src: url(/fonts/KodeMono-Bold.woff2) format("woff2"); font-weight: 700; }
html, body, #root { margin: 0; height: 100%; background: #0b0b0b; }
</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

export async function startDevServer(port = 5470): Promise<{ url: string; server: Server }> {
  const fonts = fontsDir();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(HTML);
      }
      if (url.pathname === "/app.js") {
        const js = await bundleBrowser(join(HERE, "page.tsx"), { react: true, minify: false });
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        return res.end(js);
      }
      if (url.pathname.startsWith("/fonts/") && fonts) {
        const file = join(fonts, basename(url.pathname));
        if (existsSync(file)) {
          res.writeHead(200, { "content-type": "font/woff2" });
          return res.end(readFileSync(file));
        }
      }
      if (url.pathname === "/api/board") {
        const dir = resolve(url.searchParams.get("path") ?? "");
        if (!existsSync(join(dir, "board.jsonl")) || !statSync(dir).isDirectory()) {
          res.writeHead(404, { "content-type": "text/plain" });
          return res.end(`not a board folder (no board.jsonl): ${dir}`);
        }
        const { doc } = loadBoardDir(dir);
        const board = doc.records.get("board");
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        return res.end(JSON.stringify({ records: [...doc.records.values()], ...(doc.netlist ? { netlist: doc.netlist } : {}), name: board?.kind === "board" ? board.name : basename(dir) }));
      }
      res.writeHead(url.pathname === "/favicon.ico" ? 204 : 404);
      res.end();
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error).stack ?? e));
    }
  });
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  const addr = server.address();
  const p = typeof addr === "object" && addr ? addr.port : port;
  return { url: `http://127.0.0.1:${p}/`, server };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: "string" } } });
  const { url } = await startDevServer(Number(values.port ?? 5470));
  console.log(`layout screen dev page: ${url}  (a board folder: ${url}?board=<folder>)`);
}
