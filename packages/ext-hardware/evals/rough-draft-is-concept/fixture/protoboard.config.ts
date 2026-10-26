import { defineConfig } from "@protoboardai/core";

// EVAL FIXTURE: a project set up with `protoboard init` and nothing in it yet:
// src/trail-light.uhd.ts does not exist. The person has an idea, not a design.
export default defineConfig({
  name: "trail-light",
  root: { source: "src/trail-light.uhd.ts", export: "TRAIL_LIGHT" },
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  catalog: "parts/catalog",
  extensions: ["@protoboardai/ext-hardware"],
});
