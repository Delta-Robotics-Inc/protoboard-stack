/**
 * The update and vulnerability toast (PB-1168): which toast, the three
 * buttons, the weekly limit for plain updates, and the same state file the
 * CLI writes. Nothing is installed; the network is stubbed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: () => undefined }), openTextDocument: async () => ({}) },
  window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined, showTextDocument: async () => undefined },
  commands: { registerCommand: () => ({ dispose() {} }) },
  env: {},
}));

const { BUTTONS, INFO_KEY, SNOOZE_KEY, detailsMarkdown, planToast, showUpdateToast } = await import("../src/updateToast.js");
const { readState, runUpdateCheck } = await import("../../core/src/update/check.js");
const { makeProject, stubFetcher, VULN_ID } = await import("../../core/test/update-fixtures.js");

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const env = () => {
  const dir = mkdtempSync(join(tmpdir(), "pb-cfg-"));
  made.push(dir);
  return { PROTOBOARD_CONFIG_DIR: dir } as NodeJS.ProcessEnv;
};

async function checkedProject(options: { onlyUpdates?: boolean } = {}) {
  const root = makeProject();
  made.push(root);
  const { fetcher } = stubFetcher();
  const f: typeof fetcher = options.onlyUpdates ? async (url, init) => (url.includes("querybatch") ? new Response(JSON.stringify({ results: [] })) : fetcher(url, init)) : fetcher;
  await runUpdateCheck({ root, fetcher: f, env: env(), inventoryOptions: { noExec: true, home: root } });
  return root;
}

const memory = () => {
  const m = new Map<string, unknown>();
  return { m, get: <T>(k: string) => m.get(k) as T | undefined, update: async (k: string, v: unknown) => void m.set(k, v) };
};

const host = (choice?: string) => {
  const shown: { level: string; message: string; items: string[] }[] = [];
  const details: string[] = [];
  return {
    shown,
    details,
    showWarningMessage: async (message: string, ...items: string[]) => (shown.push({ level: "warning", message, items }), choice),
    showInformationMessage: async (message: string, ...items: string[]) => (shown.push({ level: "info", message, items }), choice),
    openDetails: async (md: string) => void details.push(md),
  };
};

describe("the update toast", () => {
  it("warns about a vulnerability with its advisory id and the three buttons; Show opens the details", async () => {
    const root = await checkedProject();
    const h = host(BUTTONS.show);
    const r = await showUpdateToast(root, memory(), h);
    expect(r.plan?.level).toBe("warning");
    expect(h.shown[0].level).toBe("warning");
    expect(h.shown[0].message).toContain(VULN_ID);
    expect(h.shown[0].message).toContain("lodash");
    expect(h.shown[0].items).toEqual(["Show", "Later", "Don't show for this version"]);
    expect(h.details[0]).toContain("Fix: fixed in lodash 4.17.21");
    expect(h.details[0]).toContain("Nothing is installed or changed by Protoboard");
  });

  it("Later keeps it quiet for a day", async () => {
    const root = await checkedProject();
    const mem = memory();
    const now = new Date("2026-11-01T12:00:00Z");
    await showUpdateToast(root, mem, host(BUTTONS.later), now);
    expect(mem.m.get(SNOOZE_KEY)).toBe("2026-11-02T12:00:00.000Z");
    const h = host();
    expect((await showUpdateToast(root, mem, h, new Date("2026-11-02T11:00:00Z"))).plan).toBeUndefined();
    expect(h.shown).toEqual([]);
    expect((await showUpdateToast(root, mem, host(), new Date("2026-11-02T13:00:00Z"))).plan?.level).toBe("warning");
  });

  it("Don't show for this version records the dismissal in the project's state file", async () => {
    const root = await checkedProject();
    await showUpdateToast(root, memory(), host(BUTTONS.never));
    const state = readState(root);
    expect(state.dismissed["vulnerable:npm:lodash"]).toBe("4.17.20");
    // the warning is gone; the plain update remains, as an info toast
    expect(planToast(state, {})?.level).toBe("info");
  });

  it("shows a plain update at most once a week", async () => {
    const root = await checkedProject({ onlyUpdates: true });
    const mem = memory();
    const now = new Date("2026-11-01T12:00:00Z");
    const first = await showUpdateToast(root, mem, host(), now);
    expect(first.plan?.level).toBe("info");
    expect(first.plan?.message).toMatch(/Protoboard: @protoboardai\/\w+ 0\.2\.3 is available/);
    expect(mem.m.get(INFO_KEY)).toBe(now.toISOString());
    expect((await showUpdateToast(root, mem, host(), new Date("2026-11-05T12:00:00Z"))).plan).toBeUndefined();
    expect((await showUpdateToast(root, mem, host(), new Date("2026-11-08T13:00:00Z"))).plan?.level).toBe("info");
  });

  it("says nothing without a check or with nothing open, and never throws", async () => {
    const empty = mkdtempSync(join(tmpdir(), "pb-empty-"));
    made.push(empty);
    expect(await showUpdateToast(empty, memory(), host())).toEqual({});
    expect(detailsMarkdown(readState(empty))).toContain("Not checked yet.");
  });
});
