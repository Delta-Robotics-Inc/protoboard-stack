import type { OperationFn } from "@protoboardai/core";
import { buildRelease } from "../lib/release.ts";

const flag = (v: string | undefined) => v !== undefined && !/^(false|no|0|)$/i.test(v);

/**
 * release: refuse unless the project is clean (no check errors, nothing
 * stale, committed), then write the Manufacturing Package to
 * release/<version>/. Every file is a recorded output of this run.
 */
export const release: OperationFn = async (ctx) => {
  const r = await buildRelease(ctx.project, {
    version: ctx.inputs.version || undefined,
    allowDirty: flag(ctx.inputs["allow-dirty"]),
    checkOnly: flag(ctx.inputs.check),
    write: (path, content, description) => ctx.writeOutput(path, content, description),
    log: ctx.log,
  });
  for (const d of r.diagnostics.filter((d) => d.severity !== "info")) ctx.log(`${d.severity.toUpperCase().padEnd(7)} ${d.code}  ${d.message}`);
  return { status: r.status, summary: r.summary, data: r };
};
