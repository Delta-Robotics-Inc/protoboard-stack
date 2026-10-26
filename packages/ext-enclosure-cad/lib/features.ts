/**
 * Enclosure features as UHD interfaces.
 *
 * An enclosure is a module whose interfaces are the features it must
 * provide. Each feature is an ordinary mechanical interface carrying one
 * `enclosure_feature` trait: what kind of feature it is, its size in mm, the
 * standard part it takes (O-ring, insert, spring bar) and, for features that
 * give access to something inside, the part it serves. Nothing here names a
 * CAD tool: an Onshape or Zoo provider reads the same interfaces.
 *
 *   opening      a cut through a wall for a connector, a port or a vent
 *   button       a bore and a separate plunger pressing a switch inside
 *   window       an aperture with a pocket for a cover (glass, IR window)
 *   light_pipe   a hole for a light pipe over an LED
 *   boss         bosses with heat-set insert holes (a bolt pattern)
 *   seal_gland   an O-ring groove: face (at the lid joint or at a frame) or radial
 *   thread       an internal thread (a cap on a neck)
 *   strap_lugs   a pair of lugs with spring-bar holes
 *   joint        the lid joint and its fasteners
 *   twist_lid    a lid that closes without screws: a threaded or bayonet collar
 *                on a round base, the lid's skirt over it, sealed by a radial
 *                O-ring on the collar (a SealGland radial at "joint")
 *
 * `serves` names an interface of a sibling module in the system the
 * enclosure sits in ({ child: "board", interfaceId: "usb" }); the feature is
 * placed on, and checked against, that interface's frame. This relation is a
 * candidate for a UHD link kind; until then it is a trait parameter.
 */
import { BoltPattern, type BoltPatternConfig, type ArtifactDef, type GeometryFrame, type InterfaceDef, type ModuleDef } from "@deltarobotics/uhd";
import { as568, glandRow, lugHole, type Insert, type ORing, type Plug, type Screw, type SpringBar } from "./standards.ts";

export const FEATURE_TRAIT = "enclosure_feature";
export const FEATURE_KINDS = ["opening", "button", "window", "light_pipe", "boss", "seal_gland", "thread", "strap_lugs", "joint", "twist_lid"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];
/** Features that mate with something outside the enclosure (or in its wall: a window's cover in its pocket): what they hold is not inside it. */
export const EXTERNAL_KINDS: FeatureKind[] = ["thread", "strap_lugs", "window"];

/** An interface of a sibling module, in the system the enclosure sits in. */
export interface Serves {
  child: string;
  interfaceId: string;
}

/** Where a stated value comes from: a source, or why it was chosen. */
export interface Provenance {
  source?: string;
  assumption?: string;
}

interface Base extends Provenance {
  id: string;
  name?: string;
  /** Where the feature is (module coordinates, mm; normal pointing out of the enclosure). */
  frame?: GeometryFrame;
}

const feature = (c: Base, kind: FeatureKind, params: Record<string, unknown>, extra: Partial<InterfaceDef> = {}): InterfaceDef => {
  const p = Object.fromEntries(Object.entries({ kind, ...params, source: c.source, assumption: c.assumption }).filter(([, v]) => v !== undefined));
  return {
    id: c.id,
    ...(c.name ? { name: c.name } : {}),
    domain: "mechanical",
    exposed: true,
    protocols: [],
    ...extra,
    traits: [...(extra.traits ?? []), { type: FEATURE_TRAIT, params: p }],
    ...(c.frame ? { geometry: { ...(extra.geometry ?? {}), frame: c.frame } } : {}),
  };
};

export interface OpeningConfig extends Base {
  serves?: Serves;
  shape?: "rect" | "round";
  widthMm?: number;
  heightMm?: number;
  diameterMm?: number;
  cornerRadiusMm?: number;
  /** Deepest the served part may sit behind the outer surface (a plug must still seat). */
  maxRecessMm?: number;
  /** The cable plug the opening takes (USB_C_PLUG): it must pass, and its overmold needs a flat seat around the opening. */
  plug?: Plug;
  /**
   * "flat": on a round wall, add a flat seat for the plug's overmold (material out to the plane through the
   * opening's outermost point, the overmold's face plus 0.3 mm a side). Without it the curve leaves a gap under
   * the overmold's ends (ENCLOSURE_PLUG_FIT).
   */
  seat?: "flat";
}

