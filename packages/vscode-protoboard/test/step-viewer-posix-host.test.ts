/**
 * The preferred STEP viewer's Windows install folders (R2-E, G2) are Windows paths whatever machine works them out:
 * the platform is an option, so the test of the Windows branch (r2e-host-nav.test.ts) runs on Linux and macOS CI too.
 * There node:path's own join writes "/" and found nothing (CI, 2026-11-10: `missing` for Fusion 360). This file runs
 * the Windows branch with node:path behaving as on Linux, on any machine.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));
// node:path as on a Linux or macOS host: its plain functions are the POSIX ones (win32 and posix stay as they are)
vi.mock("node:path", async (original) => {
  const path = (await original()) as typeof import("node:path");
  const host = { ...path.posix, win32: path.win32, posix: path.posix };
  return { ...host, default: host };
});

const { stepLaunch } = await import("../src/stepViewer.js");

describe("the preferred STEP viewer on a POSIX host", () => {
  it("still finds the Windows applications where they install", async () => {
    const { join } = await import("node:path");
    expect(join("C:\\a", "b")).toBe("C:\\a/b"); // the mock is in place: a POSIX join
    const win = { platform: "win32" as const, env: { LOCALAPPDATA: "C:\\Users\\k\\AppData\\Local", ProgramFiles: "C:\\Program Files" } };
    const files = new Set([
      "C:\\Users\\k\\AppData\\Local\\Autodesk\\webdeploy\\production\\aaa\\FusionLauncher.exe",
      "C:\\Program Files\\KiCad\\9.0\\bin\\kicad.exe",
      "C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe",
    ]);
    const list = (dir: string) => (dir.endsWith("production") ? ["aaa"] : dir.endsWith("KiCad") ? ["9.0"] : ["FreeCAD 1.0"]);
    const o = { ...win, exists: (p: string) => files.has(p), list, mtime: () => 1 };
    expect(stepLaunch("fusion360", "C:\\m\\body.step", o)).toMatchObject({ kind: "exec", command: "C:\\Users\\k\\AppData\\Local\\Autodesk\\webdeploy\\production\\aaa\\FusionLauncher.exe" });
    expect(stepLaunch("kicad", "f.step", o)).toMatchObject({ kind: "exec", command: "C:\\Program Files\\KiCad\\9.0\\bin\\kicad.exe" });
    expect(stepLaunch("freecad", "f.step", o)).toMatchObject({ kind: "exec", command: "C:\\Program Files\\FreeCAD 1.0\\bin\\FreeCAD.exe" });
  });
});
