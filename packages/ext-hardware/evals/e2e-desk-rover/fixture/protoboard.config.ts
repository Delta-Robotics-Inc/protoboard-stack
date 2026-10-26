import { defineConfig } from "@protoboardai/core";

// EVAL FIXTURE: a small project set up with `protoboard init`, its parts already vendored
// from the catalog into parts/catalog (pinned in parts/origins.json). The system is not
// composed yet: src/desk-rover.uhd.ts does not exist.
export default defineConfig({
  name: "desk-rover",
  root: { source: "src/desk-rover.uhd.ts", export: "DESK_ROVER" },
  sources: ["src/**/*.uhd.ts"],
  catalog: "parts/catalog",
  extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-release"],
});
