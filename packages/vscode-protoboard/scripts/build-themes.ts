// Writes themes/protoboard-{dark,light}-color-theme.json from the brand palette
// (@protoboardai/views BRAND_TOKENS) and the viewer's DRC colours (src/themeColors.ts),
// and from those the Ghostty and herdr themes under themes/ghostty/ and themes/herdr/ (src/terminalThemes.ts).
// `npm run themes`; test/themes.test.ts fails when the files are out of date.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRC_TOKENS } from "@deltarobotics/uhd-viewer/components";
import { BRAND_TOKENS } from "../../views/src/theme.ts";
import { THEME_FILES, colorTheme, themeJson } from "../src/themeColors.ts";
import { TERMINAL_FILES, ghosttyTheme, herdrTheme } from "../src/terminalThemes.ts";

const dir = fileURLToPath(new URL("../themes/", import.meta.url));
const write = (name: string, text: string) => {
  const file = join(dir, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
};
const themes = { dark: colorTheme("dark", BRAND_TOKENS.dark, DRC_TOKENS), light: colorTheme("light", BRAND_TOKENS.light, DRC_TOKENS) };
for (const scheme of ["dark", "light"] as const) {
  write(THEME_FILES[scheme], themeJson(themes[scheme]));
  write(TERMINAL_FILES.ghostty[scheme], ghosttyTheme(themes[scheme]));
}
write(TERMINAL_FILES.herdr, herdrTheme(themes.dark, themes.light));
