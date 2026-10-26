/**
 * Choosing the Python that creates a project's Python runtime (PB-943):
 * where Pythons are looked for on macOS, Linux and Windows (fake file
 * systems), how each is tested (fake interpreters), which one is used, what
 * is said when none works, and the install falling back to the next Python
 * when a venv cannot be made.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  FIRST_PROBE_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  PYTHON_PROBE,
  describeTried,
  formatPythonRange,
  installRuntimes,
  intersectPythonRanges,
  minorsOf,
  noPythonMessage,
  parsePythonRange,
  planRuntimes,
  probePython,
  probeTool,
  probeTools,
  pythonCandidates,
  pythonInRange,
  selectPython,
  validateRuntime,
  type LoadedExtension,
  type PythonExec,
  type PythonLookup,
  type PythonProbe,
} from "../src/index.js";

const CAD = parsePythonRange(">=3.11,<3.15")!;
const has =
  (...files: string[]) =>
  (p: string) =>
    files.includes(p);

/** Fake interpreters: command (with its arguments) → what the probe prints, or an Error. */
const interpreters =
  (table: Record<string, { version: string; failed?: Record<string, string>; executable?: string } | Error | string>): PythonExec =>
  async (command, args) => {
    expect(args.slice(-2)).toEqual(["-c", PYTHON_PROBE]);
    const key = [command, ...args.slice(0, -2)].join(" ");
    const r = table[key];
    if (r === undefined) throw new Error("not found");
    if (r instanceof Error) throw r;
    if (typeof r === "string") return r;
    return JSON.stringify({ version: r.version, executable: r.executable ?? key, failed: r.failed ?? {} });
  };

const PYEXPAT = { pyexpat: "ImportError: dlopen(pyexpat.cpython-313-darwin.so): Symbol not found: _XML_SetAllocTrackerActivationThreshold" };

describe("version ranges", () => {
  it("parses, intersects and formats", () => {
    expect(CAD).toEqual({ min: [3, 11], below: [3, 15] });
    expect(parsePythonRange(">=3.10")).toEqual({ min: [3, 10] });
    expect(parsePythonRange("3.12")).toBeUndefined();
    expect(parsePythonRange("^3.12")).toBeUndefined();
    expect(intersectPythonRanges([CAD, parsePythonRange(">=3.12,<3.14"), undefined])).toEqual({ min: [3, 12], below: [3, 14] });
    expect(formatPythonRange(CAD)).toBe("3.11 or later, before 3.15");
    expect(formatPythonRange({})).toBe("any version");
  });
  it("tests a version", () => {
    expect(["3.10.14", "3.11.0", "3.14.2", "3.15.0", "2.7.18", "junk"].map((v) => pythonInRange(v, CAD))).toEqual([false, true, true, false, false, false]);
    expect(pythonInRange("3.9.1", {})).toBe(true);
  });
  it("tries the minors with the most wheels first", () => {
    expect(minorsOf(CAD)).toEqual(["3.12", "3.13", "3.11", "3.14"]);
  });
});

