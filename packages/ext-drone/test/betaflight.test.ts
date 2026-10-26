/**
 * betaflight-cli writes every hardware UART of the flight controller (PB-870):
 * the ports the model uses get their function, every other port is reset to
 * function 0. Pasting the output therefore leaves no function behind from the
 * board's saved settings: after the GPS moves from UART1 to UART3, UART1 is
 * cleared instead of keeping GPS.
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProject } from "@protoboardai/core";
import { betaflightCli, betaflightConfig } from "../lib/betaflight.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const QUAD = join(HERE, "../../../examples/quadcopter-5in");
const TMP = join(HERE, ".tmp");

async function cli(root: string) {
  const p = await loadProject(root, { checks: false });
  return betaflightCli(p.rootDef!, betaflightConfig(p.rootDef!, p.lookup));
}

const serialLines = (text: string) => text.split("\n").filter((l) => l.startsWith("serial "));
const port = (text: string, n: number) => serialLines(text).filter((l) => l.startsWith(`serial UART${n} `));

describe("betaflight-cli serial ports", () => {
  it("sets every hardware UART of the flight controller once, unused ones reset to no function", async () => {
    const text = await cli(QUAD);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(port(text, n)).toHaveLength(1);
    expect(port(text, 1)[0]).toMatch(/^serial UART1 2 115200 115200 0 115200 /);
    expect(port(text, 2)[0]).toMatch(/^serial UART2 64 115200 57600 0 115200 /);
    expect(port(text, 5)[0]).toMatch(/^serial UART5 131073 115200 57600 0 115200 /);
    for (const n of [3, 4, 6]) expect(port(text, n)[0]).toMatch(new RegExp(`^serial UART${n} 0 115200 57600 0 115200 +# .*no link in the model`));
    // in port order, ahead of the features and settings
    expect(serialLines(text).map((l) => /UART(\d)/.exec(l)![1])).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(text.split("\n").findIndex((l) => l.startsWith("feature "))).toBeGreaterThan(text.split("\n").findIndex((l) => l.startsWith("serial UART6 ")));
  });

  it("after the GPS moves to UART3, the output clears UART1 instead of leaving GPS on it", async () => {
    const dir = join(TMP, "gps-uart3");
    rmSync(dir, { recursive: true, force: true });
    cpSync(QUAD, dir, { recursive: true, filter: (src) => !/[/\\](node_modules|\.protoboard|\.claude|docs|operations|release|tsconfig\.json)$/.test(src) });
    const file = join(dir, "src/quadcopter.uhd.ts");
    const before = readFileSync(file, "utf8");
    const after = before.replace('p2: "fc:uart1_tx", p3: "fc:uart1_rx"', 'p2: "fc:uart3_tx", p3: "fc:uart3_rx"');
    expect(after).not.toBe(before);
    writeFileSync(file, after);
    const text = await cli(dir);
    expect(port(text, 3)[0]).toMatch(/^serial UART3 2 115200 115200 0 115200 /);
    expect(port(text, 1)[0]).toMatch(/^serial UART1 0 115200 57600 0 115200 /);
    expect(text).not.toMatch(/^serial UART1 2 /m);
  });
});
