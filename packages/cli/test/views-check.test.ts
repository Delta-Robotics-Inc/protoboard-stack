/**
 * `protoboard views check` (PB-1030): the tabs each level gets, from the
 * shells' own rules, and each tab opened once in the web viewer in a
 * headless browser. The render cases need a Chromium-family browser
 * (core's findBrowser); without one they are skipped.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { accessMessage, findBrowser, type AccessRefusal } from "@protoboardai/core";
import { environmentTokenSent, formatViewsCheck, libraryAccessProblem, viewsCheck, type ViewsCheckReport } from "../src/views-check.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TMP = join(HERE, ".tmp-views-check");
const CLI = join(HERE, "../bin/protoboard.mjs");
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const rects = (n: number) => Array.from({ length: n }, (_, i) => `<rect x="${(i % 10) * 9}" y="${Math.floor(i / 10) * 9}" width="6" height="6" fill="#c83232"/>`).join("");
const PART = (id: string) => `{ id: "${id}", name: "${id}", interfaces: [{ id: "p", name: "P", domain: "electrical", exposed: true, pin: 1, protocols: [{ type: "gpio", roles: ["bidirectional"] }] }] }`;

/** A system with one board (two parts, a schematic and a PCB drawing listed by hand) and a loose part. */
function project(name: string, files: Record<string, string>) {
  const dir = join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, content: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  write("package.json", JSON.stringify({ name, private: true, type: "module" }));
  write("protoboard.config.ts", `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "${name}", root: { source: "src/sys.uhd.ts", export: "SYS" } });\n`);
  write(
    "src/sys.uhd.ts",
    `const A = ${PART("part-a")};
const B = ${PART("part-b")};
export const BOARD = {
  id: "fixture-board",
  name: "Fixture board",
  interfaces: [],
  children: [{ id: "u1", moduleDefId: "part-a" }, { id: "u2", moduleDefId: "part-b" }],
  links: [{ id: "l1", a: { child: "u1", interfaceId: "p" }, b: { child: "u2", interfaceId: "p" } }],
  artifacts: [
    { id: "sch", name: "Schematic", type: "schematic", format: "svg", filePath: "board/out/schematic.svg" },
    { id: "top", name: "PCB top", type: "pcb", format: "svg", filePath: "board/out/pcb-top.svg" },
  ],
};
export const SYS = { id: "fixture-sys", name: "Fixture system", interfaces: [], children: [{ id: "board", moduleDefId: "fixture-board" }, { id: "loose", moduleDefId: "part-a" }] };
export const DEFS = [A, B];
`,
  );
  for (const [rel, content] of Object.entries(files)) write(rel, content);
  return dir;
}

const DRAWN = {
  "board/out/schematic.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90">${rects(60)}</svg>`,
  "board/out/pcb-top.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90">${rects(60)}</svg>`,
};

describe("views check: the tabs each level gets", () => {
  it("lists the root and every level with modules inside it, with the shells' tabs, without rendering", async () => {
    const r = await viewsCheck({ cwd: project("listing", DRAWN), render: false });
    expect(r.rendered).toBe(false);
    expect(r.levels.map((l) => [l.path, l.module, l.tabs.map((t) => t.id)])).toEqual([
      ["", "fixture-sys", ["diagram", "bom", "pair", "library"].filter((t) => t !== "pair")],
      ["board", "fixture-board", ["diagram", "schematic", "pcb", "pair"]],
    ]);
    expect(formatViewsCheck(r)).toMatch(/not rendered: not rendered \(--no-render\)/);
  });

  it("--module picks one level by instance path or module id, a part included; an unknown one is refused", async () => {
    const dir = project("module", DRAWN);
    expect((await viewsCheck({ cwd: dir, render: false, module: "loose" })).levels.map((l) => [l.path, l.tabs.map((t) => t.id)])).toEqual([["loose", ["diagram"]]]);
    expect((await viewsCheck({ cwd: dir, render: false, module: "fixture-board" })).levels.map((l) => l.path)).toEqual(["board"]);
    await expect(viewsCheck({ cwd: dir, render: false, module: "nowhere" })).rejects.toThrow(/no instance path or module "nowhere"/);
  });

  it("the command: --no-render exits 0 and prints the tabs; --format json carries the report", () => {
    const dir = project("cli", DRAWN);
    const text = spawnSync(process.execPath, [CLI, "views", "check", "--no-render", "--cwd", dir], { encoding: "utf8", env: process.env });
    expect(text.status).toBe(0);
    expect(text.stdout).toMatch(/board {2}fixture-board\n {2}· Diagram\n {2}· Schematic\n {2}· PCB/);
    const json = spawnSync(process.execPath, [CLI, "views", "check", "--no-render", "--format", "json", "--cwd", dir], { encoding: "utf8", env: process.env });
    expect(JSON.parse(json.stdout).levels[1].tabs.map((t: { title: string }) => t.title)).toEqual(["Diagram", "Schematic", "PCB", "Pair"]);
  });
});

