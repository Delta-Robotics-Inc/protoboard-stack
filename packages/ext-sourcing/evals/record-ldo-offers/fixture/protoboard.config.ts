import { defineConfig } from "@protoboardai/core";

// EVAL FIXTURE: a small fictional sensor node with one purchased part researched in the project.
export default defineConfig({
  name: "sensor-node",
  root: { source: "src/sensor-node.uhd.ts", export: "SENSOR_NODE" },
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-parts", "@protoboardai/ext-sourcing"],
});
