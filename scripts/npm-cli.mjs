/**
 * npm and npx for the build and release scripts, started without a shell on
 * every platform (PB-1047).
 *
 * On Windows npm is `npm.cmd`, and Node refuses to start a `.cmd` file
 * without a shell (EINVAL, since Node 20.12). A shell would read the
 * arguments as its own (spaces, `&`, `%`). So npm runs as what it is, a
 * JavaScript program: this Node (`process.execPath`) with npm's own
 * `npm-cli.js` (or `npx-cli.js`), found where npm itself says (npm_execpath,
 * set when npm runs a script) or where Node's installer puts it (beside
 * node.exe on Windows, `../lib/node_modules/npm` elsewhere).
 *
 * Only when that file is not there: plain `npm` elsewhere; on Windows
 * `npm.cmd` through cmd, each argument in double quotes, and an argument cmd
 * would still read as its own (a `"` or a `%`) refused.
 *
 *   import { npmCommand, runNpm } from "<repo>/scripts/npm-cli.mjs";
 *   runNpm(["pack", "--json"], { cwd, encoding: "utf8" });          // execFileSync's result
 *   const { command, args, shell } = npmCommand(["ci"]);              // to start it yourself
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";

/** npm's `<tool>-cli.js` for this Node, or undefined when it is not where npm and Node's installer put it. */
export function npmCliPath(tool = "npm", { env = process.env, execPath = process.execPath, platform = process.platform, exists = existsSync } = {}) {
  const path = platform === "win32" ? win32 : posix;
  const file = `${tool}-cli.js`;
  const candidates = [];
  // npm running a script says where it is (pnpm and yarn set npm_execpath to their own: not those)
  if (env.npm_execpath && /[\\/]npm-cli\.js$/i.test(env.npm_execpath)) candidates.push(path.join(path.dirname(env.npm_execpath), file));
  const dir = path.dirname(execPath);
  candidates.push(platform === "win32" ? path.join(dir, "node_modules", "npm", "bin", file) : path.join(dir, "..", "lib", "node_modules", "npm", "bin", file));
  return candidates.find((f) => exists(f));
}

/** One argument for cmd, in double quotes when it needs them; what cmd reads inside quotes anyway is refused. */
export function cmdArg(a) {
  if (/["%\r\n]/.test(a)) throw new Error(`npm: the argument ${JSON.stringify(a)} has a " or a % in it, which cmd would read as its own`);
  return /^[\w@+=:,./\\-]+$/.test(a) ? a : `"${a}"`;
}

/**
 * How to start `npm <args>` (or `npx <args>` with tool "npx") here: `{ command, args, shell }`, for
 * execFileSync, spawn or spawnSync. `shell` is true only for the Windows fallback.
 */
export function npmCommand(args, options = {}) {
  const tool = options.tool ?? "npm";
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;
  const cli = npmCliPath(tool, { ...options, platform, execPath });
  if (cli) return { command: execPath, args: [cli, ...args], shell: false };
  if (platform !== "win32") return { command: tool, args: [...args], shell: false };
  return { command: `${tool}.cmd`, args: args.map(cmdArg), shell: true };
}

/** execFileSync of `npm <args>` (options.tool "npx" for npx), started as npmCommand says. */
export function runNpm(args, options = {}) {
  const { tool, ...rest } = options;
  const c = npmCommand(args, tool ? { tool } : {});
  return execFileSync(c.command, c.args, { ...rest, shell: c.shell });
}
