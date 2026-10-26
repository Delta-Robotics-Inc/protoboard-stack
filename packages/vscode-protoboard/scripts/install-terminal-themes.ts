// Puts Protoboard Dark and Light into this machine's Ghostty and herdr (`npm run themes:install`):
// copies themes/ghostty/* into Ghostty's themes folder and sets its `theme =` line, and replaces
// herdr's [theme] tables with themes/herdr/theme.toml. Each config it changes is saved first as <file>.<time>.bak.
// Reload afterwards: Ghostty with ctrl+shift+, (cmd+shift+, on macOS), herdr with `herdr server reload-config`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TERMINAL_FILES, withGhosttyTheme, withHerdrTheme } from "../src/terminalThemes.ts";

const themes = fileURLToPath(new URL("../themes/", import.meta.url));
const config = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");

function update(file: string, change: (text: string) => string) {
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  const after = change(before);
  if (after === before) return console.log(`unchanged ${file}`);
  const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  if (before) copyFileSync(file, backup);
  writeFileSync(file, after);
  console.log(`updated ${file}${before ? ` (previous: ${basename(backup)})` : ""}`);
}

// Ghostty
const ghostty = join(config, "ghostty");
mkdirSync(join(ghostty, "themes"), { recursive: true });
for (const name of Object.values(TERMINAL_FILES.ghostty)) {
  copyFileSync(join(themes, name), join(ghostty, "themes", basename(name)));
  console.log(`wrote ${join(ghostty, "themes", basename(name))}`);
}
update(["config.ghostty", "config"].map((f) => join(ghostty, f)).find(existsSync) ?? join(ghostty, "config.ghostty"), withGhosttyTheme);

// herdr
const herdr = join(config, "herdr");
mkdirSync(herdr, { recursive: true });
const block = readFileSync(join(themes, TERMINAL_FILES.herdr), "utf8");
update(join(herdr, "config.toml"), (text) => withHerdrTheme(text, block));
