import { defineCapabilityConfig } from "@protoboardai/core";

// TEST FIXTURE: ESP-IDF for the bottle core board.
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-esp-idf",
  constraints: {
    // the wake button and the fuel gauge's alert wake the cap from Deep-sleep
    wake: ["sw2", "u4"],
  },
});
