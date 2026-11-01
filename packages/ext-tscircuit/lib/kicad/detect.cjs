// Finding kicad-cli (PB-1182): the one detection routine, shared by cli.ts
// (the provider's operations) and probe.cjs (the tool probe `protoboard doctor`
// runs). CommonJS so the probe can require it from `node -e` without a
// TypeScript loader; cli.ts imports it as ESM (types in detect.d.cts).
//
// Order:
//   1. PROTOBOARD_KICAD_CLI, when set. It is the user's choice: when it does
//      not answer a version (or is older than KiCad 10) nothing else is tried,
//      so a broken override is reported instead of silently replaced.
//   2. kicad-cli on PATH (each PATH folder; on Windows kicad-cli.exe).
//   3. KiCad's install folders, matched by pattern so any version is found:
//      Windows  <ProgramFiles>\KiCad\<major>.<minor>\bin\kicad-cli.exe and the
//               per-user <LOCALAPPDATA>\Programs\KiCad\<major>.<minor>\bin,
//               newest version first (10.99 nightlies included; DEFAULT: the
//               newest wins, so a nightly beside a stable 10.0 is chosen);
//      macOS    /Applications/KiCad*/KiCad*.app/Contents/MacOS/kicad-cli (and
//               ~/Applications), named versions newest first;
//      Linux    /usr/bin, /usr/local/bin, the nightly PPA's /usr/lib/kicad-nightly/bin.
// Each candidate that exists is asked `kicad-cli version` (then `--version`)
// until one answers KiCad 10 or newer. KiCad 11 drops the SWIG Python
// bindings and the bundled Python, not kicad-cli, so 11 is accepted; nothing
// here uses Python. There is no project-config setting for the path (none
// exists in protoboard.config.ts or circuit.config.ts); the variable is the
// override.

const MIN_MAJOR = 10;
const ENV = "PROTOBOARD_KICAD_CLI";

/** "10.0.8", "10.99.0-1234-gabc", "11.0.0-rc1" -> parts; undefined when it is not a version. */
function parseVersion(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /\d+\.\d+/.test(l));
  if (!line) return undefined;
  const m = /(\d+)\.(\d+)(?:\.(\d+))?(?:[-+~][\w.+~-]*)?/.exec(line);
  if (!m) return undefined;
  return { version: m[0], major: Number(m[1]), minor: Number(m[2]), patch: m[3] === undefined ? 0 : Number(m[3]) };
}

function defaultDeps() {
  const fs = require("node:fs");
  const os = require("node:os");
  const { spawnSync } = require("node:child_process");
  return {
    env: process.env,
    platform: process.platform,
    home: os.homedir(),
    exists: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    readdir: (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
    run: (file, args) => {
      const r = spawnSync(file, args, { encoding: "utf8", timeout: 20000, windowsHide: true });
      return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || (r.error ? r.error.message : "") };
    },
  };
}

/** An environment variable, case-insensitively on Windows (PATH is "Path" there). */
function envGet(env, name, win) {
  if (env[name] !== undefined) return env[name];
  if (!win) return undefined;
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

const byVersionDesc = (a, b) => b.major - a.major || b.minor - a.minor;

/** Version folders under a KiCad folder ("10.0", "10.99", "11.0"), newest first. */
function versionDirs(deps, dir) {
  return deps
    .readdir(dir)
    .map((name) => {
      const m = /^(\d+)\.(\d+)/.exec(name);
      return m ? { name, major: Number(m[1]), minor: Number(m[2]) } : undefined;
    })
    .filter(Boolean)
    .sort(byVersionDesc);
}

/** Every place to look after the override, in order, with where it came from. */
function candidates(overrides) {
  const deps = { ...defaultDeps(), ...(overrides || {}) };
  const win = deps.platform === "win32";
  const path = win ? require("node:path").win32 : require("node:path").posix;
  const out = [];
  const seen = new Set();
  const add = (file, source) => {
    const key = win ? file.toLowerCase() : file;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: file, source });
  };

  for (const dir of (envGet(deps.env, "PATH", win) || "").split(win ? ";" : ":")) {
    const d = dir.trim().replace(/^"(.*)"$/, "$1");
    if (d) add(path.join(d, win ? "kicad-cli.exe" : "kicad-cli"), "path");
  }

  if (win) {
    const roots = [envGet(deps.env, "ProgramW6432", win), envGet(deps.env, "ProgramFiles", win), "C:\\Program Files"].filter(Boolean).map((r) => path.join(r, "KiCad"));
    const local = envGet(deps.env, "LOCALAPPDATA", win);
    if (local) roots.push(path.join(local, "Programs", "KiCad"));
    const found = [];
    const rootSeen = new Set();
    for (const root of roots) {
      if (rootSeen.has(root.toLowerCase())) continue;
      rootSeen.add(root.toLowerCase());
      for (const v of versionDirs(deps, root)) found.push({ ...v, file: path.join(root, v.name, "bin", "kicad-cli.exe") });
    }
    for (const f of found.sort(byVersionDesc)) add(f.file, "install");
  } else if (deps.platform === "darwin") {
    const found = [];
    for (const apps of ["/Applications", deps.home ? path.join(deps.home, "Applications") : undefined].filter(Boolean)) {
      for (const entry of deps.readdir(apps).filter((n) => /^kicad/i.test(n))) {
        const bundles = /\.app$/i.test(entry)
          ? [path.join(apps, entry)]
          : deps
              .readdir(path.join(apps, entry))
              .filter((n) => /^kicad.*\.app$/i.test(n))
              .map((n) => path.join(apps, entry, n));
        for (const b of bundles) {
          const m = /(\d+)(?:\.(\d+))?/.exec(b.slice(apps.length));
          found.push({ file: path.join(b, "Contents", "MacOS", "kicad-cli"), major: m ? Number(m[1]) : -1, minor: m && m[2] ? Number(m[2]) : 0 });
        }
      }
    }
    // named versions newest first; among the unnamed, the plain /Applications/KiCad/KiCad.app first (as before)
    found.sort((a, b) => byVersionDesc(a, b) || a.file.length - b.file.length);
    for (const f of found) add(f.file, "install");
  } else {
    for (const f of ["/usr/bin/kicad-cli", "/usr/local/bin/kicad-cli", "/usr/lib/kicad-nightly/bin/kicad-cli"]) add(f, "install");
  }
  return out;
}

