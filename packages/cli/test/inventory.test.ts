/**
 * `protoboard inventory --json` (PB-1168): the command's output for a
 * project, from inside a subfolder, and outside any project.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { makeProject } from "../../core/test/update-fixtures.js";
import { inventoryCommand, inventoryFor, projectRootFrom } from "../src/inventory.js";

const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("protoboard inventory", () => {
  it("prints the inventory as JSON (schema protoboard.inventory/v0) and as text", async () => {
    const root = makeProject();
    made.push(root);
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    expect(projectRootFrom(join(root, "src", "deep"))).toBe(root);
    let data: unknown;
    let text = "";
    const code = await inventoryCommand(join(root, "src", "deep"), [], (d, t) => {
      data = d;
      text = t();
    });
    expect(code).toBe(0);
    const inv = data as { schema: string; stack: { version: string; from: string }; components: { name: string; role: string }[]; counts: { runtimes: number } };
    expect(inv.schema).toBe("protoboard.inventory/v0");
    expect(inv.stack).toMatchObject({ version: "0.2.2", from: "project" });
    expect(inv.components.find((c) => c.name === "build123d")?.role).toBe("runtime:cad");
    expect(inv.counts.runtimes).toBe(1);
    expect(text).toMatch(/^stack 0\.2\.2/);
    expect(text).toContain("@protoboardai/ext-parts");
    expect(text).toMatch(/1 managed runtime/);
  });

  it("outside a project, lists the stack running the command", () => {
    const inv = inventoryFor(tmpdir(), { noExec: true, home: tmpdir() });
    expect(inv.stack.from).toBe("this-cli");
    expect(inv.stack.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(inv.counts.runtimes).toBe(0);
  });
});
