import { defineConfig } from "@protoboardai/core";

// TEST FIXTURE: one module in a rig; ext-hardware for its skills (the runner exports them to the host).
export default defineConfig({ name: "demo-rig", root: { source: "src/rig.uhd.ts", export: "RIG" }, extensions: ["@protoboardai/ext-hardware"] });
