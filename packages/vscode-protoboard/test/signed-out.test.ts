/**
 * Signed out (PB-928 as changed on 2026-10-21): local work is never covered
 * or disabled, and only the cloud asks for a sign-in. The Library's screens
 * show a sign-in card in place of the library (PB-1039); the cloud's commands
 * ask to sign in instead of running; nothing else changes.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { commandGate } from "../../cli/src/gate.js";
import { ACCOUNT_ACTIONS, CHECKING, CLOUD_COMMANDS, UNLOCKED, accessMessage, accountFromWhoAmI, isAccountAction, lockOf } from "../src/account.js";
import { appHtml } from "../src/appPage.js";
import { viewerPageHtml } from "../src/viewerPage.js";
import { projectPartsWaiting } from "../src/libraryModel.js";

const src = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
const pkg = JSON.parse(src("package.json")) as {
  contributes: {
    commands: { command: string; enablement?: string }[];
    menus: Record<string, { command?: string; when?: string; group?: string }[]>;
    viewsWelcome: { view: string; contents: string; when?: string }[];
    walkthroughs: { description: string; steps: { id: string; title: string; description: string; when?: string }[] }[];
  };
};
/** A function's body in a source file, from its signature to the next member. */
const body = (file: string, signature: string) => {
  const s = src(file);
  const at = s.indexOf(signature);
  expect(at, signature).toBeGreaterThan(0);
  const next = s.slice(at + signature.length).search(/\n {2}(\/\*\*|(private |async |static )*[a-zA-Z]+\()/);
  return s.slice(at, next < 0 ? undefined : at + signature.length + next);
};

describe("the one flag", () => {
  it("says the library needs a sign-in, with the reason and the sentence, or nothing else", () => {
    expect(accessMessage(UNLOCKED)).toEqual({ type: "protoboard:access", signedOut: false });
    expect(accessMessage(CHECKING)).toEqual({ type: "protoboard:access", signedOut: true, reason: "checking", message: "Checking your Protoboard sign-in…" });
    const out = lockOf(accountFromWhoAmI({ code: 1, stdout: JSON.stringify({ service: "https://parts.example", signedIn: false, access: { allowed: false, reason: "signed-out" } }), stderr: "" }));
    expect(accessMessage(out)).toMatchObject({ signedOut: true, reason: "signed-out", message: "Sign in to use the Protoboard library." });
  });

  it("a page's buttons can ask for the account actions and nothing else", () => {
    for (const a of ACCOUNT_ACTIONS) expect(isAccountAction(a)).toBe(true);
    for (const a of ["retry", "reload", "protoboard.newProject", "", undefined, 3]) expect(isAccountAction(a)).toBe(false);
  });
});

describe("the part library signed out (PB-1039)", () => {
  it("only its screens follow the flag: the sign-in card and no parts", () => {
    const page = src("webview/views-app/main.tsx");
    expect(page).toMatch(/const LIBRARY_SCREENS: ReadonlySet<Screen> = new Set<Screen>\(\["library", "library-page", "part"\]\);/);
    expect(page).toContain("if (!library || !access.signedOut) return <>{children}</>;");
    expect(page).toContain('return { title: "Sign in to use the Protoboard library"');
    // the card says, in a line, that the project does not need the account
    expect(page).toContain('const LOCAL_STILL_WORKS = "Projects work without an account.";');
    // no screen is made inert or dimmed any more
    expect(page).not.toMatch(/inert=|opacity: 0\.45/);
  });

  it("the Library asks nothing of a library and lists nothing while it needs a sign-in", () => {
    const lib = src("src/libraryView.ts");
    expect(lib).toMatch(/if \(!root \|\| this\.isLocked\(\)\) return;/);
    expect(lib).toMatch(/private async search\(\): Promise<void> \{\n\s+if \(!this\.root \|\| !this\.conns\.length \|\| this\.isLocked\(\)\) return;/);
    expect(lib).toMatch(/this\.isLocked\(\) && m\?\.type !== "ready"/);
    expect(lib).toContain("lockChanged() {");
    expect(src("src/extension.ts")).toContain("this.library.lockChanged();");
  });

  it("a library's refusal of the sign-in is told apart from other failures", async () => {
    const { isSignInRefusal } = await import("../src/libraryData.js");
    for (const code of ["AUTH_REQUIRED", "ACCOUNT_NOT_ALLOWED", "FORBIDDEN"]) expect(isSignInRefusal(Object.assign(new Error("x"), { code }))).toBe(true);
    for (const e of [new Error("x"), Object.assign(new Error("x"), { code: "NETWORK" }), undefined, null, "AUTH_REQUIRED"]) expect(isSignInRefusal(e)).toBe(false);
  });

  it("only a Library page is written with the flag; the other screens never are", () => {
    const app = { screen: "library" as const, title: "Library", cspSource: "vscode-webview://x", script: "s.js", style: "s.css", nonce: "n1" };
    expect(appHtml(app)).not.toContain("data-signed-out");
    expect(appHtml({ ...app, signedOut: { reason: "not-invited", message: 'eve@x.example is "not" invited' } })).toContain('data-signed-out-message="eve@x.example is &quot;not&quot; invited"');
    const view = src("src/appView.ts");
    expect(view).toContain('const LIBRARY_SCREENS: ReadonlySet<AppScreen> = new Set<AppScreen>(["library", "library-page", "part"]);');
    expect(view).toContain("...(appSignedOut() && LIBRARY_SCREENS.has(screen) ? { signedOut: appSignedOut() } : {}),");
  });
});

describe("local work is never covered, disabled or held back", () => {
  it("the viewer tab has no overlay: no script, no flag, nothing made inert", () => {
    const viewer = { cspSource: "vscode-webview://x", script: "shell.js", style: "shell.css", nonce: "n1", title: "Drone", origins: ["http://127.0.0.1:*"], config: { path: "", view: "diagram", media: "m" } };
    const html = viewerPageHtml(viewer);
    expect(html).not.toMatch(/signed-out|data-signed-out|inert/);
    expect(existsSync(fileURLToPath(new URL("../webview/signed-out.ts", import.meta.url)))).toBe(false);
    expect(src("esbuild.mjs")).not.toContain("signed-out");
    expect(src("src/viewerEditor.ts")).not.toMatch(/access\(\)|accessChanged/);
    // the shell's own sign-in card is gone too: the dev message carries no sign-in
    expect(src("../web-viewer/src/vscode/protocol.ts")).not.toContain("SignInPrompt");
    expect(src("../web-viewer/src/vscode/Shell.tsx")).not.toContain("status.signIn");
  });

  it("the check, the dev server, the first look at a project and the hierarchy do not look at the account", () => {
    for (const [file, sig] of [
      ["src/extension.ts", "async check(given?: string"],
      ["src/extension.ts", "async ensureDev(root: string)"],
      ["src/extension.ts", "private devState(root: string)"],
      ["src/extension.ts", "private async arrive(root: string, later: boolean)"],
      ["src/extension.ts", "private checkOnOpen(root: string)"],
      ["src/extension.ts", "private buildChanged(uri: vscode.Uri)"],
      ["src/extension.ts", "private showCurrent()"],
      ["src/extension.ts", "private readyProject()"],
    ] as const) {
      expect(body(file, sig), sig).not.toMatch(/\block\b|locked|signIn/i);
    }
    expect(src("src/explorer.ts")).not.toMatch(/lockedRows|setLocked/);
    // a sign-out stops nothing and clears nothing
    const lock = body("src/extension.ts", "private applyLock()");
    expect(lock).not.toMatch(/abort\(\)|this\.data\.clear\(\)|this\.results\.clear\(\)|process\.stop\(\)|viewers\.|explorer\.|startProjects/);
  });

  it("no command is drawn disabled signed out: none has an enablement on the account", () => {
    expect(pkg.contributes.commands.filter((c) => c.enablement).map((c) => `${c.command}: ${c.enablement}`)).toEqual([]);
    expect(src("package.json")).not.toContain("protoboard.locked");
  });

  it("no welcome view says the views are locked; New Project says no account is needed", () => {
    for (const w of pkg.contributes.viewsWelcome) {
      expect(w.when ?? "", w.view).not.toMatch(/locked/);
      expect(w.contents, w.view).not.toMatch(/unlocks|for now|needs a signed-in/i);
    }
    const start = pkg.contributes.viewsWelcome.filter((w) => w.view === "protoboard.start.inspector" && /noProject/.test(w.when ?? ""));
    expect(start.find((w) => /!protoboard\.signedIn/.test(w.when ?? ""))!.contents).toContain("No account needed;");
  });

  it("the Sign In title button is on the Library only, and only while the library needs it", () => {
    const signIn = Object.values(pkg.contributes.menus)
      .flat()
      .filter((m) => m.command === "protoboard.signIn" && m.group?.startsWith("navigation"));
    // not while the card answers with Check Again (the sign-in is kept): a check that cannot run, an unreachable service
    expect(signIn.map((m) => m.when)).toEqual([
      "view == protoboard.library && protoboard.cloudLocked && protoboard.access != 'checking' && protoboard.access != 'check-unavailable' && protoboard.access != 'unreachable' && protoboard.access != 'unknown'",
    ]);
  });

  it("Sign In with a Code is in the palette only while signed out, like Sign In", () => {
    const palette = pkg.contributes.menus.commandPalette.filter((m) => m.command === "protoboard.signIn" || m.command === "protoboard.signInDevice");
    expect(palette.map((m) => [m.command, m.when])).toEqual([
      ["protoboard.signIn", "!protoboard.signedIn"],
      ["protoboard.signInDevice", "!protoboard.signedIn"],
    ]);
  });

  it("Project Parts lists the project's own parts with no word about a sign-in", () => {
    expect(projectPartsWaiting()).not.toMatch(/sign in/i);
    // the libraries are asked for updates only where the cloud may be used
    expect(src("src/partsViews.ts")).toContain("void this.load(false).then(async () => ((await this.host.cloudLocked?.()) ? undefined : this.load(true)));");
  });
});

describe("the cloud's commands (CLOUD_COMMANDS) ask to sign in instead of running", () => {
  it("are exactly the ones that use the library's account features", () => {
    expect([...CLOUD_COMMANDS].sort()).toEqual(["protoboard.fetchOffers", "protoboard.fetchParts", "protoboard.library.add", "protoboard.parts.check", "protoboard.parts.compare", "protoboard.parts.publish", "protoboard.parts.restore", "protoboard.parts.update"]);
    const known = new Set(pkg.contributes.commands.map((c) => c.command));
    for (const id of CLOUD_COMMANDS) expect(known.has(id), id).toBe(true);
  });

  it("each runs a CLI command that the CLI's gate table also calls cloud (packages/cli/src/gate.ts)", () => {
    const cli: Record<string, [string, string, { check?: boolean }?]> = {
      "protoboard.fetchParts": ["parts", "add"],
      "protoboard.library.add": ["parts", "add"],
      "protoboard.parts.check": ["parts", "list", { check: true }],
      "protoboard.parts.update": ["parts", "update"],
      "protoboard.parts.restore": ["parts", "add"],
      "protoboard.parts.compare": ["parts", "update"],
      "protoboard.fetchOffers": ["parts", "offers"],
      "protoboard.parts.publish": ["parts", "publish"],
    };
    for (const id of CLOUD_COMMANDS) expect(commandGate(cli[id]![0], cli[id]![1], cli[id]![2]).gate, id).toBe("cloud");
    // and the local ones the extension runs are local there too
    for (const [c, sub] of [["check"], ["build"], ["init"], ["dev"], ["layout"], ["parts", "list"], ["bom"], ["release"]] as [string, string?][]) expect(commandGate(c, sub).gate, `${c} ${sub ?? ""}`).toBe("local");
  });

  it("the extension's and the parts views' command wrappers ask only for those, and Fetch Parts and offers check themselves too", () => {
    expect(src("src/extension.ts")).toContain("CLOUD_COMMANDS.has(id) && (await this.cloudLocked()) ? this.askSignIn() : fn(...args)");
    expect(src("src/partsViews.ts")).toContain("CLOUD_COMMANDS.has(id) && (await host.cloudLocked?.()) ? host.askSignIn?.() : fn(...args)");
    expect(body("src/extension.ts", "private async fetchParts(root: string, args: string[])")).toContain("if (await this.cloudLocked()) {");
    expect(body("src/extension.ts", "async fetchOffers(given?: string)")).toContain("if (await this.cloudLocked()) return this.askSignIn();");
  });

  it("Open Full Library opens the library tab, which shows the sign-in card and loads nothing", () => {
    const parts = src("src/partsViews.ts");
    expect(parts).toMatch(/registerCommand\("protoboard\.library\.openPage", \(\) => host\.guard\(\(\) => host\.library\.openPage\(\)\)\)/);
    expect(src("src/libraryView.ts")).toMatch(/if \(this\.root && !this\.loaded && !this\.isLocked\(\)\) this\.loaded = this\.reload\(\)/);
  });
});

describe("the walkthrough", () => {
  it("makes a project and shows it first; signing in is an optional step where the library comes in", () => {
    const w = pkg.contributes.walkthroughs[0]!;
    expect(w.steps.map((s) => s.id)).toEqual(["newProject", "viewer", "signIn", "terminal"]);
    const step = w.steps.find((s) => s.id === "signIn")!;
    expect(step.when).toBeUndefined();
    expect(step.title).toBe("Use the Protoboard library (optional)");
    expect(w.description).toMatch(/No account needed/);
    for (const s of w.steps) expect(s.description, s.id).not.toMatch(/for now|needs a signed-in, invited account/);
    expect(src("media/walkthrough/sign-in.md")).not.toMatch(/unlocks|for now/);
    expect(src("src/extension.ts")).not.toContain("protoboard.signInOff");
  });
});
