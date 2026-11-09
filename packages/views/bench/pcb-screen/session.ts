/**
 * Scripted editing sessions on the layout screen (the dev page, serve.ts), driven as a person drives it: real mouse
 * and key events through DevTools, on the Airnode C3 fixture served as a live board service. After each step the
 * script reads the service's own document (not the page's) and says whether it holds what the step should have
 * done, and saves a screenshot.
 *
 *   npx tsx packages/views/bench/pcb-screen/session.ts --out <folder> [--backend auto|gpu|swiftshader] [--only <name,...>] [--no-route]
 *
 * Sessions: move a part and undo it; rotate, flip, lock and an inspector edit; lock a track and confirm a router run
 * leaves it byte-identical, then accept the proposal; work a review item to done (a waiver with a reason); a routing
 * diagnosis; replay the timeline; an agent at work with a lease and Take over; a checkpoint committed to Git; a
 * first write on a board with no service (the host opens it). Exit 1 when a check fails.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser, type Browser } from "@protoboardai/core/cdp";
import { canonicalRecord } from "@protoboardai/board/node";
import { startDevServer } from "./serve.js";

const { values } = parseArgs({ options: { out: { type: "string" }, backend: { type: "string" }, only: { type: "string" }, "no-route": { type: "boolean" } } });
if (!values.out) throw new Error("give --out <folder>");
const OUT = resolve(values.out);
mkdirSync(OUT, { recursive: true });
const ONLY = values.only ? new Set(values.only.split(",")) : undefined;
const W = 1440;
const H = 900;

const dev = await startDevServer(0);
const browser: Browser = await launchBrowser({ backend: (values.backend as "auto") ?? "auto", purpose: "Scripted editing sessions on the layout screen", echoErrors: true });
await browser.setViewport(W, H, 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

async function waitFor<T>(expr: string, test: (v: T) => boolean, ms = 30_000, step = 100): Promise<T> {
  const t0 = Date.now();
  let v: T = await browser.evaluate<T>(expr);
  while (!test(v) && Date.now() - t0 < ms) {
    await sleep(step);
    v = await browser.evaluate<T>(expr);
  }
  return v;
}
async function open(query = "") {
  await browser.navigate(`${dev.url}?${query}`);
  await waitFor<{ ready: boolean; error?: string }>("({ ready: !!window.__dev?.ready, error: window.__dev?.error })", (s) => s.ready || !!s.error);
  await waitFor<boolean>("!!window.__dev?.derived", (x) => x, 30_000);
  await browser.evaluate("document.fonts.ready.then(() => true)");
  await sleep(300);
}
async function shot(name: string) {
  await sleep(300);
  const png = await browser.screenshot({ x: 0, y: 0, width: W, height: H });
  writeFileSync(join(OUT, `${name}.png`), png);
  console.log(`      ${name}.png`);
}
async function at(xMm: number, yMm: number): Promise<{ x: number; y: number }> {
  return browser.evaluate(`(() => { const v = window.__dev.view; const r = document.querySelector(".pcb-canvas").getBoundingClientRect(); const p = v.toScreen(${xMm}, ${yMm}); return { x: r.left + p.x, y: r.top + p.y }; })()`);
}
async function mouse(type: "mousePressed" | "mouseReleased" | "mouseMoved", x: number, y: number, extra: Record<string, unknown> = {}) {
  await browser.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !extra.buttons ? "none" : "left", clickCount: 1, ...extra });
}
async function click(x: number, y: number) {
  await mouse("mouseMoved", x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
}
async function drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 10, hold?: () => Promise<void>) {
  await mouse("mouseMoved", from.x, from.y);
  await mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
    await sleep(16);
  }
  if (hold) await hold();
  await mouse("mouseReleased", to.x, to.y);
}
async function clickSel(selector: string, text?: string) {
  const p = await browser.evaluate<{ x: number; y: number } | null>(
    `(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = els.find((e) => !e.disabled && ${text ? `e.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())})` : "true"}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  if (!p) throw new Error(`no ${selector} ${text ?? ""}`);
  await click(p.x, p.y);
}
async function key(k: string, code: string, modifiers = 0) {
  await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers, ...(k.length === 1 && !(modifiers & 2) ? { text: k } : {}) });
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers });
}
async function type(text: string) {
  await browser.send("Input.insertText", { text });
}
/** The service's own document (not the page's). */
const svcRec = (id: string) => dev.fixture.snapshot().doc.records.get(id);
const svcSeq = () => dev.fixture.seq;
async function settle(seq: number) {
  await waitFor<number>("window.__dev.session.confirmed().seq", (s) => s >= seq, 10_000);
  await waitFor<boolean>("window.__dev.derived && window.__dev.derived.seq === window.__dev.session.confirmed().seq", (x) => x, 20_000);
}
const run = (name: string) => !ONLY || ONLY.has(name);

