import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "watch-core",
  root: { source: "src/watch.uhd.ts", export: "WATCH" },
  sources: ["src/**/*.uhd.ts"],
  // the researched parts are vendored by the test from test/fixtures/parts (catalog tier)
  catalog: "parts/catalog",
});
