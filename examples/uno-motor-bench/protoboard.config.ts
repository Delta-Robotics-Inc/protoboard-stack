import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "uno-motor-bench",
  // the root system and every local definition (exported ModuleDefs in src/**/*.uhd.ts)
  root: { source: "src/uno-motor-bench.uhd.ts", export: "UNO_MOTOR_BENCH" },
  sources: ["src/**/*.uhd.ts"],
  // downloaded/vendored definitions; provenance in parts/origins.json
  catalog: "parts/catalog",
  // extensions (`protoboard extensions add <name>` lists and links one); `protoboard doctor`
  // reports their tools, `protoboard skills` their skills. ext-hardware: the order of work
  // (build-a-project) and the system skills, as every new project lists it
  extensions: ["@protoboardai/ext-hardware"],
});
