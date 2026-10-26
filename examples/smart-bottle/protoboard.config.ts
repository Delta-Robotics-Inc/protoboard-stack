import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "smart-bottle",
  root: { source: "src/bottle.uhd.ts", export: "SMART_BOTTLE" },
  // local definitions: the system, the cap board and its pads, the cap enclosure and the
  // harnesses (src/), and three purchased parts researched here (parts/local: the bottle,
  // the cell and the temperature probe, evidence in parts/evidence/)
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  // purchased parts from the Protoboard parts catalog (`protoboard parts add`), pinned in
  // parts/origins.json with their files under parts/catalog/<id>/
  catalog: "parts/catalog",
  // the read-only development catalog these parts were vendored from (PROTOBOARD_CLOUD_URL
  // overrides it); only `protoboard parts` commands use it
  cloud: { url: "http://localhost:8795" },
  // named variants (fault scenarios) carried into the UHD bundle for viewers
  scenarios: { source: "src/scenarios.ts", export: "SCENARIOS" },
  // installed npm packages with a protoboard-extension.json. The three capability providers
  // are also selected by the modules' own configs (circuit.config.ts, cad.config.ts,
  // firmware.config.ts); listing them here makes their skills and checks visible to `doctor`.
  extensions: [
    "@protoboardai/ext-hardware",
    "@protoboardai/ext-parts",
    "@protoboardai/ext-tscircuit",
    "@protoboardai/ext-enclosure-cad",
    "@protoboardai/ext-esp-idf",
    "@protoboardai/ext-harness-cad",
    "@protoboardai/ext-frame-cad",
    "@protoboardai/ext-docs",
    "@protoboardai/ext-release",
  ],
  // `protoboard release`: the Manufacturing Package gets a folder per unit. The cap board is
  // fabricated, assembled and brought up on the bench on its own; the cap housing is printed
  // and its inserts set before final assembly; everything else (cell, probe, O-rings, cables,
  // screws, the bottle) is final assembly onto the cap (the root).
  release: {
    units: ["board", "cap"],
  },
});
