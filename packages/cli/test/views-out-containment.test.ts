/**
 * Where `views capture` and `views check` may write through the render service (wave 2 gate): the
 * opt-in to write outside the project is set only for a person's own `--out` / `--out-dir`, never from
 * a manifest, and the service's `/check` body is contained to the project without it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { captureArgs } from "../src/views-capture.js";
import { checkBody } from "../src/views-service.js";

const TMP = mkdtempSync(join(tmpdir(), "pb-views-out-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe("views capture: the opt-in follows the person's own --out", () => {
  it("--out sets allowOutsideProject; no --out does not", () => {
    expect(captureArgs(["--out", join(TMP, "..", "elsewhere.png")], TMP).request).toMatchObject({ out: join(TMP, "..", "elsewhere.png"), allowOutsideProject: true });
    expect(captureArgs(["--view", "3d"], TMP).request.allowOutsideProject).toBeUndefined();
  });
  it("a manifest cannot carry the opt-in (nor its own out)", () => {
    const m = join(TMP, "m.capture.json");
    writeFileSync(m, JSON.stringify({ schema: "protoboard.capture-manifest/v0", request: { view: "3d", out: "/etc/x.png", allowOutsideProject: true }, image: "docs/x.png" }));
    const { request } = captureArgs(["--from", m], TMP);
    expect(request.allowOutsideProject).toBeUndefined();
    expect(request.out).toBe("docs/x.png");
  });
});

describe("the service's /check body", () => {
  const root = join(TMP, "project");
  mkdirSync(root, { recursive: true });
  it("keeps out inside the project without the opt-in, and says how to write elsewhere", async () => {
    expect(await checkBody(root, { out: "shots" })).toEqual({ out: join(root, "shots") });
    await expect(checkBody(root, { out: "../shots" })).rejects.toThrow(/views check: out: .* is outside the project.*protoboard views check --out-dir/);
    await expect(checkBody(root, { out: join(TMP, "elsewhere") })).rejects.toThrow(/outside the project/);
    expect(await checkBody(root, { out: join(TMP, "elsewhere"), allowOutsideProject: true })).toEqual({ out: join(TMP, "elsewhere") });
  });
  it("checks the other fields", async () => {
    expect(await checkBody(root, undefined)).toEqual({});
    expect(await checkBody(root, { module: "arm_fr", timeout: 30 })).toEqual({ module: "arm_fr", timeout: 30 });
    await expect(checkBody(root, { module: 3 })).rejects.toThrow(/module/);
    await expect(checkBody(root, { timeout: 0 })).rejects.toThrow(/timeout is 1 to 600/);
    await expect(checkBody(root, { allowOutsideProject: "yes", out: "/x" })).rejects.toThrow(/allowOutsideProject/);
    await expect(checkBody(root, { out: 'a"b' })).rejects.toThrow(/folder path/);
    await expect(checkBody(root, [1])).rejects.toThrow(/JSON object/);
  });
});