describe("views check: the Library tab and the account", () => {
  const S = "https://parts.example.test";
  it("no problem while a library can be used now (signed in, a recent answer, a service token, an open service)", () => {
    expect(libraryAccessProblem([])).toBeUndefined();
    for (const via of ["account", "recent", "service-token", "open-service"] as const) expect(libraryAccessProblem([{ allowed: true, service: S, via }])).toBeUndefined();
    // one usable library is enough: the tab shows its parts
    expect(libraryAccessProblem([{ allowed: false, service: S, reason: "signed-out", message: "x" }, { allowed: true, service: "https://other.test", via: "account" }])).toBeUndefined();
  });

  it("every refusal is the account's or the connection's state, with its reason and one line, whatever the reason", () => {
    for (const reason of ["signed-out", "sign-in-invalid", "unreachable", "not-invited", "email-unverified", "check-unavailable"]) {
      const p = libraryAccessProblem([{ allowed: false, service: S, reason: reason as AccessRefusal, message: `line for ${reason}\nmore` }]);
      expect(p).toEqual({ reason, message: `line for ${reason}` });
    }
    // no message: the line access.ts gives the reason
    expect(libraryAccessProblem([{ allowed: false, service: S, reason: "signed-out" }])?.message).toMatch(/protoboard login/);
  });

  it("a service that cannot check sign-ins (check-unavailable) skips the tab like any other refusal, saying to try again later", () => {
    const p = libraryAccessProblem([{ allowed: false, service: S, reason: "check-unavailable", message: accessMessage({ reason: "check-unavailable", service: S }) }]);
    expect(p).toEqual({ reason: "check-unavailable", message: accessMessage({ reason: "check-unavailable", service: S }) });
    expect(p!.message).not.toMatch(/sign in again/i);
    // with no message of its own, the line access.ts gives the reason
    expect(libraryAccessProblem([{ allowed: false, service: S, reason: "check-unavailable" }])?.message).toBe(accessMessage({ reason: "check-unavailable", service: S }));
  });

  it("a service accepted only from the last answer, because it cannot be reached, reads as unreachable", () => {
    const p = libraryAccessProblem([{ allowed: true, service: S, via: "offline" }]);
    expect(p?.reason).toBe("unreachable");
    expect(p?.message).toContain(S);
    // an open service (no sign-in) answered from its last record while it cannot be reached
    expect(libraryAccessProblem([{ allowed: true, service: S, via: "open-service", offlineUntil: "2026-11-06T00:00:00.000Z" }])?.reason).toBe("unreachable");
  });

  it("a token from the environment counts only where the library client sends it", () => {
    const H = "https://protoboard-parts.example.test";
    const ci = { PROTOBOARD_CLOUD_TOKEN: "t", PROTOBOARD_CLOUD_TOKEN_ORIGINS: H };
    // the service token: the Protoboard library, at an origin allowed to receive it
    expect(environmentTokenSent({ id: "protoboard", url: H }, ci)).toBe(true);
    expect(environmentTokenSent({ id: "protoboard", url: "https://elsewhere.example.test" }, ci)).toBe(false);
    expect(environmentTokenSent({ id: "vendor", url: H }, ci)).toBe(false);
    // a library's own token, when set, and never over plain http to another machine
    expect(environmentTokenSent({ id: "vendor", url: "https://vendor.example.test", authEnv: "PROTOBOARD_VENDOR_TOKEN" }, { PROTOBOARD_VENDOR_TOKEN: "v" })).toBe(true);
    expect(environmentTokenSent({ id: "vendor", url: "https://vendor.example.test", authEnv: "PROTOBOARD_VENDOR_TOKEN" }, {})).toBe(false);
    expect(environmentTokenSent({ id: "vendor", url: "http://vendor.example.test", authEnv: "PROTOBOARD_VENDOR_TOKEN" }, { PROTOBOARD_VENDOR_TOKEN: "v" })).toBe(false);
  });

  it("the report: a skipped tab is marked, says why, and is not counted as failed", () => {
    const r: ViewsCheckReport = {
      root: "/x",
      rendered: true,
      failed: 0,
      skipped: 1,
      levels: [
        {
          path: "",
          module: "sys",
          name: "sys",
          tabs: [
            { id: "diagram", title: "Diagram", status: "ok" },
            { id: "library", title: "Library", status: "skipped", reason: "sign-in-invalid", detail: "The Protoboard library needs a sign-in." },
          ],
        },
      ],
    };
    const text = formatViewsCheck(r);
    expect(text).toContain("  – Library    skipped (sign-in-invalid): The Protoboard library needs a sign-in.");
    expect(text).toMatch(/2 tab\(s\) on 1 level\(s\): every other one draws, 1 skipped$/);
    expect(formatViewsCheck({ ...r, failed: 1, levels: [{ ...r.levels[0]!, tabs: [{ id: "diagram", title: "Diagram", status: "empty", detail: "blank: nothing is drawn" }, r.levels[0]!.tabs[1]!] }] })).toMatch(/1 failed, 1 skipped$/);
  });
});

