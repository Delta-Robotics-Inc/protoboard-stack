/**
 * `protoboard parts import | fetch | models` (PB-1174, PB-1143): the CLI over
 * core's one model resolver (part-files.ts). All three are local except
 * `parts fetch` with a vendor source, which reaches the network only because
 * the user asked for that one part (no silent network anywhere else).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  fetchPartModel,
  importPartFile,
  loadProject,
  modelTable,
  packageRoot,
  readToolsRecord,
  recordDerived,
  restorePartFiles,
  runCapabilityOperation,
  type FetchOutcome,
  type FetchSource,
  type PartFileTerms,
  type Project,
} from "@protoboardai/core";

export interface PartFilesFlags {
  part?: string;
  board?: boolean;
  replace?: boolean;
  lcsc?: string;
  kicad?: string;
  link?: string;
  fileFormat?: string;
  terms?: string;
  offline?: boolean;
  convert?: boolean;
}

type Out = (data: unknown, text: () => string) => void;

/** The CAD runtime's Python: PROTOBOARD_PYTHON, else the project's `cad` runtime. */
function cadPython(root: string): string | undefined {
  if (process.env.PROTOBOARD_PYTHON) return process.env.PROTOBOARD_PYTHON;
  const rt = readToolsRecord(root).runtimes.cad;
  const f = rt ? join(root, rt.interpreter.path) : undefined;
  return f && existsSync(f) ? f : undefined;
}

function runPython(python: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const c = spawn(python, args, { stdio: ["ignore", "ignore", "pipe"], timeout: 10 * 60 * 1000 });
    let err = "";
    c.stderr!.setEncoding("utf8").on("data", (d: string) => (err += d));
    c.on("error", (e) => resolve({ ok: false, error: e.message }));
    c.on("close", (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split("\n").pop() || `exited with ${code}` }));
  });
}

/** STEP → GLB for a fetched vendor model (the viewer draws GLB), recorded as the entry's derived file. */
async function deriveGlb(p: Project, o: FetchOutcome): Promise<string | undefined> {
  if (!o.entry || o.entry.format !== "step" || !o.file) return undefined;
  const python = cadPython(p.root);
  const extParts = packageRoot(p.root, "@protoboardai/ext-parts");
  const script = extParts ? join(extParts, "scripts", "import_cad.py") : undefined;
  if (!python || !script || !existsSync(script)) return `no viewer mesh made: the CAD runtime (protoboard tools install cad, or PROTOBOARD_PYTHON) and @protoboardai/ext-parts are needed to turn the STEP into a GLB`;
  const glb = o.file.replace(/\.step$/i, ".glb");
  const r = await runPython(python, [script, "--convert", o.file, glb]);
  if (!r.ok) return `no viewer mesh made: ${r.error}`;
  recordDerived(p, o.part, o.entry.id, { format: "glb", path: o.entry.path!.replace(/\.step$/i, ".glb") });
  return `viewer mesh ${o.entry.path!.replace(/\.step$/i, ".glb")}`;
}

/** `parts import <file> --part <id>`: record the file, bind the module, then generate and export its body. */
export async function partsImport(cwd: string, rest: string[], flags: PartFilesFlags, out: Out): Promise<number> {
  const file = rest[0];
  if (!file || !flags.part) throw new Error("usage: protoboard parts import <file.step|.stp|.stl|.3mf> --part <module or part id> [--board] [--replace]");
  const p = await loadProject(cwd, { checks: false });
  const r = importPartFile(p, file, flags.part, { board: flags.board, replace: flags.replace });
  const ran: { operation: string; status: string; summary: string }[] = [];
  if (r.config) {
    // the binding is new: load again so the provider sees it, then run it (Python with build123d)
    const p2 = await loadProject(cwd, { checks: false });
    for (const op of ["generate", "export"]) {
      const rec = await runCapabilityOperation(p2, "cad", op, flags.part, {}, {});
      ran.push({ operation: `cad:${op}`, status: rec.status, summary: rec.summary });
      if (rec.status !== "succeeded") break;
    }
  }
  const failed = ran.some((x) => x.status !== "succeeded");
  out({ ...r, ran }, () =>
    [
      `${r.part}: ${r.entry.path} recorded as its body (imported, ${r.entry.format}, ${r.entry.sha256.slice(0, 19)}…) in ${r.sources}`,
      r.config ? `bound in ${r.config}: @protoboardai/ext-parts imports it (constraints.import), no script` : `kept ${r.keptConfig}: it already binds ${r.part} (pass --replace to bind the import instead)`,
      ...ran.map((x) => `  ${x.status.toUpperCase()} ${x.operation}: ${x.summary}`),
      ...(r.board
        ? [
            `board STEP mapped onto ${r.board.instance}: ${Object.keys(r.board.components).length} component node(s) matched (${Object.values(r.board.components).filter((c) => c.by === "designator").length} by designator, ${Object.values(r.board.components).filter((c) => c.by === "lcsc").length} by LCSC C-number); ${r.board.unmatchedNodes.length} node(s) and ${r.board.unmatchedInstances.length} instance(s) unmatched`,
            ...(r.board.unmatchedInstances.length ? [`  instances with no node: ${r.board.unmatchedInstances.slice(0, 12).join(", ")}${r.board.unmatchedInstances.length > 12 ? ", …" : ""}`] : []),
          ]
        : []),
      r.config && !ran.length ? `next: protoboard run cad:generate --module ${r.part}, then cad:export` : failed ? `fix the above, then: protoboard run cad:generate --module ${r.part}, then cad:export` : "next: protoboard build (the model table in .protoboard/build/resolved.json lists it)",
    ].join("\n"),
  );
  return failed ? 1 : 0;
}

