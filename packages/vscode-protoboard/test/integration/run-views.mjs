// The schematic and PCB views on a large board, driven in both hosts (the extension's viewer tab page and the web
// viewer), with a pixel check that something is drawn: test/visual/views-capture.ts --strict. The large board is the
// smart bottle's, tiled three times (183 parts, more than a large field board's 137): its routed result (circuit.json), its
// schematic and its exported PCB drawings, each copy with its own ids, references and nets, side by side on one
// board. The fixture is made in .vscode-test/ (ignored) so the example's packages resolve from this checkout.
// Needs Chrome ($CHROME or /usr/bin/google-chrome) and the extension built (node esbuild.mjs, which test:integration
// runs first). PROTOBOARD_VIEWS_OUT keeps the captures; VIEWS_TILES changes the number of copies.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("../..", import.meta.url));
const example = join(pkg, "..", "..", "examples", "smart-bottle");
const board = "src/boards/bottle-cap";
const tiles = Number(process.env.VIEWS_TILES ?? 3);
const fixture = join(pkg, ".vscode-test", "fixtures", "large-board");

// ---- the fixture: the example with its board tiled
rmSync(fixture, { recursive: true, force: true });
mkdirSync(fixture, { recursive: true });
cpSync(example, fixture, { recursive: true, filter: (src) => !/[\\/](node_modules|\.protoboard|docs|release)$/.test(src) });

/** Circuit JSON tiled `n` times along x: ids and names made unique per copy, one board under all of them. */
function tileCircuit(cj, n, gap = 6) {
  const board = cj.find((e) => e.type === "pcb_board");
  const w = board.width;
  const out = [];
  for (let k = 0; k < n; k++) {
    const dx = k * (w + gap);
    const sfx = k ? `_t${k}` : "";
    const move = (v, key) => {
      if (Array.isArray(v)) return v.map((x) => move(x, key));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, move(x, kk)]));
      if (typeof v === "number" && (key === "x" || key === "x1" || key === "x2" || key === "anchor_x" || key === "center_x")) return v + dx;
      if (typeof v === "string" && (/_id$/.test(key) || key === "name") && sfx) return v + sfx;
      return v;
    };
    for (const e of cj) {
      if (e.type === "pcb_board" || e.type === "source_board") continue;
      const isPcb = e.type.startsWith("pcb_");
      const c = isPcb ? move(e) : JSON.parse(JSON.stringify(e), (key, v) => (typeof v === "string" && (/_id$/.test(key) || key === "name") && sfx && key !== "type" ? v + sfx : v));
      if (Array.isArray(c.connected_source_port_ids)) c.connected_source_port_ids = e.connected_source_port_ids.map((id) => id + sfx);
      if (Array.isArray(c.connected_source_net_ids)) c.connected_source_net_ids = e.connected_source_net_ids.map((id) => id + sfx);
      out.push(c);
    }
  }
  const total = n * w + (n - 1) * gap;
  const { outline: _drop, ...rest } = board;
  out.unshift({ ...rest, width: total, center: { x: board.center.x + (total - w) / 2, y: board.center.y } });
  for (const e of cj) if (e.type === "source_board") out.unshift(e);
  return out;
}

/** An SVG drawing tiled `n` times along x inside one <svg>, the copies' ids made unique. */
function tileSvg(svg, n, gap = 0.05) {
  const open = svg.match(/<svg\b[^>]*>/)[0];
  const body = svg.slice(svg.indexOf(open) + open.length, svg.lastIndexOf("</svg>"));
  const vb = (open.match(/viewBox="([^"]+)"/)?.[1] ?? `0 0 ${parseFloat(open.match(/width="([\d.]+)/)[1])} ${parseFloat(open.match(/height="([\d.]+)/)[1])}`).split(/[\s,]+/).map(Number);
  const step = vb[2] * (1 + gap);
  const copies = Array.from({ length: n }, (_, k) => `<g transform="translate(${k * step} 0)">${k ? body.replace(/\bid="([^"]+)"/g, `id="$1_t${k}"`).replace(/url\(#([^)]+)\)/g, `url(#$1_t${k})`).replace(/href="#([^"]+)"/g, `href="#$1_t${k}"`) : body}</g>`);
  const width = vb[2] + (n - 1) * step;
  const head = open
    .replace(/viewBox="[^"]*"/, "")
    .replace(/\swidth="[^"]*"/, ` width="${width}"`)
    .replace(/<svg\b/, `<svg viewBox="${vb[0]} ${vb[1]} ${width} ${vb[3]}"`);
  return `${head}${copies.join("")}</svg>`;
}

const routed = join(fixture, board, "tscircuit", "circuit.json");
writeFileSync(routed, JSON.stringify(tileCircuit(JSON.parse(readFileSync(routed, "utf8")), tiles)));
for (const f of ["schematic.svg", "pcb-top.svg", "pcb-bottom.svg"]) {
  const p = join(fixture, board, "out", f);
  if (existsSync(p)) writeFileSync(p, tileSvg(readFileSync(p, "utf8"), tiles));
}
const parts = JSON.parse(readFileSync(routed, "utf8")).filter((e) => e.type === "pcb_component").length;
console.log(`[protoboard views] large board: ${tiles} copies of the smart bottle's, ${parts} parts`);

// ---- both hosts, driven and checked
const out = process.env.PROTOBOARD_VIEWS_OUT ?? mkdtempSync(join(tmpdir(), "protoboard-views-"));
const r = spawnSync(process.execPath, ["--import", "tsx", join(pkg, "test", "visual", "views-capture.ts"), "--projects", fixture, "--out", out, "--themes", "protoboard-dark", "--strict", "--port", process.env.VIEWS_PORT ?? "5480"], { cwd: pkg, stdio: "inherit", env: process.env });
if (!process.env.PROTOBOARD_VIEWS_OUT) rmSync(out, { recursive: true, force: true });
if (r.status !== 0) {
  console.error("views integration test failed: a view did not draw, pan or zoom as it should (the problems are listed above)");
  process.exitCode = 1;
} else console.log("[protoboard views] the schematic and the PCB draw, pan and zoom in both hosts");
