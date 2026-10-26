import { defineConfig } from "@protoboardai/core";

// EVAL FIXTURE: a concept-level bike computer, nine blocks, whose diagram was
// saved as one long row of cards with two of them on top of each other
// (.protoboard/display.json). The model is right; the diagram is not.
export default defineConfig({
  name: "bike-computer",
  root: { source: "src/bike-computer.uhd.ts", export: "BIKE_COMPUTER" },
  sources: ["src/**/*.uhd.ts", "parts/local/**/*.uhd.ts"],
  catalog: "parts/catalog",
  extensions: ["@protoboardai/ext-hardware"],
});
