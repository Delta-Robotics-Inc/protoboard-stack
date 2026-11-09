/**
 * JSON Schema (draft 2020-12 subset) for the zod schemas the operation registry uses, so `board.operations`, the
 * CLI's `board ops` and MCP clients see each operation's input exactly as the engine validates it. Covers the zod 3
 * constructs the board package uses; refinements are not expressible and are left to the engine's own check.
 */
import type { z } from "zod";

export type JsonSchema = Record<string, unknown>;

interface Def {
  typeName?: string;
  description?: string;
  checks?: { kind: string; value?: unknown; inclusive?: boolean; regex?: RegExp }[];
  [k: string]: unknown;
}

const defOf = (s: z.ZodTypeAny): Def => (s as unknown as { _def: Def })._def;
/** Lazy schemas being converted (a recursive one stops at its second use). */
const lazyActive = new Set<z.ZodTypeAny>();

function withDescription(out: JsonSchema, def: Def): JsonSchema {
  return def.description ? { ...out, description: def.description } : out;
}

/** The JSON Schema of a zod schema. Unknown constructs become `{}` (anything), never an error. */
export function toJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const def = defOf(schema);
  return withDescription(convert(schema, def), def);
}

function convert(schema: z.ZodTypeAny, def: Def): JsonSchema {
  switch (def.typeName) {
    case "ZodString": {
      const out: JsonSchema = { type: "string" };
      for (const c of def.checks ?? []) {
        if (c.kind === "min") out.minLength = c.value;
        else if (c.kind === "max") out.maxLength = c.value;
        else if (c.kind === "length") out.minLength = out.maxLength = c.value;
        else if (c.kind === "regex" && c.regex) out.pattern = c.regex.source;
      }
      return out;
    }
    case "ZodNumber": {
      const out: JsonSchema = { type: "number" };
      for (const c of def.checks ?? []) {
        if (c.kind === "int") out.type = "integer";
        else if (c.kind === "min") out[c.inclusive ? "minimum" : "exclusiveMinimum"] = c.value;
        else if (c.kind === "max") out[c.inclusive ? "maximum" : "exclusiveMaximum"] = c.value;
        else if (c.kind === "multipleOf") out.multipleOf = c.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodLiteral":
      return { const: def.value };
    case "ZodEnum":
      return { type: "string", enum: [...(def.values as string[])] };
    case "ZodNativeEnum":
      return { enum: Object.values(def.values as Record<string, unknown>) };
    case "ZodArray": {
      const out: JsonSchema = { type: "array", items: toJsonSchema(def.type as z.ZodTypeAny) };
      const min = def.minLength as { value: number } | null;
      const max = def.maxLength as { value: number } | null;
      const exact = def.exactLength as { value: number } | null;
      if (min) out.minItems = min.value;
      if (max) out.maxItems = max.value;
      if (exact) out.minItems = out.maxItems = exact.value;
      return out;
    }
    case "ZodTuple":
      return { type: "array", prefixItems: (def.items as z.ZodTypeAny[]).map(toJsonSchema), minItems: (def.items as unknown[]).length, ...(def.rest ? { items: toJsonSchema(def.rest as z.ZodTypeAny) } : { maxItems: (def.items as unknown[]).length }) };
    case "ZodObject": {
      const shape = (schema as unknown as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = toJsonSchema(v);
        if (!v.isOptional()) required.push(k);
      }
      const unknownKeys = def.unknownKeys as string | undefined;
      const catchall = def.catchall as z.ZodTypeAny | undefined;
      const catchallName = catchall ? defOf(catchall).typeName : undefined;
      const additional = catchallName && catchallName !== "ZodNever" ? toJsonSchema(catchall!) : unknownKeys !== "strict";
      return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: additional };
    }
    case "ZodRecord":
      return { type: "object", additionalProperties: toJsonSchema(def.valueType as z.ZodTypeAny) };
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = (Array.isArray(def.options) ? def.options : [...(def.options as Map<unknown, z.ZodTypeAny>).values()]) as z.ZodTypeAny[];
      return { anyOf: options.map(toJsonSchema) };
    }
    case "ZodIntersection":
      return { allOf: [toJsonSchema(def.left as z.ZodTypeAny), toJsonSchema(def.right as z.ZodTypeAny)] };
    case "ZodOptional":
      return toJsonSchema(def.innerType as z.ZodTypeAny);
    case "ZodNullable":
      return { anyOf: [toJsonSchema(def.innerType as z.ZodTypeAny), { type: "null" }] };
    case "ZodDefault":
      return { ...toJsonSchema(def.innerType as z.ZodTypeAny), default: (def.defaultValue as () => unknown)() };
    case "ZodEffects":
      return toJsonSchema(def.schema as z.ZodTypeAny);
    case "ZodLazy": {
      // a recursive schema (a rule condition) is written out once; its inner use is left open
      if (lazyActive.has(schema)) return { description: "recursive: the same schema as its enclosing one" };
      lazyActive.add(schema);
      try {
        return toJsonSchema((def.getter as () => z.ZodTypeAny)());
      } finally {
        lazyActive.delete(schema);
      }
    }
    case "ZodBranded":
      return toJsonSchema(def.type as z.ZodTypeAny);
    case "ZodReadonly":
    case "ZodCatch":
      return toJsonSchema(def.innerType as z.ZodTypeAny);
    case "ZodPipeline":
      return toJsonSchema(def.in as z.ZodTypeAny);
    default:
      // ZodUnknown, ZodAny and anything newer: no constraint
      return {};
  }
}
