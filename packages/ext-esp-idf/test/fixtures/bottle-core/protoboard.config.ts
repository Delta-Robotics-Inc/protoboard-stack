import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "bottle-core",
  root: { source: "src/bottle.uhd.ts", export: "BOTTLE" },
  sources: ["src/**/*.uhd.ts"],
  // the researched parts are vendored by the test from test/fixtures/parts (catalog tier)
  catalog: "parts/catalog",
});
