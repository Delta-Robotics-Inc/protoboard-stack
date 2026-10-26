/**
 * Finding a Chromium-family browser (PB-943), with fake file systems: where
 * Chrome, Chromium, Edge and Brave are on Linux, macOS and Windows, that
 * `CHROME` wins, and what the `chrome` tool's probe (`protoboard:browser`)
 * says when there is one and when there is none.
 */
import { describe, expect, it } from "vitest";
import { BROWSER_PURPOSE, browserPaths, findBrowser, noBrowserMessage, probeTool, type BrowserLookup } from "../src/index.js";

const has =
  (...files: string[]) =>
  (p: string) =>
    files.includes(p);
const mac = (files: string[], env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" }): BrowserLookup => ({ platform: "darwin", home: "/Users/ada", env, exists: has(...files) });
const linux = (files: string[], env: NodeJS.ProcessEnv = { PATH: "/usr/local/bin:/usr/bin" }): BrowserLookup => ({ platform: "linux", home: "/home/ada", env, exists: has(...files) });
const win = (files: string[], env: NodeJS.ProcessEnv = {}): BrowserLookup => ({
  platform: "win32",
  home: "C:\\Users\\ada",
  env: { Path: "C:\\Windows\\system32", ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local", ...env },
  exists: has(...files),
});

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MAC_EDGE = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";

describe("macOS", () => {
  it("Chrome in /Applications (the name `google-chrome` does not exist there)", () => {
    expect(findBrowser(mac([MAC_CHROME]))).toEqual({ path: MAC_CHROME, name: "Google Chrome", from: "installed" });
  });
  it("Chrome first, then Chromium, Edge, Brave; a user's own Applications folder too", () => {
    expect(findBrowser(mac([MAC_EDGE, "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]))?.name).toBe("Microsoft Edge");
    expect(findBrowser(mac([MAC_EDGE, "/Applications/Chromium.app/Contents/MacOS/Chromium"]))?.name).toBe("Chromium");
    expect(findBrowser(mac(["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]))).toMatchObject({ name: "Brave" });
    expect(findBrowser(mac(["/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]))?.path).toBe("/Users/ada/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });
  it("a Homebrew chromium on PATH", () => {
    expect(findBrowser(mac(["/opt/homebrew/bin/chromium"], { PATH: "/opt/homebrew/bin:/usr/bin" }))).toEqual({ path: "/opt/homebrew/bin/chromium", name: "Chromium", from: "PATH" });
  });
  it("Safari and Firefox are not Chromium: nothing found", () => {
    expect(findBrowser(mac(["/Applications/Safari.app/Contents/MacOS/Safari", "/Applications/Firefox.app/Contents/MacOS/firefox"]))).toBeUndefined();
  });
});

describe("Linux", () => {
  it("google-chrome on PATH, as before", () => {
    expect(findBrowser(linux(["/usr/bin/google-chrome", "/usr/bin/chromium"]))).toEqual({ path: "/usr/bin/google-chrome", name: "Google Chrome", from: "PATH" });
  });
  it("chromium, chromium-browser, the snap, Edge, Brave", () => {
    expect(findBrowser(linux(["/usr/bin/chromium-browser"]))?.path).toBe("/usr/bin/chromium-browser");
    expect(findBrowser(linux(["/snap/bin/chromium"]))).toEqual({ path: "/snap/bin/chromium", name: "Chromium", from: "installed" });
    expect(findBrowser(linux(["/usr/bin/microsoft-edge-stable"]))?.name).toBe("Microsoft Edge");
    expect(findBrowser(linux(["/usr/bin/brave-browser"]))?.name).toBe("Brave");
    expect(findBrowser(linux(["/opt/google/chrome/chrome"], { PATH: "" }))?.path).toBe("/opt/google/chrome/chrome");
  });
});

describe("Windows", () => {
  it("Chrome under Program Files, either one, or the user's AppData", () => {
    expect(findBrowser(win(["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"]))).toEqual({ path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", name: "Google Chrome", from: "installed" });
    expect(findBrowser(win(["C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]))?.name).toBe("Google Chrome");
    expect(findBrowser(win(["C:\\Users\\ada\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"]))?.name).toBe("Google Chrome");
  });
  it("Edge, which every Windows has, when there is no Chrome; Brave", () => {
    expect(findBrowser(win(["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]))).toMatchObject({ name: "Microsoft Edge", from: "installed" });
    expect(findBrowser(win(["C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"]))?.name).toBe("Brave");
  });
  it("chrome.exe on Path", () => {
    expect(findBrowser(win(["D:\\tools\\chrome.exe"], { Path: "C:\\Windows;D:\\tools" }))).toEqual({ path: "D:\\tools\\chrome.exe", name: "Google Chrome", from: "PATH" });
  });
});

describe("CHROME wins", () => {
  it("over an installed browser, as a path or as a command name", () => {
    expect(findBrowser(mac([MAC_CHROME, MAC_EDGE], { CHROME: MAC_EDGE }))).toEqual({ path: MAC_EDGE, name: "CHROME", from: "CHROME" });
    expect(findBrowser(linux(["/usr/bin/google-chrome", "/usr/bin/chromium"], { PATH: "/usr/bin", CHROME: "chromium" }))).toEqual({ path: "/usr/bin/chromium", name: "CHROME", from: "CHROME" });
  });
  it("even when it names nothing: the user chose it, and running it says so", () => {
    expect(findBrowser(linux(["/usr/bin/google-chrome"], { PATH: "/usr/bin", CHROME: "/nope/chrome" }))?.path).toBe("/nope/chrome");
  });
  it("then CHROME_PATH and PUPPETEER_EXECUTABLE_PATH; an empty variable is not set", () => {
    expect(findBrowser(linux([], { CHROME: " ", CHROME_PATH: "/a/chrome", PUPPETEER_EXECUTABLE_PATH: "/b/chrome" }))?.from).toBe("CHROME_PATH");
    expect(findBrowser(linux([], { PUPPETEER_EXECUTABLE_PATH: "/b/chrome" }))?.path).toBe("/b/chrome");
  });
});

describe("no browser", () => {
  it("says why one is needed, where it was looked for and how to point at one, per platform", () => {
    expect(noBrowserMessage("darwin")).toBe(
      `no browser found. ${BROWSER_PURPOSE} None was found in /Applications and ~/Applications, and on PATH. Install one of them, or set CHROME to a browser's executable: export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`,
    );
    expect(BROWSER_PURPOSE).toBe("The datasheet, the assembly guide and the package documents are rendered to PDF with a headless Chromium-family browser (Google Chrome, Chromium, Microsoft Edge or Brave).");
    expect(noBrowserMessage("win32")).toContain('$env:CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
    expect(noBrowserMessage("linux")).toContain("export CHROME=/usr/bin/chromium");
  });
  it("every path listed is absolute for its platform", () => {
    expect(browserPaths(mac([])).every(([p]) => p.startsWith("/"))).toBe(true);
    expect(browserPaths(win([])).every(([p]) => /^C:\\/.test(p))).toBe(true);
    expect(browserPaths(linux([])).length).toBeGreaterThan(8);
  });
});

describe("the `chrome` tool's probe (protoboard:browser)", () => {
  const tool = { id: "chrome", purpose: "PDF", probe: ["protoboard:browser"] };
  it("runs the browser found and reports its version and where it is", () => {
    const ran: string[] = [];
    const r = probeTool(tool, { PATH: "/usr/bin" }, { browser: mac([MAC_CHROME]), exec: (c, a) => (ran.push([c, ...a].join(" ")), "Google Chrome 141.0.7390.55 \n") });
    expect(ran).toEqual([`${MAC_CHROME} --version`]);
    expect(r).toEqual({ available: true, detail: `Google Chrome 141.0.7390.55 (${MAC_CHROME})` });
  });
  it("none: the message says why a browser is needed and how to point at one", () => {
    const r = probeTool(tool, { PATH: "/usr/bin" }, { browser: mac([]), exec: () => "must not run" });
    expect(r).toEqual({ available: false, detail: noBrowserMessage("darwin") });
  });
  it("CHROME that names nothing: says so, and not that google-chrome was not found", () => {
    const r = probeTool(tool, { CHROME: "/nope/chrome" }, { browser: linux([], { CHROME: "/nope/chrome" }), exec: () => { throw Object.assign(new Error("spawnSync /nope/chrome ENOENT"), { code: "ENOENT" }); } });
    expect(r.available).toBe(false);
    expect(r.detail).toBe(`CHROME names /nope/chrome, which does not exist. ${BROWSER_PURPOSE} Set CHROME to a browser's executable.`);
  });
  it("Windows: a browser found is not run (chrome.exe --version opens a window there)", () => {
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const r = probeTool(tool, {}, { browser: win([edge]), exec: () => { throw new Error("must not run"); } });
    expect(r).toEqual({ available: true, detail: `Microsoft Edge at ${edge}` });
  });
  it("an unknown built-in probe is unavailable, with the ones there are", () => {
    expect(probeTool({ id: "x", purpose: "", probe: ["protoboard:teapot"] }).detail).toBe("unknown built-in probe protoboard:teapot (known: protoboard:browser)");
  });
  it("on this machine: whatever is found answers --version, or nothing is found", () => {
    const r = probeTool(tool);
    if (findBrowser()) expect(r.detail).toMatch(/\(.+\)$|names|found/);
    else expect(r).toEqual({ available: false, detail: noBrowserMessage() });
  });
});
