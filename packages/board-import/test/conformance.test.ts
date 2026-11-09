/**
 * Circuit JSON conformance: every element type, field and shape name the adapter reads or writes must exist in the
 * installed `circuit-json` package's zod schemas, so an upstream rename fails here instead of being silently ignored.
 * (The same tables are checked against the package's TypeScript types at compile time, in fields.ts.)
 */
import * as cj from "circuit-json";
import { describe, expect, it } from "vitest";
import { READ_FIELDS, ROUTE_POINT_FIELDS, WRITE_FIELDS } from "../src/index.js";

type Zod = { _def: Record<string, any>; shape?: Record<string, Zod> };

/** Every object a schema can be (union and discriminated-union options, effects and wrappers unwrapped). */
function objects(s: Zod | undefined, depth = 0): Zod[] {
  if (!s?._def || depth > 30) return [];
  const d = s._def;
  switch (d.typeName) {
    case "ZodObject":
      return [s];
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return (d.options instanceof Map ? [...d.options.values()] : d.options).flatMap((o: Zod) => objects(o, depth + 1));
    case "ZodIntersection":
      return [...objects(d.left, depth + 1), ...objects(d.right, depth + 1)];
    case "ZodEffects":
      return objects(d.schema, depth + 1);
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodBranded":
    case "ZodReadonly":
      return objects(d.innerType ?? d.type, depth + 1);
    case "ZodPipeline":
      return objects(d.in, depth + 1);
    case "ZodLazy":
      return objects(d.getter(), depth + 1);
    default:
      return [];
  }
}
/** The literal values a field can take across a schema's objects (`shape: "rect" | ...`). */
function literals(s: Zod, field: string): string[] {
  const out = new Set<string>();
  for (const o of objects(s)) {
    let f = o.shape?.[field];
    while (f?._def && ["ZodOptional", "ZodDefault", "ZodNullable", "ZodEffects"].includes(f._def.typeName)) f = f._def.innerType ?? f._def.schema;
    if (f?._def?.typeName === "ZodLiteral") out.add(String(f._def.value));
    if (f?._def?.typeName === "ZodEnum") for (const v of f._def.values) out.add(String(v));
  }
  return [...out];
}
const fields = (s: Zod) => new Set(objects(s).flatMap((o) => Object.keys(o.shape ?? {})));
const SCHEMA_OF: Record<string, string> = { source_component: "any_source_component" };
const schema = (type: string): Zod | undefined => (cj as unknown as Record<string, Zod>)[SCHEMA_OF[type] ?? type];

describe("Circuit JSON conformance", () => {
  const known = new Set(literals(cj.any_circuit_element as unknown as Zod, "type"));

  for (const [name, table] of [
    ["read", READ_FIELDS],
    ["written", WRITE_FIELDS],
  ] as const) {
    it(`every element type ${name} is an element of the installed circuit-json`, () => {
      const missing = Object.keys(table).filter((t) => !known.has(t) || !schema(t));
      expect(missing, `element types ${name} but absent from circuit-json`).toEqual([]);
    });
    it(`every field ${name} exists in its element's schema`, () => {
      const missing: string[] = [];
      for (const [type, list] of Object.entries(table)) {
        const have = fields(schema(type)!);
        for (const f of list as readonly string[]) if (!have.has(f)) missing.push(`${type}.${f}`);
      }
      expect(missing, `fields ${name} but absent from circuit-json`).toEqual([]);
    });
  }

  it("every route point field exists", () => {
    const have = fields(cj.pcb_trace_route_point as unknown as Zod);
    expect(ROUTE_POINT_FIELDS.filter((f) => !have.has(f))).toEqual([]);
    expect(literals(cj.pcb_trace_route_point as unknown as Zod, "route_type").sort()).toEqual(expect.arrayContaining(["through_pad", "via", "wire"]));
  });

  it("every shape name the adapter switches on exists", () => {
    const need: [string, string, string[]][] = [
      ["pcb_smtpad", "shape", ["rect", "rotated_rect", "circle", "pill", "rotated_pill", "polygon"]],
      ["pcb_plated_hole", "shape", ["circle", "oval", "pill", "circular_hole_with_rect_pad", "pill_hole_with_rect_pad", "rotated_pill_hole_with_rect_pad", "hole_with_polygon_pad"]],
      ["pcb_hole", "hole_shape", ["circle"]],
      ["pcb_keepout", "shape", ["rect", "circle", "outline"]],
      ["pcb_copper_pour", "shape", ["rect", "polygon", "brep"]],
      ["pcb_cutout", "shape", ["rect", "circle", "polygon"]],
      ["pcb_silkscreen_text", "anchor_alignment", ["center", "center_left", "center_right"]],
    ];
    const missing: string[] = [];
    for (const [type, field, values] of need) {
      const have = new Set(literals(schema(type)!, field));
      for (const v of values) if (!have.has(v)) missing.push(`${type}.${field}=${v}`);
    }
    expect(missing).toEqual([]);
  });

  it("the walker finds fields (a field the package never had is reported missing)", () => {
    expect(fields(cj.pcb_smtpad as unknown as Zod).has("x")).toBe(true);
    expect(fields(cj.pcb_smtpad as unknown as Zod).has("no_such_field")).toBe(false);
  });
});
