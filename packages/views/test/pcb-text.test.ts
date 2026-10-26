/**
 * The PCB view's routed drawing sets silkscreen and fabrication text at 100
 * times its size and scales it down: Chrome draws a font of a millimetre or
 * less with doubled glyphs once the drawing is zoomed (seen on the watch's
 * designators, 2026-10-21).
 */
import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { shapeEl } from "../src/drawing/CircuitPcbView.js";
import type { Piece } from "../src/drawing/circuit.js";

describe("PCB view text", () => {
  it("is set large and scaled down to its size, keeping its place, turn and side", () => {
    const piece = { shape: { kind: "text", x: 3, y: -4, text: "R12", size: 0.8, rotate: 90, anchor: "middle" } } as unknown as Piece;
    const el = shapeEl(piece, 0, false, {}) as ReactElement<{ fontSize: number; transform: string; children: string }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.props.fontSize).toBeCloseTo(80);
    expect(el.props.transform).toBe("translate(3 -4) rotate(90) scale(0.01)");
    expect(el.props.children).toBe("R12");
    const flipped = shapeEl(piece, 0, true, {}) as ReactElement<{ transform: string }>;
    expect(flipped.props.transform).toBe("translate(3 -4) scale(-1 1) rotate(-90) scale(0.01)");
  });
});
