/**
 * `protoboard package write|read|verify` (PB-1195): `.uhdpkg` files, a part
 * revision envelope (unchanged) plus its files, zipped. No UHD change: see
 * docs/reference/uhdpkg.md.
 *
 *   protoboard package write <part-id | folder> [--out <file.uhdpkg>] [--exclude <path>]... [--allow-unpinned] [--created-at <iso>] [--stored]
 *   protoboard package read <file.uhdpkg> <folder>
 *   protoboard package verify <file.uhdpkg>
 *
 * `write` takes a part of the project it runs in (built offline as `parts
 * publish` would send it; a catalog part rebuilt from what `parts add`
 * vendored), or a folder holding `uhdpkg.json` (an unpacked package) or
 * `envelope.json` with the envelope's files. `read` unpacks into a new
 * folder after every check; `verify` checks without writing. `--json` (the
 * CLI's own flag) prints the result as JSON. Exit 0 when the package is
 * sound, 1 when a check fails.
 *
 * Flags come from `args` (for direct calls and tests) and from `flags` (the
 * CLI's parsed flags: meow takes `--exclude x` out of the positional input).
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProjectRoot } from "@protoboardai/core";
// the ./uhdpkg export of core (W4-D applied it: no longer the relative path)
import {
  UHDPKG_EXT,
  UhdpkgError,
  inputFromFolder,
  inputFromProjectPart,
  readPackage,
  verifyPackageFile,
  writePackage,
  type PackageInput,
  type PackageReport,
} from "@protoboardai/core/uhdpkg";

type Out = (data: unknown, text: () => string) => void;

export const PACKAGE_USAGE =
  "usage: protoboard package write <part-id | folder> [--out <file.uhdpkg>] [--exclude <path>]... [--allow-unpinned] [--created-at <iso>] [--stored] | read <file.uhdpkg> <folder> | verify <file.uhdpkg>";

/** Flags that take a value, so the word after them is not a positional. */
const VALUE_FLAGS = new Set(["out", "exclude", "created-at", "cwd", "format"]);

function argFlags(args: string[]): { positional: string[]; values: Map<string, string[]>; bools: Set<string> } {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = a.slice(2, eq < 0 ? undefined : eq);
    if (eq >= 0) values.set(name, [...(values.get(name) ?? []), a.slice(eq + 1)]);
    else if (VALUE_FLAGS.has(name) && i + 1 < args.length) values.set(name, [...(values.get(name) ?? []), args[++i]]);
    else bools.add(name);
  }
  return { positional, values, bools };
}