describe.skipIf(!findBrowser())("views check: each tab rendered once in a headless browser", () => {
  it("passes tabs that draw, fails a blank drawing, and keeps a PNG of each", async () => {
    const dir = project("render", { ...DRAWN, "board/out/schematic.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 90"></svg>` });
    const out = join(dir, "shots");
    const r = await viewsCheck({ cwd: dir, module: "board", out, timeout: 20 });
    expect(r.rendered).toBe(true);
    const tabs = Object.fromEntries(r.levels[0].tabs.map((t) => [t.id, t]));
    expect(tabs.diagram.status).toBe("ok");
    expect(tabs.pcb.status).toBe("ok");
    expect(tabs.schematic.status).not.toBe("ok");
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(out, "board__pcb.png"))).toBe(true);
    expect(formatViewsCheck(r)).toMatch(/✗ Schematic/);
  }, 240000);

  it("skips the Library tab while no library can be used, and still judges the model's tabs", async () => {
    // the project's library on a loopback port nothing listens on: the tab asks no real service
    const dir = project("library", {
      ...DRAWN,
      "protoboard.config.ts": `import { defineConfig } from "@protoboardai/core";\nexport default defineConfig({ name: "library", root: { source: "src/sys.uhd.ts", export: "SYS" }, cloud: { url: "http://127.0.0.1:59999" } });\n`,
    });
    const r = await viewsCheck({ cwd: dir, module: "", timeout: 20, libraryAccess: async () => ({ reason: "sign-in-invalid", message: "The Protoboard library needs a sign-in." }) });
    const tabs = Object.fromEntries(r.levels[0].tabs.map((t) => [t.id, t]));
    expect(tabs.library).toMatchObject({ status: "skipped", reason: "sign-in-invalid", detail: "The Protoboard library needs a sign-in." });
    expect(tabs.diagram.status).toBe("ok");
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(r.levels[0].tabs.filter((t) => t.status === "empty" || t.status === "error").length);
    expect(r.levels[0].tabs.filter((t) => t.id !== "library").every((t) => t.status !== "skipped")).toBe(true);
  }, 240000);
});