const TERMS = new Set(["redistributable", "internal", "unknown"]);

/**
 * `parts fetch <part> --lcsc <C#> | --kicad <lib:name> | --link <url>`: one vendor model, fetched by
 * this machine (KiCad's installed library needs no network); `parts fetch [part]`: restore the files
 * parts/sources.json records that are not on this machine.
 */
export async function partsFetch(cwd: string, rest: string[], flags: PartFilesFlags, out: Out): Promise<number> {
  const p = await loadProject(cwd, { checks: false });
  const part = rest[0] ?? flags.part;
  const sources = [flags.lcsc && "lcsc", flags.kicad && "kicad", flags.link && "link"].filter(Boolean);
  if (sources.length > 1) throw new Error("give one source: --lcsc, --kicad or --link");
  let outcomes: FetchOutcome[];
  const notes: string[] = [];
  if (sources.length) {
    if (!part) throw new Error("usage: protoboard parts fetch <part> --lcsc <C-number> | --kicad <library:name> | --link <https url> [--file-format step] [--terms redistributable|internal|unknown]");
    if (flags.terms && !TERMS.has(flags.terms)) throw new Error(`--terms is redistributable, internal or unknown`);
    const source: FetchSource = flags.lcsc ? { type: "lcsc", id: flags.lcsc } : flags.kicad ? { type: "kicad", id: flags.kicad } : { type: "url", url: flags.link!, ...(flags.fileFormat ? { format: flags.fileFormat } : {}), ...(flags.terms ? { terms: { distribution: flags.terms } as PartFileTerms } : {}) };
    const o = await fetchPartModel(p, part, source, { offline: flags.offline });
    outcomes = [o];
    if (flags.convert !== false && (o.status === "fetched" || o.status === "copied")) {
      const d = await deriveGlb(p, o);
      if (d) notes.push(`${o.part}: ${d}`);
    }
  } else {
    outcomes = await restorePartFiles(p, { ...(part ? { part } : {}), offline: flags.offline });
  }
  const failed = outcomes.filter((o) => o.status === "failed" || o.status === "changed");
  out({ outcomes, notes }, () =>
    [
      ...(outcomes.length ? outcomes.map((o) => `${o.status.toUpperCase().padEnd(9)} ${o.message}${o.network ? "  (network)" : ""}`) : ["nothing recorded to fetch (parts/sources.json lists no vendor files)"]),
      ...notes,
      ...(outcomes.some((o) => o.entry) ? ["vendor files stay out of git (.gitignore: parts/files/**/model.*); parts/sources.json and the sidecars record the link, sha256 and terms"] : []),
    ].join("\n"),
  );
  return failed.length ? 1 : 0;
}

/** `parts models [instance]`: the resolver's model table (what `build` writes into resolved.json). */
export async function partsModels(cwd: string, rest: string[], out: Out): Promise<number> {
  const p = await loadProject(cwd, { checks: false });
  const t = modelTable(p);
  const rows = rest[0] ? t.instances.filter((e) => e.instance === rest[0] || e.instance.startsWith(`${rest[0]}/`)) : t.instances.filter((e) => !e.drawnBy);
  out({ ...t, instances: rows }, () =>
    [
      `${t.counts.instances} drawn bodies: ${t.counts.resolved} resolved, ${t.counts.placeholders} placeholder(s) (${t.counts.missing} with no model at any tier), ${t.counts.files} distinct files; ${t.counts.drawnByHolder} instance(s) drawn inside a holder's body`,
      ...rows.map((e) => `${e.placeholder ? "▲" : " "} ${e.instance.padEnd(36)} ${e.tier.padEnd(6)} ${e.source.padEnd(11)} ${e.drawnBy ? `in ${e.drawnBy}${e.node ? ` as ${e.node.name} (${e.node.by})` : ""}` : (e.file ?? "—")}`),
    ].join("\n"),
  );
  return 0;
}