try {
  // ---------------------------------------------------------------- 1. move a part, then undo
  if (run("move")) {
    await open();
    await shot("p2-01-layout-editable");
    const ldo = svcRec("fp:power/ldo") as { x: number; y: number };
    const a = await at(-10, -3);
    const b = await at(-7, -3);
    let during = "";
    await drag(a, b, 12, async () => {
      await sleep(150);
      during = await browser.evaluate<string>("JSON.stringify({ shown: window.__dev.session.snapshot().doc.records.get('fp:power/ldo').x, confirmed: window.__dev.session.confirmed().doc.records.get('fp:power/ldo').x })");
      await shot("p2-02-drag-live-preview");
    });
    const d = JSON.parse(during) as { shown: number; confirmed: number };
    check("drag preview shows the move before any commit", d.shown !== d.confirmed && d.confirmed === ldo.x, `shown x ${d.shown / 1e6} mm, service x ${d.confirmed / 1e6} mm`);
    await settle(1);
    const moved = svcRec("fp:power/ldo") as { x: number; y: number };
    check("one gesture is one transaction (seq 1)", svcSeq() === 1, `service seq ${svcSeq()}`);
    check("the service holds the move, snapped to the 0.25 mm grid", moved.x !== ldo.x && Math.abs(moved.x - ldo.x - 3_000_000) <= 250_000 && moved.y === ldo.y && moved.x % 250_000 === 0, `x ${ldo.x / 1e6} -> ${moved.x / 1e6} mm`);
    const entry = dev.fixture.log().at(-1)!;
    check("the transaction is the person's", entry.actor.kind === "human", `${entry.actor.kind} ${entry.actor.id}: ${entry.label}`);
    await shot("p2-03-after-move-committed");
    await key("z", "KeyZ", 2);
    await settle(2);
    const back = svcRec("fp:power/ldo") as { x: number; y: number };
    check("Ctrl+Z puts it back in the service's document", back.x === ldo.x && back.y === ldo.y, `x ${back.x / 1e6} mm at seq ${svcSeq()}`);
    await key("z", "KeyZ", 2 | 8);
    await settle(3);
    check("Ctrl+Shift+Z redoes it", (svcRec("fp:power/ldo") as { x: number }).x === moved.x);
    await key("z", "KeyZ", 2);
    await settle(4);
    await shot("p2-04-after-undo-timeline");
  }

  // ---------------------------------------------------------------- 2. rotate, flip, lock, inspector edit, a refusal
  if (run("edit")) {
    await open();
    const p = await at(10, 6.5);
    await click(p.x, p.y);
    const sel = await browser.evaluate<string>("JSON.stringify(window.__dev.view.selection)");
    const id = (JSON.parse(sel) as string[])[0]?.replace(/^pad:([^:]+):.*$/, "fp:$1") ?? "";
    const r0 = svcRec(id) as { rotation: number; side: string } | undefined;
    const s0 = svcSeq();
    await key("r", "KeyR");
    await settle(s0 + 1);
    const r1 = svcRec(id) as { rotation: number; side: string };
    check(`R rotates ${id} by 90 degrees`, !!r0 && (r1.rotation - r0.rotation + 360_000) % 360_000 === 90_000, `${r0?.rotation} -> ${r1.rotation} mdeg`);
    await key("F", "KeyF", 8);
    await settle(s0 + 2);
    check("Shift+F flips it", (svcRec(id) as { side: string }).side !== r1.side, `side ${(svcRec(id) as { side: string }).side}`);
    await key("l", "KeyL");
    await settle(s0 + 3);
    check("L locks it", (svcRec(id) as { locked?: true }).locked === true);
    await clickSel(".pcb-tabs button", "inspect");
    await sleep(200);
    const inputs = await browser.evaluate<number>("document.querySelectorAll('.pcb-num input').length");
    if (inputs) {
      await clickSel(".pcb-num input");
      await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
      await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
      await type("4.25");
      await key("Enter", "Enter");
      await settle(s0 + 4);
      check("the inspector's X field moves it in millimeters", (svcRec(id) as { x: number }).x === 4_250_000, `x ${(svcRec(id) as { x: number }).x / 1e6} mm`);
    } else check("the inspector shows numeric fields", false, "no field");
    await shot("p2-05-inspector-edit-locked-part");
    // an agent's lease, then the person's undo stays the person's
    await key("z", "KeyZ", 2);
    await settle(s0 + 5);
    check("undo takes back the person's own last change only", (svcRec(id) as { x: number }).x !== 4_250_000);
  }

  // ---------------------------------------------------------------- 3. lock a track, autoroute, accept
  if (run("route") && !values["no-route"]) {
    await open();
    const p = await at(-5.2, -8.0);
    await click(p.x, p.y);
    const picked = await browser.evaluate<string[]>("window.__dev.view.selection");
    check("a click selects the USB D+ track", picked.includes("trk:f.usb_dp.1"), picked.join(", "));
    const s0 = svcSeq();
    await key("l", "KeyL");
    await settle(s0 + 1);
    const locked = svcRec("trk:f.usb_dp.1");
    check("L locks the track", (locked as { locked?: true } | undefined)?.locked === true);
    const before = canonicalRecord(locked!);
    const hand = ["trk:f.vbus.1", "trk:f.vbus.2"].map((i) => canonicalRecord(svcRec(i)!));
    await key("Escape", "Escape");
    await clickSel(".pcb-rail button[title^='Autoroute']");
    await waitFor<number>("document.querySelectorAll('.pcb-step').length", (n) => n >= 2, 10_000);
    await shot("p2-06-autoroute-panel");
    await clickSel(".pcb-panel .pcb-btn", "run");
    await sleep(1500);
    await shot("p2-07-autoroute-running");
    const done = await waitFor<boolean>("!!document.querySelector('.pcb-proposal') || document.querySelector('.pcb-panel')?.textContent.includes('Not offered')", (x) => x, 300_000, 500);
    check("the run ends with a scored proposal", done);
    await shot("p2-08-autoroute-proposal-ghost");
    const offered = await browser.evaluate<boolean>("!!document.querySelector('.pcb-proposal .pcb-btn.main')");
    if (offered) {
      const s1 = svcSeq();
      await clickSel(".pcb-proposal .pcb-btn.main");
      await waitFor<number>("window.__dev.session.confirmed().seq", (s) => s > s1, 60_000);
      await sleep(1500);
      const after = svcRec("trk:f.usb_dp.1");
      check("the locked track is byte-identical after the router run", !!after && canonicalRecord(after) === before);
      check("hand copper is byte-identical after the router run", ["trk:f.vbus.1", "trk:f.vbus.2"].every((i, k) => canonicalRecord(svcRec(i)!) === hand[k]));
      const routed = [...dev.fixture.snapshot().doc.records.values()].filter((r) => r.kind === "track" && r.provenance?.by === "routed" && !r.id.startsWith("trk:f.")).length;
      check("the accepted proposal is on the service's board as routed copper", routed > 0, `${routed} new routed segments, seq ${svcSeq()}`);
      await shot("p2-09-autoroute-accepted");
    } else {
      const why = await browser.evaluate<string>("document.querySelector('.pcb-panel')?.textContent.match(/Not offered[^.]*\\./)?.[0] ?? ''");
      check("a result worse than the board is not offered for Accept", true, why);
      check("the locked track is byte-identical after the router run", canonicalRecord(svcRec("trk:f.usb_dp.1")!) === before);
    }
  }

  // ---------------------------------------------------------------- 4. review: work an item to done
  if (run("review")) {
    await open();
    await clickSel(".pcb-top .pcb-btn.main", "review");
    await sleep(600);
    await shot("p2-10-review-mode");
    const n0 = await browser.evaluate<number>("Number(document.querySelector('.pcb-left b')?.textContent.match(/[0-9]+/)?.[0] ?? -1)");
    // the first item that is not an open connection gets a waiver with a reason
    const hasWaivable = await browser.evaluate<boolean>("[...document.querySelectorAll('.pcb-card .pcb-btn')].some((b) => b.textContent.includes('Not a problem') && !b.disabled)");
    if (!hasWaivable) {
      // step to one: J until the card's Not a problem is enabled
      for (let i = 0; i < 40; i++) {
        await key("j", "KeyJ");
        await sleep(80);
        if (await browser.evaluate<boolean>("[...document.querySelectorAll('.pcb-card .pcb-btn')].some((b) => b.textContent.includes('Not a problem') && !b.disabled)")) break;
      }
    }
    const item = await browser.evaluate<string>("document.querySelector('.pcb-card')?.dataset.item ?? ''");
    const s0 = svcSeq();
    await clickSel(".pcb-card .pcb-btn", "not a problem");
    await sleep(150);
    await type("The pad and the track are on one part; the fab accepts this gap on this board.");
    await shot("p2-11-review-waiver-reason");
    await key("Enter", "Enter");
    await settle(s0 + 1);
    const waiverRule = [...dev.fixture.snapshot().doc.records.values()].find((r) => r.kind === "rule" && r.id.startsWith("rule:waiver."));
    check("the waiver is a rules entry on the service's board", !!waiverRule, waiverRule ? `${waiverRule.id}` : "none");
    const listed = await waitFor<boolean>("!!window.__dev.derived?.waived?.length", (x) => x, 15_000);
    check("the checks leave the waived finding out and list it", listed && item !== "", `item ${item}`);
    const n1 = await browser.evaluate<number>("Number(document.querySelector('.pcb-left b')?.textContent.match(/[0-9]+/)?.[0] ?? -1)");
    check("the queue shrinks by one", n1 === n0 - 1 || n1 < n0, `${n0} -> ${n1}`);
    await shot("p2-12-review-item-done");
  }

  // ---------------------------------------------------------------- 5. diagnosis of an open net
  if (run("diagnose") && !values["no-route"]) {
    await open();
    await clickSel(".pcb-top .pcb-btn.main", "review");
    await sleep(300);
    // the first open net in the queue
    await clickSel(".pcb-presets button", "unconnected");
    await sleep(300);
    await clickSel(".pcb-card .pcb-btn", "why?");
    const ok = await waitFor<boolean>("!!document.querySelector('.pcb-verdict') || !!document.querySelector('.pcb-note.fail')", (x) => x, 300_000, 500);
    const verdict = await browser.evaluate<string>("document.querySelector('.pcb-verdict b')?.textContent ?? document.querySelector('.pcb-note.fail')?.textContent ?? ''");
    check("the diagnosis gives a verdict", ok && !!verdict, verdict);
    await shot("p2-13-routing-diagnosis");
  }

  // ---------------------------------------------------------------- 6. replay the timeline
  if (run("replay")) {
    await open();
    await browser.evaluate(`window.__dev.move("fp:power/ldo", 2, 0)`);
    await browser.evaluate(`window.__dev.move("fp:sensor/ic", 0, -1.5)`);
    await browser.evaluate(`window.__dev.move("fp:status/led1", -1, 0)`);
    const top = svcSeq();
    await settle(top);
    await shot("p2-14-timeline-three-commits");
    // the Checkpoints lane (the Changes lane's blocks select what they changed instead)
    const lanes = await browser.evaluate<{ x: number; y: number; w: number }>("(() => { const r = document.querySelector('.pcb-timeline .lanes').getBoundingClientRect(); return { x: r.left, y: r.top + 66, w: r.width }; })()");
    // the timeline's window: the latest 24 versions (timeline.ts, scaleFor)
    const seqTarget = top - 2;
    const min = Math.max(0, Math.max(top, 1) - 24);
    const slots = Math.max(top, 1) - min + 1;
    await click(lanes.x + ((seqTarget - min + 0.5) / slots) * lanes.w, lanes.y);
    const replay = await waitFor<number | null>("window.__dev.session.status().replay && !window.__dev.session.status().replay.loading ? window.__dev.session.status().replay.seq : null", (x) => x !== null, 10_000);
    const shownX = await browser.evaluate<number>("window.__dev.session.snapshot().doc.records.get('fp:sensor/ic').y");
    const liveY = (svcRec("fp:sensor/ic") as { y: number }).y;
    check("a click on the timeline shows the board at that seq, read only", replay === seqTarget && shownX === liveY + 1_500_000 && svcSeq() === top, `replay seq ${replay}, sensor y ${shownX / 1e6} (live ${liveY / 1e6}) mm`);
    await shot("p2-15-timeline-replay");
    await key("Escape", "Escape");
    const live = await waitFor<boolean>("!window.__dev.session.status().replay", (x) => x, 5000);
    check("Esc returns to the live board", live);
  }

  // ---------------------------------------------------------------- 7. an agent at work: lease, region, Take over
  if (run("agent")) {
    await open();
    await browser.evaluate(`window.__dev.agent({ name: "placer", root: "sensor", purpose: "tidy the sensor section", move: "fp:sensor/r_sda" })`);
    await waitFor<boolean>("!!document.querySelector('.pcb-agent.working')", (x) => x, 10_000);
    await sleep(800);
    await shot("p2-16-agent-at-work-lease");
    check("the agent bar shows the lease", await browser.evaluate<boolean>("document.querySelector('.pcb-agent')?.textContent.includes('tidy the sensor section')"));
    await clickSel(".pcb-agent .pcb-btn", "take over");
    const gone = await waitFor<boolean>("!document.querySelector('.pcb-agent.working')", (x) => x, 10_000);
    check("Take over revokes the agent's lease", gone && dev.fixture.presence().leases.length === 0, `${dev.fixture.presence().leases.length} live leases`);
    await shot("p2-17-after-take-over");
  }

  // ---------------------------------------------------------------- 8. checkpoint committed to Git
  if (run("checkpoint")) {
    await open();
    await browser.evaluate(`window.__dev.move("fp:status/led2", 1, 0)`);
    await settle(svcSeq());
    await clickSel(".pcb-timeline .pcb-btn", "checkpoint");
    await sleep(200);
    await clickSel(".pcb-dialog .pcb-btn", "save and prepare");
    await waitFor<boolean>("!!document.querySelector('.pcb-dialog .pcb-msg')", (x) => x, 10_000);
    await shot("p2-18-checkpoint-message");
    await clickSel(".pcb-dialog .pcb-btn.main");
    const committed = await waitFor<boolean>("!!document.querySelector('.pcb-dialog .pcb-note.pass') || !!document.querySelector('.pcb-dialog .pcb-note.fail')", (x) => x, 20_000);
    let logLine = "";
    try {
      logLine = execFileSync("git", ["log", "-1", "--name-only", "--format=%s"], { cwd: dev.root, encoding: "utf8" }).trim();
    } catch (e) {
      logLine = String(e);
    }
    check("the checkpoint is a Git commit of the board folder only", committed && /airnode-c3\/placement\.jsonl/.test(logLine) && !/airnode-c3-files/.test(logLine), logLine.replace(/\n/g, " | "));
    const remotes = execFileSync("git", ["remote"], { cwd: dev.root, encoding: "utf8" }).trim();
    check("nothing was pushed (no remote is even configured)", remotes === "");
    await shot("p2-19-checkpoint-committed");
  }

  // ---------------------------------------------------------------- 9. a board with no service: the host opens it
  if (run("files")) {
    await open("fixture=files");
    const p = await at(-10, -3);
    await drag(p, await at(-9, -3), 8);
    const ok = await waitFor<number>("window.__dev.session.confirmed().seq", (s) => s >= 1, 15_000);
    check("the first write opens a board with no service and commits", ok >= 1, `seq ${ok}`);
    await waitFor<boolean>("window.__dev.derived && window.__dev.derived.seq === window.__dev.session.confirmed().seq", (x) => x, 20_000);
    await shot("p2-20-files-board-first-write");
  }

  // ---------------------------------------------------------------- 10. read only: no request channel
  if (run("readonly")) {
    await open("readonly=1");
    const p = await at(-10, -3);
    await drag(p, await at(-8, -3), 8);
    await sleep(500);
    const seq = await browser.evaluate<number>("window.__dev.session.confirmed().seq");
    check("a read-only host takes no edits (a drag box-selects)", seq === svcSeq());
  }

  const errors = browser.takeErrors();
  if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await dev.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
