/**
 * The token schema: every style token has a dotted path, a class, a typed value with units and allowed values, a
 * default (the plain, conventional value a board gets with no theme), and for fab and electrical tokens a guard
 * rail (guards.ts). Lengths are millimeters in tokens and theme files; tools convert to the board's nanometers.
 *
 * Classes:
 * - `cosmetic`: how the board looks; floored by fab minimums where it prints (text, lines).
 * - `fab`: what the fab makes (mask, silk, finish); can change cost, lead time or yield; checked against a fab profile.
 * - `electrical`: style preferences that change copper; never changed for looks (a correction refuses them).
 * - `placement`: preferences that move parts; applied only when asked, before routing, with a length guard.
 */

export type TokenClass = "cosmetic" | "fab" | "electrical" | "placement";
export const TOKEN_CLASSES: readonly TokenClass[] = ["fab", "electrical", "placement", "cosmetic"];

/** A text class: glyph height and width, stroke, case, and whether it prints as a knockout tag (mm). */
export interface TextClass {
  height: number;
  width: number;
  stroke: number;
  case: "upper" | "asis";
  knockout: boolean;
}

export type TokenValue = string | number | boolean | readonly string[] | readonly number[] | TextClass;

export type TokenType =
  | { kind: "length"; min?: number; max?: number }
  | { kind: "range"; min?: number; max?: number }
  | { kind: "number"; min?: number; max?: number; unit?: "deg" | "share" | "count" | "oz"; integer?: boolean }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "set"; values: readonly string[] }
  | { kind: "bool" }
  | { kind: "color" }
  | { kind: "text"; max: number }
  | { kind: "texts"; max: number }
  | { kind: "lengths" }
  | { kind: "textClass" }
  | { kind: "asset" };

export interface TokenDef {
  path: string;
  class: TokenClass;
  type: TokenType;
  /** The value with no theme: a plain, conventional board. */
  default: TokenValue;
  title: string;
  description: string;
  /** For fab and electrical tokens: what the guard rail checks (guards.ts implements it). */
  guard?: string;
  /** The tools that read it. */
  usedBy: readonly string[];
  /** Specified for a later version: carried and resolved, not yet acted on by any tool. */
  specifiedOnly?: true;
}

export const MASK_COLORS = ["green", "black", "matteBlack", "white", "blue", "red", "purple", "yellow", "matteGreen"] as const;
export const SILK_COLORS = ["white", "black", "fullColor"] as const;
export const FINISHES = ["HASL", "HASL-LF", "ENIG", "OSP", "ENEPIG"] as const;
export const HAZARD_KINDS = ["antennaKeepout", "keyingFlat", "uvEmitter", "highVoltage", "noMetal", "hotSurface"] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];
export const ASSET_SLOTS = ["maker", "company", "oshw", "easterEgg"] as const;
export type AssetSlot = (typeof ASSET_SLOTS)[number];

const T = {
  length: (min = 0, max = 100): TokenType => ({ kind: "length", min, max }),
  range: (min = 0, max = 100): TokenType => ({ kind: "range", min, max }),
  enumOf: (values: readonly string[]): TokenType => ({ kind: "enum", values }),
  setOf: (values: readonly string[]): TokenType => ({ kind: "set", values }),
  bool: (): TokenType => ({ kind: "bool" }),
  color: (): TokenType => ({ kind: "color" }),
  text: (max = 120): TokenType => ({ kind: "text", max }),
  texts: (max = 40): TokenType => ({ kind: "texts", max }),
};

const tc = (height: number, width: number, stroke: number, kase: "upper" | "asis", knockout: boolean): TextClass => ({ height, width, stroke, case: kase, knockout });

const FRAMES = ["frames"];
const DESIG = ["designators"];
const NAME = ["nameplate"];
const HAZ = ["hazard"];
const EDGE = ["edgeText"];
const MARKS = ["marks"];
const ALIGN = ["alignParts"];
const CHECK = ["checkStyle"];
const RENDER = ["renderAsBuilt"];
const ALL_SILK = ["frames", "designators", "nameplate", "hazard", "edgeText", "marks"];

