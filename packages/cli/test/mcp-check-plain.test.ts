/**
 * project_check's plain words (wave R2, D3): every diagnostic it returns carries `title` and `summary` for people
 * beside the raw `message`, and the description says `summary` is for people. A fake CLI run: no project, no cloud
 * (mcp.test.ts, which runs the real CLI, needs a protoboard-cloud checkout).
 */
import { describe, expect, it } from "vitest";
import { protoboardTools, type ToolContext } from "../src/mcp/tools.js";

const CHECK = {
  checks: [{ validator: "uhd/checkSystem", status: "ran", counts: { error: 0, warning: 1, info: 1 } }],
  diagnostics: [
    // written by `protoboard check` with its plain words
    { code: "UHD_BUS_PULLUP", severity: "warning", entity: { kind: "interface", id: "pcb/power/:i2c0_scl" }, message: "pcb/power (sec-power): net i2c0_scl carries I2C (cs:pin_5) but no resistor pulls it up to a supply.", title: "I2C line has no pull-up", summary: "The I2C clock line i2c0_scl on Power needs a pull-up resistor to its supply; none is connected.", validator: "uhd/checkSystem" },
    // added after loading (the diagram's layout) or by an older CLI: no plain words yet
    { code: "PB_DIAGRAM_LAYOUT", severity: "info", entity: { kind: "instance", id: "fan_unit_1" }, message: 'the diagram\'s level "fan_unit_1" is hard to read: 8 cards in one column', validator: "protoboard/layout" },
  ],
};

const ctx: ToolContext = {
  dir: async (given) => given ?? "/p",
  cli: async () => ({ code: 0, stdout: JSON.stringify(CHECK), stderr: "" }) as never,
  cliFor: () => ({ entry: "protoboard", from: "server" }),
  version: "0.0.0-test",
  about: "test",
};

describe("project_check (MCP)", () => {
  const tool = protoboardTools([]).find((t) => t.name === "project_check")!;

  it("says that summary is for people and message is the detail", () => {
    expect(tool.description).toContain("`summary`");
    expect(tool.description).toContain("plain words for people");
    expect(tool.description).toContain("`message` is the raw detail");
  });

  it("returns title, summary and message on every diagnostic, wording the ones the CLI wrote without them", async () => {
    const out = (await tool.handler({ severity: "info" } as never, ctx)) as { data: { diagnostics: { code: string; title: string; summary: string; message: string }[] } };
    const [pullup, layout] = out.data.diagnostics;
    expect(pullup).toMatchObject({ title: "I2C line has no pull-up", summary: "The I2C clock line i2c0_scl on Power needs a pull-up resistor to its supply; none is connected." });
    expect(pullup.message).toContain("no resistor pulls it up");
    expect(layout.title).toBe("Diagram is hard to read");
    expect(layout.summary).toMatch(/^A level of the diagram for fan unit 1 is hard to read/);
    expect(layout.message).toBe(CHECK.diagnostics[1].message);
  });
});
