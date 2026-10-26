// Runs in VS Code's extension host (PB-943). Asks, on this machine and this
// VS Code, the questions beta test 1 left open about the viewer tabs:
//
// - which Origin a webview sends, and whether the dev server's rule for
//   webview origins (packages/cli/src/dev/relay.js, originAllowed) accepts it;
// - whether a webview page under the viewer tab's Content-Security-Policy can
//   fetch a server that listens on 127.0.0.1 only, as http://127.0.0.1:<port>
//   and as http://localhost:<port>, and open its event stream;
// - what vscode.env.asExternalUri makes of the server's URL;
// - what an event stream does when its connection is cut (does the browser
//   reconnect), and whether a stream opens at all (it does not on VS Code
//   1.106 to at least 1.120, where the viewer asks the server every second
//   instead);
// - whether a page that loads again posts `ready` again (it must be told
//   where the server is again).
//
// The server here stands in for `protoboard dev` with the same origin rule
// and the same routes; nothing of the stack needs to be installed.
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const vscode = require("vscode");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.run = async function run() {
  const say = (s) => console.log(`[webview probe] ${s}`);
  const { originAllowed, DEFAULT_HOST_ORIGINS } = await import(pathToFileURL(join(__dirname, "..", "..", "..", "packages", "cli", "src", "dev", "relay.js")).href);
  const readOrigins = DEFAULT_HOST_ORIGINS.filter((o) => o !== "self");
  const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const seen = [];
  const streams = new Set();
  const server = createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const origin = req.headers.origin;
    const allowed = Boolean(origin && originAllowed(origin, readOrigins));
    seen.push({ url: req.url, host: req.headers.host, origin: origin ?? null, allowed });
    if (!LOOPBACK.has(host)) {
      res.writeHead(403);
      return res.end(`host ${host} not allowed`);
    }
    if (allowed) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    if (req.url === "/__protoboard/state") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return res.end(JSON.stringify({ session: "probe", version: 1 }));
    }
    if (req.url === "/__protoboard/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      res.write(`event: hello\ndata: ${JSON.stringify({ session: "probe", version: 1 })}\n\n`);
      streams.add(res);
      res.on("close", () => streams.delete(res));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/`;
  say(`VS Code ${vscode.version} on ${process.platform} ${process.arch}; stand-in dev server on ${url} (127.0.0.1 only)`);

  const external = (await vscode.env.asExternalUri(vscode.Uri.parse(url))).toString(true);
  say(`asExternalUri(${url}) = ${external}`);

  const panel = vscode.window.createWebviewPanel("protoboard.probe", "Probe", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  const messages = [];
  panel.webview.onDidReceiveMessage((m) => messages.push(m));
  const nonce = Math.random().toString(36).slice(2);
  // the viewer tab's policy (packages/vscode-protoboard/src/viewerPage.ts, viewerCsp)
  const dev = "http://127.0.0.1:* http://localhost:*";
  const csp = ["default-src 'none'", `script-src 'nonce-${nonce}' ${panel.webview.cspSource}`, `style-src ${panel.webview.cspSource} 'unsafe-inline'`, `img-src ${panel.webview.cspSource} ${dev} data: blob:`, `connect-src ${panel.webview.cspSource} ${dev} data: blob:`, "frame-src 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");
  const page = (load) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><p>probe ${load}</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const post = (m) => vscode.postMessage({ load: ${load}, ...m });
addEventListener("securitypolicyviolation", (e) => post({ type: "csp", blocked: e.blockedURI, directive: e.violatedDirective }));
post({ type: "ready", origin: location.origin, agent: navigator.userAgent, online: navigator.onLine });
addEventListener("message", async (e) => {
  const m = e.data;
  if (m.type === "fetch") {
    const t0 = performance.now();
    try {
      const res = await fetch(m.url, { cache: "no-store" });
      post({ type: "fetched", url: m.url, ok: res.ok, status: res.status, body: await res.text(), ms: Math.round(performance.now() - t0) });
    } catch (err) {
      post({ type: "fetched", url: m.url, ok: false, error: err.name + ": " + err.message, ms: Math.round(performance.now() - t0) });
    }
  }
  if (m.type === "events") {
    const t0 = performance.now();
    const es = new EventSource(m.url);
    const at = () => Math.round(performance.now() - t0);
    es.onopen = () => post({ type: "es", what: "open", url: m.url, ms: at() });
    es.addEventListener("hello", (ev) => post({ type: "es", what: "hello", url: m.url, data: ev.data, ms: at() }));
    es.onerror = () => post({ type: "es", what: "error", url: m.url, readyState: es.readyState, ms: at() });
  }
});
</script></body></html>`;
  const waitFor = async (test, what, ms = 20000) => {
    const t0 = Date.now();
    for (;;) {
      const m = messages.find(test);
      if (m) return m;
      if (Date.now() - t0 > ms) return { timedOut: what };
      await sleep(50);
    }
  };
  const result = { vscode: vscode.version, platform: `${process.platform} ${process.arch}`, external, problems: [] };

  panel.webview.html = page(1);
  const ready = await waitFor((m) => m.type === "ready" && m.load === 1, "ready");
  assert.ok(!ready.timedOut, "the webview page never ran");
  result.origin = ready.origin;
  result.originAllowedByDevServer = originAllowed(ready.origin, readOrigins);
  say(`webview origin: ${ready.origin} (the dev server's rule ${JSON.stringify(readOrigins)} ${result.originAllowedByDevServer ? "accepts" : "REFUSES"} it); online: ${ready.online}`);
  say(`user agent: ${ready.agent}`);
  if (!result.originAllowedByDevServer) result.problems.push(`the dev server refuses the webview origin ${ready.origin}`);

  result.fetch = {};
  for (const base of [url, `http://localhost:${port}/`, external.endsWith("/") ? external : `${external}/`].filter((b, i, all) => all.indexOf(b) === i)) {
    const target = `${base}__protoboard/state`;
    await panel.webview.postMessage({ type: "fetch", url: target });
    const got = await waitFor((m) => m.type === "fetched" && m.url === target, `fetch ${target}`);
    result.fetch[base] = got.timedOut ? "no answer in 20 s" : got.ok ? `ok in ${got.ms} ms` : (got.error ?? `status ${got.status}`);
    say(`fetch ${target}: ${result.fetch[base]}`);
  }
  if (!/^ok/.test(result.fetch[url])) result.problems.push(`a webview cannot fetch ${url}: ${result.fetch[url]}`);
  const sent = seen.find((s) => s.url === "/__protoboard/state");
  result.originHeader = sent ? sent.origin : "(no request reached the server)";
  say(`the server saw Origin: ${result.originHeader}, Host: ${sent ? sent.host : "?"}`);

  // the event stream, then a cut connection: does the browser reconnect by itself?
  const events = `${url}__protoboard/events`;
  await panel.webview.postMessage({ type: "events", url: events });
  const hello = await waitFor((m) => m.type === "es" && m.what === "hello", "events hello");
  result.events = hello.timedOut ? "no hello in 20 s" : `hello in ${hello.ms} ms`;
  // not a problem for the viewer: where a stream does not open (VS Code before about 1.130), the tab asks the server every second instead
  if (hello.timedOut) result.events = `does not open: ${messages.filter((m) => m.type === "es" && m.what === "error").length} error events while connecting, though ${seen.filter((x) => x.url === "/__protoboard/events").length} requests reached the server and were answered`;
  else {
    const before = messages.filter((m) => m.type === "es" && m.what === "hello").length;
    for (const res of streams) res.destroy();
    const error = await waitFor((m) => m.type === "es" && m.what === "error", "events error", 10000);
    const again = await waitFor(() => messages.filter((m) => m.type === "es" && m.what === "hello").length > before, "events reconnect", 15000);
    result.cut = `${error.timedOut ? "no error event" : `error event (readyState ${error.readyState})`}; ${again.timedOut ? "NO reconnect in 15 s" : "reconnected by itself"}`;
    say(`after the server cut the stream: ${result.cut}`);
  }
  say(`EventSource ${events}: ${result.events}`);

  // a page that loads again says `ready` again: Developer: Reload Webviews, then the html set a second time
  await vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
  await sleep(3000);
  const readies = messages.filter((m) => m.type === "ready" && m.load === 1).length;
  result.reloadWebviews = `${readies} ready message(s) from the first page after Reload Webviews`;
  say(result.reloadWebviews);
  panel.webview.html = page(2);
  const second = await waitFor((m) => m.type === "ready" && m.load === 2, "second ready");
  result.secondPage = second.timedOut ? "the second page never ran" : "the second page ran";
  const csp1 = messages.filter((m) => m.type === "csp");
  if (csp1.length) {
    result.csp = csp1.map((m) => `${m.directive}: ${m.blocked}`);
    result.problems.push(`the policy blocked: ${result.csp.join("; ")}`);
  }
  console.log(`[webview probe] RESULT ${JSON.stringify(result)}`);
  panel.dispose();
  await new Promise((ok) => {
    server.closeAllConnections();
    server.close(ok);
  });
  assert.deepEqual(result.problems, [], result.problems.join("; "));
};
