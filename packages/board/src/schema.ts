/**
 * The board document's record types and their zod schemas (contract section 4). Lengths are integer
 * nanometers, angles integer millidegrees. Field names follow Circuit JSON where the concept exists.
 */
import { z } from "zod";

export const SCHEMA_ID = "protoboard.board/v1";
export const NETLIST_SCHEMA_ID = "protoboard.netlist/v1";

// ---------------------------------------------------------------- scalars

/** An integer length in nanometers. */
export const Nm = z.number().int().safe();
export const PositiveNm = Nm.positive();
export const NonNegativeNm = Nm.nonnegative();
/** A rotation in millidegrees, [0, 360000). */
export const Rotation = z.number().int().min(0).max(359_999);
/** An arc sweep in millidegrees: signed, nonzero, at most one turn. */
export const Sweep = z
  .number()
  .int()
  .min(-360_000)
  .max(360_000)
  .refine((v) => v !== 0, "sweep must not be 0");

export const COPPER_LAYERS = ["top", "inner1", "inner2", "inner3", "inner4", "inner5", "inner6", "inner7", "inner8", "bottom"] as const;
export const CopperLayer = z.enum(COPPER_LAYERS);
export type CopperLayer = z.infer<typeof CopperLayer>;

export const DRAWING_LAYERS = [
  "top_silkscreen",
  "bottom_silkscreen",
  "top_soldermask",
  "bottom_soldermask",
  "top_paste",
  "bottom_paste",
  "top_fabrication",
  "bottom_fabrication",
  "top_courtyard",
  "bottom_courtyard",
  "edge_cuts",
  "user_notes",
] as const;
export const DrawingLayer = z.enum(DRAWING_LAYERS);
export type DrawingLayer = z.infer<typeof DrawingLayer>;
/** Any layer a graphic or text may sit on. */
export const AnyLayer = z.union([CopperLayer, DrawingLayer]);
export type AnyLayer = z.infer<typeof AnyLayer>;

export const Side = z.enum(["top", "bottom"]);
export type Side = z.infer<typeof Side>;

/** Key characters (the part of an id after its prefix). */
export const KEY_PATTERN = /^[A-Za-z0-9_.\-/+~]+$/;
export const Key = z.string().min(1).max(200).regex(KEY_PATTERN, "keys use letters, digits and _ . - / + ~");
/** A net name: any printable text without control characters. */
export const NetName = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "net names have no control characters");
/** An object id: `<prefix>:<key>`, or a singleton (`board`, `outline`). */
export const ObjectId = z
  .string()
  .min(1)
  .max(260)
  .refine((s) => s === "board" || s === "outline" || /^[a-z]+:.+$/.test(s), "an id is <prefix>:<key>, or board, or outline");

export const Point = z.object({ x: Nm, y: Nm }).strict();
export type Point = z.infer<typeof Point>;
/** A contour vertex: `sweep` is the arc from this vertex to the next (absent: a straight edge). */
export const Vertex = z.object({ x: Nm, y: Nm, sweep: Sweep.optional() }).strict();
export type Vertex = z.infer<typeof Vertex>;
export const Contour = z.array(Vertex).min(3).max(100_000);
export const OpenPath = z.array(Vertex).min(2).max(100_000);

export const ProvenanceBy = z.enum(["generated", "imported", "routed", "hand", "agent", "system"]);
export const Provenance = z
  .object({
    by: ProvenanceBy,
    tool: z.string().min(1).max(120).optional(),
    actor: z.string().min(1).max(120).optional(),
    run: z.string().min(1).max(120).optional(),
    edited: z.enum(["hand", "agent", "routed", "system"]).optional(),
  })
  .strict();
export type Provenance = z.infer<typeof Provenance>;

const Locked = z.literal(true).optional();

// ---------------------------------------------------------------- records

