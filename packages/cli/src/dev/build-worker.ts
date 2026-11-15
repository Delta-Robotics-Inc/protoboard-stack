/**
 * One `protoboard dev` build, in a process of its own: load the project (every
 * validator that can run), write the UHD bundle atomically, and print one JSON
 * line describing the result. Next to the bundle it writes where each
 * definition and instance is declared (`sources.json`, ./sources.ts), for
 * the viewer's openSource, and the project index (`atlas.json`, the Atlas
 * view's data; docs/specs/atlas.md), whose failure never fails the build.
 * A fresh process per build means every project
 * source is evaluated again; the dev server's own module cache never holds a
 * stale definition.
 *
 *   node --import <tsx> build-worker.ts <project root> <bundle file>
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { definitionTrust, loadProject, resolveViews, stableStringify, uhdBundle, writeAtlasIndex, type PartTrust, type ResolvedView } from "@protoboardai/core";
import { SOURCES_FILE, sourceIndex } from "./sources.js";

export interface BuildReport {
  ok: boolean;
  /** Milliseconds spent loading, checking and writing. */
  ms: number;
  error?: string;
  bytes?: number;
  counts?: { error: number; warning: number; info: number };
  /** What the dev server watches, from the project's configuration. */
  watch?: { display: string; sources: string[]; catalog: string; scenarios?: string };
  /** Views the project's extensions contribute (`contributes.views`), for the web viewer's tabs. */
  views?: ResolvedView[];
  /** Every definition's part status by id (PB-932): the viewer's shells mark the modules with it. */
  partStatus?: Record<string, { trust: PartTrust; basis: string }>;
  /** The project index next to the bundle (the Atlas view's data): its node count and problems, or why it was not written. */
  atlas?: { nodes: number; problems: number } | { error: string };
}

async function main() {
  const [root, bundleFile] = process.argv.slice(2);
  const t0 = Date.now();
  const report = (r: Omit<BuildReport, "ms">) => process.stdout.write(JSON.stringify({ ...r, ms: Date.now() - t0 }) + "\n");
  try {
    const p = await loadProject(root);
    const watch = {
      display: p.config.display ?? ".protoboard/display.json",
      sources: p.config.sources ?? ["src/**/*.uhd.ts"],
      catalog: p.config.catalog ?? "parts/catalog",
      ...(p.config.scenarios ? { scenarios: p.config.scenarios.source } : {}),
    };
    const data = stableStringify(await uhdBundle(p));
    // the server may be reading either file: replace each in one step
    const write = (file: string, content: string) => {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
      writeFileSync(tmp, content);
      renameSync(tmp, file);
    };
    write(join(dirname(bundleFile), SOURCES_FILE), JSON.stringify(sourceIndex(p)));
    write(bundleFile, data);
    // the project index: a failure is reported, and the bundle is served all the same
    let atlas: BuildReport["atlas"];
    try {
      const a = await writeAtlasIndex(p, { outDir: dirname(bundleFile) });
      atlas = { nodes: a.counts.nodes, problems: a.problems };
    } catch (e) {
      atlas = { error: (e as Error).message.split("\n")[0] };
    }
    const n = (s: string) => p.diagnostics.filter((d) => d.severity === s).length;
    const { views } = resolveViews(p.extensions);
    report({ ok: true, bytes: data.length, counts: { error: n("error"), warning: n("warning"), info: n("info") }, watch, ...(views.length ? { views } : {}), partStatus: definitionTrust(p), atlas });
  } catch (e) {
    report({ ok: false, error: (e as Error).message.split("\n")[0] });
    process.exitCode = 1;
  }
}

await main();
