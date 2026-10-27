/**
 * The Protoboard colour themes (PB-900): built from the Alpha tokens with the
 * brand orange, the files the extension ships equal to what the generator
 * writes, and every pairing the workbench reads legible.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DRC_TOKENS } from "@deltarobotics/uhd-viewer/components";
import { THEME_FILES, colorTheme, mixHex, themeJson, toHex } from "../src/themeColors.js";
import { GHOSTTY_THEME, TERMINAL_FILES, flatten, ghosttyTheme, herdrColors, herdrTheme, withGhosttyTheme, withHerdrTheme } from "../src/terminalThemes.js";

// @protoboardai/views is browser code (DOM types): loaded by a path the type check does not follow
const views = "../../views/src/theme.js";
const { BRAND_TOKENS } = (await import(/* @vite-ignore */ views)) as { BRAND_TOKENS: Record<"dark" | "light", Parameters<typeof colorTheme>[1]> };

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
const themeFile = (name: string) => readFileSync(fileURLToPath(new URL(`../themes/${name}`, import.meta.url)), "utf8");
const file = (scheme: "dark" | "light") => themeFile(THEME_FILES[scheme]);

/** WCAG contrast ratio of two #rrggbb colours (alpha ignored: these are opaque pairings). */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(toHex(h).slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("oklch to hex", () => {
  it("turns Alpha's primary into the brand orange, and greys into greys", () => {
    expect(toHex(BRAND_TOKENS.dark.primary)).toBe("#ff5c00");
    expect(toHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(toHex("oklch(0 0 0)")).toBe("#000000");
    expect(toHex("oklch(0.5 0 0 / 50%)")).toBe("#63636380");
    expect(toHex("#ABCDEF")).toBe("#abcdef");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(() => toHex("red")).toThrow(/not an oklch/);
  });
});

describe("Protoboard Dark and Light", () => {
  for (const scheme of ["dark", "light"] as const) {
    const theme = colorTheme(scheme, BRAND_TOKENS[scheme], DRC_TOKENS);
    it(`${scheme}: the shipped file is what the generator writes (npm run themes)`, () => {
      expect(file(scheme)).toBe(themeJson(theme));
    });

    it(`${scheme}: Alpha's surfaces, the orange as accent, DRC colours for problems`, () => {
      const a = BRAND_TOKENS[scheme];
      expect(theme.type).toBe(scheme);
      expect(theme.colors["editor.background"]).toBe(toHex(a.background));
      expect(theme.colors["sideBar.background"]).toBe(toHex(a.sidebar));
      expect(theme.colors["editor.foreground"]).toBe(toHex(a.foreground));
      for (const k of ["button.background", "statusBar.background", "activityBar.activeBorder", "tab.activeBorderTop", "progressBar.background", "badge.background"]) expect(theme.colors[k], k).toBe("#ff5c00");
      expect(theme.colors["editorError.foreground"]).toBe(DRC_TOKENS.severityError);
      expect(theme.colors["problemsWarningIcon.foreground"]).toBe(DRC_TOKENS.severityWarning);
      // the workbench, the editor and syntax are all covered
      expect(Object.keys(theme.colors).length).toBeGreaterThan(200);
      expect(theme.tokenColors.length).toBeGreaterThan(20);
      expect(theme.semanticHighlighting).toBe(true);
      for (const v of Object.values(theme.colors)) expect(v).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
    });

    it(`${scheme}: text reads on every surface it sits on`, () => {
      const c = theme.colors;
      expect(contrast(c["editor.foreground"], c["editor.background"])).toBeGreaterThanOrEqual(7);
      expect(contrast(c["sideBar.foreground"], c["sideBar.background"])).toBeGreaterThanOrEqual(7);
      expect(contrast(c["descriptionForeground"], c["editor.background"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c["statusBar.foreground"], c["statusBar.background"])).toBeGreaterThanOrEqual(2.9);
      expect(contrast(c["button.foreground"], c["button.background"])).toBeGreaterThanOrEqual(2.9);
      for (const t of theme.tokenColors) if (t.settings.foreground && !t.scope.includes("invalid")) expect(contrast(t.settings.foreground, c["editor.background"]), t.name).toBeGreaterThanOrEqual(3.5);
    });
  }

  it("are contributed, and offered once after install", () => {
    expect(pkg.contributes.themes).toEqual([
      { label: "Protoboard Dark", id: "Protoboard Dark", uiTheme: "vs-dark", path: "./themes/protoboard-dark-color-theme.json" },
      { label: "Protoboard Light", id: "Protoboard Light", uiTheme: "vs", path: "./themes/protoboard-light-color-theme.json" },
    ]);
    const src = readFileSync(fileURLToPath(new URL("../src/themes.ts", import.meta.url)), "utf8");
    expect(src).toContain("globalState.update(THEME_OFFERED_KEY, true)");
  });
});

describe("Protoboard Dark and Light in Ghostty and herdr", () => {
  const themes = { dark: colorTheme("dark", BRAND_TOKENS.dark, DRC_TOKENS), light: colorTheme("light", BRAND_TOKENS.light, DRC_TOKENS) };

  it("the files under themes/ are what the generator writes (npm run themes)", () => {
    for (const scheme of ["dark", "light"] as const) expect(themeFile(TERMINAL_FILES.ghostty[scheme])).toBe(ghosttyTheme(themes[scheme]));
    expect(themeFile(TERMINAL_FILES.herdr)).toBe(herdrTheme(themes.dark, themes.light));
  });

  it("Ghostty gets the integrated terminal's colours, selection laid over its background", () => {
    expect(flatten("#ff5c0047", "#1f1f1f")).toBe("#5d3016");
    expect(flatten("#123456", "#ffffff")).toBe("#123456");
    for (const scheme of ["dark", "light"] as const) {
      const c = themes[scheme].colors;
      const lines = ghosttyTheme(themes[scheme]).split("\n");
      expect(lines).toContain(`background = ${c["terminal.background"]}`);
      expect(lines).toContain(`palette = 1=${c["terminal.ansiRed"]}`);
      expect(lines).toContain(`palette = 15=${c["terminal.ansiBrightWhite"]}`);
      expect(lines).toContain("cursor-color = #ff5c00");
      expect(lines.filter((l) => l.startsWith("palette = "))).toHaveLength(16);
      for (const l of lines.filter((x) => x && !x.startsWith("#"))) expect(l, l).toMatch(/^[a-z-]+ = (\d+=)?#[0-9a-f]{6}$/);
    }
  });

  it("herdr follows the host palette and switches with it; its UI takes Protoboard's surfaces and the orange", () => {
    const toml = herdrTheme(themes.dark, themes.light);
    expect(toml).toContain('name = "terminal"\nauto_switch = true\ndark_name = "terminal"\nlight_name = "terminal"');
    expect(herdrColors(themes.dark).accent).toBe("#ff5c00");
    for (const scheme of ["dark", "light"] as const) {
      const h = herdrColors(themes[scheme]);
      expect(Object.keys(h).sort()).toEqual(["accent", "active_row_bg", "blue", "green", "mauve", "overlay0", "overlay1", "panel_bg", "peach", "red", "selection_bg", "sidebar_bg", "subtext0", "surface0", "surface1", "surface_dim", "teal", "text", "yellow"]);
      expect(h.panel_bg).toBe(themes[scheme].colors["terminal.background"]);
      for (const v of Object.values(h)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("install sets Ghostty's theme line and replaces only herdr's theme tables", () => {
    expect(withGhosttyTheme("font-size = 12\ntheme = Catppuccin Mocha\n")).toBe(`font-size = 12\ntheme = ${GHOSTTY_THEME}\n`);
    expect(withGhosttyTheme("font-size = 12")).toBe(`font-size = 12\ntheme = ${GHOSTTY_THEME}\n`);
    expect(withGhosttyTheme("")).toBe(`theme = ${GHOSTTY_THEME}\n`);
    const block = "# Protoboard\n[theme]\nname = \"terminal\"\n";
    const before = 'onboarding = false\n\n# old theme\n[theme]\nname = "catppuccin"\n\n[theme.custom]\naccent = "red"\n\n# shells\n[terminal]\nnew_cwd = "home"\n';
    const after = withHerdrTheme(before, block);
    expect(after).toBe('onboarding = false\n\n# shells\n[terminal]\nnew_cwd = "home"\n\n' + block);
    // installing again changes nothing
    expect(withHerdrTheme(after, block)).toBe(after);
    expect(withHerdrTheme("", block)).toBe(block);
  });
});

describe("the extension's manifest", () => {
  it("spells the product Protoboard everywhere", () => {
    expect(JSON.stringify(pkg)).not.toContain("ProtoBoard");
  });

  it("signed out, every view is there and none depends on the account (PB-928: only the Library's page follows it)", () => {
    type View = { id: string; name: string; when?: string };
    const containers = Object.entries(pkg.contributes.views as Record<string, View[]>);
    expect(containers.map(([c]) => c).sort()).toEqual(["protoboard-cloud", "protoboard-drc", "protoboard-inspector", "protoboard-library", "protoboard-parts"]);
    const welcomes = pkg.contributes.viewsWelcome as { view: string; contents: string; when?: string }[];
    for (const [container, views] of containers) {
      expect(views.filter((v) => v.id.startsWith("protoboard.signin.")), container).toEqual([]);
      for (const v of views) {
        // Help and Feedback is there in every window, with a project or not (PB-1070)
        if (v.id === "protoboard.help") {
          expect(container).toBe("protoboard-cloud");
          expect(v.when, v.id).toBeUndefined();
          continue;
        }
        expect(v.when, v.id).toBe(v.id.startsWith("protoboard.start.") ? "protoboard.noProject || protoboard.needsSetup" : "protoboard.hasProject && !protoboard.needsSetup");
        expect(v.when, v.id).not.toMatch(/locked|signedIn/);
      }
    }
    // no welcome stands in for a view while signed out: the start views say what to do with no project, nothing else
    for (const w of welcomes) expect(w.when ?? "", w.view).not.toMatch(/locked|access ==/);
    const commands = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const id of ["protoboard.signIn", "protoboard.signInDevice", "protoboard.signOut", "protoboard.account.check", "protoboard.newProject", "protoboard.stack.show", "protoboard.stack.update", "protoboard.stack.install"]) expect(commands.has(id), id).toBe(true);
  });

  it("offers a walkthrough for a first start: a project, the viewer, the library's sign-in (optional), the terminal (PB-929, PB-928)", () => {
    const [w] = pkg.contributes.walkthroughs;
    expect(w.steps.map((s: { id: string }) => s.id)).toEqual(["newProject", "viewer", "signIn", "terminal"]);
    for (const s of w.steps as { media: { markdown: string } }[]) expect(existsSync(new URL(`../${s.media.markdown}`, import.meta.url)), s.media.markdown).toBe(true);
    expect(pkg.contributes.configuration.properties["protoboard.terminal.addCommand"].default).toBe(true);
    // the settings say the order the CLI is found in
    expect(pkg.contributes.configuration.properties["protoboard.cliPath"].markdownDescription).toMatch(/the project's own installed .* this setting, a stack copy .* the stack carried by this extension/);
  });

  it("puts the Protoboard Inspector alone in the secondary side bar, and the viewer (with its own hierarchy) in editor tabs (PB-1042)", () => {
    expect(pkg.contributes.viewsContainers.secondarySidebar).toEqual([{ id: "protoboard-inspector", title: "Protoboard Inspector", icon: "media/protoboard.svg" }]);
    // with a project, signed in or not; without a project the container shows its start view instead (PB-931)
    const inspector = pkg.contributes.views["protoboard-inspector"] as { id: string; when?: string }[];
    expect(inspector.filter((v) => v.when === "protoboard.hasProject && !protoboard.needsSetup").map((v) => v.id)).toEqual(["protoboard.inspector"]);
    // no Hierarchy view any more: each viewer tab has its own, at its left
    expect(Object.values(pkg.contributes.views).flat().some((v) => (v as { id: string }).id === "protoboard.explorer")).toBe(false);
    expect((inspector.find((v) => v.id === "protoboard.inspector") as { name?: string }).name).toBe("Protoboard Inspector");
    expect(JSON.stringify(pkg.contributes.menus)).not.toContain("view == protoboard.explorer");
    // a hierarchy row's right-click menu: VS Code's, from the row's data-vscode-context
    const rowMenu = (pkg.contributes.menus["webview/context"] as { command: string; when: string }[]).filter((m) => m.when.includes("webviewSection == 'hierarchy'"));
    expect(rowMenu.map((m) => m.command)).toEqual(expect.arrayContaining(["protoboard.openModule", "protoboard.explorer.focus", "protoboard.explorer.openSource", "protoboard.explorer.openArtifact", "protoboard.explorer.runOperation"]));
    for (const m of rowMenu) expect(m.when).toContain("webviewId == 'protoboard.viewer'");
    expect(inspector.filter((v) => v.when !== "protoboard.hasProject && !protoboard.needsSetup").map((v) => [v.id, v.when])).toEqual([["protoboard.start.inspector", "protoboard.noProject || protoboard.needsSetup"]]);
    expect(pkg.contributes.customEditors[0]).toMatchObject({ viewType: "protoboard.viewer", priority: "option" });
  });
});
