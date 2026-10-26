/**
 * The gate table (packages/cli/src/gate.ts): which commands need the cloud.
 * Local work never does; only what uses a parts service's account endpoints.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_GATES, commandGate } from "../src/gate.js";

const INDEX = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");

describe("the gate table", () => {
  it("local work is local: init, model, check, build, dev, layout, views, circuits (run), release, the account and setup commands", () => {
    for (const c of ["init", "inspect", "artifacts", "check", "build", "dev", "layout", "views", "run", "release", "bom", "operations", "capabilities", "tools", "extensions", "skills", "evals", "stack", "setup", "agents", "mcp", "doctor", "login", "logout", "whoami"]) {
      expect(commandGate(c).gate, c).toBe("local");
    }
    expect(commandGate("parts", "list").gate).toBe("local");
    expect(commandGate("parts", "migrate").gate).toBe("local");
    expect(commandGate(undefined).gate).toBe("local");
  });

  it("browsing the library is the cloud too: signed out there is no library at all (PB-928, 2026-10-21)", () => {
    expect(commandGate("parts", "search")).toEqual({ gate: "cloud", what: "Searching the Protoboard library", uses: "libraries" });
    expect(commandGate("parts", "taxonomy")).toEqual({ gate: "cloud", what: "Browsing the Protoboard library's categories", uses: "libraries" });
    for (const sub of [undefined, "list", "add", "remove", "move"]) expect(commandGate("libraries", sub), sub).toEqual({ gate: "cloud", what: "Managing the project's libraries", uses: "libraries" });
    // no third kind: a command is local or it is the cloud
    expect(new Set(Object.values(COMMAND_GATES).map((g) => g.gate))).toEqual(new Set(["local", "cloud"]));
  });

  it("the cloud: fetching and updating library parts, update checks, offers, prices, publishing", () => {
    expect(commandGate("parts", "add")).toEqual({ gate: "cloud", what: "Adding library parts", uses: "libraries" });
    expect(commandGate("parts", "update")).toMatchObject({ gate: "cloud", uses: "libraries" });
    expect(commandGate("parts", "list", { check: true })).toMatchObject({ gate: "cloud", what: "Checking library parts for updates" });
    for (const sub of ["offers", "prices", "publish", "usage"]) expect(commandGate("parts", sub), sub).toMatchObject({ gate: "cloud", uses: "cloud" });
  });

  it("names every command the CLI dispatches, so a new one is a decision, not an accident", () => {
    const dispatched = [...INDEX.matchAll(/^ {4}case "([a-z-]+)":/gm)].map((m) => m[1]).filter((c) => !["open-service", "service-token", "offline", "list", "add", "remove", "move", "search", "prices", "usage", "taxonomy", "update", "offers", "publish"].includes(c));
    expect(dispatched.length).toBeGreaterThan(20);
    for (const c of dispatched) expect(Object.keys(COMMAND_GATES), c).toContain(c);
  });
});
