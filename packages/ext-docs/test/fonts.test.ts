/**
 * Document fonts (PB-809): Kode Mono ships in this package, so documents and
 * releases render the same on every machine without another checkout;
 * PROTOBOARD_DOC_FONTS only replaces a file by name. Display text is Kode
 * Mono Bold: no other face is used, and none outside the package is read.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUNDLED_FONTS, docFonts } from "../lib/build.ts";

const KODE = ["KodeMono-Bold.ttf", "KodeMono-Medium.ttf", "KodeMono-Regular.ttf", "KodeMono-SemiBold.ttf"];
const saved = { a: process.env.PROTOBOARD_DOC_FONTS, b: process.env.UHD_DOC_FONTS };
afterEach(() => {
  for (const [k, v] of [["PROTOBOARD_DOC_FONTS", saved.a], ["UHD_DOC_FONTS", saved.b]] as const) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

describe("document fonts", () => {
  it("default to the bundled Kode Mono, with its OFL licence and nothing else", () => {
    delete process.env.PROTOBOARD_DOC_FONTS;
    delete process.env.UHD_DOC_FONTS;
    const fonts = docFonts();
    expect(fonts.map((f) => f.file)).toEqual(KODE);
    expect(fonts.every((f) => f.path.startsWith(BUNDLED_FONTS))).toBe(true);
    expect(readFileSync(join(BUNDLED_FONTS, "OFL.txt"), "utf8")).toMatch(/^Copyright 2023 The Kode Mono Project Authors[\s\S]*SIL OPEN FONT LICENSE Version 1\.1/);
    const pkg = JSON.parse(readFileSync(join(BUNDLED_FONTS, "../package.json"), "utf8"));
    expect(pkg.files).toContain("fonts");
  });

  it("PROTOBOARD_DOC_FONTS replaces a bundled file of the same name and adds no other face", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-doc-fonts-"));
    try {
      writeFileSync(join(dir, "Other-Regular.ttf"), "x");
      writeFileSync(join(dir, "KodeMono-Bold.ttf"), "kb");
      writeFileSync(join(dir, "Telegraf.woff"), "x");
      process.env.PROTOBOARD_DOC_FONTS = dir;
      const fonts = docFonts();
      expect(fonts.map((f) => f.file)).toEqual(KODE);
      expect(fonts.find((f) => f.file === "KodeMono-Bold.ttf")!.path).toBe(join(dir, "KodeMono-Bold.ttf"));
      expect(fonts.find((f) => f.file === "KodeMono-Regular.ttf")!.path).toBe(join(BUNDLED_FONTS, "KodeMono-Regular.ttf"));
      // a folder that does not exist leaves the bundled fonts
      process.env.PROTOBOARD_DOC_FONTS = join(dir, "missing");
      expect(docFonts().map((f) => f.file)).toEqual(KODE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
