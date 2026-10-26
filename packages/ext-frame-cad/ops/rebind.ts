import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { OperationFn } from "@protoboardai/core";
import { plateBinding, plateFiles, plateModules, sameVec, type FramesFile } from "../lib/params.ts";

interface Signature {
  area_mm2: number;
  centroid: number[];
  normal?: number[];
}

const vec = (v: number[]) => `[${v.map((n) => String(Number(n.toFixed(3)) + 0)).join(", ")}]`;
const sig = (s: Signature) => `{ area_mm2: ${s.area_mm2}, centroid: ${vec(s.centroid)}${s.normal ? `, normal: ${vec(s.normal)}` : ""} }`;
const parseVec = (s: string) => s.split(",").map((x) => Number(x.trim()));

/**
 * The part of a module source that holds this module's geometry: the
 * `withGeometry(` call whose artifacts name the generated body. Several
 * modules may share a file (frame and top plate), so re-binding is scoped to
 * that call and never touches another module's literals.
 */
function geometryBlock(text: string, cadName: string): [number, number] | undefined {
  const starts = [...text.matchAll(/withGeometry\(/g)].map((m) => m.index!);
  const blocks = starts.map((s, k) => [s, starts[k + 1] ?? text.length] as [number, number]);
  const hits = blocks.filter(([a, b]) => text.slice(a, b).includes(`name: "${cadName}"`));
  if (hits.length === 1) return hits[0];
  return blocks.length === 1 ? blocks[0] : undefined;
}

/**
 * frame-cad-rebind: explicit re-binding after a reviewed change (the step
 * `cad:extract` leaves to the user, tool-integrations §8). Copies the
 * exported feature signatures (out/body.manifest.json) into the module's
 * `feature("<id>", { … })` literals and the generated frame origins (the
 * native frame-cad/frames.json) into `<id>: { frame: { origin: [...] … } }`,
 * in the module's own source file. Every change is returned; nothing else in
 * the file is touched.
 */
export const rebind: OperationFn = (ctx) => {
  const p = ctx.project;
  const only = ctx.inputs.module?.split(",").map((s) => s.trim()).filter(Boolean);
  const targets = plateModules(p, only);
  const blocked = targets.flatMap((t) => t.problems);
  if (blocked.length) return { status: "failed", summary: blocked[0] };
  const changes: { module: string; file: string; interface: string; what: "signature" | "frame origin"; from: string; to: string }[] = [];
  const edited = new Map<string, string>();
  let rebound = 0;
  for (const { def } of targets) {
    const binding = plateBinding(p, def.id);
    const files = binding && plateFiles(binding);
    const manifestFile = files && join(p.root, files.manifest);
    const framesFile = files && join(p.root, files.frames);
    if (!manifestFile || !framesFile || !existsSync(manifestFile) || !existsSync(framesFile)) {
      if (only?.length) return { status: "failed", summary: `${def.id} has no generated and exported CAD${binding ? ` in ${binding.dir}` : " (no cad.config.ts)"}; run \`protoboard run cad:generate --module ${def.id}\` and cad:export first` };
      continue;
    }
    const features = (JSON.parse(readFileSync(manifestFile, "utf8")) as { features: Record<string, Signature> }).features;
    const frames = JSON.parse(readFileSync(framesFile, "utf8")) as FramesFile;
    const file = p.definitions.get(def.id)!.origin.source.file;
    let text = edited.get(file) ?? readFileSync(join(p.root, file), "utf8");
    const block = geometryBlock(text, def.id);
    if (!block) return { status: "failed", summary: `${file}: cannot find the withGeometry(...) call for ${def.id} (artifacts named "${def.id}"); re-bind by hand from ${files.manifest}` };
    let body = text.slice(block[0], block[1]);
    body = body.replace(/feature\("([^"]+)", (\{ area_mm2: [^}]*\})/g, (all, name: string, old: string) => {
      const now = features[name];
      if (!now) return all;
      const next = sig(now);
      const was = /area_mm2: ([\d.e+-]+), centroid: \[([^\]]*)\]/.exec(old);
      if (was && Math.abs(Number(was[1]) - now.area_mm2) < 1e-6 && sameVec(parseVec(was[2]), now.centroid, 1e-6)) return all;
      changes.push({ module: def.id, file, interface: name, what: "signature", from: old, to: next });
      return `feature("${name}", ${next}`;
    });
    for (const [id, f] of Object.entries(frames)) {
      const re = new RegExp(`(\\b${id}:\\s*\\{\\s*frame:\\s*\\{\\s*origin:\\s*)\\[([^\\]]*)\\]`);
      body = body.replace(re, (all, head: string, old: string) => {
        if (sameVec(parseVec(old), f.origin, 1e-6)) return all;
        changes.push({ module: def.id, file, interface: id, what: "frame origin", from: `[${old}]`, to: vec(f.origin) });
        return `${head}${vec(f.origin)}`;
      });
    }
    text = text.slice(0, block[0]) + body + text.slice(block[1]);
    edited.set(file, text);
    rebound++;
  }
  for (const [file, text] of edited) {
    if (changes.some((c) => c.file === file)) ctx.writeOutput(file, text, "re-bound geometry literals");
  }
  for (const c of changes) ctx.log(`${c.module}.${c.interface} ${c.what}: ${c.from} -> ${c.to}`);
  return {
    status: "succeeded",
    summary: changes.length ? `${changes.length} literal(s) re-bound in ${[...new Set(changes.map((c) => c.file))].join(", ")}` : `${rebound} module(s) checked; nothing to re-bind`,
    data: { changes },
  };
};
