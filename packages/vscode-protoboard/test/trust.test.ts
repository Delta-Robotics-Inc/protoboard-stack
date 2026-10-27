/**
 * Running a project's code only once it is trusted (PB-1048): the answers
 * kept per project folder, one question at a time, nothing in Restricted
 * Mode, and the manifest's side (untrustedWorkspaces, machine-scoped paths).
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ProjectTrust, TRUST_FILE, trustQuestion, type TrustAnswer } from "../src/trust.js";

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-trust-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function setup(answers: TrustAnswer[], workspaceTrusted = () => true) {
  const dir = mkdtempSync(join(TMP, "config-"));
  const asked: string[] = [];
  const trust = new ProjectTrust({
    dir: () => dir,
    workspaceTrusted,
    ask: async (root) => {
      asked.push(root);
      return answers.shift();
    },
    now: () => new Date("2026-10-25T00:00:00.000Z"),
  });
  return { trust, asked, dir };
}

describe("project trust", () => {
  it("asks once per folder, keeps the answer, and never asks again", async () => {
    const a = join(TMP, "a");
    const b = join(TMP, "b");
    mkdirSync(a);
    mkdirSync(b);
    const { trust, asked, dir } = setup(["trust", "refuse"]);
    expect(trust.isTrusted(a)).toBe(false);
    expect(await trust.ensure(a)).toBe(true);
    expect(await trust.ensure(b)).toBe(false);
    expect(await trust.ensure(a)).toBe(true);
    expect(await trust.ensure(b)).toBe(false);
    expect(asked).toEqual([a, b]);
    expect([trust.isTrusted(a), trust.isTrusted(b)]).toEqual([true, false]);
    // kept in the config folder, by real path, readable by the user only
    const file = JSON.parse(readFileSync(join(dir, TRUST_FILE), "utf8"));
    expect(file).toEqual({ schema: "protoboard.trusted-projects/v1", projects: { [a]: { trusted: true, at: "2026-10-25T00:00:00.000Z" }, [b]: { trusted: false, at: "2026-10-25T00:00:00.000Z" } } });
    if (process.platform !== "win32") {
      expect(statSync(join(dir, TRUST_FILE)).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it("a dismissed question is not kept: it comes again, and nothing runs meanwhile", async () => {
    const p = join(TMP, "dismissed");
    mkdirSync(p);
    const { trust, asked } = setup([undefined, "trust"]);
    expect(await trust.ensure(p)).toBe(false);
    expect(trust.answer(p)).toBeUndefined();
    expect(await trust.ensure(p)).toBe(true);
    expect(asked).toHaveLength(2);
  });

  it("callers that come while the question is open wait for the same answer", async () => {
    const p = join(TMP, "once");
    mkdirSync(p);
    let release!: (a: TrustAnswer) => void;
    const dir = mkdtempSync(join(TMP, "config-"));
    let asked = 0;
    const trust = new ProjectTrust({ dir: () => dir, workspaceTrusted: () => true, ask: () => (asked++, new Promise<TrustAnswer>((ok) => (release = ok))) });
    const all = Promise.all([trust.ensure(p), trust.ensure(p), trust.ensure(p)]);
    await new Promise((r) => setTimeout(r, 10));
    release("trust");
    expect(await all).toEqual([true, true, true]);
    expect(asked).toBe(1);
  });

  it("a link to a trusted folder is that folder; another folder is not", async () => {
    const real = join(TMP, "real");
    mkdirSync(real);
    symlinkSync(real, join(TMP, "link"));
    const { trust, asked } = setup(["trust"]);
    expect(await trust.ensure(real)).toBe(true);
    expect(trust.isTrusted(join(TMP, "link"))).toBe(true);
    expect(trust.isTrusted(join(TMP, "real", "sub"))).toBe(false);
    expect(asked).toEqual([real]);
  });

  it("in Restricted Mode nothing runs and nothing is asked, whatever was answered", async () => {
    const p = join(TMP, "restricted");
    mkdirSync(p);
    let trusted = true;
    const { trust, asked } = setup(["trust"], () => trusted);
    expect(await trust.ensure(p)).toBe(true);
    trusted = false;
    expect(trust.isTrusted(p)).toBe(false);
    expect(await trust.ensure(p)).toBe(false);
    expect(asked).toHaveLength(1);
  });

  it("an answer can be taken back", async () => {
    const p = join(TMP, "again");
    mkdirSync(p);
    const { trust } = setup(["trust", "refuse"]);
    expect(await trust.ensure(p)).toBe(true);
    trust.set(p, undefined);
    expect(await trust.ensure(p)).toBe(false);
    expect(trust.list()).toEqual([{ root: p, trusted: false, at: "2026-10-25T00:00:00.000Z" }]);
  });

  it("the question says what runs and names the folder", () => {
    const q = trustQuestion("quad", "/work/quad");
    expect(q.message).toBe('Run the code of "quad"?');
    expect(q.detail).toBe(
      "Protoboard runs a project's code to check and show it. That code can do anything your account can, so allow it only for projects you trust.\n\n/work/quad",
    );
    expect(q.detail).toContain("/work/quad");
    expect([q.trust, q.refuse]).toEqual(["Trust and Run", "Don't Run"]);
  });
});

describe("the manifest", () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  it("does not run in Restricted Mode", () => {
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(pkg.capabilities.untrustedWorkspaces.description).toMatch(/Restricted Mode/);
  });
  it("takes the CLI and Node.js paths from the user's or the machine's settings only, never a workspace's", () => {
    const props = pkg.contributes.configuration.properties;
    expect(props["protoboard.cliPath"].scope).toBe("machine");
    expect(props["protoboard.nodePath"].scope).toBe("machine");
  });
  it("has the command that asks again", () => {
    expect(pkg.contributes.commands.find((c: { command: string }) => c.command === "protoboard.trustProject")).toMatchObject({ title: "Trust This Project's Code…", category: "Protoboard" });
  });
});
