/**
 * The build and release scripts start npm, npx, tsx and vsce the same way on
 * every platform (PB-1047): as this Node with their JavaScript entry points
 * (scripts/npm-cli.mjs), never a `.cmd` file, which Node does not start on
 * Windows without a shell (EINVAL). And the extension packages for one
 * platform with `package.mjs --target`, which the release workflow uses on a
 * runner of each platform, win32-x64 on windows-latest.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cmdArg, npmCliPath, npmCommand, runNpm } from "../../../scripts/npm-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const on = (...files: string[]) => (f: string) => files.includes(f);

describe("scripts/npm-cli.mjs: npm without a shell", () => {
  it("Windows: this node.exe with the npm-cli.js beside it, no shell", () => {
    const execPath = "C:\\Program Files\\nodejs\\node.exe";
    const cli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    expect(npmCliPath("npm", { platform: "win32", execPath, env: {}, exists: on(cli) })).toBe(cli);
    expect(npmCommand(["pack", "--pack-destination", "C:\\a b\\tgz"], { platform: "win32", execPath, env: {}, exists: on(cli) })).toEqual({ command: execPath, args: [cli, "pack", "--pack-destination", "C:\\a b\\tgz"], shell: false });
    // npx too
    const npx = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
    expect(npmCommand(["--yes", "ovsx"], { tool: "npx", platform: "win32", execPath, env: {}, exists: on(npx) }).args[0]).toBe(npx);
  });

  it("npm running a script says where it is (npm_execpath); pnpm's or yarn's is not taken for npm's", () => {
    const cli = "/opt/npm/bin/npm-cli.js";
    expect(npmCliPath("npm", { platform: "linux", execPath: "/usr/bin/node", env: { npm_execpath: cli }, exists: on(cli) })).toBe(cli);
    expect(npmCliPath("npm", { platform: "linux", execPath: "/usr/bin/node", env: { npm_execpath: "/opt/pnpm/bin/pnpm.cjs" }, exists: on("/opt/pnpm/bin/npm-cli.js") })).toBeUndefined();
    expect(npmCliPath("npm", { platform: "linux", execPath: "/usr/local/bin/node", env: {}, exists: on("/usr/local/lib/node_modules/npm/bin/npm-cli.js") })).toBe("/usr/local/lib/node_modules/npm/bin/npm-cli.js");
  });

  it("without npm-cli.js: plain npm elsewhere; on Windows npm.cmd through cmd, each argument quoted, a \" or % refused", () => {
    expect(npmCommand(["ci"], { platform: "linux", execPath: "/x/node", env: {}, exists: () => false })).toEqual({ command: "npm", args: ["ci"], shell: false });
    expect(npmCommand(["pack", "C:\\a & b\\x"], { platform: "win32", execPath: "C:\\x\\node.exe", env: {}, exists: () => false })).toEqual({ command: "npm.cmd", args: ["pack", '"C:\\a & b\\x"'], shell: true });
    expect(() => cmdArg("100%")).toThrow(/" or a %/);
    expect(() => cmdArg('a"b')).toThrow(/" or a %/);
  });

  it("runs npm here", () => {
    expect(String(runNpm(["--version"], { encoding: "utf8" })).trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("no build or release script starts npm, npx, tsx or vsce by name, or a .cmd file", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${n}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(mjs|ts|js)$/.test(n)) files.push(rel);
      }
    };
    for (const d of ["scripts", ".github/scripts", "packages/vscode-protoboard/scripts"]) walk(d);
    expect(files).toContain("packages/vscode-protoboard/scripts/package.mjs");
    expect(files).toContain("packages/vscode-protoboard/scripts/build-stack.ts");
    const bad = /(execFileSync|execFile|spawnSync|spawn|execSync)\(\s*["'`](npm|npx|tsx|vsce)["'`]|["'`](npm|npx|tsx|vsce)\.cmd["'`]|node_modules["'`], ["'`]\.bin/;
    for (const f of files) if (f !== "scripts/npm-cli.mjs") expect(read(f), f).not.toMatch(bad);
  });
});

describe("package.mjs --target", () => {
  const pkg = join(ROOT, "packages/vscode-protoboard/scripts/package.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, [pkg, "--skip-shell", ...args], { cwd: dirname(pkg), encoding: "utf8", timeout: 60_000 });

  it("takes only a platform whose native stack the extension carries, and never with --no-stack or other --platforms (refused before anything is built)", () => {
    for (const [args, said] of [
      [["--target", "alpine-x64"], /--target alpine-x64: the extension carries a native stack for linux-x64, linux-arm64, darwin-arm64, darwin-x64, win32-x64, win32-arm64 only/],
      [["--target", "linux-x64", "--no-stack"], /--no-stack carries none/],
      [["--target", "win32-x64", "--platforms", "linux-x64"], /--target win32-x64 carries win32-x64's stack only/],
      [["--target"], /--target needs a value/],
    ] as const) {
      const r = run(...args);
      expect(r.status, args.join(" ")).not.toBe(0);
      expect(r.stderr, args.join(" ")).toMatch(said);
      expect(r.stdout, args.join(" ")).not.toMatch(/^\$ /m);
    }
  });

  it("bundles that platform's stack and passes --target to vsce package, into vscode-protoboard-<version>-<target>.vsix", () => {
    const s = read("packages/vscode-protoboard/scripts/package.mjs");
    expect(s).toContain('const platforms = target ?? option("--platforms");');
    expect(s).toContain('...(target ? ["--target", target] : [])');
    expect(s).toContain("`vscode-protoboard-${version}${target ? `-${target}` : \"\"}.vsix`");
    expect(s).toContain("console.log(`vsix: ${named}`);");
    // the targets are the platforms build-stack.ts carries
    const carried = /const DEFAULT_PLATFORMS = (\[[^\]]+\])/.exec(read("packages/vscode-protoboard/scripts/build-stack.ts"))![1]!;
    expect(/const TARGETS = (\[[^\]]+\])/.exec(s)![1]).toBe(carried);
  });
});

describe("release.yml: one .vsix per platform, each built and smoke-tested on its own runner", () => {
  const yml = read(".github/workflows/release.yml");
  it("win32-x64 on windows-latest with the smoke test", () => {
    expect(yml).toContain("- { target: win32-x64, runner: windows-latest, smoke: true }");
    expect(yml).not.toMatch(/target: win32-x64, runner: ubuntu/);
    for (const t of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) expect(yml, t).toMatch(new RegExp(`target: ${t}, runner: [\\w.-]+, smoke: true`));
  });

  it("packages with package.mjs --target, never a second vsce package", () => {
    expect(yml).toContain('node scripts/package.mjs --target "$TARGET"');
    const commands = yml.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    expect(commands).not.toMatch(/vsce package|--platforms "\$TARGET"/);
    expect(yml).toContain('*"vscode-protoboard-$version-$TARGET.vsix"');
  });

  it("the vsix job checks out the release tags and history: a manual run's dev version counts from the last tag", () => {
    const job = yml.slice(yml.indexOf("\n  vsix:"), yml.indexOf("\n  npm:"));
    expect(job).toMatch(/path: protoboard-stack\n\s+persist-credentials: false\n(\s+#.*\n)*\s+fetch-depth: 0\n/);
  });
});
