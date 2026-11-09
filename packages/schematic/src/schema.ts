/**
 * Schematic records (contract section 4.1): zod schemas, ids and the file each kind lives in. Coordinates are
 * integer grid units, +Y down. Optional fields are omitted, never null.
 */
import { z } from "zod";

export const SCHEMA_ID = "protoboard.schematic/v1";

export const Gu = z.number().int().safe();
export const PositiveGu = Gu.positive();
export const Point = z.tuple([Gu, Gu]);
export type Point = z.infer<typeof Point>;

export const KEY_PATTERN = /^[A-Za-z0-9_.\-/+~:]+$/;
export const Key = z.string().min(1).max(240).regex(KEY_PATTERN, "keys use letters, digits and _ . - / + ~ :");
export const NetName = z.string().min(1).max(200);
export const Pinned = z.literal(true).optional();
export const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export const DirSchema = z.enum(["left", "right", "up", "down"]);

export const ProvenanceSchema = z
  .object({
    by: z.enum(["layout", "hand", "agent", "imported", "system"]),
    tool: z.string().max(120).optional(),
    actor: z.string().max(120).optional(),
    edited: z.enum(["hand", "agent", "layout"]).optional(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}:[A-Za-z0-9_.\\-/+~:]+$`), `id is ${prefix}:<key>`);

export const SchematicRec = z
  .object({
    kind: z.literal("schematic"),
    id: z.literal("schematic"),
    name: z.string().min(1).max(200),
    source: z.object({ board: z.string(), hash: z.string() }).strict(),
    title_block: z
      .object({ title: z.string().max(200).optional(), rev: z.string().max(40).optional(), date: z.string().max(40).optional(), company: z.string().max(200).optional(), comment: z.string().max(400).optional() })
      .strict()
      .optional(),
    settings: z
      .object({
        bend_limit: z.number().int().min(0).max(20),
        gutter: z.number().int().min(1).max(40),
        rails: z.array(NetName).optional(),
      })
      .strict(),
  })
  .strict();

export const CardRec = z
  .object({
    kind: z.literal("card"),
    id: id("card"),
    group: z.string(),
    title: z.string().max(120),
    subtitle: z.string().max(200).optional(),
    x: Gu,
    y: Gu,
    w: PositiveGu,
    h: PositiveGu,
    pinned: Pinned,
    provenance: ProvenanceSchema,
  })
  .strict();

export const SymbolRec = z
  .object({
    kind: z.literal("symbol"),
    id: id("sym"),
    part: z.string().min(1),
    ref: z.string().min(1).max(20),
    card: id("card"),
    x: Gu,
    y: Gu,
    rotation: RotationSchema,
    mirror: z.literal(true).optional(),
    variant: z.string().max(60).optional(),
    symbol: z.string().max(120).optional(),
    hide_unused: z.literal(true).optional(),
    /** where a box symbol's reference sits, from the symbol origin (the value is the line below); default above the body's left edge */
    fields: z.object({ dx: Gu, dy: Gu, anchor: z.enum(["left", "right"]) }).strict().optional(),
    pinned: Pinned,
    provenance: ProvenanceSchema,
  })
  .strict();

export const WireRec = z
  .object({
    kind: z.literal("wire"),
    id: id("wire"),
    net: NetName,
    card: id("card"),
    points: z.array(Point).min(2).max(10_000),
    pinned: Pinned,
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((w, ctx) => {
    for (let i = 1; i < w.points.length; i++) {
      const [a, b] = [w.points[i - 1], w.points[i]];
      if (a[0] !== b[0] && a[1] !== b[1]) ctx.addIssue({ code: "custom", message: `segment ${i} is not horizontal or vertical`, path: ["points", i] });
      if (a[0] === b[0] && a[1] === b[1]) ctx.addIssue({ code: "custom", message: `segment ${i} has no length`, path: ["points", i] });
    }
  });

export const LabelRec = z
  .object({
    kind: z.literal("label"),
    id: id("lbl"),
    net: NetName,
    card: id("card"),
    x: Gu,
    y: Gu,
    side: DirSchema,
    scope: z.enum(["local", "port"]),
    pinned: Pinned,
    provenance: ProvenanceSchema,
  })
  .strict();

export const PowerRec = z
  .object({
    kind: z.literal("power"),
    id: id("pwr"),
    net: NetName,
    card: id("card"),
    x: Gu,
    y: Gu,
    dir: z.enum(["up", "down"]),
    style: z.enum(["rail", "ground"]),
    pinned: Pinned,
    provenance: ProvenanceSchema,
  })
  .strict();

export const NoconnectRec = z.object({ kind: z.literal("noconnect"), id: id("nc"), pin: z.string().min(3), provenance: ProvenanceSchema }).strict();

export const TextRec = z
  .object({
    kind: z.literal("text"),
    id: id("txt"),
    card: id("card").optional(),
    x: Gu,
    y: Gu,
    text: z.string().min(1).max(2000),
    role: z.enum(["note", "heading"]),
    pinned: Pinned,
    provenance: ProvenanceSchema,
  })
  .strict();

export const FrameRec = z.object({ kind: z.literal("frame"), id: id("frm"), x: Gu, y: Gu, w: PositiveGu, h: PositiveGu, title: z.string().max(120).optional(), provenance: ProvenanceSchema }).strict();

export const OpCallSchema = z.object({ op: z.string() }).passthrough();
export const ProposalRec = z
  .object({
    kind: z.literal("proposal"),
    id: id("prop"),
    title: z.string().min(1).max(200),
    ops: z.array(OpCallSchema).min(1).max(200),
    rule: z.string().max(10).optional(),
    defects: z.array(z.string()).optional(),
    score: z.object({ before: z.number(), after: z.number() }).strict().optional(),
    provenance: ProvenanceSchema,
  })
  .strict();

export const RECORD_SCHEMAS = {
  schematic: SchematicRec,
  card: CardRec,
  symbol: SymbolRec,
  wire: WireRec,
  label: LabelRec,
  power: PowerRec,
  noconnect: NoconnectRec,
  text: TextRec,
  frame: FrameRec,
  proposal: ProposalRec,
} as const;
export type RecordKind = keyof typeof RECORD_SCHEMAS;
export const RECORD_KINDS = Object.keys(RECORD_SCHEMAS) as RecordKind[];

export type SchematicRecT = z.infer<typeof SchematicRec>;
export type CardRecT = z.infer<typeof CardRec>;
export type SymbolRecT = z.infer<typeof SymbolRec>;
export type WireRecT = z.infer<typeof WireRec>;
export type LabelRecT = z.infer<typeof LabelRec>;
export type PowerRecT = z.infer<typeof PowerRec>;
export type NoconnectRecT = z.infer<typeof NoconnectRec>;
export type TextRecT = z.infer<typeof TextRec>;
export type FrameRecT = z.infer<typeof FrameRec>;
export type ProposalRecT = z.infer<typeof ProposalRec>;
export type SchematicRecord = SchematicRecT | CardRecT | SymbolRecT | WireRecT | LabelRecT | PowerRecT | NoconnectRecT | TextRecT | FrameRecT | ProposalRecT;
export type RecordOf<K extends RecordKind> = Extract<SchematicRecord, { kind: K }>;

export const ID_PREFIX: Record<RecordKind, string> = {
  schematic: "schematic",
  card: "card",
  symbol: "sym",
  wire: "wire",
  label: "lbl",
  power: "pwr",
  noconnect: "nc",
  text: "txt",
  frame: "frm",
  proposal: "prop",
};

/** The files of a schematic folder; proposals are local state (contract section 5). */
export const SCHEMATIC_FILES = ["schematic", "symbols", "wires"] as const;
export type SchematicFile = (typeof SCHEMATIC_FILES)[number] | "proposals";
export const FILE_OF: Record<RecordKind, SchematicFile> = {
  schematic: "schematic",
  card: "schematic",
  frame: "schematic",
  text: "schematic",
  symbol: "symbols",
  noconnect: "symbols",
  wire: "wires",
  label: "wires",
  power: "wires",
  proposal: "proposals",
};

/** Kinds that carry `pinned`. */
export const PINNABLE: ReadonlySet<RecordKind> = new Set(["card", "symbol", "wire", "label", "power", "text"]);
/** Kinds that sit on the sheet and can be moved. */
export const MOVABLE: ReadonlySet<RecordKind> = new Set(["card", "symbol", "wire", "label", "power", "text", "frame"]);

export function kindOfId(id: string): RecordKind | undefined {
  if (id === "schematic") return "schematic";
  const p = id.slice(0, id.indexOf(":"));
  return (Object.keys(ID_PREFIX) as RecordKind[]).find((k) => ID_PREFIX[k] === p && k !== "schematic");
}

export function validateRecord(rec: SchematicRecord): { ok: true } | { ok: false; error: string; issues?: unknown } {
  const schema = RECORD_SCHEMAS[rec.kind as RecordKind];
  if (!schema) return { ok: false, error: `${(rec as { id?: string }).id}: unknown kind ${String((rec as { kind: unknown }).kind)}` };
  const r = (schema as z.ZodTypeAny).safeParse(rec);
  if (!r.success) return { ok: false, error: `${rec.id}: ${r.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ")}`, issues: r.error.issues };
  if (kindOfId(rec.id) !== rec.kind) return { ok: false, error: `${rec.id} is not a valid id for a ${rec.kind}` };
  return { ok: true };
}
