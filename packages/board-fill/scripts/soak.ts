/** Soak: fill and verify many random boards; print any failure. */
import { fillZones, verifyFill } from "../src/index.js";
import { randomBoard } from "../test/helpers.js";

let ok = 0;
const t0 = performance.now();
for (const minWidth of [undefined, 0.2, 0.35]) {
  for (let seed = 1; seed <= Number(process.argv[2] ?? 150); seed++) {
    const { doc } = randomBoard(seed * 7919 + 13, minWidth);
    try {
      const r = fillZones(doc);
      const v = verifyFill(doc, r.fill);
      if (!v.ok) console.log("verify", seed, minWidth, JSON.stringify(v.violations.slice(0, 3)));
      else ok++;
    } catch (e) {
      console.log("error", seed, minWidth, (e as Error).message);
    }
  }
}
console.log("ok", ok, "ms", (performance.now() - t0).toFixed(0));