export const BoardRec = z
  .object({
    kind: z.literal("board"),
    id: z.literal("board"),
    name: z.string().min(1).max(120),
    thickness: PositiveNm,
    copper_layers: z.number().int().min(1).max(10),
    origin: z.literal("center"),
    workflow: z.object({ order: z.enum(["cad-first", "board-first"]) }).strict().optional(),
    /** Reserved for solver interfaces (contract: simulation seams). */
    simulation: z.record(z.string(), z.unknown()).optional(),
    provenance: Provenance.optional(),
  })
  .strict();

export const LayerRec = z
  .object({
    kind: z.literal("layer"),
    id: ObjectId,
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    type: z.enum(["copper", "dielectric", "soldermask"]),
    order: z.number().int().min(0).max(64),
    thickness: PositiveNm,
    material: z.string().min(1).max(60).optional(),
    epsilon_r: z.number().positive().finite().optional(),
    loss_tangent: z.number().nonnegative().finite().optional(),
    copper_weight_oz: z.number().positive().finite().optional(),
  })
  .strict();

export const OutlineSource = z.union([z.object({ kind: z.literal("board") }).strict(), z.object({ kind: z.literal("cad"), ref: z.string().min(1).max(500) }).strict()]);

export const OutlineRec = z
  .object({ kind: z.literal("outline"), id: z.literal("outline"), outline: Contour, source: OutlineSource, locked: Locked, provenance: Provenance.optional() })
  .strict();

export const CutoutRec = z.object({ kind: z.literal("cutout"), id: ObjectId, outline: Contour, locked: Locked, provenance: Provenance.optional() }).strict();

