/** Pins named in generated Zephyr files: `NRF_PSEL(<fn>, <port>, <pin>)` and `<&gpio<port> <pin> …>`. */
import type { ModuleDef } from "@deltarobotics/uhd";
import type { PinRef } from "@protoboardai/core";
import { leafAt } from "./soc.ts";

export function readZephyrPins(files: Record<string, string>, controller: ModuleDef): PinRef[] {
  const refs: PinRef[] = [];
  for (const [file, text] of Object.entries(files)) {
    if (!/\.(dts|dtsi|overlay)$/.test(file)) continue;
    text.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, "");
      for (const m of code.matchAll(/NRF_PSEL\(\s*\w+\s*,\s*(\d+)\s*,\s*(\d+)\s*\)|&gpio(\d+)\s+(\d+)\b/g)) {
        const port = Number(m[1] ?? m[3]);
        const pin = Number(m[2] ?? m[4]);
        refs.push({ file, line: i + 1, ref: `P${port}.${String(pin).padStart(2, "0")}`, pin: leafAt(controller, port, pin)?.id });
      }
    });
  }
  return refs;
}
