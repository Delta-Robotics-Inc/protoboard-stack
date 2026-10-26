/**
 * Contributions to the Manufacturing Package (@protoboardai/ext-release section
 * contract): the flight-controller configuration, in the root unit's work
 * order (it depends on the whole system's wiring, so it is loaded at final
 * assembly, once everything is connected) and its bench check in the root
 * unit's test plan. Flashing and loading are contributed as "configure"
 * operations: the release numbers them after the assembly steps, inside the
 * bench test and before the propellers go on.
 *
 * The configuration file is the one `protoboard run betaflight-cli` wrote.
 * It is regenerated here in memory and compared: a file that no longer
 * matches the model stops the release.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listOperationRecords, type Project } from "@protoboardai/core";
import type { SectionContribution, SectionFn } from "@protoboardai/ext-release";
import { betaflightCli, betaflightConfig } from "../lib/betaflight.ts";

const DEFAULT_OUT = "firmware/betaflight/cli.txt";

/** The configuration file: where the last betaflight-cli run wrote it. */
function cliFile(p: Project): string {
  const rec = listOperationRecords(p).filter((r) => r.record.operation === "betaflight-cli" && r.record.status === "succeeded").pop();
  return rec?.record.outputs[0]?.path ?? DEFAULT_OUT;
}

function configuration(p: Project) {
  if (!p.rootDef) return undefined;
  const cfg = betaflightConfig(p.rootDef, p.lookup);
  if (!cfg.target && !cfg.lines.length) return undefined; // no flight controller in this system
  return { cfg, text: betaflightCli(p.rootDef, cfg), file: cliFile(p) };
}

export const workOrder: SectionFn = ({ project: p, unit }) => {
  if (unit?.kind !== "root") return undefined;
  const c = configuration(p);
  if (!c) return undefined;
  const abs = join(p.root, c.file);
  const rerun = "run `protoboard run betaflight-cli` and commit the result";
  if (!existsSync(abs)) return { title: "Flight controller configuration", blocks: [], diagnostics: [{ code: "DRONE_CLI_MISSING", severity: "error", message: `${c.file} does not exist; ${rerun}` }] };
  if (readFileSync(abs, "utf8") !== c.text) return { title: "Flight controller configuration", blocks: [], diagnostics: [{ code: "DRONE_CLI_STALE", severity: "error", message: `${c.file} no longer matches the model; ${rerun}` }] };
  const out: SectionContribution = {
    title: "Flight controller configuration",
    order: 60,
    blocks: [
      { kind: "paragraph", text: "Load the configuration once the receiver, video transmitter and GNSS are connected, before the propellers go on: the operations above flash the firmware and load this file after the power-up checks and before the rest of the bench test. Every line of the file cites the link or part fact it comes from." },
      {
        kind: "keyvalues",
        rows: [
          { label: "Firmware", value: `Betaflight ${c.cfg.minFirmware} or later` },
          { label: "Target", value: c.cfg.target ?? "unknown" },
          { label: "Build options", value: c.cfg.buildOptions.join(", ") },
          { label: "File", value: "files/firmware/betaflight-cli.txt", note: `${c.cfg.lines.length} settings, from ${c.file}` },
        ],
      },
      ...c.cfg.warnings.map((w) => ({ kind: "note" as const, level: "caution" as const, text: w })),
    ],
    operations: [
      { stage: "configure", title: "Flash the flight controller", actions: [`Propellers off. Flash Betaflight ${c.cfg.minFirmware} or later for ${c.cfg.target ?? "the flight controller's target"} with the cloud build options ${c.cfg.buildOptions.join(", ")}.`], tools: ["Betaflight Configurator", "USB-C cable"], inspect: "the configurator connects and shows the target", test: "the configurator connects and shows the target" },
      { stage: "configure", title: "Load the flight controller configuration", actions: ["Open the CLI tab, paste files/firmware/betaflight-cli.txt and press Enter; the board saves and reboots."], tools: ["Betaflight Configurator", "USB-C cable"], inspect: "the CLI echoes no error lines", test: "the flight controller bench check (test plan)" },
    ],
    files: [{ path: "files/firmware/betaflight-cli.txt", from: c.file, role: "firmware-config", description: "Betaflight CLI configuration" }],
  };
  return out;
};

export const testPlan: SectionFn = ({ project: p, unit }) => {
  if (unit?.kind !== "root" || !configuration(p)) return undefined;
  return {
    title: "Flight controller bench check",
    order: 60,
    blocks: [
      { kind: "paragraph", text: "After bring-up and the configuration, before the propellers go on: props off, powered through a current-limited supply or a smoke stopper. The configuration is generated from the model and has not been flight-tested." },
      {
        kind: "table",
        columns: [
          { key: "check", label: "Check" },
          { key: "how", label: "How" },
          { key: "pass", label: "Pass" },
        ],
        rows: [
          { check: "Motor order and direction", how: "Motors tab, spin each motor at low throttle", pass: "M1–M4 at the positions and directions of the model's Quad-X layout" },
          { check: "Receiver", how: "Receiver tab with the transmitter bound", pass: "all channels follow the sticks" },
          { check: "Video and OSD", how: "goggles on, power cycle", pass: "image and OSD elements shown" },
          { check: "GNSS and compass", how: "outdoors, Sensors and GPS tabs", pass: "satellite fix; heading follows the frame's nose" },
          { check: "Current sensor", how: "compare the OSD current with the supply's", pass: "within the supply's resolution at idle" },
        ],
      },
    ],
  };
};
