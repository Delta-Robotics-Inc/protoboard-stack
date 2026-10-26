/**
 * TEST FIXTURE: fake firmware provider. Writes one config file with a line
 * per board link (each citing its link) and the firmware manifest naming the
 * board's first component as the controller.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityContext, CapabilityOperationFn } from "@protoboardai/core";

const nativeFile = (ctx: CapabilityContext) => `${ctx.module.native}/board.conf`;

export const generate: CapabilityOperationFn = (ctx) => {
  const links = ctx.module.definition.links ?? [];
  ctx.writeOutput(nativeFile(ctx), links.map((l) => `LINK_${l.id.toUpperCase()}=y`).join("\n") + "\n");
  return { status: "succeeded", summary: `${links.length} lines` };
};

export const exportOutputs: CapabilityOperationFn = (ctx) => {
  const f = join(ctx.project.root, nativeFile(ctx));
  if (!existsSync(f)) return { status: "failed", summary: "not generated" };
  const content = readFileSync(f);
  const def = ctx.module.definition;
  const controller = def.children![0];
  ctx.writeOutput(`${ctx.module.out}/config/board.conf`, content);
  const manifest = {
    schema: "protoboard.firmware/v0",
    module: def.id,
    provider: "@fixtures/fake-firmware",
    framework: "fake",
    controller: { instance: controller.id, part: controller.moduleDefId },
    files: [{ path: "config/board.conf", digest: "sha256:" + createHash("sha256").update(content).digest("hex"), lines: (def.links ?? []).map((l, i) => ({ line: i + 1, cites: [`link:${l.id}`] })) }],
  };
  ctx.writeOutput(`${ctx.module.out}/firmware.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  return { status: "succeeded", summary: "config/board.conf" };
};

export const extract: CapabilityOperationFn = () => ({ status: "succeeded", summary: "no frames", data: { frames: {}, artifacts: [] } });

export const check: CapabilityOperationFn = () => ({ status: "succeeded", summary: "clean", diagnostics: [] });