export const Pad = z
  .object({
    number: z.string().min(1).max(40),
    type: z.enum(["smd", "th", "np"]),
    shape: z.enum(["rect", "roundrect", "circle", "oval", "polygon"]),
    x: Nm,
    y: Nm,
    rotation: Rotation.optional(),
    width: PositiveNm.optional(),
    height: PositiveNm.optional(),
    corner_radius: NonNegativeNm.optional(),
    radius: PositiveNm.optional(),
    points: Contour.optional(),
    layer: z.literal("top").optional(),
    outer_diameter: PositiveNm.optional(),
    hole_diameter: PositiveNm.optional(),
    outer_width: PositiveNm.optional(),
    outer_height: PositiveNm.optional(),
    hole_width: PositiveNm.optional(),
    hole_height: PositiveNm.optional(),
    mask_margin: Nm.optional(),
    paste_margin: Nm.optional(),
    pin: z.string().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const need = (field: keyof typeof p, why: string) => {
      if (p[field] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${why} needs ${String(field)}` });
    };
    if (p.type === "smd") {
      need("layer", "an smd pad");
      if (p.shape === "circle") need("radius", "a circle smd pad");
      else if (p.shape === "polygon") need("points", "a polygon pad");
      else {
        need("width", `a ${p.shape} smd pad`);
        need("height", `a ${p.shape} smd pad`);
      }
    } else if (p.type === "th") {
      if (p.shape === "circle") {
        need("outer_diameter", "a round through-hole pad");
        need("hole_diameter", "a round through-hole pad");
      } else {
        need("outer_width", "a slotted or shaped through-hole pad");
        need("outer_height", "a slotted or shaped through-hole pad");
        if (p.hole_diameter === undefined) {
          need("hole_width", "a slotted through-hole pad");
          need("hole_height", "a slotted through-hole pad");
        }
      }
    } else need("hole_diameter", "a non-plated hole");
  });
export type Pad = z.infer<typeof Pad>;

export const FootprintGraphic = z
  .object({
    layer: AnyLayer,
    shape: z.enum(["line", "arc", "circle", "rect", "polygon", "path"]),
    start: Point.optional(),
    end: Point.optional(),
    sweep: Sweep.optional(),
    center: Point.optional(),
    radius: PositiveNm.optional(),
    width: PositiveNm.optional(),
    height: PositiveNm.optional(),
    rotation: Rotation.optional(),
    points: OpenPath.optional(),
    stroke_width: NonNegativeNm,
    filled: z.literal(true).optional(),
  })
  .strict();
export type FootprintGraphic = z.infer<typeof FootprintGraphic>;

export const TextAnchor = z.enum(["center", "left", "right"]);
export const FootprintText = z
  .object({
    layer: AnyLayer,
    text: z.string().min(1).max(500),
    x: Nm,
    y: Nm,
    height: PositiveNm,
    stroke_width: PositiveNm.optional(),
    rotation: Rotation.optional(),
    anchor: TextAnchor.optional(),
    /** `ref` and `value` texts show the footprint's own fields. */
    role: z.enum(["ref", "value", "user"]).optional(),
  })
  .strict();
export type FootprintText = z.infer<typeof FootprintText>;

export const FootprintRec = z
  .object({
    kind: z.literal("footprint"),
    id: ObjectId,
    ref: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "a reference designator such as U1"),
    path: z.string().min(1).max(200).optional(),
    footprint: z.string().min(1).max(200),
    value: z.string().min(1).max(200).optional(),
    supplier_part: z.string().min(1).max(60).optional(),
    x: Nm,
    y: Nm,
    rotation: Rotation,
    side: Side,
    pads: z.array(Pad).max(5000),
    courtyard: Contour.optional(),
    graphics: z.array(FootprintGraphic).max(5000).optional(),
    texts: z.array(FootprintText).max(100).optional(),
    locked: Locked,
    provenance: Provenance,
  })
  .strict();

export const TrackRec = z
  .object({
    kind: z.literal("track"),
    id: ObjectId,
    net: NetName.optional(),
    layer: CopperLayer,
    width: PositiveNm,
    start: Point,
    end: Point,
    sweep: Sweep.optional(),
    locked: Locked,
    provenance: Provenance,
  })
  .strict();

export const ViaRec = z
  .object({
    kind: z.literal("via"),
    id: ObjectId,
    net: NetName.optional(),
    x: Nm,
    y: Nm,
    outer_diameter: PositiveNm,
    hole_diameter: PositiveNm,
    from_layer: CopperLayer,
    to_layer: CopperLayer,
    tented: z.enum(["both", "top", "bottom", "none"]).optional(),
    locked: Locked,
    provenance: Provenance,
  })
  .strict();

export const ZoneFields = z
  .object({
    net: NetName.optional(),
    layers: z.array(CopperLayer).min(1).max(10),
    outline: Contour,
    priority: z.number().int().min(0).max(1000),
    clearance: NonNegativeNm.optional(),
    min_width: PositiveNm.optional(),
    pad_connection: z.enum(["thermal", "solid", "none"]),
    thermal_gap: PositiveNm.optional(),
    thermal_spoke_width: PositiveNm.optional(),
    fill_mode: z.enum(["solid", "hatch"]),
    hatch_width: PositiveNm.optional(),
    hatch_gap: PositiveNm.optional(),
    remove_islands: z.enum(["always", "never", "below_area"]),
    /** Square nanometers (an integer: 1 mm squared is 1e12). */
    island_min_area: z.number().int().safe().positive().optional(),
    name: z.string().min(1).max(120).optional(),
    locked: Locked,
  })
  .strict();
export const ZoneRec = ZoneFields.extend({ kind: z.literal("zone"), id: ObjectId, provenance: Provenance }).strict();

export const KeepoutBlocks = z.object({ tracks: z.boolean(), vias: z.boolean(), pours: z.boolean(), footprints: z.boolean() }).strict();
export const KeepoutFields = z
  .object({
    outline: Contour,
    layers: z.array(CopperLayer).min(1).max(10),
    blocks: KeepoutBlocks,
    tier: z.enum(["no_go", "policy"]),
    footprint: ObjectId.optional(),
    name: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(500).optional(),
    locked: Locked,
  })
  .strict();
export const KeepoutRec = KeepoutFields.extend({ kind: z.literal("keepout"), id: ObjectId, provenance: Provenance }).strict();

export const GraphicRec = FootprintGraphic.extend({ kind: z.literal("graphic"), id: ObjectId, locked: Locked, provenance: Provenance }).strict();

export const TextRec = z
  .object({
    kind: z.literal("text"),
    id: ObjectId,
    layer: AnyLayer,
    text: z.string().min(1).max(500),
    x: Nm,
    y: Nm,
    height: PositiveNm,
    stroke_width: PositiveNm.optional(),
    rotation: Rotation.optional(),
    anchor: TextAnchor.optional(),
    mirrored: z.literal(true).optional(),
    locked: Locked,
    provenance: Provenance,
  })
  .strict();

export const NetclassRec = z
  .object({
    kind: z.literal("netclass"),
    id: ObjectId,
    name: z.string().regex(/^[A-Za-z0-9_.\-+]+$/),
    nets: z.array(NetName).max(10_000).optional(),
    patterns: z.array(z.string().min(1).max(200)).max(100).optional(),
    description: z.string().min(1).max(500).optional(),
    provenance: Provenance.optional(),
  })
  .strict();

export const RULE_TIERS = ["floor", "target", "policy", "no_go"] as const;
export const RuleTier = z.enum(RULE_TIERS);
export type RuleTier = z.infer<typeof RuleTier>;
export const RULE_CHECKS = [
  "clearance",
  "track_width",
  "via_diameter",
  "via_hole",
  "annular_ring",
  "hole_clearance",
  "hole_to_hole",
  "edge_clearance",
  "silk_to_pad",
  "courtyard_overlap",
  "via_in_pad",
  "via_under_footprint",
  "length",
  "diff_pair_gap",
] as const;
export const RuleCheck = z.enum(RULE_CHECKS);
export const ObjectKindName = z.enum(["pad", "track", "via", "zone", "keepout", "footprint", "outline", "cutout", "graphic", "text", "hole"]);
export const RuleApplies = z
  .object({
    nets: z.array(NetName).max(10_000).optional(),
    classes: z.array(z.string().min(1).max(60)).max(100).optional(),
    layers: z.array(AnyLayer).max(30).optional(),
    between: z.tuple([ObjectKindName, ObjectKindName]).optional(),
    region: Contour.optional(),
  })
  .strict();
export const Severity = z.enum(["error", "warning", "info", "ignore"]);
export const RuleRec = z
  .object({
    kind: z.literal("rule"),
    id: ObjectId,
    tier: RuleTier,
    check: RuleCheck,
    applies: RuleApplies,
    min: NonNegativeNm.optional(),
    max: NonNegativeNm.optional(),
    preferred: NonNegativeNm.optional(),
    cost: z.number().nonnegative().finite().optional(),
    severity: Severity.optional(),
    enabled: z.literal(false).optional(),
    note: z.string().min(1).max(500).optional(),
    provenance: Provenance.optional(),
  })
  .strict();

export const RECORD_SCHEMAS = {
  board: BoardRec,
  layer: LayerRec,
  outline: OutlineRec,
  cutout: CutoutRec,
  footprint: FootprintRec,
  track: TrackRec,
  via: ViaRec,
  zone: ZoneRec,
  keepout: KeepoutRec,
  graphic: GraphicRec,
  text: TextRec,
  netclass: NetclassRec,
  rule: RuleRec,
} as const;

export type RecordKind = keyof typeof RECORD_SCHEMAS;
export const RECORD_KINDS = Object.keys(RECORD_SCHEMAS) as RecordKind[];

export type BoardRec = z.infer<typeof BoardRec>;
export type LayerRec = z.infer<typeof LayerRec>;
export type OutlineRec = z.infer<typeof OutlineRec>;
export type CutoutRec = z.infer<typeof CutoutRec>;
export type FootprintRec = z.infer<typeof FootprintRec>;
export type TrackRec = z.infer<typeof TrackRec>;
export type ViaRec = z.infer<typeof ViaRec>;
export type ZoneRec = z.infer<typeof ZoneRec>;
export type KeepoutRec = z.infer<typeof KeepoutRec>;
export type GraphicRec = z.infer<typeof GraphicRec>;
export type TextRec = z.infer<typeof TextRec>;
export type NetclassRec = z.infer<typeof NetclassRec>;
export type RuleRec = z.infer<typeof RuleRec>;
export type BoardRecord = BoardRec | LayerRec | OutlineRec | CutoutRec | FootprintRec | TrackRec | ViaRec | ZoneRec | KeepoutRec | GraphicRec | TextRec | NetclassRec | RuleRec;
export type RecordOf<K extends RecordKind> = z.infer<(typeof RECORD_SCHEMAS)[K]>;

/** Any record, discriminated by `kind`. */
export const AnyRecord = z.discriminatedUnion("kind", [BoardRec, LayerRec, OutlineRec, CutoutRec, FootprintRec, TrackRec, ViaRec, ZoneRec, KeepoutRec, GraphicRec, TextRec, NetclassRec, RuleRec]);

/** The id prefix of each kind (singletons have none). */
export const ID_PREFIX: Record<RecordKind, string> = {
  board: "",
  layer: "layer",
  outline: "",
  cutout: "cutout",
  footprint: "fp",
  track: "trk",
  via: "via",
  zone: "zone",
  keepout: "kpo",
  graphic: "gfx",
  text: "txt",
  netclass: "class",
  rule: "rule",
};

/** Which file each kind is saved in (contract section 7). */
export const FILE_OF: Record<RecordKind, BoardFile> = {
  board: "board",
  layer: "board",
  outline: "board",
  cutout: "board",
  footprint: "placement",
  track: "copper",
  via: "copper",
  zone: "zones",
  keepout: "zones",
  graphic: "graphics",
  text: "graphics",
  netclass: "rules",
  rule: "rules",
};
export const BOARD_FILES = ["board", "placement", "copper", "zones", "graphics", "rules"] as const;
export type BoardFile = (typeof BOARD_FILES)[number];

/** The kinds a lock applies to (contract section 6). */
export const LOCKABLE_KINDS: ReadonlySet<RecordKind> = new Set(["footprint", "track", "via", "zone", "keepout", "outline", "cutout", "graphic", "text"]);

/** The kind an id names, from its prefix (pads and nets are derived: `pad`, `net`). */
export function kindOfId(id: string): RecordKind | "pad" | "net" | undefined {
  if (id === "board") return "board";
  if (id === "outline") return "outline";
  const prefix = id.slice(0, id.indexOf(":"));
  if (prefix === "pad") return "pad";
  if (prefix === "net") return "net";
  return (Object.entries(ID_PREFIX).find(([, p]) => p && p === prefix)?.[0] as RecordKind | undefined) ?? undefined;
}

/** Whether `id` is well formed for a record of `kind`. */
export function idMatchesKind(id: string, kind: RecordKind): boolean {
  if (kind === "board") return id === "board";
  if (kind === "outline") return id === "outline";
  const prefix = `${ID_PREFIX[kind]}:`;
  if (!id.startsWith(prefix)) return false;
  const key = id.slice(prefix.length);
  if (kind === "netclass") return /^[A-Za-z0-9_.\-+]+$/.test(key);
  return KEY_PATTERN.test(key);
}

// ---------------------------------------------------------------- netlist

export const NetlistNet = z
  .object({
    name: NetName,
    class: z.string().min(1).max(60).optional(),
    pins: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*\.[^\s]+$/, "pins are <ref>.<pad number>")).max(100_000),
  })
  .strict();
export const Netlist = z.object({ source: z.string().min(1).max(60), nets: z.array(NetlistNet).max(100_000) }).strict();
export type Netlist = z.infer<typeof Netlist>;
export type NetlistNet = z.infer<typeof NetlistNet>;
