// Tool probe for kicad-cli (KiCad 10), found as lib/kicad/cli.ts finds it:
// PROTOBOARD_KICAD_CLI, PATH, then KiCad's usual install places. Prints one
// line; exits 1 when there is none, or when it is older than KiCad 10.
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");

const places = [process.env.PROTOBOARD_KICAD_CLI, "kicad-cli", "/usr/bin/kicad-cli", "/usr/local/bin/kicad-cli", "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli", "C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe"].filter(Boolean);
for (const c of places) {
  if (c !== "kicad-cli" && !existsSync(c)) continue;
  const r = spawnSync(c, ["version"], { encoding: "utf8", timeout: 20000 });
  const v = (r.stdout || "").trim();
  if (r.status !== 0 || !/^\d+\./.test(v)) continue;
  if (Number(v.split(".")[0]) < 10) {
    console.error(`kicad-cli ${v} at ${c}: the KiCad handoff writes KiCad 10 files; install KiCad 10`);
    process.exit(1);
  }
  console.log(`kicad-cli ${v} (${c})`);
  process.exit(0);
}
console.error("kicad-cli not found: install KiCad 10, or set PROTOBOARD_KICAD_CLI to its kicad-cli");
process.exit(1);
