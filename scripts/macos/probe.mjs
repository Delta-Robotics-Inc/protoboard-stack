#!/usr/bin/env node
/**
 * What a machine gives the stack, before anything is installed (PB-943): the
 * Pythons `protoboard tools install` would try and which one it would use,
 * the browser the documents would be rendered with, and how the loopback
 * names resolve. It imports only two files of @protoboardai/core that need
 * nothing but Node (python.ts, browser.ts), so it runs from a bare checkout
 * of this repository: the macOS workflow runs it on a runner that has no
 * access to the sibling repositories, and a tester can run it and send the
 * output.
 *
 *   node scripts/macos/probe.mjs [--strict]
 *
 * Node 22.18 or later (it runs the TypeScript sources as they are).
 * --strict: exit 1 when no Python can create the CAD runtime, when no browser
 * is found, or when a browser found cannot print a page to PDF.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { describeTried, noPythonMessage, parsePythonRange, selectPython } from "../../packages/core/src/python.ts";
import { findBrowser, noBrowserMessage } from "../../packages/core/src/browser.ts";

const strict = process.argv.includes("--strict");
const problems = [];
const section = (title) => console.log(`\n== ${title}`);

section("Machine");
console.log(`${process.platform} ${process.arch}, release ${release()}, Node.js ${process.version}`);
if (process.platform === "darwin") {
  try {
    console.log(execFileSync("sw_vers", { encoding: "utf8" }).trim());
  } catch {
    /* not there */
  }
}
console.log(`PATH: ${process.env.PATH}`);

section("Python for the CAD runtime (build123d 0.13.0: Python 3.11 or later, before 3.15)");
const range = parsePythonRange(">=3.11,<3.15");
const { working, tried } = await selectPython({ range });
console.log(describeTried(tried).join("\n") || "  (no Python found)");
if (!working.length) {
  problems.push("no Python can create the CAD runtime");
  console.log(noPythonMessage(tried, range, process.platform, "protoboard tools install cad"));
} else {
  // the real test: a venv with pip, made by each Python that passed the checks
  for (const p of working) {
    const dir = mkdtempSync(join(tmpdir(), "pb-probe-venv-"));
    const t0 = Date.now();
    try {
      execFileSync(p.command, [...p.args, "-m", "venv", join(dir, "venv")], { stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
      const py = process.platform === "win32" ? join(dir, "venv", "Scripts", "python.exe") : join(dir, "venv", "bin", "python");
      const pip = execFileSync(py, ["-m", "pip", "--version"], { encoding: "utf8", timeout: 60000 }).trim();
      console.log(`  venv with ${[p.command, ...p.args].join(" ")} (Python ${p.version}): made in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${pip.split(" from ")[0]}`);
    } catch (e) {
      problems.push(`${p.command} passed the checks but could not create a venv`);
      console.log(`  venv with ${[p.command, ...p.args].join(" ")} FAILED: ${String(e.stderr || e.message).trim().split("\n").slice(-2).join(" | ")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(`tools install would use: ${[working[0].command, ...working[0].args].join(" ")} (${working[0].from}, Python ${working[0].version})`);
}
// what the refused ones say when asked to do it anyway: the evidence for the checks
for (const p of tried.filter((x) => !x.ok && x.version && /cannot import/.test(x.reason ?? "")).slice(0, 2)) {
  const dir = mkdtempSync(join(tmpdir(), "pb-probe-venv-"));
  try {
    execFileSync(p.command, [...p.args, "-m", "venv", join(dir, "venv")], { stdio: ["ignore", "pipe", "pipe"], timeout: 180000 });
    console.log(`  note: ${p.command} was refused (${p.reason}) but did create a venv`);
  } catch (e) {
    console.log(`  confirmed: ${p.command} cannot create a venv (${String(e.stderr || e.message).trim().split("\n").pop()})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

section("Browser for the documents (Chrome, Chromium, Edge or Brave; CHROME wins)");
const browser = findBrowser();
if (!browser) {
  problems.push("no Chromium-family browser found");
  console.log(noBrowserMessage());
} else {
  console.log(`${browser.name} at ${browser.path} (from ${browser.from})`);
  if (process.platform !== "win32") {
    try {
      console.log(`  ${execFileSync(browser.path, ["--version"], { encoding: "utf8", timeout: 30000 }).trim()}`);
    } catch (e) {
      problems.push("the browser found does not answer --version");
      console.log(`  --version failed: ${e.message.split("\n")[0]}`);
    }
  }
  // headless, the way the renderer starts it: one page to PDF
  const dir = mkdtempSync(join(tmpdir(), "pb-probe-pdf-"));
  const pdf = join(dir, "page.pdf");
  // the PDF decides, not the exit status or what the browser writes to stderr (on a Mac without a display it
  // logs a display-link error and still prints)
  const run = spawnSync(browser.path, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${join(dir, "profile")}`, `--print-to-pdf=${pdf}`, "--no-pdf-header-footer", "data:text/html,<h1>Protoboard</h1>"], {
    encoding: "utf8",
    timeout: 120000,
  });
  try {
    if (existsSync(pdf) && statSync(pdf).size >= 500) console.log(`  headless: printed a page to PDF (${statSync(pdf).size} bytes; exit ${run.status ?? run.signal})`);
    else {
      problems.push("the browser found could not print a page to PDF headless");
      console.log(`  headless print FAILED (exit ${run.status ?? run.signal}): ${String(run.stderr || run.error?.message || "").trim().split("\n").slice(-2).join(" | ")}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

section("Loopback (the dev server listens on 127.0.0.1; the viewer reads http://127.0.0.1:<port>/)");
for (const name of ["localhost", "127.0.0.1"]) {
  try {
    console.log(`  ${name} resolves to ${(await lookup(name, { all: true })).map((a) => `${a.address} (IPv${a.family})`).join(", ")}`);
  } catch (e) {
    console.log(`  ${name} does not resolve: ${e.message}`);
  }
}
const server = createServer((_req, res) => res.end("ok"));
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const { port } = server.address();
for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
  const t0 = Date.now();
  try {
    const res = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(5000) });
    console.log(`  GET http://${host}:${port}/ (server on 127.0.0.1 only): ${res.status} in ${Date.now() - t0} ms`);
  } catch (e) {
    console.log(`  GET http://${host}:${port}/ (server on 127.0.0.1 only): ${e.cause?.code ?? e.message}`);
    if (host === "127.0.0.1") problems.push("a server on 127.0.0.1 is not reachable at 127.0.0.1");
  }
}
server.close();

section("Result");
if (problems.length) console.log(problems.map((p) => `PROBLEM: ${p}`).join("\n"));
else console.log("ok: a Python that can create the CAD runtime, a browser that prints to PDF, and loopback as expected");
process.exit(strict && problems.length ? 1 : 0);