export function Opening(c: OpeningConfig): InterfaceDef {
  return feature(c, "opening", {
    serves: c.serves,
    shape: c.shape ?? (c.diameterMm !== undefined ? "round" : "rect"),
    width_mm: c.widthMm,
    height_mm: c.heightMm,
    diameter_mm: c.diameterMm,
    corner_radius_mm: c.cornerRadiusMm,
    max_recess_mm: c.maxRecessMm,
    plug: c.plug,
    seat: c.seat,
  });
}

export interface ButtonConfig extends Base {
  serves: Serves;
  /** Bore through the wall for the plunger. */
  holeDiameterMm: number;
  /** Actuator travel of the switch (from its datasheet). */
  travelMm?: number;
  /** Gap left between the plunger tip and the actuator at rest. */
  gapMm?: number;
  protrudeMm?: number;
  flangeDiameterMm?: number;
  flangeMm?: number;
  clearanceMm?: number;
}

export function Button(c: ButtonConfig): InterfaceDef {
  return feature(c, "button", {
    serves: c.serves,
    hole_d_mm: c.holeDiameterMm,
    travel_mm: c.travelMm,
    gap_mm: c.gapMm,
    protrude_mm: c.protrudeMm,
    flange_d_mm: c.flangeDiameterMm,
    flange_mm: c.flangeMm,
    clearance_mm: c.clearanceMm,
  });
}

type Outline = { widthMm: number; heightMm: number } | { diameterMm: number };
const outline = (o: Outline) => ("diameterMm" in o ? { diameter_mm: o.diameterMm } : { width_mm: o.widthMm, height_mm: o.heightMm });

export interface WindowConfig extends Base {
  serves?: Serves;
  aperture: Outline;
  /** The cover: glass, a lens, an IR-transparent window. */
  cover: Outline & { thicknessMm: number; material?: string };
  /** Pocket for the cover on the outside (flush) or the inside of the wall. */
  side?: "outside" | "inside";
  cornerRadiusMm?: number;
  clearanceMm?: number;
}

export function Window(c: WindowConfig): InterfaceDef {
  return feature(c, "window", {
    serves: c.serves,
    aperture: outline(c.aperture),
    cover: { ...outline(c.cover), thickness_mm: c.cover.thicknessMm, ...(c.cover.material ? { material: c.cover.material } : {}) },
    side: c.side,
    corner_radius_mm: c.cornerRadiusMm,
    clearance_mm: c.clearanceMm,
  }, {
    // the cover's module (coverArtifacts) mates its seat here: custom peer, capability window_cover
    protocols: [{ type: "custom", roles: ["peer"] }],
    capabilities: ["window_cover"],
  });
}

export interface LightPipeConfig extends Base {
  serves?: Serves;
  diameterMm: number;
  clearanceMm?: number;
  /** What fills the hole after printing (clear UV-cure resin): a post-processing step of the print order. */
  fill?: string;
}

export function LightPipe(c: LightPipeConfig): InterfaceDef {
  return feature(c, "light_pipe", { serves: c.serves, diameter_mm: c.diameterMm, clearance_mm: c.clearanceMm, fill: c.fill });
}

export interface BossConfig extends Omit<BoltPatternConfig, "role" | "threaded"> {
  frame: GeometryFrame;
  insert: Insert;
  /** Boss outside diameter; default: insert hole + 2 × its minimum wall. */
  bossDiameterMm?: number;
  source?: string;
  assumption?: string;
}

/** Bosses with heat-set inserts: a structure bolt pattern whose frame is the boss tops (normal +Z). */
export function InsertBosses(c: BossConfig): InterfaceDef {
  const { frame, insert, bossDiameterMm, source, assumption, ...pattern } = c;
  const bp = BoltPattern({ ...pattern, role: "structure", threaded: true, note: pattern.note ?? `heat-set inserts (${insert.name})` });
  return feature({ id: c.id, name: c.name, frame, source, assumption }, "boss", { insert, boss_d_mm: bossDiameterMm }, bp);
}

