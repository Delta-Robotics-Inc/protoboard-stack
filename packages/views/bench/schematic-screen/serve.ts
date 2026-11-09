/**
 * The schematic screen's dev server: bundles page.tsx (the schematic screen, and the layout screen for the
 * cross-probe and the switcher) and serves it on 127.0.0.1, with the same routes `protoboard dev` mounts: the
 * schematic routes (@protoboardai/views/schematic/host: `/__protoboard/schematic/...`) and the board routes for the
 * layout screen (`/__protoboard/board/...`). The page acts as a person; the host is the schematic service's client.
 *
 * - Default: the synthetic Airnode C3 circuit (`airnode`) and its 5 V fault variant (`airnode-fault`), each with an
 *   empty schematic folder in a temporary Git repository (so a first open lays it out in memory and a checkpoint
 *   commits), paired with a copy of the board core's Airnode C3 layout fixture. Tracked files are never written.
 * - `--local <label>`: a real UHD project from the Git-ignored `uhd-projects.json` beside the PCB regression set's
 *   local manifest (its largest board), for performance; its schematic folder is a temporary one, the project is
 *   only read. Nothing about it is printed but its label.
 *
 *   npx tsx packages/views/bench/schematic-screen/serve.ts [--port 5480] [--local A]
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { boardKey } from "@protoboardai/board/node";
import type { SchematicCircuit } from "@protoboardai/schematic";
import { airnodeCircuit } from "@protoboardai/schematic/fixtures/airnode-c3";
import { bundleBrowser } from "../../src/pcb/headless/bundle.js";
import { BOARD_ROUTE_PREFIX, createBoardRoutes, entryOf } from "../../src/pcb/host/index.js";
import { createSchematicRoutes, SCHEMATIC_ROUTE_PREFIX, type SchematicRoutes, type SchematicSourceEntry } from "../../src/schematic/host/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..", "..");
const BOARD_FIXTURE = join(REPO, "packages", "board", "test", "fixtures", "airnode-c3");
const LOCAL_LIST = join(REPO, "packages", "ext-tscircuit", "test", "fixtures", "pcb-regression", "local", "uhd-projects.json");

function fontsDir(): string | undefined {
  try {
    const viewer = dirname(createRequire(join(REPO, "package.json")).resolve("@deltarobotics/uhd-viewer/package.json"));
    const dir = join(viewer, "src", "styles", "fonts");
    return existsSync(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>schematic</title>
<style>
@font-face { font-family: "Kode Mono"; src: url(/fonts/KodeMono-Regular.woff2) format("woff2"); font-weight: 400; }
@font-face { font-family: "Kode Mono"; src: url(/fonts/KodeMono-Bold.woff2) format("woff2"); font-weight: 700; }
html, body, #root { margin: 0; height: 100%; background: #0b0b0b; }
</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

/** A real project's largest board from the local list, by label (generic labels only). */
async function localSource(label: string, tmp: string): Promise<SchematicSourceEntry> {
  if (!existsSync(LOCAL_LIST)) throw new Error("no local list of UHD projects (uhd-projects.json beside the PCB regression set's local manifest)");
  const projects = (JSON.parse(readFileSync(LOCAL_LIST, "utf8")) as { projects?: Record<string, string> }).projects ?? {};
  const dir = projects[label];
  if (!dir || !existsSync(dir)) throw new Error(`board ${label}: not in the local list, or its project is missing`);
  const { boardOptions, loadProject } = await import("@protoboardai/core");
  const { circuitFromUhd } = await import("@protoboardai/schematic/uhd");
  const p = await loadProject(dir);
  const boards = [...p.definitions.values()].map((d) => d.def).filter((d) => d && (d.kind === "board" || (d.traits ?? []).some((t: { type: string }) => t.type === "design_envelope")));
  let best: SchematicCircuit | undefined;
  for (const def of boards) {
    const c = circuitFromUhd(def, p.lookup, boardOptions(p)) as SchematicCircuit;
    if (!best || c.parts.length > best.parts.length) best = c;
  }
  if (!best) throw new Error(`board ${label}: its project has no board`);
  const sdir = join(tmp, `local-${label}`, "schematic");
  mkdirSync(dirname(sdir), { recursive: true });
  const circuit = best;
  return { entry: { key: `local-${label}`, dir: `local-${label}/schematic`, name: `board ${label}`, board: `board-${label}` }, dir: sdir, projectRoot: tmp, circuit: () => circuit };
}

export interface SchematicDevServer {
  url: string;
  server: Server;
  root: string;
  routes: SchematicRoutes;
  close(): Promise<void>;
}

