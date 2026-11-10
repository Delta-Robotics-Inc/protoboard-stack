/**
 * Getting started: the page a first install opens, the Start view of a
 * window with no project, the theme tiles, and the example the extension
 * carries (startPage.ts, example.ts; start.ts is their VS Code side).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { EXAMPLE, copyExample, exampleParts, exampleSkips, exampleSource, exampleTarget, hasExample } from "../src/example.js";
import { RESTRICTED_LINE, START_LINE, START_TITLE, isProtoboardTheme, shouldOpenStart, startHtml, startSteps, startViewHtml, themeClick, themeLabel, type StartModel } from "../src/startPage.js";

const here = (f: string) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const src = (f: string) => readFileSync(here(f), "utf8");
const pkg = JSON.parse(src("package.json"));
const QUAD = here("../../examples/quadcopter-5in");
const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pb-start-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const CHOICES = [
  { id: "Protoboard Dark", swatch: { editor: "#1a1a1a", side: "#1f1f1f", bar: "#ff5c00", line: "#3a3a3a" } },
  { id: "Protoboard Light", swatch: { editor: "#f0f0f0", side: "#eaeaea", bar: "#ff5c00", line: "#c8c8c8" } },
];

function model(over: Partial<Omit<StartModel, "steps">> & { exampleOpened?: boolean } = {}): StartModel {
  const base = {
    account: { signedIn: false },
    agents: { waiting: ["Claude Code", "Codex"], connected: [], onPath: false },
    example: { carried: true, title: EXAMPLE.title, text: EXAMPLE.text },
    theme: { choices: CHOICES, current: "Default Dark Modern" },
    hasProject: false,
    ...over,
  };
  return { ...base, steps: startSteps({ ...base, exampleOpened: !!over.exampleOpened }) };
}
const ENV = { cspSource: "vscode-webview://x", nonce: "N0nce", picture: "vscode-webview://x/media/start/quadcopter.png" };

describe("the steps of Get Started", () => {
  it("are five, in this order: sign in, connect your agent, the drone example, a theme, your own project", () => {
    expect(model().steps.map((s) => [s.id, s.title])).toEqual([
      ["signIn", "Sign in"],
      ["agents", "Connect your agent"],
      ["example", "Open the drone example"],
      ["theme", "Choose a theme"],
      ["project", "Start your own project"],
    ]);
  });

  it("are done by what is so on the machine, not by a click", () => {
    expect(model().steps.map((s) => s.done)).toEqual([false, false, false, false, false]);
    const all = model({
      account: { signedIn: true, email: "someone@example.com" },
      agents: { waiting: [], connected: ["Codex"], onPath: true },
      theme: { choices: CHOICES, current: "Protoboard Light", previous: "Default Dark Modern" },
      hasProject: true,
      exampleOpened: true,
    });
    expect(all.steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
    // an agent found but not connected is not a connected agent
    expect(model({ agents: { waiting: ["Codex"], connected: [], onPath: true } }).steps[1]!.done).toBe(false);
  });
});

describe("the example and a project of one's own", () => {
  it("are told apart: a window on a copy of the example has not started a project", () => {
    const start = src("src/start.ts");
    expect(start).toContain("hasProject: this.host.hasProject() && !this.inExample()");
    expect(start).toMatch(/update\(EXAMPLE_COPIES_KEY, \[\.\.\.\(this\.context\.globalState\.get<string\[\]>\(EXAMPLE_COPIES_KEY\) \?\? \[\]\), copied\.dir\]/);
  });
});

describe("opening by itself", () => {
  it("happens once, at the first start after an install, in a trusted window", () => {
    expect(shouldOpenStart({ shown: false, hadBefore: false, test: false, trusted: true })).toBe(true);
    expect(shouldOpenStart({ shown: true, hadBefore: false, test: false, trusted: true })).toBe(false);
  });
  it("does not for someone who had the extension before the page existed, in a test run, or in Restricted Mode", () => {
    expect(shouldOpenStart({ shown: false, hadBefore: true, test: false, trusted: true })).toBe(false);
    expect(shouldOpenStart({ shown: false, hadBefore: false, test: true, trusted: true })).toBe(false);
    expect(shouldOpenStart({ shown: false, hadBefore: false, test: false, trusted: false })).toBe(false);
  });
  it("is wired to the first activation, replaces the install notice, and stands in for the theme and agent offers", () => {
    const ext = src("src/extension.ts");
    expect(ext).toMatch(/void this\.getStarted\.auto\(\)\.then\(\(r\) => \{\s*if \(r === "opened"\) this\.noticed = true;/);
    // the notice of a first unpack is not also shown when the page is
    expect(ext).toMatch(/if \(this\.getStarted\.shown\) return;\s*const path = "Add to PATH";/);
    const start = src("src/start.ts");
    expect(start).toContain("await state.update(THEME_OFFERED_KEY, true);");
    expect(start).toContain("await state.update(AGENTS_OFFERED_KEY, new Date().toISOString());");
    // someone who had the extension is marked as shown, without the page opening
    expect(start).toContain("if (!facts.shown && facts.hadBefore) await state.update(START_SHOWN_KEY, true);");
  });
  it("can be opened again: a command, and the first row of Help", () => {
    expect(pkg.contributes.commands.find((c: { command: string }) => c.command === "protoboard.start")).toMatchObject({ title: "Get Started", category: "Protoboard" });
    expect(src("src/help.ts")).toContain('export const START_COMMAND = "protoboard.start";');
  });
});

describe("the theme tiles", () => {
  it("a tile applies its theme and remembers the one in use before", () => {
    expect(themeClick("Protoboard Dark", "Default Dark Modern", undefined, CHOICES, "x")).toEqual({ set: "Protoboard Dark", previous: "Default Dark Modern" });
  });
  it("stay in view once a theme is applied: the step holds the way back, so it does not hand over to the next", () => {
    expect(src("src/startPage.ts")).toContain('if (open !== "theme" && before && now && !before.done && now.done) open = undefined;');
  });
  it("the applied tile, clicked again, puts that theme back", () => {
    expect(themeClick("Protoboard Dark", "Protoboard Dark", "Solarized Light", CHOICES, "x")).toEqual({ set: "Solarized Light" });
  });
  it("from one Protoboard theme to the other, what to go back to stays the theme before both", () => {
    expect(themeClick("Protoboard Light", "Protoboard Dark", "Monokai", CHOICES, "x")).toEqual({ set: "Protoboard Light", previous: "Monokai" });
    expect(themeClick("Protoboard Light", "Protoboard Light", "Monokai", CHOICES, "x")).toEqual({ set: "Monokai" });
  });
  it("with nothing remembered (the theme was chosen elsewhere), going back is the editor's default", () => {
    expect(themeClick("Protoboard Dark", "Protoboard Dark", undefined, CHOICES, "Default Dark Modern")).toEqual({ set: "Default Dark Modern" });
  });
  it("a name that is not one of the tiles changes nothing", () => {
    expect(themeClick("Monokai", "Protoboard Dark", "Abyss", CHOICES, "x")).toEqual({ previous: "Abyss" });
  });
  it("names a theme as people read it", () => {
    expect(themeLabel("Default Dark Modern")).toBe("Dark Modern");
    expect(themeLabel("Solarized Light")).toBe("Solarized Light");
    expect(isProtoboardTheme("Protoboard Dark", CHOICES)).toBe(true);
    expect(isProtoboardTheme("Dark 2026", CHOICES)).toBe(false);
  });
  it("are the two themes the extension ships", () => {
    expect(pkg.contributes.themes.map((t: { id: string }) => t.id)).toEqual(CHOICES.map((c) => c.id));
  });
});

describe("the page", () => {
  const html = startHtml(ENV, model());
  it("says what it is, in the editor's own colours", () => {
    expect(html).toContain(`<h1>${START_TITLE}</h1>`);
    expect(html).toContain(START_LINE);
    expect(START_TITLE).toBe("Get Started with Protoboard");
    expect(START_LINE).toBe("Sign in, connect your agent, open the drone example.");
    // it follows the theme: no colour of its own outside the theme pictures, which are data
    expect(html).toContain("var(--vscode-button-background)");
    expect(html.match(/#[0-9a-f]{6}\b/gi)?.filter((c) => !JSON.stringify(CHOICES).includes(c)) ?? []).toEqual([]);
  });
  it("loads only what the extension ships: scripts and styles by nonce, pictures from the extension, nothing from the network", () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(csp).toContain("default-src &#39;none&#39;");
    expect(csp).toContain("script-src &#39;nonce-N0nce&#39;");
    expect(csp).toContain("style-src &#39;nonce-N0nce&#39;");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    // so nothing in the page relies on an inline style or handler
    expect(html).not.toMatch(/\sstyle="|\son[a-z]+="/);
  });
  it("carries the model as data a closing tag cannot break out of", () => {
    const risky = startHtml(ENV, model({ account: { signedIn: true, email: "</script><b>x" } }));
    expect(risky).not.toContain("</script><b>x");
    expect(risky).toContain("\\u003c/script>\\u003cb>x");
  });
  it("holds each step's own words and button", () => {
    for (const text of ["A free Protoboard account unlocks the parts library.", "Sign In", "Connect Agents", "Add to PATH", "A complete drone to explore.", "Click the selected theme again to go back to ", "New Project"]) expect(html, text).toContain(text);
    // no instruction to run a command, no leftover of the walkthrough it replaces
    expect(html).not.toMatch(/npm install|Mark Done/);
  });
});

describe("the Start view of a window with no project", () => {
  const parts = exampleParts(QUAD);
  const html = startViewHtml(ENV, { account: { signedIn: false }, example: { carried: true, title: EXAMPLE.title, text: EXAMPLE.text }, parts });
  it("is the Library container's view when there is no project", () => {
    const views = pkg.contributes.views["protoboard-library"] as { id: string; type?: string; when?: string; name: string }[];
    expect(views.find((v) => v.id === "protoboard.start.home")).toMatchObject({ type: "webview", when: "protoboard.noProject", name: "Start" });
    expect(src("src/start.ts")).toContain('export const START_VIEW = "protoboard.start.home";');
  });
  it("has the drone's card and New Project", () => {
    for (const text of ["EXAMPLE", "openExample", "New Project", "Get Started"]) expect(html, text).toContain(text);
    expect(html).toContain(JSON.stringify(EXAMPLE.title));
  });
  it("shows what the Library looks like before a sign-in: dimmed, not to be used, under one line with Sign In", () => {
    expect(html).toContain("Sign in to use the library");
    expect(html).toContain('data-action="signIn"');
    // the preview is out of reach of the pointer, the keyboard and a screen reader
    expect(html).toContain('<div class="preview" aria-hidden="true" inert>');
    expect(html).toMatch(/\.preview\{[^}]*opacity:\.45;pointer-events:none/);
  });
  it("its rows are the example's own parts, which the extension ships: nothing of the hosted library", () => {
    expect(parts.length).toBe(9);
    expect(parts.map((p) => p.name)).toContain("DJI O4 Air Unit");
    for (const p of parts) expect(existsSync(join(QUAD, "parts", "catalog")) && p.name.length > 0).toBe(true);
    // one of each category first, and abbreviations keep their capitals
    expect(new Set(parts.slice(0, 5).map((p) => p.category)).size).toBe(5);
    expect(parts.map((p) => p.category)).toContain("GNSS");
    expect(parts.find((p) => p.name.startsWith("DolphinRC F405"))).toMatchObject({ maker: "DolphinRC", category: "Flight controller", top: "Microcontroller" });
    expect(src("src/start.ts")).not.toMatch(/parts search|libraries/);
  });
});

describe("the example the extension carries", () => {
  it("is the quadcopter, with its words", () => {
    expect(EXAMPLE).toEqual({ id: "quadcopter-5in", title: "5-inch 6S quadcopter", text: "System diagram, 3D assembly and checks. Copied to a folder you choose." });
    expect(exampleSource("/ext")).toBe(join("/ext", "dist", "examples", "quadcopter-5in"));
    expect(hasExample(TMP)).toBe(false);
  });

  it("leaves out what a build, an install or a tool wrote into the folder", () => {
    for (const rel of ["node_modules", "node_modules/@protoboardai/cli/package.json", ".protoboard/build/bundle.json", ".protoboard/local/dev.json", ".protoboard/tools/cad", "build", "release/index.html", "src/x/__pycache__/a.pyc", "debug.log", ".claude/skills/a.md", "parts/evidence/x/.research/a.txt"]) expect(exampleSkips(rel), rel).toBe(true);
    for (const rel of ["src/quadcopter.uhd.ts", ".protoboard/display.json", ".gitignore", "parts/catalog/a.json", "parts/evidence/x/notes.md", "docs/build.md", "src/harnesses/a/out/body.glb"]) expect(exampleSkips(rel), rel).toBe(false);
    // the build copies it by the same rule (esbuild.mjs)
    const build = src("esbuild.mjs");
    for (const rule of ['parts.includes("node_modules")', 'parts[0] === ".protoboard" && ["build", "cache", "local", "tools", "evals"]', 'parts[0] === "parts" && parts[1] === "evidence" && parts[3] === ".research"']) expect(build, rule).toContain(rule);
    expect(src(".vscodeignore")).toContain("!dist/examples/**");
  });

  it("goes into a new folder of its name, or the next free one, never into an existing folder", () => {
    const taken = new Set([join("/w", "quadcopter-5in"), join("/w", "quadcopter-5in-2")]);
    expect(exampleTarget("/w", () => false)).toBe(join("/w", "quadcopter-5in"));
    expect(exampleTarget("/w", (p) => taken.has(p))).toBe(join("/w", "quadcopter-5in-3"));
    const there = join(TMP, "there");
    mkdirSync(there);
    expect(() => copyExample(QUAD, there)).toThrow(/exists already/);
    expect(() => copyExample(TMP, join(TMP, "nothing"))).toThrow(/does not carry one/);
  });

  it("is copied whole: every committed file of the example, and nothing a tool left there", () => {
    const target = join(TMP, "copy", "quadcopter-5in");
    mkdirSync(join(TMP, "copy"));
    const r = copyExample(QUAD, target);
    expect(r.dir).toBe(target);
    for (const f of ["protoboard.config.ts", "package.json", ".gitignore", "src/quadcopter.uhd.ts", "parts/origins.json"]) expect(existsSync(join(target, f)), f).toBe(true);
    for (const f of ["node_modules", ".protoboard/build", ".protoboard/local", "release"]) expect(existsSync(join(target, f)), f).toBe(false);
    // the count is the repository's: what git tracks of the example (skipped where the tests do not run in a checkout)
    let tracked: string[] | undefined;
    try {
      tracked = execFileSync("git", ["ls-files", "-z", "."], { cwd: QUAD, encoding: "utf8", maxBuffer: 1 << 26 }).split("\0").filter(Boolean);
    } catch {
      tracked = undefined;
    }
    if (tracked?.length) {
      expect(tracked.filter((f) => exampleSkips(f))).toEqual([]);
      for (const f of tracked) if (!existsSync(join(target, f))) expect.fail(`${f} is committed and was not copied`);
      expect(r.files).toBeGreaterThanOrEqual(tracked.length);
    }
    expect(r.bytes).toBeGreaterThan(1_000_000);
  });

  it("a copy with a tool's leftovers beside it copies none of them", () => {
    const from = join(TMP, "dirty");
    mkdirSync(join(from, "node_modules", "x"), { recursive: true });
    mkdirSync(join(from, ".protoboard", "build"), { recursive: true });
    writeFileSync(join(from, "protoboard.config.ts"), "export default {};\n");
    writeFileSync(join(from, "node_modules", "x", "index.js"), "");
    writeFileSync(join(from, ".protoboard", "build", "bundle.json"), "{}");
    writeFileSync(join(from, ".protoboard", "display.json"), "{}");
    const r = copyExample(from, join(TMP, "clean"));
    expect(r.files).toBe(2);
    expect(existsSync(join(TMP, "clean", "node_modules"))).toBe(false);
    expect(existsSync(join(TMP, "clean", ".protoboard", "display.json"))).toBe(true);
  });

  it("opens with no account and no npm: trusted because the user asked for it, linked to the installed stack, then opened", () => {
    const ext = src("src/extension.ts");
    const adopt = ext.slice(ext.indexOf("private async adoptExample("), ext.indexOf("private async adoptExample(") + 1600);
    expect(adopt).toContain("this.trust.set(dir, true);");
    expect(adopt).toContain('["stack", "link", "--format", "json"]');
    expect(adopt).not.toMatch(/npm|signedInForParts|parts", "add/);
    expect(pkg.contributes.commands.find((c: { command: string }) => c.command === "protoboard.openExample")).toMatchObject({ title: "Open the Quadcopter Example…", category: "Protoboard" });
  });
});

describe("a failed first set-up", () => {
  it("is said where it is seen, with Try Again, not only written to the log", () => {
    const ext = src("src/extension.ts");
    expect(ext).toContain(".catch((e: Error) => this.stackFailed(e));");
    const failed = ext.slice(ext.indexOf("private stackFailed("), ext.indexOf("private stackFailed(") + 700);
    expect(failed).toContain("vscode.window.showErrorMessage(`Protoboard could not set up its stack in");
    expect(failed).toContain('"Try Again"');
    expect(failed).toContain('"Show Log"');
  });
});

describe("Restricted Mode's one line", () => {
  it("is the same in the views and in the message", () => {
    expect(RESTRICTED_LINE).toBe("Protoboard is off until you trust this folder.");
  });
});
