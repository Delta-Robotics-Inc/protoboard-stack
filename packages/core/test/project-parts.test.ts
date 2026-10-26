/**
 * The project's parts as one list (PB-903, `protoboard parts list`): library
 * parts pinned to a revision, diverged when their vendored files were
 * edited, researched parts in parts/local, designed parts in src/; and the
 * libraries' recommendation merged in by `--check`.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UhdModuleDef } from "@protoboardai/cloud/client";
import { addParts, checkPartUpdates, connectCloud, definitionTrust, loadProject, projectParts, withUpdates, type CloudConnection } from "../src/index.js";
import { Blobs, draft, startCloud, type CloudService } from "./cloud.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-project-parts");
const CLI = join(HERE, "../../cli/bin/protoboard.mjs");

const power = { id: "vin", name: "VIN", domain: "electrical", exposed: true, protocols: [{ type: "power", roles: ["sink"] }] };
const SENSOR = (description: string): UhdModuleDef => ({ id: "test-sensor", name: "Test sensor", description, manufacturer: "Test", part_number: "TS-1", interfaces: [power] });
const LED: UhdModuleDef = { id: "test-led", name: "Test LED", manufacturer: "Test", part_number: "LED-1", interfaces: [power] };

let svc: CloudService;
let cloud: CloudConnection;

beforeAll(async () => {
  svc = await startCloud();
  cloud = connectCloud(undefined, { url: svc.url, env: {} });
  const blobs = new Blobs();
  const publish = (d: Parameters<typeof svc.client.publish>[0]) => svc.client.publish(d, blobs.source);
  await publish(draft(blobs, SENSOR("first")));
  await publish(draft(blobs, SENSOR("second"), { revision: 2 }));
  await publish(draft(blobs, LED));
});
afterAll(async () => {
  await svc?.stop();
  rmSync(TMP, { recursive: true, force: true });
});

function project(): string {
  const dir = join(TMP, "p");
  rmSync(dir, { recursive: true, force: true });
  const files: Record<string, string> = {
    "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ root: { source: "src/sys.uhd.ts", export: "SYS" }, libraries: [{ id: "protoboard", url: ${JSON.stringify(svc.url)} }] });\n`,
    "src/sys.uhd.ts": [
      `export const BOARD = { id: "board", name: "Main board", interfaces: [] };`,
      `export const GROUP = { id: "group", name: "Group", interfaces: [], children: [{ id: "led_a", moduleDefId: "test-led" }, { id: "led_b", moduleDefId: "test-led" }] };`,
      `export const SYS = { id: "sys", name: "System", interfaces: [], children: [{ id: "sensor", moduleDefId: "test-sensor" }, { id: "leds", moduleDefId: "group" }, { id: "board", moduleDefId: "board" }, { id: "cell", moduleDefId: "local-cell" }] };`,
      "",
    ].join("\n"),
    "parts/local/cell.uhd.ts": `export const CELL = { id: "local-cell", name: "LiPo cell", interfaces: [] };\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe("projectParts", () => {
  it("lists library, researched and designed parts; an edited vendored file makes a part diverged", async () => {
    const dir = project();
    await addParts(await loadProject(dir, { checks: false }), ["test-sensor@1", "test-led@1"], cloud, { now: "2026-10-05T00:00:00.000Z" });
    let p = await loadProject(dir, { checks: false });
    const r = projectParts(p);
    expect(r.parts.map((x) => [x.id, x.tier, x.status, x.library, x.revision, x.instances])).toEqual([
      ["test-led", "catalog", "pinned", "protoboard", 1, 2],
      ["test-sensor", "catalog", "pinned", "protoboard", 1, 1],
      ["local-cell", "project-researched", "local", undefined, undefined, 1],
      // the grouping module is the diagram's, not a part
      ["board", "project-specific", "designed", undefined, undefined, 1],
    ]);
    expect(r.counts).toEqual({ total: 4, library: 2, researched: 1, designed: 1, updates: 0, diverged: 0 });
    expect(r.parts[0]).toMatchObject({ manufacturer: "Test", partNumber: "LED-1", file: "parts/catalog/test-led.json" });
    // each part's status (PB-932): the project's own are local; a library part vendored without a verification record is unverified
    expect(r.parts.map((x) => [x.id, x.trust, x.trustBasis])).toEqual([
      ["test-led", "unverified", "no verification record"],
      ["test-sensor", "unverified", "no verification record"],
      ["local-cell", "local", "not in a library"],
      ["board", "local", "not in a library"],
    ]);
    expect(definitionTrust(p)).toMatchObject({ "test-led": { trust: "unverified" }, "local-cell": { trust: "local" }, group: { trust: "local" }, sys: { trust: "local" } });
    // a blank block (item 5 of the 2026-10-08 first builds): a module of the project with a name and interfaces only.
    // Not a library part, not a module that holds others, never the root system.
    const trust = definitionTrust(p);
    expect(trust.board).toEqual({ trust: "local", basis: "no part chosen", blank: true });
    expect(trust["local-cell"].blank).toBe(true);
    for (const id of ["test-led", "test-sensor", "group", "sys"]) expect(trust[id].blank, id).toBeUndefined();

    appendFileSync(join(dir, "parts/catalog/test-led.json"), "\n");
    p = await loadProject(dir, { checks: false });
    const edited = projectParts(p);
    expect(edited.parts.find((x) => x.id === "test-led")).toMatchObject({ status: "diverged", edited: ["parts/catalog/test-led.json"] });
    expect(edited.counts.diverged).toBe(1);

    // the library's recommendation: an update for the sensor; the diverged LED stays diverged
    const checked = withUpdates(edited, await checkPartUpdates(p, ["test-sensor", "test-led"], cloud), "2026-10-05T01:00:00.000Z");
    expect(checked.parts.find((x) => x.id === "test-sensor")).toMatchObject({ status: "update-available", revision: 1, recommended: 2 });
    expect(checked.parts.find((x) => x.id === "test-led")).toMatchObject({ status: "diverged" });
    expect(checked.counts).toMatchObject({ updates: 1, diverged: 1 });
    expect(checked.checked).toEqual({ at: "2026-10-05T01:00:00.000Z", problems: [] });
  });

  it("is `protoboard parts list`, offline unless --check", async () => {
    const dir = project();
    await addParts(await loadProject(dir, { checks: false }), ["test-sensor@1"], cloud);
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, "parts", "list", ...args, "--cwd", dir], { encoding: "utf8", timeout: 120000 });
    const offline = run(["--format", "json"]);
    expect(offline.status).toBe(0);
    const o = JSON.parse(offline.stdout);
    expect(o.checked).toBeUndefined();
    expect(o.parts.find((x: { id: string }) => x.id === "test-sensor")).toMatchObject({ status: "pinned", revision: 1 });

    const online = JSON.parse(run(["--check", "--format", "json"]).stdout);
    expect(online.parts.find((x: { id: string }) => x.id === "test-sensor")).toMatchObject({ status: "update-available", recommended: 2 });
    expect(online.counts.updates).toBe(1);

    const text = run([]).stdout;
    expect(text).toMatch(/^3 part\(s\): 1 from libraries, 1 researched, 1 designed \(not checked for updates: --check\)/);
    expect(text).toMatch(/Library · protoboard \(1\)\n {4}Test sensor +@1/);
    expect(text).toMatch(/Project · researched \(1\)\n {4}LiPo cell/);
  });
});
