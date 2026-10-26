/** Protoboard's theme: the brand orange lives here and nowhere in the open viewer. */
import { describe, expect, it } from "vitest";
import { TOKEN_NAMES, defaultDark } from "@deltarobotics/uhd-viewer/components";
import { THEME_CHOICES, protoboardDark, protoboardLight, themeAdapterFor } from "../src/theme.js";

describe("Protoboard theme", () => {
  it("maps the Alpha app's tokens (next-alpha :root and .dark)", () => {
    expect(protoboardDark.tokens.accent).toMatch(/^oklch\(0\.6837 0\.212 40/);
    expect(protoboardLight.tokens.accent).toBe(protoboardDark.tokens.accent);
    expect(protoboardLight.tokens).toMatchObject({
      background: "oklch(0.9551 0 0)",
      text: "oklch(0.3211 0 0)",
      surface: "oklch(0.97 0 0)",
      border: "oklch(0.8576 0 0)",
      textMuted: "oklch(0.45 0 0)",
      canvas: "oklch(0.94 0 0)",
    });
    expect(protoboardDark.tokens).toMatchObject({
      background: "oklch(0.2178 0 0)",
      text: "oklch(0.8853 0 0)",
      surface: "oklch(0.251 0 0)",
      border: "oklch(0.329 0 0)",
      textMuted: "oklch(0.68 0 0)",
    });
    expect(protoboardDark.tokens.canvas).toBe(defaultDark.tokens.canvas);
    // no warm stone greys from the viewer's neutral light theme
    expect(JSON.stringify(protoboardLight.tokens)).not.toMatch(/#f5f5f4|#1c1917|#e2e0de/);
    for (const t of [protoboardDark, protoboardLight]) expect(Object.keys(t.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it("maps every theme choice to an adapter", () => {
    expect(THEME_CHOICES.map((c) => themeAdapterFor(c).id)).toEqual(["protoboard-dark", "protoboard-light", "protoboard", "vscode", "default", "default"]);
    expect(themeAdapterFor("nonsense").current().id).toBe("protoboard-dark");
  });
});