/** Ask one kicad-cli its version: `version`, else `--version`. */
function askVersion(deps, file) {
  let last = "";
  for (const args of [["version"], ["--version"]]) {
    let r;
    try {
      r = deps.run(file, args);
    } catch (e) {
      last = e && e.message ? e.message : String(e);
      continue;
    }
    const v = r && r.status === 0 ? parseVersion(r.stdout) : undefined;
    if (v) return { v };
    const said = r ? String(r.stderr || r.stdout || "").trim().split(/\r?\n/).pop() : "";
    last = said || `exit ${r ? r.status : "?"}`;
  }
  return { why: `no version answered (${last})` };
}

/**
 * Find kicad-cli. Returns `{ cli, tried, reason }`: `cli` is `{ path, version,
 * major, minor, source, nightly }` or undefined (then `reason` says why);
 * `tried` lists each candidate that existed and was turned down.
 */
function findKicadCli(overrides) {
  const deps = { ...defaultDeps(), ...(overrides || {}) };
  const win = deps.platform === "win32";
  const tried = [];
  const accept = (file, source) => {
    const a = askVersion(deps, file);
    if (!a.v) {
      tried.push({ path: file, source, why: a.why });
      return undefined;
    }
    if (a.v.major < MIN_MAJOR) {
      tried.push({ path: file, source, why: `KiCad ${a.v.version} is older than KiCad ${MIN_MAJOR}` });
      return undefined;
    }
    return { path: file, version: a.v.version, major: a.v.major, minor: a.v.minor, source, nightly: a.v.minor >= 99 };
  };

  const override = (envGet(deps.env, ENV, win) || "").trim();
  if (override) {
    // a bare command name ("kicad-cli") is left to the OS to find; a path must exist
    const bare = !/[\\/]/.test(override);
    const cli = bare || deps.exists(override) ? accept(override, "override") : undefined;
    if (cli) return { cli, tried, reason: undefined };
    if (!tried.length) tried.push({ path: override, source: "override", why: "no such file" });
    return { cli: undefined, tried, reason: `${ENV} is set to ${override}, which is not a usable kicad-cli (${tried[tried.length - 1].why}); fix or unset it` };
  }

  for (const c of candidates(deps)) {
    if (!deps.exists(c.path)) continue;
    const cli = accept(c.path, c.source);
    if (cli) return { cli, tried, reason: undefined };
  }
  const old = tried.find((t) => /older than/.test(t.why));
  return {
    cli: undefined,
    tried,
    reason: old
      ? `only ${old.why.replace(/ is older.*/, "")} was found (${old.path}); install KiCad ${MIN_MAJOR} or newer, or set ${ENV} to its kicad-cli`
      : `kicad-cli not found on PATH or in KiCad's install folders; install KiCad ${MIN_MAJOR} or newer (kicad.org/download), or set ${ENV} to its kicad-cli`,
  };
}

/** One line for the probe and `protoboard doctor`. */
function describeKicadCli(cli) {
  const where = cli.source === "override" ? `from ${ENV}` : cli.source === "path" ? "found on PATH" : "found in KiCad's install folder";
  const notes = [];
  if (cli.nightly) notes.push("a nightly build");
  else if (cli.major > MIN_MAJOR) notes.push(`newer than the KiCad ${MIN_MAJOR} this provider is tested with`);
  return `kicad-cli ${cli.version} at ${cli.path} (${where}${notes.length ? `; ${notes.join("; ")}` : ""})`;
}

let cached;
/** findKicadCli for this process, run once (the result, found or not, is kept). */
function kicadCliCached() {
  if (!cached) cached = findKicadCli();
  return cached;
}
/** Forget the cached result (tests, or a long-running process after KiCad was installed). */
function resetKicadCliCache() {
  cached = undefined;
}

module.exports = { MIN_MAJOR, ENV, parseVersion, candidates, findKicadCli, describeKicadCli, kicadCliCached, resetKicadCliCache };