/** Every token, in a stable order (class, then path). */
export const TOKENS: readonly TokenDef[] = [
  // ------------------------------------------------------------ fab
  { path: "fab.profile", class: "fab", type: T.enumOf(["jlcpcb", "circuithub"]), default: "jlcpcb", title: "Fab profile", description: "The fab whose published limits the guard rails use.", guard: "Selects the mask colors, silk colors, finishes and minimums every other fab guard reads.", usedBy: ["guards", ...CHECK] },
  { path: "fab.mask.color.top", class: "fab", type: T.enumOf(MASK_COLORS), default: "green", title: "Mask color, top", description: "Solder mask color of the top side.", guard: "Must be offered by the fab; sets the minimum mask web (black and white need a wider web than green at JLCPCB), checked against fine-pitch pads.", usedBy: [...RENDER, ...CHECK] },
  { path: "fab.mask.color.bottom", class: "fab", type: T.enumOf(MASK_COLORS), default: "green", title: "Mask color, bottom", description: "Solder mask color of the bottom side.", guard: "As the top: offered by the fab, minimum web checked against fine-pitch pads.", usedBy: [...RENDER, ...CHECK] },
  { path: "fab.mask.expansion", class: "fab", type: T.length(0, 0.3), default: 0.05, title: "Mask expansion", description: "Mask opening margin around each pad assumed by the mask web check (an assumption: set it from the fab's notes or the board's own pad margins).", guard: "Used with the minimum web: two pads closer than twice this plus the web lose the mask between them.", usedBy: CHECK },
  { path: "fab.copperWeight", class: "fab", type: { kind: "number", min: 0.5, max: 4, unit: "oz" }, default: 1, title: "Outer copper weight", description: "Outer layer copper weight in ounces; heavier copper needs a wider mask web.", guard: "At 2 oz JLCPCB's minimum mask web is 0.20 mm for every color.", usedBy: CHECK },
  { path: "fab.silk.color.top", class: "fab", type: T.enumOf(SILK_COLORS), default: "white", title: "Silkscreen color, top", description: "Silkscreen ink of the top side.", guard: "Black silk only on a white mask (reported); full-color silk needs a white mask, ENIG, 2 to 4 layers and an EasyEDA export.", usedBy: [...RENDER, ...CHECK] },
  { path: "fab.silk.color.bottom", class: "fab", type: T.enumOf(SILK_COLORS), default: "white", title: "Silkscreen color, bottom", description: "Silkscreen ink of the bottom side.", guard: "As the top.", usedBy: [...RENDER, ...CHECK] },
  { path: "fab.finish", class: "fab", type: T.enumOf(FINISHES), default: "HASL-LF", title: "Surface finish", description: "Finish of exposed copper.", guard: "Must be offered by the fab; ENIG costs more on small runs (reported); leadless and fine-pitch parts want a flat finish (ENIG); copper art reads gold only with ENIG.", usedBy: [...RENDER, ...CHECK] },
  { path: "fab.viaCovering", class: "fab", type: T.enumOf(["tented", "open", "plugged", "filled"]), default: "tented", title: "Via covering", description: "How vias are covered by the mask.", guard: "A via in a pad needs filled vias.", usedBy: [...RENDER, ...CHECK] },
  // ------------------------------------------------------------ electrical
  { path: "copper.angle", class: "electrical", type: T.enumOf(["any", "45", "90"]), default: "any", title: "Track angles", description: "The angles copper is routed at: router setting and the odd-angle style check.", guard: "Changes routing; never changed for looks.", usedBy: CHECK },
  { path: "copper.oddAngle.maxShare", class: "electrical", type: { kind: "number", min: 0, max: 1, unit: "share" }, default: 1, title: "Odd-angle allowance", description: "Share of track segments (longer than the minimum length) allowed off the angle grid before the style check reports it.", guard: "Read by the check only.", usedBy: CHECK },
  { path: "copper.oddAngle.minLength", class: "electrical", type: T.length(0, 10), default: 0.25, title: "Odd-angle minimum length", description: "Segments shorter than this are not counted by the odd-angle check (pad entries, short jogs).", guard: "Read by the check only.", usedBy: CHECK },
  { path: "copper.corner", class: "electrical", type: T.enumOf(["miter45", "arc"]), default: "miter45", title: "Track corners", description: "How track corners are formed.", guard: "Arc corners change copper; routers decide.", usedBy: [], specifiedOnly: true },
  { path: "copper.teardrops", class: "electrical", type: T.enumOf(["off", "padVia", "all"]), default: "off", title: "Teardrops", description: "Teardrops at pad and via entries.", guard: "Changes copper and clearances.", usedBy: [], specifiedOnly: true },
  { path: "copper.widthLadder", class: "electrical", type: { kind: "lengths" }, default: [], title: "Track width ladder", description: "The few track widths a board uses (mm); net class minimums always win.", guard: "Never shrinks a power track for looks; the check reports widths off the ladder as info.", usedBy: CHECK },
  { path: "pour.connection", class: "electrical", type: T.enumOf(["solid", "thermal"]), default: "thermal", title: "Pour connection", description: "How pours connect to pads.", guard: "Solid connections make hand soldering and rework harder; a per-net override wins.", usedBy: [], specifiedOnly: true },
  { path: "via.sizes", class: "electrical", type: T.texts(8), default: [], title: "Via sizes", description: "Via sizes as pad/drill in mm, for example 0.6/0.3.", guard: "Fab minimum and current capacity decide; style only orders the list.", usedBy: [], specifiedOnly: true },
  { path: "via.stitching", class: "electrical", type: T.enumOf(["none", "strategic", "grid"]), default: "none", title: "Stitching vias", description: "How stitching vias are placed.", guard: "Return paths decide; style only states the preference.", usedBy: [], specifiedOnly: true },
  { path: "copperArt.enabled", class: "electrical", type: T.bool(), default: false, title: "Copper art", description: "Art in exposed copper.", guard: "Needs a mask opening, a net (or isolation) and clearance; reads gold only with ENIG.", usedBy: [], specifiedOnly: true },
  // ------------------------------------------------------------ placement
  { path: "placement.grid", class: "placement", type: T.length(0.001, 5), default: 0.1, title: "Placement grid", description: "Grid parts snap to when the user asks for alignment.", guard: "Only when asked and only before routing (unless told otherwise); a move that lengthens a critical net past the limit is reported and not made.", usedBy: ALIGN },
  { path: "placement.rowAlign", class: "placement", type: T.bool(), default: false, title: "Row alignment", description: "Align the parts of a group that sit in a row on one axis when the user asks for alignment.", guard: "As the grid.", usedBy: ALIGN },
  { path: "placement.beforeRoutingOnly", class: "placement", type: T.bool(), default: true, title: "Before routing only", description: "Refuse to move a part that has copper attached unless the call says it may.", guard: "Ruling: silk and tidiness never move a part after routing unless the user says so.", usedBy: ALIGN },
  { path: "placement.critical", class: "placement", type: T.texts(20), default: ["power", "usb", "rf", "clock"], title: "Critical nets", description: "Net classes (or net name patterns with * and ?) whose length an alignment must not grow.", guard: "Moves that lengthen these past the limit are reported and skipped.", usedBy: ALIGN },
  { path: "placement.maxLengthIncrease", class: "placement", type: T.length(0, 100), default: 1.0, title: "Length limit", description: "Largest increase of a critical net's ratsnest length an alignment may cause (mm).", guard: "As above.", usedBy: ALIGN },
  // ------------------------------------------------------------ cosmetic: preview colors
  { path: "preview.maskHex", class: "cosmetic", type: T.color(), default: "auto", title: "Preview mask color", description: "Mask color in renders and the as-built view (#RRGGBB or #RRGGBBAA, or auto from the mask color).", usedBy: RENDER },
  { path: "preview.silkHex", class: "cosmetic", type: T.color(), default: "auto", title: "Preview silk color", description: "Silkscreen color in renders, or auto.", usedBy: RENDER },
  { path: "preview.copperHex", class: "cosmetic", type: T.color(), default: "auto", title: "Preview finish color", description: "Exposed copper color in renders, or auto from the finish.", usedBy: RENDER },
  // ------------------------------------------------------------ cosmetic: typography
  { path: "type.font", class: "cosmetic", type: T.enumOf(["stroke"]), default: "stroke", title: "Font", description: "Silkscreen font. Version 1: the stroke font of the board's exporter (KiCad style); polygon fonts are specified for later.", usedBy: ALL_SILK },
  { path: "type.class.designator", class: "cosmetic", type: { kind: "textClass" }, default: tc(1.0, 1.0, 0.15, "asis", false), title: "Designator text", description: "Reference designators.", usedBy: DESIG },
  { path: "type.class.groupTitle", class: "cosmetic", type: { kind: "textClass" }, default: tc(1.0, 1.0, 0.15, "upper", false), title: "Group title text", description: "Titles of group frames.", usedBy: FRAMES },
  { path: "type.class.nameplate", class: "cosmetic", type: { kind: "textClass" }, default: tc(1.2, 1.2, 0.18, "asis", false), title: "Nameplate text", description: "Board name and revision.", usedBy: NAME },
  { path: "type.class.edge", class: "cosmetic", type: { kind: "textClass" }, default: tc(1.0, 0.7, 0.15, "upper", false), title: "Edge text", description: "Text along the board edge.", usedBy: EDGE },
  { path: "type.class.warning", class: "cosmetic", type: { kind: "textClass" }, default: tc(1.0, 1.0, 0.15, "upper", true), title: "Warning text", description: "Hazard zone tags.", usedBy: HAZ },
  { path: "type.class.mark", class: "cosmetic", type: { kind: "textClass" }, default: tc(1.0, 0.8, 0.15, "upper", false), title: "Mark label text", description: "Labels beside marks (a motto, a maker line).", usedBy: MARKS },
  // ------------------------------------------------------------ cosmetic: silk graphics
  { path: "silk.line", class: "cosmetic", type: T.length(0.05, 2), default: 0.15, title: "Silk line", description: "Line width of silk graphics.", usedBy: ALL_SILK },
  { path: "silk.clearance.pad", class: "cosmetic", type: T.length(0, 5), default: 0.15, title: "Silk to pad", description: "Clearance of any style silk from pads, vias and holes.", usedBy: ALL_SILK },
  { path: "silk.clearance.silk", class: "cosmetic", type: T.length(0, 5), default: 0.2, title: "Silk to silk", description: "Clearance of placed text and marks from other silk.", usedBy: ALL_SILK },
  { path: "silk.clearance.edge", class: "cosmetic", type: T.length(0, 5), default: 0.5, title: "Silk to edge", description: "Clearance of style silk from the board edge.", usedBy: ALL_SILK },
  { path: "silk.clearance.courtyard", class: "cosmetic", type: T.length(0, 5), default: 0.1, title: "Text to other parts", description: "Clearance of designators and marks from parts' courtyards (text under a part disappears once it is fitted).", usedBy: [...DESIG, ...MARKS, ...NAME] },
  { path: "frame.style", class: "cosmetic", type: T.enumOf(["none", "rect", "chamfer45", "round", "bracket"]), default: "none", title: "Group frames", description: "Frames around the parts of a group: none, square corners, 45 degree chamfers, rounded corners, or corner brackets.", usedBy: [...FRAMES, ...CHECK] },
  { path: "frame.chamfer", class: "cosmetic", type: T.range(0, 5), default: [0.25, 0.8], title: "Corner size", description: "Chamfer depth (or corner radius, or bracket arm) as a range: as deep as the parts allow within it.", usedBy: FRAMES },
  { path: "frame.offset", class: "cosmetic", type: T.length(0, 5), default: 0.3, title: "Frame offset", description: "Distance of a frame outside its parts' courtyards.", usedBy: FRAMES },
  { path: "frame.clearance.part", class: "cosmetic", type: T.length(0, 5), default: 0.15, title: "Frame to other parts", description: "Clearance of a frame from the courtyards of parts outside its group.", usedBy: FRAMES },
  { path: "frame.clearance.frame", class: "cosmetic", type: T.length(0, 5), default: 0.3, title: "Frame to frame", description: "Clearance between frames.", usedBy: FRAMES },
  { path: "frame.sides", class: "cosmetic", type: T.enumOf(["top", "bottom", "both"]), default: "both", title: "Frame sides", description: "Which sides get frames.", usedBy: [...FRAMES, ...CHECK] },
  { path: "frame.title", class: "cosmetic", type: T.enumOf(["tag", "plain", "none"]), default: "plain", title: "Frame titles", description: "Titles as knockout tags (solid silk with the text cut out), plain text, or none. A tag that does not fit falls back to plain text.", usedBy: [...FRAMES, ...CHECK] },
  { path: "frame.minParts", class: "cosmetic", type: { kind: "number", min: 1, max: 100, unit: "count", integer: true }, default: 2, title: "Parts per frame", description: "A group gets a frame on a side when it has at least this many parts there.", usedBy: [...FRAMES, ...CHECK] },
  { path: "frame.groupDepth", class: "cosmetic", type: { kind: "number", min: 1, max: 6, unit: "count", integer: true }, default: 1, title: "Group depth", description: "How many segments of a part's UHD instance path name its group (1: power/ldo is in group power).", usedBy: [...FRAMES, ...CHECK] },
  { path: "hazard.zones", class: "cosmetic", type: T.setOf(HAZARD_KINDS), default: [], title: "Hazard zones", description: "Kinds of declared no-go keep-outs that get the hazard pattern; nothing else is striped.", usedBy: [...HAZ, ...CHECK] },
  { path: "hazard.stripe", class: "cosmetic", type: T.length(0.05, 5), default: 0.45, title: "Stripe width", description: "Width of each hazard stripe.", usedBy: HAZ },
  { path: "hazard.gap", class: "cosmetic", type: T.length(0.05, 5), default: 0.45, title: "Stripe gap", description: "Gap between hazard stripes.", usedBy: HAZ },
  { path: "hazard.angle", class: "cosmetic", type: { kind: "number", min: -90, max: 90, unit: "deg" }, default: 45, title: "Stripe angle", description: "Angle of the stripes, degrees counterclockwise from the X axis.", usedBy: HAZ },
  { path: "hazard.outline", class: "cosmetic", type: T.bool(), default: false, title: "Zone outline", description: "Draw a line around striped zones.", usedBy: HAZ },
  { path: "hazard.sides", class: "cosmetic", type: T.enumOf(["top", "bottom", "both"]), default: "top", title: "Hazard sides", description: "Silkscreen sides the pattern is drawn on (within the keep-out's own layers).", usedBy: HAZ },
  { path: "hazard.tag.antennaKeepout", class: "cosmetic", type: T.text(30), default: "ANTENNA", title: "Antenna tag", description: "Tag on antenna keep-outs (empty: none).", usedBy: HAZ },
  { path: "hazard.tag.keyingFlat", class: "cosmetic", type: T.text(30), default: "", title: "Keying flat tag", description: "Tag on keying flats (empty: none).", usedBy: HAZ },
  { path: "hazard.tag.uvEmitter", class: "cosmetic", type: T.text(30), default: "UV-C DANGER", title: "UV emitter tag", description: "Tag on UV emitter zones.", usedBy: HAZ },
  { path: "hazard.tag.highVoltage", class: "cosmetic", type: T.text(30), default: "HIGH VOLTAGE", title: "High voltage tag", description: "Tag on high voltage zones.", usedBy: HAZ },
  { path: "hazard.tag.noMetal", class: "cosmetic", type: T.text(30), default: "NO METAL", title: "No metal tag", description: "Tag on no-metal zones.", usedBy: HAZ },
  { path: "hazard.tag.hotSurface", class: "cosmetic", type: T.text(30), default: "HOT", title: "Hot surface tag", description: "Tag on hot surfaces.", usedBy: HAZ },
  { path: "designator.policy", class: "cosmetic", type: T.enumOf(["all", "benchNeeded", "none"]), default: "all", title: "Designators shown", description: "all: every designator that fits; benchNeeded: the classes a person at the bench needs, filled up to the target share; none.", usedBy: [...DESIG, ...CHECK] },
  { path: "designator.classes", class: "cosmetic", type: T.texts(30), default: ["J", "P", "CN", "TP", "D", "LED", "SW", "S", "BTN", "U", "IC", "F"], title: "Bench classes", description: "Reference prefixes a person at the bench needs first: connectors, test points, LEDs, switches, ICs, fuses.", usedBy: [...DESIG, ...CHECK] },
  { path: "designator.targetShare", class: "cosmetic", type: { kind: "number", min: 0, max: 1, unit: "share" }, default: 0.35, title: "Designator share", description: "With benchNeeded: the share of parts labeled, bench classes first.", usedBy: [...DESIG, ...CHECK] },
  { path: "designator.orientation", class: "cosmetic", type: T.setOf(["horizontal", "vertical"]), default: ["horizontal", "vertical"], title: "Designator orientation", description: "Allowed reading directions: horizontal, or vertical reading bottom-up from its own side.", usedBy: DESIG },
  { path: "designator.maxDistance", class: "cosmetic", type: T.length(0.2, 20), default: 3.0, title: "Designator distance", description: "Farthest a designator may sit from its part's body.", usedBy: DESIG },
  { path: "nameplate.enabled", class: "cosmetic", type: T.bool(), default: true, title: "Nameplate", description: "Board name and revision on the board.", usedBy: [...NAME, ...CHECK] },
  { path: "nameplate.side", class: "cosmetic", type: T.enumOf(["top", "bottom"]), default: "top", title: "Nameplate side", description: "Side the nameplate goes on.", usedBy: [...NAME, ...CHECK] },
  { path: "nameplate.text", class: "cosmetic", type: T.text(80), default: "${NAME} rev ${REV}", title: "Nameplate text", description: "Template: ${NAME} is the board name, ${REV} the revision.", usedBy: NAME },
  { path: "nameplate.date", class: "cosmetic", type: T.enumOf(["off", "year", "full"]), default: "full", title: "Nameplate date", description: "Date on the nameplate (from the call's date; never the clock).", usedBy: [...NAME, ...CHECK] },
  { path: "nameplate.style", class: "cosmetic", type: T.enumOf(["tag", "plain"]), default: "plain", title: "Nameplate style", description: "A solid knockout tag or plain text.", usedBy: NAME },
  { path: "nameplate.decor", class: "cosmetic", type: T.setOf(["barcode", "crosshairs"]), default: [], title: "Nameplate decor", description: "A decorative barcode under the name, crosshairs either side.", usedBy: NAME },
  { path: "edgeText.mode", class: "cosmetic", type: T.enumOf(["off", "auto", "on"]), default: "off", title: "Edge text ring", description: "Text along the board edge: off, auto (round outlines only), on.", usedBy: EDGE },
  { path: "edgeText.items", class: "cosmetic", type: T.texts(12), default: [], title: "Edge text items", description: "Text runs placed around the edge; ${NAME}, ${REV} and ${MOTTO} are filled in, empty ones dropped.", usedBy: EDGE },
  { path: "edgeText.inset", class: "cosmetic", type: T.length(0, 10), default: 0.6, title: "Edge text inset", description: "Distance from the edge to the text's feet.", usedBy: EDGE },
  { path: "edgeText.orientation", class: "cosmetic", type: T.enumOf(["feetOut", "feetIn"]), default: "feetOut", title: "Edge text orientation", description: "feetOut: letters stand on the edge (counterclockwise); feetIn: tops toward the edge (clockwise).", usedBy: EDGE },
  { path: "edgeText.gap", class: "cosmetic", type: T.length(0, 50), default: 3.0, title: "Edge text gap", description: "Least space between edge text runs.", usedBy: EDGE },
  { path: "brand.mode", class: "cosmetic", type: T.enumOf(["house", "client", "neutral"]), default: "neutral", title: "Brand mode", description: "house: the owner's own marks; client: no house name or company mark (client boards); neutral: no marks.", usedBy: [...MARKS, ...CHECK] },
  { path: "marks.maker", class: "cosmetic", type: { kind: "asset" }, default: "none", title: "Maker mark", description: "Asset id of the maker mark (from the asset registry), or none.", usedBy: MARKS },
  { path: "marks.company", class: "cosmetic", type: { kind: "asset" }, default: "none", title: "Company mark", description: "Asset id of the company mark, or none; never on client boards.", usedBy: MARKS },
  { path: "marks.oshw", class: "cosmetic", type: { kind: "asset" }, default: "none", title: "Open hardware mark", description: "Asset id of an open hardware mark; drawn only when the call says the board is released as open hardware.", usedBy: MARKS },
  { path: "marks.easterEgg", class: "cosmetic", type: { kind: "asset" }, default: "none", title: "Easter egg", description: "Asset id of a personal mark, placed where it does not compete with function.", usedBy: MARKS },
  { path: "marks.easterEgg.max", class: "cosmetic", type: { kind: "number", min: 0, max: 5, unit: "count", integer: true }, default: 1, title: "Easter eggs per board", description: "At most this many easter eggs on one board.", usedBy: [...MARKS, ...CHECK] },
  { path: "marks.motto", class: "cosmetic", type: T.text(60), default: "", title: "Motto", description: "A motto, set in your own layer; filled into ${MOTTO}.", usedBy: [...MARKS, ...EDGE] },
  { path: "marks.side", class: "cosmetic", type: T.enumOf(["top", "bottom"]), default: "bottom", title: "Marks side", description: "Side marks go on.", usedBy: MARKS },
  { path: "marks.height", class: "cosmetic", type: T.length(0.5, 30), default: 4.0, title: "Mark height", description: "Height of a logo or mark, within the asset's own size limits.", usedBy: MARKS },
  { path: "marks.easterEgg.height", class: "cosmetic", type: T.length(0.5, 30), default: 3.0, title: "Easter egg height", description: "Height of the easter egg.", usedBy: MARKS },
  { path: "edge.corner", class: "cosmetic", type: T.enumOf(["square", "chamfer", "round"]), default: "square", title: "Board corners", description: "How free board corners are dressed; mechanical design owns the outline.", usedBy: [], specifiedOnly: true },
  { path: "polarity.mark", class: "cosmetic", type: T.enumOf(["none", "triangle"]), default: "none", title: "Polarity marks", description: "Pin 1 and polarity marks beside polarized parts.", usedBy: [], specifiedOnly: true },
];

