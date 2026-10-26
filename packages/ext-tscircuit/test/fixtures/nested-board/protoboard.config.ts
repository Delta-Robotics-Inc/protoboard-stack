import { defineConfig } from "@protoboardai/core";

export default defineConfig({
  name: "nested-board",
  root: { source: "src/system.uhd.ts", export: "LAMP" },
  sources: ["src/**/*.uhd.ts"],
});
