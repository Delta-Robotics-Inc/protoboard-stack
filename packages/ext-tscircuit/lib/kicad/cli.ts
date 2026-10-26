/**
 * kicad-cli (KiCad 10): found on PATH, at KiCad's usual install places, or
 * where PROTOBOARD_KICAD_CLI points. Every call is synchronous, has a timeout
 * and reports KiCad's own words when it fails.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const PLACES = [
  "/usr/bin/kicad-cli",
  "/usr/local/bin/kicad-cli",
  "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
  "C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe",
];

let found: string | null | undefined;

/** The kicad-cli to run, or undefined when KiCad is not installed. */
export function kicadCli(): string | undefined {
  if (found !== undefined) return found ?? undefined;
  const env = process.env.PROTOBOARD_KICAD_CLI;
  const candidates = [...(env ? [env] : []), "kicad-cli", ...PLACES];
  for (const c of candidates) {
    if (c !== "kicad-cli" && !existsSync(c)) continue;
    const r = spawnSync(c, ["version"], { encoding: "utf8", timeout: 20_000 });
    if (r.status === 0 && /\d+\.\d+/.test(r.stdout)) {
      found = c;
      return c;
    }
  }
  found = null;
  return undefined;
}

/** `kicad-cli version`, e.g. "10.0.6". */
export function kicadVersion(): string | undefined {
  const cli = kicadCli();
  if (!cli) return undefined;
  return spawnSync(cli, ["version"], { encoding: "utf8", timeout: 20_000 }).stdout.trim() || undefined;
}

export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run kicad-cli; throws when it is not installed. A non-zero exit is returned, not thrown (DRC exits 5 on violations with --exit-code-violations). */
export function runKicad(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): CliRun {
  const cli = kicadCli();
  if (!cli) throw new Error("kicad-cli (KiCad 10) is not installed or not on PATH; install KiCad 10, or set PROTOBOARD_KICAD_CLI to its kicad-cli");
  const r = spawnSync(cli, args, { encoding: "utf8", cwd: options.cwd, timeout: options.timeoutMs ?? 300_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`kicad-cli ${args.slice(0, 3).join(" ")}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run kicad-cli and throw with its output when it exits non-zero. */
export function mustKicad(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): CliRun {
  const r = runKicad(args, options);
  if (r.status !== 0) throw new Error(`kicad-cli ${args.slice(0, 3).join(" ")} failed (exit ${r.status}): ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
  return r;
}

/**
 * A GLB exported by kicad-cli in the stack's board frame: KiCad writes glTF's
 * own axes (metres, +Y up, (x, z, −y) of the board) with the board's bottom
 * face at height 0; the stack's frame puts the mid-plane there (layout.ts), so
 * one root node lowers everything by half the thickness. Nodes named by
 * designator are renamed by instance path (as the tscircuit board.glb names
 * them), and the export date is dropped so an unchanged board writes the same
 * file.
 */
export function reframeKicadGlb(glb: Buffer, thicknessMm: number, instanceOf: (ref: string) => string | undefined): Buffer {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const rest = glb.subarray(20 + jsonLength);
  for (const n of json.nodes ?? []) if (typeof n.name === "string" && instanceOf(n.name)) n.name = instanceOf(n.name);
  const scene = json.scenes[json.scene ?? 0];
  json.nodes.push({ name: "board", translation: [0, -thicknessMm / 2000, 0], children: scene.nodes });
  scene.nodes = [json.nodes.length - 1];
  if (json.asset?.extras) delete json.asset.extras.generated_at;
  json.asset = { ...json.asset, extras: { ...(json.asset?.extras ?? {}), frame: "glTF: metres, +Y up; board frame (mm, Z up) = (x, -z, y) × 1000, z = 0 on the mid-plane" } };
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += " ";
  const body = Buffer.from(text);
  const head = Buffer.alloc(20);
  head.write("glTF", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + body.length + rest.length, 8);
  head.writeUInt32LE(body.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([head, body, rest]);
}
