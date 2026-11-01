/**
 * Which STEP file the exact tier measures for a part (PB-1187): the source
 * STEP the model resolver recorded for the instance in
 * `.protoboard/build/resolved.json` (W1-B, `models.instances[].step`).
 * Never a vendor file that is not on disk: a missing file is an error that
 * says how to get it, nothing is fetched here. The path must stay inside the
 * project (links resolved) and under the size cap.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const RESOLVED_FILE = ".protoboard/build/resolved.json";
/** DEFAULT: the largest STEP the geometry service opens (ClientX's board is 143 MB). */
export const MAX_STEP_BYTES = 256 * 1024 * 1024;
/** DEFAULT: the largest resolved.json read. */
export const MAX_RESOLVED_BYTES = 64 * 1024 * 1024;

export interface PartStep {
  /** The instance asked for, and the instance whose file holds it (a board's component is drawn by its board). */
  part: string;
  holder: string;
  /** Absolute path (links resolved). */
  file: string;
  /** As resolved.json writes it (project-relative). */
  relative: string;
  bytes: number;
  sha256?: string;
  /** The model is a declared or generated stand-in: its numbers describe the stand-in, not the real part. */
  placeholder?: boolean;
}

interface ModelRow {
  instance?: string;
  drawnBy?: string;
  placeholder?: boolean;
  step?: { file?: string; bytes?: number; sha256?: string };
}

/** `child` is `parent` or inside it (both absolute, links resolved). */
export function inside(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r) && !r.split(sep).includes(".."));
}

function readModels(root: string): ModelRow[] {
  const f = join(root, RESOLVED_FILE);
  if (!existsSync(f)) throw new Error(`${RESOLVED_FILE} is missing: run \`protoboard build\` first`);
  if (statSync(f).size > MAX_RESOLVED_BYTES) throw new Error(`${RESOLVED_FILE} is over ${MAX_RESOLVED_BYTES} bytes`);
  const j = JSON.parse(readFileSync(f, "utf8")) as { models?: { instances?: ModelRow[] } };
  return j.models?.instances ?? [];
}

/** The source STEP for a part's instance path; throws with a reason a person can act on. */
export function resolvePartStep(root: string, part: string, opts: { maxBytes?: number } = {}): PartStep {
  const rows = readModels(root);
  let row = rows.find((r) => r.instance === part);
  let holder = part;
  if (row?.drawnBy !== undefined) {
    holder = row.drawnBy;
    row = rows.find((r) => r.instance === holder);
  }
  if (!row) {
    // a component path under a drawn body (`pcb/power/u13` inside `pcb`): the longest instance that holds it
    const owner = rows.filter((r) => r.instance && part.startsWith(`${r.instance}/`)).sort((a, b) => b.instance!.length - a.instance!.length)[0];
    if (owner) {
      row = owner;
      holder = owner.instance!;
    }
  }
  if (!row) throw new Error(`"${part}" is not in the model table (${RESOLVED_FILE}); instance paths are listed by \`protoboard parts models\``);
  const rel = row.step?.file;
  if (!rel) throw new Error(`"${holder}" has no source STEP recorded (the exact tier needs one; \`protoboard parts models ${holder}\` shows what is resolved)`);
  const abs = resolve(root, rel);
  if (!existsSync(abs)) throw new Error(`"${holder}"'s STEP ${rel} is not on disk (a vendor file is fetched by a person: \`protoboard parts fetch\`)`);
  const realRoot = realpathSync(root);
  const real = realpathSync(abs);
  if (!inside(realRoot, real)) throw new Error(`"${holder}"'s STEP resolves outside the project (${rel}): refused`);
  const bytes = statSync(real).size;
  const max = opts.maxBytes ?? MAX_STEP_BYTES;
  if (bytes > max) throw new Error(`"${holder}"'s STEP is ${bytes} bytes, over the ${max} byte cap`);
  return { part, holder, file: real, relative: rel.replace(/\\/g, "/"), bytes, ...(row.step?.sha256 ? { sha256: row.step.sha256 } : {}), ...(row.placeholder ? { placeholder: true } : {}) };
}
