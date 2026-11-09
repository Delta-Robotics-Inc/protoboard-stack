/**
 * The layout screen's dev server: bundles page.tsx (the screen, the renderer and the board core's browser-safe
 * parts) and serves it on 127.0.0.1 with the viewer's Kode Mono faces, and is the board service's client for the
 * page through the same routes `protoboard dev` mounts (@protoboardai/views/pcb/host: `/__protoboard/board/...`).
 *
 * - The default board is the Airnode C3 fixture, copied to a temporary folder (a Git repository, so checkpoints
 *   commit) and served there as a live board service (`serveBoard`), so the page sees commits as they happen and
 *   writes through it as a person (`/__protoboard/board/request`); `/api/move` commits a footprint move on it as a
 *   person and `/api/agent` makes an agent claim a lease and commit (the screenshot script's way to make
 *   commits). The tracked fixture is never written.
 * - `?fixture=files` opens a second copy with no service: the host opens it for writing on the page's first write.
 * - `?board=<folder>` (any folder holding board.jsonl) opens that board through its live service when one runs
 *   (`protoboard board serve`), else from its files.
 *
 *   npx tsx packages/views/bench/pcb-screen/serve.ts [--port 5470]
 *   then open http://127.0.0.1:5470/ (the fixture) or /?board=<board folder>
 *
 * The bundle is rebuilt on every page load, so an edit shows on reload.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { agentActor, HUMAN, openBoardService, serveBoard, type BoardServer, type BoardService } from "@protoboardai/board/node";
import { bundleBrowser } from "../../src/pcb/headless/bundle.js";
import { BOARD_ROUTE_PREFIX, createBoardRoutes, entryOf } from "../../src/pcb/host/index.js";
import type { BoardEntry } from "../../src/pcb/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..");
const FIXTURE = join(REPO, "packages", "board", "test", "fixtures", "airnode-c3");

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

export async function startDevServer(port = 5470, options: { log?: (line: string) => void } = {}): Promise<{ url: string; server: Server; close(): Promise<void>; fixture: BoardService; fixtureDir: string; filesDir: string; root: string }> {
  const fonts = fontsDir();
  // the fixture as a live board service, on a copy
  const tmp = mkdtempSync(join(tmpdir(), "pcb-screen-"));
  const fixtureDir = join(tmp, "airnode-c3");
  cpSync(FIXTURE, fixtureDir, { recursive: true });
  const filesDir = join(tmp, "airnode-c3-files");
  cpSync(FIXTURE, filesDir, { recursive: true });
  writeFileSync(join(tmp, ".gitignore"), ".protoboard/\n");
  // a Git repository, so a checkpoint's commit has somewhere to go (no remote: nothing can be pushed)
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "ignore", windowsHide: true });
    git(["init", "-q"]);
    git(["config", "user.name", "Layout dev page"]);
    git(["config", "user.email", "dev@localhost"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "the Airnode C3 fixture"]);
  } catch {
    options.log?.("git is not available: checkpoints will save but not commit");
  }
  const fixture: BoardService = openBoardService({ dir: fixtureDir });
  const fixtureServer: BoardServer = await serveBoard(fixture);
  const opened = new Map<string, { entry: BoardEntry; dir: string; service?: BoardService }>();
  const fixtureEntry = { ...entryOf(tmp, fixtureDir), key: "fixture" };
  opened.set("fixture", { entry: fixtureEntry, dir: fixtureDir, service: fixture });
  opened.set("fixture-files", { entry: { ...entryOf(tmp, filesDir), key: "fixture-files" }, dir: filesDir });
  const samePage = (req: { headers: { origin?: string } }) => !req.headers.origin || /^http:\/\/127\.0\.0\.1:\d+$/.test(String(req.headers.origin));
  const routes = createBoardRoutes({ root: tmp, extra: () => [...opened.values()], mayRecheck: samePage, mayWrite: samePage, ...(options.log ? { log: options.log } : {}) });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname.startsWith(BOARD_ROUTE_PREFIX)) {
        routes.handle(req, res, url);
        return;
      }
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
      if (url.pathname === "/api/open") {
        const path = url.searchParams.get("path");
        if (url.searchParams.get("fixture") === "files") {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ key: "fixture-files", name: fixtureEntry.name }));
        }
        if (!path) {
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ key: "fixture", name: fixtureEntry.name }));
        }
        const dir = resolve(path);
        if (!existsSync(join(dir, "board.jsonl")) || !statSync(dir).isDirectory()) {
          res.writeHead(404, { "content-type": "text/plain" });
          return res.end(`not a board folder (no board.jsonl): ${dir}`);
        }
        const entry = { ...entryOf(dirname(dir), dir), key: `dir-${opened.size}` };
        const had = [...opened.values()].find((o) => o.dir === dir);
        const use = had?.entry ?? entry;
        if (!had) opened.set(entry.key, { entry, dir });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ key: use.key, name: use.name }));
      }
      if (url.pathname === "/api/move" && req.method === "POST") {
        const o = opened.get(url.searchParams.get("board") ?? "");
        if (!o?.service) {
          res.writeHead(409, { "content-type": "text/plain" });
          return res.end("only the fixture's own service takes moves here");
        }
        const dx = Math.round(Number(url.searchParams.get("dx")) * 1e6);
        const dy = Math.round(Number(url.searchParams.get("dy")) * 1e6);
        const r = o.service.apply({ batchId: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: `move ${url.searchParams.get("id")} by hand`, ops: [{ op: "footprint.move", ids: [url.searchParams.get("id") ?? ""], dx, dy, tracks: "stay" }] }, HUMAN);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(r));
      }
      if (url.pathname === "/api/agent" && req.method === "POST") {
        // an agent at work on the fixture: a lease on a subtree, then a move inside it (the agent bar's feed)
        const agent = agentActor(url.searchParams.get("name") ?? "placer");
        const c = fixture.claim(agent, { roots: [url.searchParams.get("root") ?? "sensor"], purpose: url.searchParams.get("purpose") ?? "tidy the sensor section", ttlMs: 240_000 });
        let r: unknown = c;
        const move = url.searchParams.get("move");
        if (c.status === "granted" && move) r = fixture.apply({ batchId: `agent-${Date.now()}`, label: "nudge the sensor pull-up", leaseToken: c.lease.token, ops: [{ op: "footprint.move", ids: [move], dx: 500_000, dy: 0, tracks: "stay" }] }, agent);
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ claim: c, reply: r }));
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
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${p}/`,
    server,
    fixture,
    fixtureDir,
    filesDir,
    root: tmp,
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise<void>((ok) => server.close(() => ok()));
        await routes.close();
        await fixtureServer.close();
        fixture.close({ save: false });
        rmSync(tmp, { recursive: true, force: true });
      })()),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: "string" } } });
  const s = await startDevServer(Number(values.port ?? 5470), { log: (l) => console.log(l) });
  console.log(`layout screen dev page: ${s.url}  (a board folder: ${s.url}?board=<folder>)`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => void s.close().then(() => process.exit(0)));
}
