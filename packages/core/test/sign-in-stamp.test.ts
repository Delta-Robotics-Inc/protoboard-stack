/**
 * What tells a watcher (the VS Code extension) that a sign-in was made or
 * forgotten, and which services this machine is signed in to (first builds
 * review, items 23 and 24).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CredentialStore, logout, savedServices, signInStamp, type Session } from "../src/index.js";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "pb-stamp-"));
  dirs.push(dir);
  const env = { PROTOBOARD_CONFIG_DIR: dir, PROTOBOARD_CREDENTIAL_STORE: "file" };
  return { dir, env, store: new CredentialStore({ env }) };
}
const session = (service: string): Session => ({ service, uid: "u1", email: "ada@example.com", apiKey: "k", refreshToken: "r", signedInAt: "2026-10-01T00:00:00.000Z", via: "browser" }) as Session;

describe("the sign-in stamp", () => {
  it("is written by a sign-in change, holds a time and nothing else, and is not written by a token refresh", () => {
    const { dir, store } = scratch();
    store.put(session("https://parts.example"));
    expect(existsSync(signInStamp(dir))).toBe(false);
    store.changed(new Date("2026-10-11T10:00:00Z"));
    expect(readFileSync(signInStamp(dir), "utf8")).toBe("2026-10-11T10:00:00.000Z\n");
  });

  it("logout touches it, whether or not anyone was signed in", () => {
    const { dir, store } = scratch();
    expect(logout("https://parts.example", { store })).toBe(false);
    expect(existsSync(signInStamp(dir))).toBe(true);
  });
});

describe("savedServices", () => {
  it("lists the services a sign-in is kept for, and none when signed out", () => {
    const { env, store } = scratch();
    expect(savedServices({ env, store })).toEqual([]);
    store.put(session("https://parts.example/"));
    expect(savedServices({ env, store, also: ["https://hosted.example"] })).toEqual(["https://parts.example"]);
    store.put(session("https://hosted.example"));
    expect(savedServices({ env, store }).sort()).toEqual(["https://hosted.example", "https://parts.example"]);
  });
});
