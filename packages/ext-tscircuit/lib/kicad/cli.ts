/**
 * kicad-cli (KiCad 10 or newer): found by detect.cjs, the one search shared
 * with the tool probe (probe.cjs): PROTOBOARD_KICAD_CLI, then PATH, then
 * KiCad's install folders for any version (newest first). The version is
 * asked once per process and kept. Every call is synchronous, has a timeout
 * and reports KiCad's own words when it fails. Only kicad-cli subcommands are
 * used: no SWIG bindings, no Python (KiCad 11 removes those, not kicad-cli).
 */
import { spawnSync } from "node:child_process";
import { describeKicadCli, kicadCliCached, type KicadCli } from "./detect.cjs";

export type { KicadCli, KicadCliSearch, KicadCliSource } from "./detect.cjs";
// resetKicadCliCache: look again (after KiCad was installed or PROTOBOARD_KICAD_CLI changed, in a long-running process)
export { describeKicadCli, findKicadCli, resetKicadCliCache } from "./detect.cjs";

/** The kicad-cli in use, `{ path, version, major, minor, source, nightly }`, or undefined when there is none. */
export function kicadCliInfo(): KicadCli | undefined {
  return kicadCliCached().cli;
}

/** Why there is no kicad-cli (undefined when there is one). */
export function kicadCliMissing(): string | undefined {
  return kicadCliCached().reason;
}

/** One line: the version, the path and where it was found; or why there is none. */
export function kicadCliSummary(): string {
  const r = kicadCliCached();
  return r.cli ? describeKicadCli(r.cli) : (r.reason ?? "kicad-cli not found");
}

/** The kicad-cli to run, or undefined when KiCad (10 or newer) is not installed. */
export function kicadCli(): string | undefined {
  return kicadCliInfo()?.path;
}

/** `kicad-cli version` as it answered, e.g. "10.0.6" (asked once, when kicad-cli was found). */
export function kicadVersion(): string | undefined {
  return kicadCliInfo()?.version;
}

export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run kicad-cli; throws when it is not installed. A non-zero exit is returned, not thrown (DRC exits 5 on violations with --exit-code-violations). */
export function runKicad(args: string[], options: { cwd?: string; timeoutMs?: number } = {}): CliRun {
  const cli = kicadCli();
  if (!cli) throw new Error(kicadCliMissing() ?? "kicad-cli (KiCad 10 or newer) not found; install KiCad, or set PROTOBOARD_KICAD_CLI to its kicad-cli");
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
