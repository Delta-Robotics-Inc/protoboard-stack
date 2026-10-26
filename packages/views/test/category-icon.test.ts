import { describe, expect, it } from "vitest";
import { icons } from "lucide-react";
import { categoryIcon } from "../src/parts/ui.js";

const pascal = (name: string) => name.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

describe("category icons (PB-902)", () => {
  it("come from the most specific segment of a taxonomy path", () => {
    expect(categoryIcon("sensor")).toBe("radar");
    expect(categoryIcon("sensor.environmental.gas")).toBe("wind");
    expect(categoryIcon("sensor.environmental.humidity")).toBe("droplets");
    expect(categoryIcon("sensor.environmental.temperature")).toBe("thermometer");
    expect(categoryIcon("sensor.distance")).toBe("ruler");
    expect(categoryIcon("microcontroller.module")).toBe("circuit-board");
    // sibling categories under one parent get icons of their own
    const siblings = ["gas", "humidity", "temperature"].map((c) => categoryIcon(`sensor.environmental.${c}`));
    expect(new Set(siblings).size).toBe(3);
  });

  it("are Lucide icons", () => {
    for (const p of ["sensor", "sensor.environmental.gas", "sensor.environmental.humidity", "power.regulator", "unknown.thing"]) {
      expect(icons[pascal(categoryIcon(p)) as keyof typeof icons], p).toBeTruthy();
    }
  });
});