const BY_PATH = new Map(TOKENS.map((t) => [t.path, t]));

/** One token's definition, or undefined. */
export const tokenDef = (path: string): TokenDef | undefined => BY_PATH.get(path);

/** The default value of every token, by path. */
export function defaultTokens(): Record<string, TokenValue> {
  const out: Record<string, TokenValue> = {};
  for (const t of TOKENS) out[t.path] = t.default;
  return out;
}

const HEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Why a value does not fit its token, or undefined when it does. Asset ids are checked against the registry elsewhere. */
export function checkTokenValue(path: string, value: unknown): string | undefined {
  const def = BY_PATH.get(path);
  if (!def) return `unknown token ${path}`;
  const t = def.type;
  const inRange = (v: number, min?: number, max?: number) => (min !== undefined && v < min ? `${path}: ${v} is below ${min}` : max !== undefined && v > max ? `${path}: ${v} is above ${max}` : undefined);
  switch (t.kind) {
    case "length":
      return isNum(value) ? inRange(value, t.min, t.max) : `${path}: a length in mm`;
    case "number":
      if (!isNum(value)) return `${path}: a number`;
      if (t.integer && !Number.isInteger(value)) return `${path}: a whole number`;
      return inRange(value, t.min, t.max);
    case "range":
      if (!Array.isArray(value) || value.length !== 2 || !value.every(isNum)) return `${path}: [low, high] in mm`;
      if (value[0] > value[1]) return `${path}: low above high`;
      return inRange(value[0], t.min, t.max) ?? inRange(value[1], t.min, t.max);
    case "enum":
      return typeof value === "string" && t.values.includes(value) ? undefined : `${path}: one of ${t.values.join(", ")}`;
    case "set":
      if (!Array.isArray(value)) return `${path}: a list of ${t.values.join(", ")}`;
      for (const v of value) if (typeof v !== "string" || !t.values.includes(v)) return `${path}: ${String(v)} is not one of ${t.values.join(", ")}`;
      return new Set(value).size === value.length ? undefined : `${path}: repeated entries`;
    case "bool":
      return typeof value === "boolean" ? undefined : `${path}: true or false`;
    case "color":
      return typeof value === "string" && (value === "auto" || HEX.test(value)) ? undefined : `${path}: #RRGGBB, #RRGGBBAA or auto`;
    case "text":
      return typeof value === "string" && value.length <= t.max && !/[\n\r]/.test(value) ? undefined : `${path}: one line of at most ${t.max} characters`;
    case "texts":
      return Array.isArray(value) && value.length <= t.max && value.every((v) => typeof v === "string" && v.length <= 120) ? undefined : `${path}: a list of at most ${t.max} short texts`;
    case "lengths":
      return Array.isArray(value) && value.length <= 20 && value.every((v) => isNum(v) && v > 0 && v <= 100) ? undefined : `${path}: a list of lengths in mm`;
    case "textClass": {
      const v = value as Partial<TextClass>;
      if (!v || typeof v !== "object") return `${path}: { height, width, stroke, case, knockout }`;
      const keys = Object.keys(v).sort().join(",");
      if (keys !== "case,height,knockout,stroke,width") return `${path}: exactly height, width, stroke, case and knockout`;
      if (![v.height, v.width, v.stroke].every((n) => isNum(n) && n > 0 && n <= 20)) return `${path}: height, width and stroke are positive lengths in mm`;
      if (v.case !== "upper" && v.case !== "asis") return `${path}: case is upper or asis`;
      return typeof v.knockout === "boolean" ? undefined : `${path}: knockout is true or false`;
    }
    case "asset":
      return typeof value === "string" && /^(none|[a-z0-9][a-z0-9.-]{0,63})$/.test(value) ? undefined : `${path}: an asset id or none`;
  }
}

/** The unit a token's numbers are in, for tables and explanations. */
export function tokenUnit(def: TokenDef): string {
  switch (def.type.kind) {
    case "length":
    case "range":
    case "lengths":
    case "textClass":
      return "mm";
    case "number":
      return def.type.unit === "deg" ? "deg" : def.type.unit === "oz" ? "oz" : def.type.unit === "share" ? "share" : "";
    default:
      return "";
  }
}

/** A value as short text: `0.15 mm`, `[0.25, 0.8] mm`, `1.0 x 0.8 x 0.15 mm upper knockout`. */
export function formatValue(def: TokenDef | undefined, value: unknown): string {
  const unit = def ? tokenUnit(def) : "";
  const u = unit && unit !== "share" ? ` ${unit}` : "";
  if (def?.type.kind === "textClass") {
    const v = value as TextClass;
    return `${v.height} x ${v.width} x ${v.stroke} mm, ${v.case === "upper" ? "uppercase" : "as written"}${v.knockout ? ", knockout" : ""}`;
  }
  if (Array.isArray(value)) return def?.type.kind === "range" ? `${value[0]} to ${value[1]}${u}` : value.length ? value.join(", ") + u : "(none)";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  return `${String(value)}${u}`;
}
