// A stand-in for `protoboard dev --format json` in the integration test: it
// records itself like the real server, answers the state route, serves a
// page and the project's last bundle, and logs every request to
// PROTOBOARD_FAKE_LOG so the test can see the viewer tab load. GET /__restart changes the session, as a
// restarted server would; GET /__rebuild makes a new version of the same session, as a rebuild does, and says so
// on the event stream.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";

if (process.argv[2] !== "dev") {
  console.log(JSON.stringify({ error: `the fake CLI only runs dev, not ${process.argv[2]}` }));
  process.exit(2);
}
const root = process.cwd();
const record = join(root, ".protoboard", "local", "dev.json");
let session = randomBytes(6).toString("hex");
let version = 1;
const streams = new Set();
let url;
const write = () => {
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, JSON.stringify({ schema: "protoboard.dev/v0", url, port: server.address().port, pid: process.pid, session, root, startedAt: new Date().toISOString() }));
};
const bundle = join(root, ".protoboard", "build", "uhd-bundle.json");
const server = createServer((req, res) => {
  if (process.env.PROTOBOARD_FAKE_LOG) appendFileSync(process.env.PROTOBOARD_FAKE_LOG, `${req.method} ${req.url}\n`);
  // the viewer tab reads from its own origin, as from the real server
  if (req.headers.origin) res.setHeader("access-control-allow-origin", req.headers.origin);
  if (req.url === "/__protoboard/state") return res.end(JSON.stringify({ session, version, diagnostics: [] }));
  if (req.url === "/__protoboard/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`retry: 1000\n\nevent: hello\ndata: ${JSON.stringify({ session, version })}\n\n`);
    streams.add(res);
    res.on("close", () => streams.delete(res));
    return;
  }
  if (req.url === "/__streams") return res.end(String(streams.size));
  if (req.url === "/__rebuild") {
    version++;
    for (const s of streams) s.write(`event: bundle\ndata: ${JSON.stringify({ version, reason: "source", diagnostics: [], failed: false, message: "built" })}\n\n`);
    // (a request that is open, whether or not the page's EventSource accepted the answer: VS Code 1.108's does not)
    return res.end(`version ${version}; ${streams.size} event stream request(s) open`);
  }
  if (req.url === "/uhd-bundle.json" && existsSync(bundle)) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(readFileSync(bundle));
  }
  if (req.url === "/__restart") {
    session = randomBytes(6).toString("hex");
    write();
    return res.end("restarted");
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>fake viewer</title><p>fake viewer</p>");
});
server.listen(0, "127.0.0.1", () => {
  url = `http://127.0.0.1:${server.address().port}/`;
  write();
  console.log(JSON.stringify({ level: "info", event: "listening", message: `serving at ${url}`, url, port: server.address().port }));
});
process.on("SIGTERM", () => {
  rmSync(record, { force: true });
  console.log(JSON.stringify({ level: "info", event: "stopped", message: "stopped" }));
  for (const s of streams) s.destroy();
  process.exit(0);
});