export async function startSchematicDevServer(port = 5480, options: { log?: (line: string) => void; local?: string } = {}): Promise<SchematicDevServer> {
  const fonts = fontsDir();
  const tmp = mkdtempSync(join(tmpdir(), "schematic-screen-"));
  writeFileSync(join(tmp, "protoboard.config.ts"), "export default {};\n");
  writeFileSync(join(tmp, ".gitignore"), ".protoboard/\n");
  const boardDir = join(tmp, "main", "board");
  cpSync(BOARD_FIXTURE, boardDir, { recursive: true });
  mkdirSync(join(tmp, "fault"), { recursive: true });
  try {
    const git = (args: string[]) => execFileSync("git", args, { cwd: tmp, stdio: "ignore", windowsHide: true });
    git(["init", "-q"]);
    git(["config", "user.name", "Schematic dev page"]);
    git(["config", "user.email", "dev@localhost"]);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "the Airnode C3 fixture"]);
  } catch {
    options.log?.("git is not available: checkpoints will save but not commit");
  }
  const bkey = boardKey(tmp, boardDir);
  const ok = await airnodeCircuit("ok");
  const fault = await airnodeCircuit("fault");
  const sources: SchematicSourceEntry[] = [
    { entry: { key: "airnode", dir: "main/schematic", name: "Airnode C3", board: ok.board, layoutKey: bkey }, dir: join(tmp, "main", "schematic"), projectRoot: tmp, circuit: () => ok },
    { entry: { key: "airnode-fault", dir: "fault/schematic", name: "Airnode C3 (5 V fault)", board: fault.board, layoutKey: bkey }, dir: join(tmp, "fault", "schematic"), projectRoot: tmp, circuit: () => fault },
  ];
  // fresh copies for scripted sessions (one per step, so no step sees another's edits)
  for (let i = 1; i <= 8; i++) sources.push({ entry: { key: `airnode-${i}`, dir: `copy${i}/schematic`, name: "Airnode C3", board: ok.board, layoutKey: bkey }, dir: join(tmp, `copy${i}`, "schematic"), projectRoot: tmp, circuit: () => ok });
  if (options.local) sources.push(await localSource(options.local, tmp));
  const samePage = (req: { headers: { origin?: string } }) => !req.headers.origin || /^http:\/\/127\.0\.0\.1:\d+$/.test(String(req.headers.origin));
  const routes = createSchematicRoutes({ list: () => sources, mayWrite: samePage, ...(options.log ? { log: options.log } : {}) });
  const boards = createBoardRoutes({ root: tmp, extra: () => [{ entry: { ...entryOf(tmp, boardDir), key: bkey }, dir: boardDir }], mayRecheck: samePage, mayWrite: samePage, ...(options.log ? { log: options.log } : {}) });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname.startsWith(SCHEMATIC_ROUTE_PREFIX)) return void routes.handle(req, res, url);
      if (url.pathname.startsWith(BOARD_ROUTE_PREFIX)) return void boards.handle(req, res, url);
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
      if (url.pathname === "/api/agent-draft" && req.method === "POST") {
        // an agent drafts a card quickly: three parts moved off their pins without their wires (what a cleanup is for)
        const f = await routes.feed(url.searchParams.get("schematic") ?? "airnode");
        const r = await f.applyAs({ batchId: `draft-${Date.now()}`, label: "draft the sensor and MCU parts", ops: [{ op: "item.move", ids: ["sym:sensor/c_dec"], dx: 9, dy: 6 }, { op: "item.move", ids: ["sym:sensor/r_scl"], dx: -7, dy: 8 }, { op: "item.move", ids: ["sym:mcu/c_en"], dx: -6, dy: 7 }] }, { kind: "agent", id: "agent:drafter", name: "drafter" });
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(r));
      }
      res.writeHead(url.pathname === "/favicon.ico" ? 204 : 404);
      res.end();
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String((e as Error).stack ?? e));
    }
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const addr = server.address();
  const p = typeof addr === "object" && addr ? addr.port : port;
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${p}/`,
    server,
    root: tmp,
    routes,
    close: () =>
      (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        await routes.close();
        await boards.close();
        rmSync(tmp, { recursive: true, force: true });
      })()),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: "string" }, local: { type: "string" } } });
  const s = await startSchematicDevServer(Number(values.port ?? 5480), { log: (l) => console.log(l), ...(values.local ? { local: values.local } : {}) });
  console.log(`schematic screen dev page: ${s.url}  (?schematic=airnode | airnode-fault${values.local ? ` | local-${values.local}` : ""})`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => void s.close().then(() => process.exit(0)));
}