export interface SealGlandConfig extends Base {
  type: "face" | "radial";
  /** An AS568 size ("AS568-033") or the O-ring's dimensions. */
  oring: string | ORing;
  /**
   * "joint": the lid joint's seal. A face gland's groove goes in the base rim; a radial gland's
   * groove goes round the base's collar under a TwistLid's skirt (the skirt's bore is the sealing
   * surface). Otherwise the frame places the gland.
   */
  at?: "joint";
  /** Which side the pressure is on (decides whether the groove is sized by the O-ring's ID or OD). */
  pressure?: "external" | "internal";
  /** Radial glands: the rod or tube the O-ring seals on. */
  rodDiameterMm?: number;
}

export function SealGland(c: SealGlandConfig): InterfaceDef {
  const o = typeof c.oring === "string" ? as568(c.oring) : c.oring;
  if (!o) throw new Error(`${c.id}: unknown O-ring ${String(c.oring)} (give an AS568 size or its dimensions)`);
  return feature(c, "seal_gland", { type: c.type, oring: o, at: c.at, pressure: c.pressure, rod_d_mm: c.rodDiameterMm });
}

export interface ThreadConfig extends Base {
  /** The neck's thread: major diameter (T), root diameter (E), pitch. */
  majorDiameterMm: number;
  rootDiameterMm: number;
  pitchMm: number;
  /** Skirt length holding the thread. */
  lengthMm: number;
  clearanceMm?: number;
  crestWidthMm?: number;
  flankAngleDeg?: number;
  skirtWallMm?: number;
}

export function Thread(c: ThreadConfig): InterfaceDef {
  return feature(c, "thread", {
    major_d_mm: c.majorDiameterMm,
    root_d_mm: c.rootDiameterMm,
    pitch_mm: c.pitchMm,
    length_mm: c.lengthMm,
    clearance_mm: c.clearanceMm,
    crest_width_mm: c.crestWidthMm,
    flank_angle_deg: c.flankAngleDeg,
    skirt_wall_mm: c.skirtWallMm,
  });
}

export interface StrapLugsConfig extends Base {
  end: "+y" | "-y";
  springBar: SpringBar;
  /** Gap between the strap and the case under the bar. */
  strapGapMm?: number;
  lugWidthMm?: number;
  lugHeightMm?: number;
}

export function StrapLugs(c: StrapLugsConfig): InterfaceDef {
  const h = lugHole(c.springBar);
  return feature(c, "strap_lugs", {
    end: c.end,
    spring_bar: c.springBar,
    strap_width_mm: c.springBar.lug_gap_mm,
    bar_d_mm: c.springBar.bar_d_mm,
    hole_d_mm: h.hole_d_mm,
    hole_depth_mm: h.hole_depth_mm,
    strap_gap_mm: c.strapGapMm,
    lug_width_mm: c.lugWidthMm,
    lug_height_mm: c.lugHeightMm,
  }, {
    // a spring bar part's bar interface (custom peer, capability strap_bar) links to the lugs that hold it
    protocols: [{ type: "custom", roles: ["peer"] }],
    capabilities: ["strap_bar"],
  });
}

export interface JointConfig extends Base {
  screw: Screw;
  insert: Insert;
  count?: number;
}

/** The lid joint: where the parts split and what holds them together. */
export function Joint(c: JointConfig): InterfaceDef {
  // the joint links to itself through the fastener harness that closes it (its fastenerStack places the
  // screws and inserts at the columns the provider reports): custom peer, capability lid_joint
  return feature(c, "joint", { screw: c.screw, insert: c.insert, count: c.count ?? 4 }, { protocols: [{ type: "custom", roles: ["peer"] }], capabilities: ["lid_joint"] });
}

