import type { OperationFn } from "@protoboardai/core";
import { betaflightCli, betaflightConfig } from "../lib/betaflight.ts";

/** Betaflight CLI from the resolved system; warnings are returned as data for the agent to act on. */
export const betaflightCliOp: OperationFn = (ctx) => {
  const { rootDef, lookup } = ctx.project;
  if (!rootDef) return { status: "failed", summary: "project has no root system" };
  const cfg = betaflightConfig(rootDef, lookup);
  const out = ctx.inputs.out ?? "firmware/betaflight/cli.txt";
  ctx.writeOutput(out, betaflightCli(rootDef, cfg), `Betaflight CLI (min firmware ${cfg.minFirmware})`);
  return {
    status: "succeeded",
    summary: `${cfg.lines.length} CLI lines for ${cfg.target ?? "unknown target"}, firmware ≥ ${cfg.minFirmware}${cfg.warnings.length ? `, ${cfg.warnings.length} warning(s)` : ""}`,
    data: { target: cfg.target, minFirmware: cfg.minFirmware, buildOptions: cfg.buildOptions, warnings: cfg.warnings },
  };
};
