/** Pins named in generated ESP-IDF files: `GPIO_NUM_<n>`. */
import type { ModuleDef } from "@deltarobotics/uhd";
import type { PinRef } from "@protoboardai/core";
import { leafForGpio } from "./soc.ts";

export function readEspIdfPins(files: Record<string, string>, controller: ModuleDef): PinRef[] {
  const refs: PinRef[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (!/\.h$/.test(file)) continue;
    text.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
      for (const m of code.matchAll(/GPIO_NUM_(\d+)\b/g)) {
        const n = Number(m[1]);
        refs.push({ file, line: i + 1, ref: `GPIO${n}`, pin: leafForGpio(controller, n)?.id });
      }
    });
  }
  return refs;
}