export interface TwistLidConfig extends Base {
  /**
   * How the lid holds: "thread" (an external thread on the base's collar, an internal one in the lid's
   * skirt) or "bayonet" (lugs on the collar entering L-slots in the skirt; the slot's end fixes the
   * lid's angle, and a key lug (keyLugWidthMm) lets it go on one way only, so features in the lid,
   * such as light pipes, line up with what is under them).
   */
  lock: "thread" | "bayonet";
  /** Thread: pitch (mm), depth of the profile (radial, mm), flank half-angle (deg, default 30: 60° from the bed when printed upright). */
  pitchMm?: number;
  depthMm?: number;
  flankAngleDeg?: number;
  /** Turns of engagement (thread; default 2). */
  turns?: number;
  /** Bayonet: lug count (default 3), lug width along the collar (mm), radial depth and height (mm), and the twist that locks it (deg). */
  lugs?: number;
  lugWidthMm?: number;
  lugDepthMm?: number;
  lugHeightMm?: number;
  twistDeg?: number;
  /**
   * Bayonet: the first lug's width (the one on +Y), wider than the others plus twice the clearance, so
   * it enters only its own slot and the lid goes on in one position. Without it, equal lugs let the lid
   * go on in as many positions as there are lugs, which the build refuses unless orientation is "any".
   */
  keyLugWidthMm?: number;
  /** Bayonet: "keyed" (default: the lid must go on one way) or "any" (nothing in the lid needs lining up). */
  orientation?: "keyed" | "any";
  /**
   * How much larger (radial, mm) the skirt's bore is drawn than the bore it should print at (default 0,
   * a machined bore). A printed bore comes out undersize; the O-ring groove's depth is measured from
   * the printed bore, so Parker's squeeze holds when the print shrinks by this much.
   */
  boreAllowanceMm?: number;
  /** Radial clearance between the collar's lock and the skirt (mm, default 0.2: a printed fit). */
  clearanceMm?: number;
  /** Axial clearance in the lock (mm, default 0.15). */
  axialClearanceMm?: number;
}

/**
 * A lid that twists on instead of screwing down: the base's wall steps in to a collar at the top,
 * the lid's skirt slides over it and locks (a thread, or a bayonet with lugs and L-slots), and a
 * radial O-ring in a groove round the collar seals against the skirt's bore (a SealGland radial at
 * "joint"). The shell's outside stays one diameter, so nothing reaches past it (no screw lugs).
 */
export function TwistLid(c: TwistLidConfig): InterfaceDef {
  return feature(c, "twist_lid", {
    lock: c.lock,
    pitch_mm: c.pitchMm,
    depth_mm: c.depthMm,
    flank_angle_deg: c.flankAngleDeg,
    turns: c.turns,
    lugs: c.lugs,
    lug_width_mm: c.lugWidthMm,
    lug_depth_mm: c.lugDepthMm,
    lug_height_mm: c.lugHeightMm,
    twist_deg: c.twistDeg,
    key_lug_width_mm: c.keyLugWidthMm,
    orientation: c.orientation,
    bore_allowance_mm: c.boreAllowanceMm,
    clearance_mm: c.clearanceMm,
    axial_clearance_mm: c.axialClearanceMm,
  }, { protocols: [{ type: "custom", roles: ["peer"] }], capabilities: ["lid_joint"] });
}

// ---------------------------------------------------------------------------
// Reading features back from a module
// ---------------------------------------------------------------------------

