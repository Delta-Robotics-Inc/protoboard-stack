/**
 * Units in values.json (PB-870): every numeric value a document shows
 * records the unit its text shows, and that unit agrees with the key it was
 * read from. The committed documents of the three examples are checked, and
 * the rules on the cases the eval trials found: a total in grams shown as
 * kg, kv_rpm_per_V, a CRSF baud rate stored in Hz, and peak current, latency
 * and bitrate shown through a unit override with no unit recorded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { displayUnit, unitFromKey, unitFromKeys, unitLabel } from "../lib/format.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EXAMPLES = ["quadcopter-5in", "wearable-watch", "smart-bottle"];

/** Keys of a value query, in order, without matches and arguments (`interfaces[id=bat_in].parameters[id=voltage].value` → interfaces, parameters, value). */
const keysOf = (q: string) => q.slice(q.indexOf(":") + 1).replace(/\[[^\]]*\]|\([^)]*\)/g, "").split(/[.:]+/).filter(Boolean);

const PREFIX = /^(G|M|k|m|μ|µ|u|n|p)(?=[A-Za-z°Ω])/;
/** One spelling per unit: display labels, SI prefixes removed (kg → g, kHz → Hz, μA → A, mAh → Ah). */
const base = (u: string) => {
  const l = unitLabel(u).replace(/^μ|^µ/, "u");
  return l === "count" || l === "" || u === "dimensionless" ? "count" : l.replace(PREFIX, "").replace(/^u(?=[A-Z])/, "");
};

/** Numeric text: a number, a range or a size, with or without its unit ("6.3 kg", "−10–40 °C", "45 × 41 mm", "0x2C"). */
const NUMERIC = /^[−-]?(0x[0-9A-F]+|\d[\d  ]*(\.\d+)?)([–×x ]+[−-]?\d[\d  ]*(\.\d+)?)*( \S.*|°.*)?$/;

describe("unit rules", () => {
  it("reads units from keys: suffixes, ratios, camel case, and keys that name the quantity", () => {
    expect(unitFromKey("kv_rpm_per_V")).toBe("rpm/V");
    expect(unitFromKey("typical_mAh_per_day")).toBe("mAh/day");
    expect(unitFromKey("density_g_cm3")).toBe("g/cm³");
    expect(unitFromKey("max_bitrate_Mbps")).toBe("Mbit/s");
    expect(unitFromKey("torqueNm")).toBe("N·m");
    expect(unitFromKey("baud_rate")).toBe("Bd");
    expect(unitFromKey("rpm")).toBe("rpm");
    expect(unitFromKey("hole_count")).toBe("count");
    expect(unitFromKey("peak_current_A")).toBe("A");
    expect(unitFromKey("capacity_ml")).toBe("mL");
    expect(unitFromKey("goggles_3")).toBeUndefined();
    expect(unitFromKeys(["params", "lowest_latency_ms", "goggles_3"])).toBe("ms");
  });

  it("records the unit the text shows: SI prefix, override and %; a whole number with no unit is a count", () => {
    expect(displayUnit(6300, "g", "si|d1")).toBe("kg");
    expect(displayUnit(171.9, undefined, "u=A|d1")).toBe("A");
    expect(displayUnit(420000, "Hz", "u=Bd")).toBe("Bd");
    expect(displayUnit(0.25, undefined, "pct")).toBe("%");
    expect(displayUnit(14, undefined)).toBe("count");
    expect(displayUnit(10.4, undefined)).toBe("dimensionless");
    expect(displayUnit([3.7, 13.2], "V", "d1")).toBe("V");
    expect(displayUnit(1036, "W", "nounit")).toBe("W");
    expect(displayUnit("DJI O4 Air Unit", undefined)).toBeUndefined();
  });
});

describe.each(EXAMPLES)("values.json of %s", (example) => {
  for (const doc of ["datasheet", "assembly-guide"]) {
    it(`${doc}: every numeric value has a unit consistent with its key`, () => {
      const file = join(HERE, `../../../examples/${example}/docs/${example}-${doc}.values.json`);
      const values = JSON.parse(readFileSync(file, "utf8")).values as { q: string; f?: string; text: string; unit?: string }[];
      const bad: string[] = [];
      for (const v of values) {
        // numbers only: a part number or a name that looks like one is text
        if (v.text === "—" || !NUMERIC.test(v.text) || /(partNumber|mpn|sku|name|id|version)$/i.test(keysOf(v.q).at(-1) ?? "")) continue;
        if (!v.unit) {
          bad.push(`${v.q}: "${v.text}" has no unit`);
          continue;
        }
        const expected = unitFromKeys(keysOf(v.q));
        if (expected && base(expected) !== base(v.unit)) bad.push(`${v.q}: unit ${v.unit}, its key says ${expected}`);
        // the text shows the recorded unit (unless the table header carries it)
        const shown = unitLabel(v.unit);
        if (!/nounit/.test(v.f ?? "") && !["count", "dimensionless"].includes(v.unit) && shown && !v.text.includes(shown)) bad.push(`${v.q}: "${v.text}" does not show its unit ${v.unit}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
