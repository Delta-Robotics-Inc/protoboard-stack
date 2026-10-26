// The projects a test opens are trusted before VS Code starts (PB-1048): the extension asks once per project folder
// before it runs a project's code, and keeps the answers in <config dir>/trusted-projects.json (src/trust.ts). A
// test writes that file into its own config folder, never the user's.
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export function trustProjects(configDir, roots) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const projects = Object.fromEntries(roots.map((r) => [realpathSync(resolve(r)), { trusted: true, at: new Date().toISOString() }]));
  writeFileSync(join(configDir, "trusted-projects.json"), JSON.stringify({ schema: "protoboard.trusted-projects/v1", projects }, null, 2) + "\n", { mode: 0o600 });
}
