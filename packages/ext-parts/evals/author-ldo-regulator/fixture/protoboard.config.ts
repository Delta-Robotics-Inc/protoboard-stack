import { defineConfig } from "@protoboardai/core";

// EVAL FIXTURE: a small fictional sensor node whose regulator is not authored yet.
export default defineConfig({
  name: "sensor-node",
  root: { source: "src/sensor-node.uhd.ts", export: "SENSOR_NODE" },
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  extensions: ["@protoboardai/ext-hardware", "@protoboardai/ext-parts"],
});