export interface FeatureSpec {
  id: string;
  kind: FeatureKind;
  params: Record<string, unknown>;
  serves?: Serves;
  /** The frame the module declares, if any. */
  frame?: GeometryFrame;
  iface: InterfaceDef;
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** What each kind needs (positive numbers, or present objects). */
const REQUIRED: Record<FeatureKind, string[]> = {
  opening: [],
  button: ["hole_d_mm"],
  window: ["aperture", "cover"],
  light_pipe: ["diameter_mm"],
  boss: ["insert"],
  seal_gland: ["type", "oring"],
  thread: ["major_d_mm", "root_d_mm", "pitch_mm", "length_mm"],
  strap_lugs: ["end", "strap_width_mm", "bar_d_mm", "hole_d_mm", "hole_depth_mm"],
  joint: [],
  twist_lid: ["lock"],
};

/** The module's enclosure features, and what is wrong with them. */
export function readFeatures(def: ModuleDef): { features: FeatureSpec[]; problems: { interface: string; message: string }[] } {
  const features: FeatureSpec[] = [];
  const problems: { interface: string; message: string }[] = [];
  for (const iface of def.interfaces) {
    const t = iface.traits?.find((x) => x.type === FEATURE_TRAIT);
    if (!t) continue;
    const { kind, serves, ...params } = (t.params ?? {}) as Record<string, unknown> & { kind?: string; serves?: Serves };
    const bad = (message: string) => problems.push({ interface: iface.id, message });
    if (!FEATURE_KINDS.includes(kind as FeatureKind)) {
      bad(`unknown feature kind ${JSON.stringify(kind)} (known: ${FEATURE_KINDS.join(", ")})`);
      continue;
    }
    const k = kind as FeatureKind;
    const missing = REQUIRED[k].filter((key) => params[key] === undefined || (typeof params[key] === "number" && !num(params[key])));
    if (missing.length) bad(`${k} needs ${missing.join(", ")}`);
    if (k === "opening") {
      const round = params.shape === "round";
      if (round ? !num(params.diameter_mm) : !(num(params.width_mm) && num(params.height_mm))) bad(round ? "a round opening needs diameter_mm" : "an opening needs width_mm and height_mm");
    }
    if (["opening", "button", "window", "light_pipe"].includes(k) && !serves && !iface.geometry?.frame) bad(`${k} needs a frame or the part it serves (serves: { child, interfaceId })`);
    if (k === "button" && !serves) bad("a button needs the switch it serves (serves: { child, interfaceId })");
    if (k === "boss" && !iface.geometry?.frame) bad("bosses need a frame (the boss tops, normal +Z)");
    if (k === "seal_gland") {
      const o = params.oring as ORing | undefined;
      if (params.type !== "face" && params.type !== "radial") bad('seal_gland type must be "face" or "radial"');
      else if (o && !glandRow(params.type as "face" | "radial", o.w_mm)) bad(`no ${params.type} gland row for a ${o.w_mm} mm O-ring cross-section (Parker ORD 5700 Design Charts 4-1, 4-2)`);
      if (params.type === "radial" && params.at !== "joint" && !num(params.rod_d_mm)) bad("a radial gland needs rod_d_mm (what the O-ring seals on), or at: \"joint\" under a TwistLid");
      if (params.at !== "joint" && !iface.geometry?.frame) bad('a gland needs a frame, or at: "joint"');
    }
    if (serves && (typeof serves.child !== "string" || typeof serves.interfaceId !== "string")) bad("serves must be { child, interfaceId }");
    features.push({ id: iface.id, kind: k, params, ...(serves ? { serves } : {}), ...(iface.geometry?.frame ? { frame: iface.geometry.frame } : {}), iface });
  }
  return { features, problems };
}

export const isEnclosure = (def: ModuleDef) => def.interfaces.some((i) => i.traits?.some((t) => t.type === FEATURE_TRAIT));

/**
 * The artifacts of a window's cover as cad:export writes them (`<out>/cover_<window id>.step|glb|dxf`), for
 * the module that stands for the cover (a lens bought or cut as its own part). In the cover's own frame: its
 * outer face at z 0, its body along +z; mate its frame (origin, normal +z) with the window's.
 */
export function coverArtifacts(out: string, windowId: string): ArtifactDef[] {
  const name = `cover_${windowId}`;
  const prov = { tool: "build123d", generatedFrom: "cad_source" };
  return [
    { id: "cover_step", name: `${name} (STEP)`, type: "cad", role: "body", format: "step", units: "mm", filePath: `${out}/${name}.step`, provenance: prov },
    { id: "cover_glb", name: `${name} (GLB)`, type: "cad", role: "body", format: "glb", units: "mm", filePath: `${out}/${name}.glb`, provenance: { ...prov, generatedFrom: "cover_step" } },
    { id: "cover_dxf", name: `${name} outline (DXF, for cutting)`, type: "cad", role: "drawing", format: "dxf", units: "mm", filePath: `${out}/${name}.dxf`, tags: ["manufacturing", "cut"], provenance: { ...prov, generatedFrom: "cover_step" } },
  ];
}
