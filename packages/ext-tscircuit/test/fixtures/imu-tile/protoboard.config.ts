import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "imu-tile",
  root: { source: "src/tile.uhd.ts", export: "TILE" },
  sources: ["src/**/*.uhd.ts"],
  // RP2040, BMI270 and TPS63020 vendored by the test from test/fixtures/uhd-parts (catalog tier)
  catalog: "parts/catalog",
});