const asList = (v: unknown): string[] => (v === undefined || v === null || v === false ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);
const MiB = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MiB`;

/** The report as lines: entries with size, sha256 status, role and licence terms; then problems and warnings. */
export function formatReport(r: PackageReport, heading: string): string {
  const lines = [`${heading}: ${r.ok ? "OK" : "FAILED"}  ${r.partId ?? "?"}@${r.revision ?? "?"}  ${r.envelopeSchema ?? ""}  archive ${MiB(r.archiveBytes)}, files ${MiB(r.totalBytes)}`];
  if (r.envelopeDigest) lines.push(`  envelope ${r.envelopeDigest}`);
  for (const e of r.entries) {
    const terms = e.terms && typeof e.terms === "object" ? (e.terms as { distribution?: string; license?: string }) : undefined;
    const t = e.kind === "manifest" ? "" : terms ? `  terms ${terms.distribution ?? "?"}${terms.license ? ` ${terms.license}` : ""}` : e.kind === "derived" ? "" : "  terms unknown";
    const sha = e.status === "ok" ? "sha256 OK" : e.status === "unread" ? "not read" : e.status === "bad" ? `sha256 BAD (${e.problem ?? ""})` : e.status.toUpperCase();
    lines.push(`  ${e.kind.padEnd(9)} ${String(e.size).padStart(10)}  ${sha}  ${e.path}${e.role ? `  [${e.role}]` : ""}${t}`);
  }
  for (const p of r.problems) lines.push(`  ERROR   ${p.code}  ${p.message}`);
  for (const w of r.warnings) lines.push(`  WARNING ${w.code}  ${w.message}`);
  return lines.join("\n");
}

/** Run `protoboard package <sub> ...`; returns the exit code. */
export async function packageCommand(cwd: string, args: string[], out: Out, flags: Record<string, unknown> = {}): Promise<number> {
  const [sub, ...rest] = args;
  const { positional, values, bools } = argFlags(rest);
  const value = (name: string, camel: string): string | undefined => values.get(name)?.[0] ?? (typeof flags[camel] === "string" ? (flags[camel] as string) : undefined);
  switch (sub) {
    case "write": {
      const what = positional[0];
      if (!what) throw new Error(PACKAGE_USAGE);
      const exclude = [...(values.get("exclude") ?? []), ...asList(flags.exclude)];
      const allowUnpinned = bools.has("allow-unpinned") || flags.allowUnpinned === true;
      const stored = bools.has("stored") || flags.stored === true;
      const createdAt = value("created-at", "createdAt");
      if (createdAt !== undefined && Number.isNaN(Date.parse(createdAt))) throw new Error(`--created-at ${createdAt} is not a date`);
      const asFolder = resolve(cwd, what);
      const started = Date.now();
      let input: PackageInput;
      if (existsSync(asFolder) && statSync(asFolder).isDirectory()) {
        if (exclude.length) throw new Error("--exclude applies to a project part; a folder's envelope is packaged as it is");
        input = inputFromFolder(asFolder);
      } else {
        const root = findProjectRoot(cwd);
        if (!root) throw new Error(`${what} is not a folder, and this is not a Protoboard project (no protoboard.config.ts here or above) to find a part in`);
        input = await inputFromProjectPart(root, what, { exclude, allowUnpinned });
      }
      if (createdAt !== undefined) input.createdAt = createdAt;
      if (stored) input.method = "store";
      const env = input.envelope;
      // DEFAULT: <part-id>-r<revision>.uhdpkg in the working folder
      const file = resolve(cwd, value("out", "out") ?? join(cwd, `${env.partId}-r${env.revision}${UHDPKG_EXT}`));
      try {
        const built = writePackage(file, input);
        const ms = Date.now() - started;
        const total = built.entries.reduce((n, e) => n + e.size, 0);
        out(
          { ok: true, file: built.file, bytes: built.zip.length, files: built.entries.length, totalBytes: total, partId: env.partId, revision: env.revision, envelopeDigest: env.digest, provenance: input.provenance, ms },
          () =>
            [
              `wrote ${built.file}: ${env.partId}@${env.revision}, ${built.entries.length} file(s), ${MiB(total)} in, ${MiB(built.zip.length)} packed, ${ms} ms`,
              `  envelope ${env.digest}${input.provenance?.pinnedEnvelopeDigest ? ` (rebuilt; the project pins ${input.provenance.pinnedEnvelopeDigest})` : ""}`,
              ...env.missingArtifacts.map((m) => `  not carried: ${m.path} (${m.reason})`),
            ].join("\n"),
        );
        return 0;
      } catch (e) {
        if (e instanceof UhdpkgError) {
          out({ ok: false, code: e.code, message: e.message, problems: e.problems }, () => `package write failed: ${e.code}  ${e.message}`);
          return 1;
        }
        throw e;
      }
    }
    case "read": {
      const [file, target] = positional;
      if (!file || !target) throw new Error(PACKAGE_USAGE);
      const started = Date.now();
      try {
        const r = readPackage(resolve(cwd, file), resolve(cwd, target));
        const ms = Date.now() - started;
        out({ ...r, ms }, () => `${formatReport(r.report, `read ${file}`)}\n${r.target ? `unpacked ${r.written} file(s) into ${r.target}, ${ms} ms` : "nothing written"}`);
        return r.report.ok ? 0 : 1;
      } catch (e) {
        if (e instanceof UhdpkgError) {
          out({ ok: false, code: e.code, message: e.message }, () => `package read failed: ${e.code}  ${e.message}`);
          return 1;
        }
        throw e;
      }
    }
    case "verify": {
      const file = positional[0];
      if (!file) throw new Error(PACKAGE_USAGE);
      const started = Date.now();
      const r = verifyPackageFile(resolve(cwd, file));
      const ms = Date.now() - started;
      out({ ...r, ms }, () => `${formatReport(r, `verify ${file}`)}\n${ms} ms`);
      return r.ok ? 0 : 1;
    }
    default:
      throw new Error(PACKAGE_USAGE);
  }
}
