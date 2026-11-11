// Tool probe for kicad-cli (KiCad 10 or newer), found exactly as lib/kicad/cli.ts
// finds it (both use detect.cjs): PROTOBOARD_KICAD_CLI, PATH, then KiCad's
// install folders for any version. Prints one line (version, path, where it
// was found; `protoboard doctor` shows it); exits 1 when there is none, or
// when only a KiCad older than 10 is installed.
const { findKicadCli, describeKicadCli } = require("./detect.cjs");

const r = findKicadCli();
if (r.cli) {
  console.log(describeKicadCli(r.cli));
  process.exit(0);
}
console.error(r.reason);
process.exit(1);