describe("where Pythons are looked for", () => {
  const mac = (over: Partial<PythonLookup> = {}): PythonLookup => ({ platform: "darwin", home: "/Users/ada", env: { PATH: "/opt/homebrew/bin:/usr/bin:/bin" }, range: CAD, exists: () => false, list: () => [], ...over });

  it("macOS: --python, PATH, Homebrew, python.org, the system's, uv, pyenv, in that order", () => {
    const uv = "/Users/ada/.local/share/uv/python";
    const c = pythonCandidates(
      mac({
        explicit: "/custom/python3",
        exists: has(
          "/opt/homebrew/bin/python3",
          "/opt/homebrew/bin/python3.13",
          "/opt/homebrew/opt/python@3.13/bin/python3.13",
          "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12",
          "/usr/bin/python3",
          `${uv}/cpython-3.12.7-macos-aarch64-none/bin/python3.12`,
          `${uv}/cpython-3.12.11-macos-aarch64-none/bin/python3.12`,
          "/Users/ada/.pyenv/versions/3.11.9/bin/python",
        ),
        list: (d) => (d === uv ? ["cpython-3.12.7-macos-aarch64-none", "cpython-3.12.11-macos-aarch64-none", "cpython-3.9.20-macos-aarch64-none", ".gitignore"] : d === "/Users/ada/.pyenv/versions" ? ["3.11.9", "3.8.19"] : []),
      }),
    );
    expect(c.map((x) => `${x.command}${x.args.length ? ` ${x.args.join(" ")}` : ""} [${x.from}]`)).toEqual([
      "/custom/python3 [--python]",
      "python3 [PATH]",
      "python3.13 [PATH]",
      "/opt/homebrew/opt/python@3.13/bin/python3.13 [Homebrew]",
      "/opt/homebrew/bin/python3.13 [Homebrew]",
      "/opt/homebrew/bin/python3 [Homebrew]",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 [python.org]",
      "/usr/bin/python3 [Xcode Command Line Tools]",
      // the newest patch of a minor first; 3.9 is outside the range and is not listed
      `${uv}/cpython-3.12.11-macos-aarch64-none/bin/python3.12 [uv]`,
      `${uv}/cpython-3.12.7-macos-aarch64-none/bin/python3.12 [uv]`,
      "/Users/ada/.pyenv/versions/3.11.9/bin/python [pyenv]",
    ]);
  });

  it("macOS on Intel: Homebrew under /usr/local; a Dock-started app's PATH has no Homebrew, the paths are found anyway", () => {
    const c = pythonCandidates(mac({ env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, exists: has("/usr/bin/python3", "/usr/local/opt/python@3.12/bin/python3.12", "/usr/local/bin/python3") }));
    expect(c.map((x) => x.command)).toEqual(["python3", "/usr/local/opt/python@3.12/bin/python3.12", "/usr/local/bin/python3", "/usr/bin/python3"]);
  });

  it("uv's folder on macOS when it is under Application Support, and UV_PYTHON_INSTALL_DIR", () => {
    const lib = "/Users/ada/Library/Application Support/uv/python";
    expect(pythonCandidates(mac({ env: {}, exists: has(`${lib}/cpython-3.13.1-macos-aarch64-none/bin/python3.13`), list: (d) => (d === lib ? ["cpython-3.13.1-macos-aarch64-none"] : []) })).map((x) => x.command)).toEqual([`${lib}/cpython-3.13.1-macos-aarch64-none/bin/python3.13`]);
    expect(pythonCandidates(mac({ env: { UV_PYTHON_INSTALL_DIR: "/opt/uvpy" }, exists: has("/opt/uvpy/cpython-3.12.3-macos-aarch64-none/bin/python3.12"), list: (d) => (d === "/opt/uvpy" ? ["cpython-3.12.3-macos-aarch64-none"] : []) })).map((x) => x.from)).toEqual(["uv"]);
  });

  it("Linux: PATH names, then uv and pyenv", () => {
    const c = pythonCandidates({ platform: "linux", home: "/home/ada", env: { PATH: "/usr/local/bin:/usr/bin", PYENV_ROOT: "/opt/pyenv" }, range: CAD, exists: has("/usr/bin/python3", "/usr/bin/python3.12", "/opt/pyenv/versions/3.13.0/bin/python"), list: (d) => (d === "/opt/pyenv/versions" ? ["3.13.0"] : []) });
    expect(c.map((x) => `${x.command} [${x.from}]`)).toEqual(["python3 [PATH]", "python3.12 [PATH]", "/opt/pyenv/versions/3.13.0/bin/python [pyenv]"]);
  });

  it("Windows: python on Path, the py launcher by version, the per-user install", () => {
    const c = pythonCandidates({
      platform: "win32",
      home: "C:\\Users\\ada",
      env: { Path: "C:\\Windows\\system32;C:\\Windows", LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local" },
      range: CAD,
      exists: has("C:\\Windows\\py.exe", "C:\\Users\\ada\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"),
      list: () => [],
    });
    expect(c.map((x) => [x.command, ...x.args].join(" "))).toEqual(["py -3.12", "py -3.13", "py -3.11", "py -3.14", "C:\\Users\\ada\\AppData\\Local\\Programs\\Python\\Python312\\python.exe"]);
    expect(c[0].from).toBe("the py launcher");
  });

  it("nothing anywhere: no candidates", () => {
    expect(pythonCandidates(mac({ env: {} }))).toEqual([]);
  });
});

describe("testing a Python", () => {
  const c = { command: "python3", args: [], from: "PATH" };
  it("works: its version and executable", async () => {
    expect(await probePython(c, CAD, interpreters({ python3: { version: "3.12.7", executable: "/usr/bin/python3.12" } }))).toEqual({ ...c, ok: true, version: "3.12.7", executable: "/usr/bin/python3.12" });
  });
  it("Homebrew's on macOS 26.2: pyexpat does not import", async () => {
    const p = await probePython(c, CAD, interpreters({ python3: { version: "3.13.7", failed: PYEXPAT } }));
    expect(p.ok).toBe(false);
    expect(p.reason).toBe("cannot import pyexpat (ImportError: dlopen(pyexpat.cpython-313-darwin.so): Symbol not found: _XML_SetAllocTrackerActivationThreshold)");
  });
  it("Debian without python3-venv: ensurepip is missing", async () => {
    expect((await probePython(c, CAD, interpreters({ python3: { version: "3.12.3", failed: { ensurepip: "ModuleNotFoundError: No module named 'ensurepip'" } } }))).reason).toBe("cannot import ensurepip (ModuleNotFoundError: No module named 'ensurepip')");
  });
  it("a version the packages have no wheels for", async () => {
    expect((await probePython(c, CAD, interpreters({ python3: { version: "3.9.6" } }))).reason).toBe("Python 3.9.6; the packages need 3.11 or later, before 3.15");
    expect((await probePython(c, CAD, interpreters({ python3: { version: "3.15.0" } }))).ok).toBe(false);
  });
  it("not there, or not a Python 3", async () => {
    expect(await probePython(c, CAD, interpreters({}))).toEqual({ ...c, ok: false, reason: "not found" });
    expect((await probePython(c, CAD, interpreters({ python3: "Python 2.7.18" }))).reason).toBe("did not answer like a Python 3");
    expect((await probePython(c, CAD, interpreters({ python3: new Error('File "<string>", line 1: SyntaxError: invalid syntax') }))).reason).toContain("SyntaxError");
  });
  it("the probe is a script every Python 3 runs (the real one here, if there is one)", async () => {
    const p = await probePython({ command: process.platform === "win32" ? "python" : "python3", args: [], from: "PATH" }, {});
    if (p.reason === "not found") return;
    expect(p.version).toMatch(/^3\.\d+\.\d+$/);
    expect(p.executable).toBeTruthy();
  });
});

describe("choosing one", () => {
  const look = (files: string[], over: Partial<PythonLookup> = {}): PythonLookup => ({ platform: "darwin", home: "/Users/ada", env: { PATH: "/opt/homebrew/bin:/usr/bin" }, range: CAD, exists: has(...files), list: (d) => (d === "/Users/ada/.local/share/uv/python" ? ["cpython-3.12.11-macos-aarch64-none"] : []), ...over });
  const UV = "/Users/ada/.local/share/uv/python/cpython-3.12.11-macos-aarch64-none/bin/python3.12";
  /** A Mac where Homebrew's Pythons are broken, the system's too old, uv's fine. */
  const MAC = ["/opt/homebrew/bin/python3", "/opt/homebrew/bin/python3.13", "/usr/bin/python3", UV];
  const macExec = interpreters({
    python3: { version: "3.13.7", failed: PYEXPAT, executable: "/opt/homebrew/opt/python@3.13/bin/python3.13" },
    "python3.13": { version: "3.13.7", failed: PYEXPAT, executable: "/opt/homebrew/opt/python@3.13/bin/python3.13" },
    "/opt/homebrew/bin/python3.13": { version: "3.13.7", failed: PYEXPAT },
    "/opt/homebrew/bin/python3": { version: "3.13.7", failed: PYEXPAT },
    "/usr/bin/python3": { version: "3.9.6" },
    [UV]: { version: "3.12.11" },
  });

  it("skips the broken and the unsupported, and uses the first that works", async () => {
    const s = await selectPython(look(MAC), macExec);
    expect(s.working.map((p) => p.command)).toEqual([UV]);
    expect(s.tried.map((p) => `${p.command}: ${p.ok ? "works" : p.reason!.split(" (")[0]}`)).toEqual([
      "python3: cannot import pyexpat",
      "python3.13: cannot import pyexpat",
      "/opt/homebrew/bin/python3.13: cannot import pyexpat",
      "/opt/homebrew/bin/python3: cannot import pyexpat",
      "/usr/bin/python3: Python 3.9.6; the packages need 3.11 or later, before 3.15",
      `${UV}: works`,
    ]);
  });

  it("a --python that works is the only one used; one that does not is reported and the others are tried", async () => {
    const good = await selectPython(look(MAC, { explicit: UV }), macExec);
    expect(good.working.map((p) => p.from)).toEqual(["--python"]);
    expect(good.tried).toHaveLength(1);
    const bad = await selectPython(look(MAC, { explicit: "/opt/homebrew/bin/python3" }), macExec);
    expect(bad.tried[0]).toMatchObject({ from: "--python", ok: false });
    expect(bad.working.map((p) => p.command)).toEqual([UV]);
  });

  it("two names for one interpreter count once; every working one is kept as a fallback", async () => {
    const s = await selectPython(
      look(["/opt/homebrew/bin/python3", "/opt/homebrew/bin/python3.12", "/usr/bin/python3"], { list: () => [] }),
      interpreters({
        python3: { version: "3.12.7", executable: "/opt/homebrew/Cellar/python@3.12/3.12.7/bin/python3.12" },
        "python3.12": { version: "3.12.7", executable: "/opt/homebrew/Cellar/python@3.12/3.12.7/bin/python3.12" },
        "/opt/homebrew/bin/python3.12": { version: "3.12.7", executable: "/opt/homebrew/Cellar/python@3.12/3.12.7/bin/python3.12" },
        "/opt/homebrew/bin/python3": { version: "3.12.7", executable: "/opt/homebrew/Cellar/python@3.12/3.12.7/bin/python3.12" },
        "/usr/bin/python3": { version: "3.11.4", executable: "/Library/Developer/CommandLineTools/usr/bin/python3" },
      }),
    );
    expect(s.working.map((p) => p.command)).toEqual(["python3", "/usr/bin/python3"]);
  });

  it("none works on macOS: what was tried, why Homebrew's fails, and what to run", async () => {
    const s = await selectPython(look(MAC.slice(0, 3), { list: () => [] }), macExec);
    expect(s.working).toEqual([]);
    const m = noPythonMessage(s.tried, CAD, "darwin", "protoboard tools install cad");
    expect(m.split("\n")).toEqual([
      "no Python that can create this runtime was found (it needs Python 3.11 or later, before 3.15, with working venv, ensurepip, pyexpat, ssl and zlib modules).",
      "Tried:",
      "  python3 (PATH), Python 3.13.7: cannot import pyexpat (ImportError: dlopen(pyexpat.cpython-313-darwin.so): Symbol not found: _XML_SetAllocTrackerActivationThreshold)",
      "  python3.13 (PATH), Python 3.13.7: cannot import pyexpat (ImportError: dlopen(pyexpat.cpython-313-darwin.so): Symbol not found: _XML_SetAllocTrackerActivationThreshold)",
      "  /opt/homebrew/bin/python3.13 (Homebrew), Python 3.13.7: cannot import pyexpat (ImportError: dlopen(pyexpat.cpython-313-darwin.so): Symbol not found: _XML_SetAllocTrackerActivationThreshold)",
      "  /opt/homebrew/bin/python3 (Homebrew), Python 3.13.7: cannot import pyexpat (ImportError: dlopen(pyexpat.cpython-313-darwin.so): Symbol not found: _XML_SetAllocTrackerActivationThreshold)",
      "  /usr/bin/python3 (Xcode Command Line Tools), Python 3.9.6: Python 3.9.6; the packages need 3.11 or later, before 3.15",
      "Homebrew's Python on this macOS has a pyexpat that does not load (it is linked against a newer libexpat than the system's), so it cannot create a venv.",
      "Install a standalone Python and run the install again:",
      "  brew install uv && uv python install 3.12",
      "  protoboard tools install cad",
      "(uv's Pythons are found by themselves. The installer from https://www.python.org/downloads/macos/ works too; or name any working one with --python <path>.)",
    ]);
    expect(m).not.toMatch(/Traceback/);
  });

  it("none on Windows or Linux: that platform's commands", () => {
    const tried: PythonProbe[] = [];
    expect(noPythonMessage(tried, CAD, "win32", "protoboard tools install cad")).toContain("winget install Python.Python.3.12");
    expect(noPythonMessage(tried, CAD, "win32")).toContain("No Python was found on PATH or in the usual places.");
    expect(noPythonMessage(tried, CAD, "linux", "protoboard tools install cad")).toContain("sudo apt install python3 python3-venv");
    expect(describeTried([{ command: "py", args: ["-3.12"], from: "the py launcher", ok: false, reason: "not found" }])).toEqual(["  py -3.12 (the py launcher): not found"]);
  });
});

describe("protoboard tools install with fake Pythons", () => {
  const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-tools", "python-select");
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  const ext = (python?: string): LoadedExtension[] =>
    [
      { manifest: { id: "ext-a", tools: [{ id: "py", purpose: "py", probe: [process.execPath, "-e", "0"], runtime: { id: "cad", kind: "python", packages: [], env: "PROTOBOARD_PYTHON", ...(python ? { python } : {}) } }] } },
      { manifest: { id: "ext-b", tools: [{ id: "py", purpose: "py", probe: [process.execPath, "-e", "0"], runtime: { id: "cad", kind: "python", packages: [], env: "PROTOBOARD_PYTHON", python: ">=3.10,<3.14" } }] } },
    ] as unknown as LoadedExtension[];
  const probe = (command: string, ok: boolean, version: string, reason?: string): PythonProbe => ({ command, args: [], from: "PATH", ok, version, ...(reason ? { reason } : {}) });
  /** An exec that "creates" a venv for the commands allowed to, and answers pip and the version. */
  const fakeExec = (root: string, canVenv: string[], calls: string[]) => async (command: string, args: string[]) => {
    calls.push([command, ...args].join(" ").replace(root, "<root>"));
    if (args[0] === "-m" && args[1] === "venv") {
      // a failed attempt leaves a half-made folder behind, as the real one does
      mkdirSync(join(args[2], "bin"), { recursive: true });
      if (!canVenv.includes(command)) throw new Error(`${command} -m venv failed: Error: Command '[...ensurepip...]' returned non-zero exit status 1.`);
      writeFileSync(join(args[2], process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"), "");
      return "";
    }
    if (args.includes("list")) return "[]";
    return "3.12.11\n";
  };
  const fresh = (name: string) => {
    const root = join(TMP, name);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    return root;
  };

  it("the manifests' ranges are checked and intersected", () => {
    expect(planRuntimes(ext(">=3.11,<3.15"))[0].python).toEqual({ min: [3, 11], below: [3, 14] });
    expect(validateRuntime({ id: "py", purpose: "", probe: ["x"], runtime: { id: "cad", kind: "python", packages: [], python: "3.12" } })).toEqual(['tool py: runtime python must be a version range such as ">=3.11,<3.15" (python runtimes only)']);
    expect(validateRuntime({ id: "js", purpose: "", probe: ["x"], runtime: { id: "circuit", kind: "node", packages: [], python: ">=3.11" } })).toHaveLength(1);
    expect(validateRuntime({ id: "py", purpose: "", probe: ["x"], runtime: { id: "cad", kind: "python", packages: [], python: ">=3.11,<3.15" } })).toEqual([]);
  });

  it("creates the venv with the Python that works, and says which were refused", async () => {
    const root = fresh("works");
    const calls: string[] = [];
    const log: string[] = [];
    let asked: PythonLookup | undefined;
    const [r] = await installRuntimes(root, ext(">=3.11,<3.15"), ["cad"], {
      exec: fakeExec(root, ["/uv/python3.12"], calls),
      log: (l) => log.push(l),
      selectPython: async (look) => {
        asked = look;
        const tried = [probe("python3", false, "3.13.7", "cannot import pyexpat (ImportError: Symbol not found)"), probe("/uv/python3.12", true, "3.12.11")];
        return { tried, working: tried.filter((p) => p.ok) };
      },
    });
    expect(asked).toEqual({ range: { min: [3, 11], below: [3, 14] } });
    expect(r.status).toBe("installed");
    expect(calls[0]).toBe("/uv/python3.12 -m venv <root>/.protoboard/tools/cad");
    // then the tools it provides are probed: a first run, said as one
    expect(log[2]).toBe("cad: py: first run of the cad runtime here; loading it for the first time can take a minute (later runs take seconds)");
    expect(log.slice(0, 2)).toEqual([
      "cad: Pythons that cannot create this runtime:\n  python3 (PATH), Python 3.13.7: cannot import pyexpat (ImportError: Symbol not found)",
      "cad: creating a Python venv with /uv/python3.12 (PATH, Python 3.12.11; the packages need 3.11 or later, before 3.14)",
    ]);
  });

  it("--python reaches the selection", async () => {
    const root = fresh("explicit");
    let asked: PythonLookup | undefined;
    await installRuntimes(root, ext(), ["cad"], { python: "/my/python", exec: fakeExec(root, ["/my/python"], []), selectPython: async (look) => ((asked = look), { tried: [probe("/my/python", true, "3.12.1")], working: [probe("/my/python", true, "3.12.1")] }) });
    expect(asked?.explicit).toBe("/my/python");
  });

  it("a Python that passes the checks but cannot make the venv: the next one is used, and nothing half-made is left", async () => {
    const root = fresh("fallback");
    const calls: string[] = [];
    const log: string[] = [];
    const working = [probe("python3", true, "3.13.7"), probe("/uv/python3.12", true, "3.12.11")];
    const [r] = await installRuntimes(root, ext(), ["cad"], { exec: fakeExec(root, ["/uv/python3.12"], calls), log: (l) => log.push(l), selectPython: async () => ({ tried: working, working }) });
    expect(r.status).toBe("installed");
    expect(calls.filter((c) => c.includes("-m venv"))).toEqual(["python3 -m venv <root>/.protoboard/tools/cad", "/uv/python3.12 -m venv <root>/.protoboard/tools/cad"]);
    expect(log[1]).toMatch(/^cad: creating the venv with python3 \(Python 3\.13\.7\) failed \(.*ensurepip.*\); trying the next Python$/);
  });

  it("the pins do not install with a Python (no wheel for it): the venv is removed and a Python of another minor version is used", async () => {
    const root = fresh("nowheel");
    const calls: string[] = [];
    const log: string[] = [];
    const pinned = [{ manifest: { id: "ext-a", tools: [{ id: "py", purpose: "py", probe: [process.execPath, "-e", "0"], runtime: { id: "cad", kind: "python", packages: ["build123d==0.13.0"], env: "PROTOBOARD_PYTHON" } }] } }] as unknown as LoadedExtension[];
    // python3 is 3.14 (no wheels yet), python3.14 is the same minor (skipped), python3.12 has them
    const working = [probe("python3", true, "3.14.7"), probe("python3.14", true, "3.14.7"), probe("python3.12", true, "3.12.10")];
    let made = "";
    const base = fakeExec(root, ["python3", "python3.14", "python3.12"], calls);
    const exec = async (command: string, args: string[]) => {
      if (args[1] === "venv") made = command;
      if (args.includes("install")) {
        calls.push(`pip install with ${made}`);
        if (made !== "python3.12") throw new Error("pip install failed: ERROR: No matching distribution found for cadquery-ocp-novtk<8.1,>=8.0");
        return "";
      }
      if (args.includes("list")) return JSON.stringify([{ name: "build123d", version: "0.13.0" }]);
      return base(command, args);
    };
    const [r] = await installRuntimes(root, pinned, ["cad"], { exec, log: (l) => log.push(l), selectPython: async () => ({ tried: working, working }) });
    expect(r.status).toBe("installed");
    expect(calls.filter((c) => c.includes("-m venv") || c.startsWith("pip"))).toEqual(["python3 -m venv <root>/.protoboard/tools/cad", "pip install with python3", "python3.12 -m venv <root>/.protoboard/tools/cad", "pip install with python3.12"]);
    expect(log.find((l) => l.includes("installing the packages"))).toMatch(/^cad: installing the packages with python3 \(Python 3\.14\.7\) failed \(.*No matching distribution.*\); trying the next Python$/);
  });

  it("none works: the install fails with what to run, not a traceback, and creates nothing", async () => {
    const root = fresh("none");
    const calls: string[] = [];
    const tried = [probe("python3", false, "3.13.7", "cannot import pyexpat (ImportError: Symbol not found)")];
    const [r] = await installRuntimes(root, ext(), ["cad"], { exec: fakeExec(root, [], calls), selectPython: async () => ({ tried, working: [] }) });
    expect(r.status).toBe("failed");
    expect(r.message).toContain("no Python that can create this runtime was found");
    expect(r.message).toContain("protoboard tools install cad");
    expect(calls).toEqual([]);
    expect(existsSync(join(root, ".protoboard", "tools", "cad"))).toBe(false);
  });

  it("every working one fails to make the venv: each failure is listed", async () => {
    const root = fresh("allfail");
    const working = [probe("python3", true, "3.13.7")];
    const [r] = await installRuntimes(root, ext(), ["cad"], { exec: fakeExec(root, [], []), selectPython: async () => ({ tried: working, working }) });
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/Also tried:\n {2}python3 \(PATH\), Python 3\.13\.7: passed the checks, but creating the venv failed: /);
    expect(existsSync(join(root, ".protoboard", "tools", "cad"))).toBe(false);
  });

  it("an existing venv is kept: no Python is looked for", async () => {
    const root = fresh("existing");
    const py = join(root, ".protoboard", "tools", "cad", process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python");
    mkdirSync(dirname(py), { recursive: true });
    writeFileSync(py, "");
    const [r] = await installRuntimes(root, ext(), ["cad"], { exec: fakeExec(root, [], []), selectPython: async () => Promise.reject(new Error("must not look")) });
    expect(r.status).toBe("installed");
  });
});

describe("a probe's time limit (a runtime's first import is slow)", () => {
  const TMP = join(fileURLToPath(new URL(".", import.meta.url)), ".tmp-tools", "probe-first");
  afterAll(() => rmSync(TMP, { recursive: true, force: true }));
  const cad = { id: "python-build123d", purpose: "CAD", probe: ["python", "-c", "import build123d"], runtime: { id: "cad", kind: "python" as const, packages: [], env: "PROTOBOARD_PYTHON" } };
  const plain = { id: "chrome", purpose: "PDF", probe: ["chrome", "--version"] };
  const timedOut = () => {
    throw Object.assign(new Error("spawnSync python ETIMEDOUT"), { code: "ETIMEDOUT" });
  };

  it("the first probe of a runtime's tool gets the long limit and says so; once it has passed, the normal one", () => {
    const root = join(TMP, "first");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const limits: number[] = [];
    const said: string[] = [];
    const exec = (_c: string, _a: string[], o: { timeout: number }) => (limits.push(o.timeout), "0.13.0\n");
    const env = { PROTOBOARD_PYTHON: "/p/.protoboard/tools/cad/bin/python" };
    expect(probeTool(cad, env, { root, exec, log: (l) => said.push(l) })).toMatchObject({ available: true, detail: "0.13.0", firstRun: true });
    expect(probeTool(cad, env, { root, exec, log: (l) => said.push(l) })).not.toHaveProperty("firstRun");
    expect(limits).toEqual([FIRST_PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS]);
    expect(said).toEqual(["python-build123d: first run of the cad runtime here; loading it for the first time can take a minute (later runs take seconds)"]);
    expect(existsSync(join(root, ".protoboard", "local", "probed.json"))).toBe(true);
    // another interpreter (the variable changed) is a first run again
    probeTool(cad, { PROTOBOARD_PYTHON: "/other/python" }, { root, exec });
    expect(limits[2]).toBe(FIRST_PROBE_TIMEOUT_MS);
  });

  it("a tool without a runtime keeps the normal limit; a failed first probe stays a first probe", () => {
    const root = join(TMP, "plain");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const limits: number[] = [];
    probeTool(plain, {}, { root, exec: (_c, _a, o) => (limits.push(o.timeout), "Chrome 140") });
    const fail = (_c: string, _a: string[], o: { timeout: number }): string => {
      limits.push(o.timeout);
      throw Object.assign(new Error("exit 1"), { stderr: "ModuleNotFoundError: No module named 'build123d'" });
    };
    expect(probeTool(cad, {}, { root, exec: fail })).toMatchObject({ available: false, detail: "ModuleNotFoundError: No module named 'build123d'" });
    probeTool(cad, {}, { root, exec: fail });
    expect(limits).toEqual([PROBE_TIMEOUT_MS, FIRST_PROBE_TIMEOUT_MS, FIRST_PROBE_TIMEOUT_MS]);
  });

  it("no answer in time: says how long it waited and what to do, not ETIMEDOUT", () => {
    const first = probeTool(cad, {}, { exec: timedOut });
    expect(first.detail).toBe("no answer after 180 s on its first run (loading a runtime for the first time is slow; run the command again, and if it still gives no answer the runtime is broken: protoboard tools install cad --clean)");
    expect(probeTool(plain, {}, { exec: timedOut }).detail).toBe("no answer after 20 s");
  });

  it("a real slow command is stopped at the limit", () => {
    const slow = { ...cad, probe: [process.execPath, "-e", "setTimeout(() => {}, 5000)"] };
    const r = probeTool(slow, {}, { firstTimeoutMs: 300 });
    expect(r.available).toBe(false);
    expect(r.detail).toMatch(/^no answer after 0 s on its first run/);
  });

  it("doctor's list says when a first run was slow", () => {
    const root = join(TMP, "note");
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    const slow = { ...cad, probe: [process.execPath, "-e", "setTimeout(() => console.log('ok'), 5200)"] };
    const [status] = probeTools([{ manifest: { id: "ext-a", tools: [slow] } }] as unknown as LoadedExtension[], { root });
    expect(status).toMatchObject({ available: true, note: "first run took 5 s; later runs are faster" });
    const [again] = probeTools([{ manifest: { id: "ext-a", tools: [{ ...slow, probe: slow.probe }] } }] as unknown as LoadedExtension[], { root });
    expect(again.note).toBeUndefined();
  });
});
