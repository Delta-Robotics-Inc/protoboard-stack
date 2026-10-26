/**
 * EastRising ER-TFT1.28-1 1.28-inch round 240x240 IPS TFT panel (GC9A01, 12-pin
 * 0.7 mm hollow-out FPC) — datasheet-honest UHD part.
 *
 * Sources (see parts/evidence/eastrising-er-tft128-1/sources.json):
 *   - src_datasheet: ER-TFT1.28-1 datasheet REV 1.0, outline drawing dated
 *     2025-02-07 — https://www.buydisplay.com/download/manual/ER-TFT1.28-1_Datasheet.pdf
 *     (§2 specification, §3.1 outline drawing, §4.1 pin configuration, §4.2
 *     absolute maximum, §4.3 electrical, §4.4 backlight, §6 precautions, §7.5 soldering)
 *   - src_datasheet_2019: the same datasheet with its 2019 drawing (Internet
 *     Archive capture), read as a rendered drawing for the FPC and outline geometry
 *   - src_product: BuyDisplay product page (Chinese store, product id 1806)
 *   - src_controller: GC9A01A datasheet Rev 1.0 (§7.3.4 Table 48, 4-line SPI timing)
 *
 * Modelling notes:
 *   - A bare panel (no carrier board) whose only electrical termination is the
 *     12-contact hollow-out FPC tail, which is soldered to the host board. The
 *     12 contacts are the pin table (`pin_1`..`pin_12`, §4.1 names) with
 *     designators 1..12, and the mechanical domain states the termination as
 *     the package: 12 contacts at 0.7 mm pitch, no exposed pad.
 *   - Host bus: a write-mostly 4-wire SPI target (SCL clock, SDA data, CS
 *     select) plus the separate D/C (data/command) and RESET inputs. SDA is the
 *     only data line and is bidirectional (§4.1), so there is no MISO slot: the
 *     composite is hand-rolled with MOSI/SCK/SS slots (the SPI builder would add a
 *     required MISO). D/C and RESET stay plain inputs: a host SPI port has no
 *     slot for them, so they are wired to GPIOs. Reads need SDA tied to a
 *     bidirectional host pin and at most 6.67 MHz (usage_note).
 *   - The SDA slot's role is `data_in`, from the panel's side (slot roles are
 *     from the composite's perspective). Pair DRC then lands the host's MOSI on
 *     SDA and reports the host's MISO as unresolved, which is true: the panel
 *     has no MISO line. With `data_out` (the SPI builder's slot role) it paired
 *     SDA with the host's MISO.
 *   - Backlight: LEDA/LEDK are the two terminals of two parallel LED chips
 *     (§3.1 schematic). They are `passive` terminals, not supply pins: the LED is
 *     current driven (30 mA typ, 40 mA max, Vf 2.9-3.1 V) through a series
 *     resistor or a driver, so a supply voltage on the pin would be wrong. The
 *     ratings are a `performance` trait and a usage_note.
 *   - VDD is the only supply pin (2.5-3.3 V, typ 2.8 V). The panel has no
 *     separate IOVCC pin; logic levels are fractions of VDD, and §6.2 requires
 *     VDD to power every device that drives the bus.
 *   - Two discrepancies between drawing issues are `source_discrepancy` traits
 *     (outline height 37.80 vs 38.10 mm; thickness 1.5 vs 1.55 mm).
 *   - Geometry is generated (parts/local/eastrising-er-tft128-1/eastrising-er-tft128-1.py):
 *     no manufacturer CAD with usable terms (data_gap). It is modelled in the
 *     installed state of the wearable watch: the FPC drops 4.65 mm behind the
 *     backlight, past the cell, to the board, contacts facing it (-z). The panel ships with the FPC unfolded. `fpc_tail` carries the
 *     contact plane frame, `display_face` the viewing face, and each pin leaf
 *     refs its own contact face. Unstated dimensions are `assumption` traits,
 *     including the alignment holes' position along the tail (scaled; the
 *     drawing's 1.00 is a sideways offset from the tail edge). The folded
 *     front side (2.00 mm window) faces the board; the rear view's 1.70 mm is
 *     the window on the other side. The body envelope (38.30 x 35.60 x 6.28, installed)
 *     exceeds the §2.2 folded outline by the fold and the tail under the
 *     backlight (see the CAD installed state assumption).
 *   - Mass is not in the sources: 4 g is the project brief's assumption.
 *   - Availability: the English BuyDisplay URL once used for this panel now
 *     sells ER-TFT1.28-3 (plug-in FPC); the Chinese store still lists
 *     ER-TFT1.28-1 (usage_note).
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { clockFreqHz, defineModule, pinTable } from "@deltarobotics/uhd";
import { feature, own, withGeometry } from "@deltarobotics/uhd";
// the common generated-CAD layout (STEP, GLB, manifest), which parts/local/cadkit/partkit.py follows
import { cadArtifacts } from "@protoboardai/ext-frame-cad/artifacts";

const SRC = {
  datasheet: "https://www.buydisplay.com/download/manual/ER-TFT1.28-1_Datasheet.pdf",
  datasheet2019:
    "https://web.archive.org/web/20230128234518/https://www.buydisplay.com/download/manual/ER-TFT1.28-1_Datasheet.pdf",
  product:
    "https://www.buydisplay.com/chinese/catalog/product/view/id/1806/s/1-28-inch-tft-lcd-display-240x240-round-circle-screen-for-smart-watch/",
  productEnSlug: "https://www.buydisplay.com/1-28-inch-tft-lcd-display-240x240-round-circle-screen-for-smart-watch",
  controller: "https://web.archive.org/web/20250218222306/https://www.buydisplay.com/download/ic/GC9A01A.pdf",
  grabcad: "https://grabcad.com/buydisplay.com-1/models",
} as const;

const VDD: [number, number] = [2.5, 3.3]; // §4.3
const VDD_TYP = 2.8; // §4.3
const SPI_WRITE_MAX_HZ = 100_000_000; // GC9A01A Table 48: twc >= 10 ns
const SPI_READ_MAX_HZ = 6_666_666; // GC9A01A Table 48: trc >= 150 ns

function withTraits(iface: InterfaceDef, traits: TraitDef[]): InterfaceDef {
  return { ...iface, traits: [...(iface.traits ?? []), ...traits] };
}

// ---------------------------------------------------------------------------
// FPC contacts — §4.1 pin configuration, pin 1 first
// ---------------------------------------------------------------------------

const pins = pinTable(
  [
    [1, "GND", "ground", "Power Ground"],
    { pin: 2, name: "LEDK", type: "passive", description: "LED Cathode", capabilities: ["led_cathode"] },
    { pin: 3, name: "LEDA", type: "passive", description: "LED Anode", capabilities: ["led_anode"] },
    { pin: 4, name: "VDD", type: "power_in", voltageV: VDD, nominalV: VDD_TYP, description: "Power Supply for Analog" },
    [5, "GND", "ground", "Power Ground"],
    [6, "GND", "ground", "Power Ground"],
    { pin: 7, name: "D/C", type: "input", description: "Display data/command selection pin in 4-line serial interface.", capabilities: ["display_dc"] },
    { pin: 8, name: "CS", type: "input", description: "Chip selection pin. Low : enable High : Disable", capabilities: ["spi_ss"] },
    { pin: 9, name: "SCL", type: "input", description: "This pin is used to be serial interface clock.", capabilities: ["spi_sck"] },
    { pin: 10, name: "SDA", type: "io", description: "Serial communication data input and output .", capabilities: ["spi_mosi"] },
    {
      pin: 11,
      name: "RESET",
      type: "input",
      description: "This signal will reset the device and it must be applied to properly initialize the chip.Signal is active low.",
      capabilities: ["reset"],
    },
    [12, "GND", "ground", "Power Ground"],
  ],
  { source: `${SRC.datasheet} (§4.1)`, logicV: VDD },
).map((p) =>
  p.id === "pin_4"
    ? withTraits({ ...p, parameters: [...(p.parameters ?? []), { id: "max_current", unit: "A", value: 0.0105 }] }, [
        {
          type: "usage_note",
          params: {
            note: "IDD 8.5 mA typ, 10.5 mA max operating; 15 uA typ, 30 uA max in sleep-in. max_current is the operating maximum. Backlight current is separate (LEDA/LEDK).",
            source: `${SRC.datasheet} (§4.3)`,
          },
        },
      ])
    : p,
);

// ---------------------------------------------------------------------------
// Host bus: 4-wire serial SPI target (no MISO: SDA is the only data line)
// ---------------------------------------------------------------------------

const spi: InterfaceDef = {
  id: "spi",
  name: "4-wire serial SPI (target)",
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "spi", roles: ["slave"] }],
  parameters: [clockFreqHz([0, SPI_WRITE_MAX_HZ])],
  slots: [
    { id: "mosi", label: "SDA (data in; also data out for reads)", required: true, match: { protocol: "spi", role: "data_in", capability: "spi_mosi" } },
    { id: "sck", label: "SCL", required: true, match: { protocol: "spi", role: "clock", capability: "spi_sck" } },
    { id: "ss", label: "CS (active low)", required: true, match: { protocol: "spi", role: "select", capability: "spi_ss" } },
  ],
  profiles: [{ id: "spi_fpc", label: "SDA/SCL/CS on FPC pins 10/9/8", bindings: { mosi: "pin_10", sck: "pin_9", ss: "pin_8" } }],
  max_instances: 1,
  traits: [
    {
      type: "usage_note",
      params: {
        note: "4-line serial interface: D/C (pin 7) selects command (low) or data (high) for each byte and is driven from a host GPIO, as is RESET (pin 11, active low, required to initialise the chip). Write clock cycle >= 10 ns (up to 100 MHz); read clock cycle >= 150 ns (up to 6.67 MHz). SDA is bidirectional: reads need it on a bidirectional host pin; a write-only host can leave reads unused.",
        read_max_hz: SPI_READ_MAX_HZ,
        source: [`${SRC.datasheet} (§2.3, §4.1)`, `${SRC.controller} (§7.3.4 Table 48)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Mechanical: FPC solder tail and viewing face
// ---------------------------------------------------------------------------

const fpcTail: InterfaceDef = {
  id: "fpc_tail",
  name: "12-pin 0.7 mm hollow-out FPC tail (solder)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["solder_fpc_tail"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "fpc_hollow_out_solder_12p_0p7mm",
        positions: 12,
        pinout: ["GND", "LEDK", "LEDA", "VDD", "GND", "GND", "D/C", "CS", "SCL", "SDA", "RESET", "GND"],
        note: "Hollow-out FPC: 12 bare contacts 0.35 mm wide at 0.7 mm pitch (7.7 mm span) across a window at the tail end, 2.00 mm long on the front side (the side towards the board once folded) and 1.70 mm on the rear; tail 11.4 +-0.2 mm wide, 0.13 +-0.03 mm thick; 2 x dia 1.0 +-0.05 mm alignment holes 10.00 mm apart, the pin-12 hole centre 1.00 mm in from the pin-12 side edge of the tail. No dimension places the holes along the tail (see the hole-position assumption). Soldered to the host board, not plugged into a connector. Shipped unfolded (tail end 12.24 +-0.3 mm beyond the backlight edge); folded behind the backlight the tail end sits 10.24 +-0.5 mm in from the outer edge and the fold stands at most 0.50 mm proud of the backlight frame.",
        source: [`${SRC.datasheet} (§2.1, §3.1)`, `${SRC.datasheet2019} (§3.1 drawing)`],
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Solder with an iron at 280 +-10 C for 3-4 s with eutectic solder, and remove flux residue afterwards (non-halogen flux excepted). Do not plug or unplug with power applied.",
        source: `${SRC.datasheet} (§6.3, §7.5)`,
      },
    },
  ],
};

const displayFace: InterfaceDef = {
  id: "display_face",
  name: "Viewing face (polarizer; visual area dia 33.4 mm, active area dia 32.4 mm)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["display_viewing_face"],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "Cover the polarizer with a transparent protective plate; leave enough spacer height between the panel and the fitting plate that the panel surface is not stressed (tolerance +-0.1 mm). Mount free of twisting and torque. Keep the housing clear of the FPC fold (up to 0.50 mm proud of the backlight frame) and of the backlight lead region (up to 0.45 mm high).",
        source: [`${SRC.datasheet} (§6.1, §6.4, §7.2)`, `${SRC.datasheet2019} (§3.1 fold note)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const EASTRISING_ER_TFT128_1_BASE: ModuleDef = defineModule({
  id: "eastrising-er-tft128-1",
  name: "EastRising ER-TFT1.28-1 1.28\" round TFT",
  version: "1.0.0",
  manufacturer: "EastRising Technology (BuyDisplay)",
  part_number: "ER-TFT1.28-1",
  description:
    "1.28-inch round IPS TFT panel, 240xRGBx240, GC9A01 controller (COG), 4-wire serial SPI, 2-chip white LED backlight, no touch panel. 12-pin 0.7 mm hollow-out FPC for soldering. Outline 35.60 x 37.80 x 1.5 mm with the FPC folded; active area dia 32.4 mm. VDD 2.5-3.3 V.",
  tags: ["display", "tft", "ips", "round", "240x240", "gc9a01", "spi", "fpc", "eastrising", "buydisplay", "wearable"],
  categories: ["component.display"],
  interfaces: [...pins, spi, fpcTail, displayFace],
  interfaceGroups: [
    { id: "required_power_pins", label: "Supply and ground contacts", members: ["pin_1", "pin_4", "pin_5", "pin_6", "pin_12"], policy: "all_of" },
    { id: "backlight", label: "Backlight LED anode and cathode", members: ["pin_2", "pin_3"], policy: "all_of" },
    { id: "host_control", label: "SPI bus plus D/C and RESET", members: ["spi", "pin_7", "pin_11"], policy: "all_of" },
  ],
  artifacts: [
    { id: "datasheet", name: "ER-TFT1.28-1 datasheet REV 1.0 (drawing 2025-02-07)", type: "datasheet", url: SRC.datasheet },
    { id: "datasheet_2019", name: "ER-TFT1.28-1 datasheet, 2019 drawing (archive copy)", type: "datasheet", url: SRC.datasheet2019 },
    { id: "controller_datasheet", name: "GC9A01A datasheet Rev 1.0 (archive copy)", type: "datasheet", url: SRC.controller },
    { id: "product", name: "BuyDisplay product page ER-TFT1.28-1", type: "documentation", url: SRC.product },
  ],
  domains: [
    {
      domain: "electrical",
      power_domains: [{ id: "vdd", name: "VDD (logic and analog)", nominal_voltage_V: VDD_TYP, voltage_range_V: VDD }],
      metadata: {
        logic_levels: { vih_min: "0.7 VDD", vil_max: "0.3 VDD", voh_min: "0.8 VDD", vol_max: "0.2 VDD" },
        idd_mA: { operating_typ: 8.5, operating_max: 10.5, sleep_in_typ: 0.015, sleep_in_max: 0.03 },
        backlight: { leds: 2, connection: "parallel", vf_V: [2.9, 3.1], vf_typ_V: 3.0, if_typ_mA: 30, if_max_mA: 40 },
        source: [`${SRC.datasheet} (§4.3, §4.4)`, `${SRC.datasheet2019} (§3.1 LED schematic)`],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 37.8, width: 35.6, height: 1.5 },
      weight_g: 4,
      package: {
        name: "Hollow out FPC, 12 pins",
        code: "ER-TFT1.28-1 outline drawing §3.1",
        pin_count: 12,
        pitch_mm: 0.7,
        exposed_pad: false,
        source: `${SRC.datasheet} (§2.1 "FPC Connector: Hollow out FPC", §2.2 outline with FPC folded, §3.1 "P0.7*(12-1)=7.70")`,
      },
      metadata: {
        visual_area_dia_mm: 33.4,
        active_area_dia_mm: 32.4,
        lcd_glass_mm: [35.2, 37.24],
        polarizer_mm: [34.74, 34.32],
        fpc_thickness_mm: 0.13,
        weight_note: "4 g is an assumption (assumption trait); the product page gives 18 g shipping weight with packaging.",
        source: [`${SRC.datasheet} (§2.2, §3.1)`, `${SRC.datasheet2019} (§3.1)`],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-20, 70],
      metadata: { storage_temperature_C: [-30, 80], source: `${SRC.datasheet} (§2.1)` },
    },
  ],
  traits: [
    {
      type: "operating_conditions",
      params: { vdd_V: VDD, vdd_typ_V: VDD_TYP, temperature_C: [-20, 70], storage_temperature_C: [-30, 80], source: `${SRC.datasheet} (§2.1, §4.3)` },
    },
    {
      type: "absolute_maximum",
      params: {
        vdd_V: [-0.3, 4.6],
        logic_input_V: "-0.3 to VDD+0.3",
        backlight_if_max_mA: 40,
        note: "§4.2 lists 'Supply Voltage (I/O) VDD' and 'Analog Supply Voltage VDDIO', both -0.3 to +4.6 V; the panel has one supply pin (VDD). The 40 mA backlight figure is the §4.4 maximum forward current.",
        source: `${SRC.datasheet} (§4.2, §4.4)`,
      },
    },
    {
      type: "performance",
      params: {
        kind: "display",
        technology: "IPS TFT LCD, white LED backlight",
        resolution: [240, 240],
        colours: "4K/65K/262K",
        active_area_dia_mm: 32.4,
        dot_pitch_mm: 0.135,
        brightness_cd_m2_typ: 400,
        contrast_typ: 500,
        viewing_angle_deg: { left: 80, right: 80, up: 80, down: 80 },
        response_time_ms_typ: 20,
        controller: "GC9A01 (GC9A01A)",
        backlight_life_h: 30000,
        source: [`${SRC.datasheet} (§2.1-§2.4, §4.4)`, `${SRC.product} (controller GC9A01A)`],
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Power: VDD must also supply every device that can drive the display's bus, and the bus must not be driven while VDD is off. Backlight: LEDA to LEDK through a current limit; 30 mA typ (40 mA max) at Vf 2.9-3.1 V, two LED chips in parallel. A 3.0 V rail gives no headroom for a series resistor, so drive it from a higher rail (e.g. the cell) with a series resistor and a low-side switch on LEDK, or with an LED driver.",
        source: [`${SRC.datasheet} (§4.4, §6.2)`, `${SRC.datasheet2019} (§3.1 LED schematic)`],
      },
    },
    {
      type: "usage_note",
      params: {
        note: "Availability: BuyDisplay's Chinese store lists ER-TFT1.28-1 (product id 1806, in stock, 10-year continuity from 2019). The English URL that used to sell it now sells ER-TFT1.28-3, a different panel (plug-in FPC, 300 cd/m2). Confirm the order code before buying.",
        source: [SRC.product, SRC.productEnSlug],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "outline height (H, FPC side)",
        values: ["37.80 mm (§2.2 and the 2025-02-07 drawing, LCM 37.8 +-0.1; product page)", "38.10 mm (2019 drawing, BL 38.10 +-0.1)"],
        sources: [SRC.datasheet, SRC.datasheet2019],
        resolution: "Current issue used: 37.80 mm. The CAD backlight tab ends 20.00 mm from the active-area centre.",
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "thickness",
        values: ["1.5 mm (§2.2 outline with FPC folded; product page)", "1.50 +-0.1 mm (2019 drawing)", "1.55 +-0.1 mm (2025 drawing text, which also notes a removable protective tape up to 0.15 mm)"],
        sources: [SRC.datasheet, SRC.datasheet2019, SRC.product],
        resolution: "1.5 mm used (§2.2).",
      },
    },
    {
      type: "assumption",
      params: { field: "mass", value: "4 g", reason: "No net mass in the datasheet or product page (18 g is the shipping weight). Project brief estimate for a glass panel of this outline; feeds the mass estimate only." },
    },
    {
      type: "assumption",
      params: { field: "CAD layer split", value: "backlight 0.80 mm, LCD glass 0.60 mm, polarizer 0.10 mm", reason: "The drawing gives only the 1.5 mm total." },
    },
    {
      type: "assumption",
      params: {
        field: "CAD tab and FPC neck outline",
        value: "tab flat end 14.0 mm wide, chamfered to the circle at +-8.6 mm; FPC neck 8.7 mm wide through the fold; hollow-out window 8.6 mm wide",
        reason: "Not dimensioned on the drawing; scaled from it (the drawing says do not scale).",
      },
    },
    {
      type: "assumption",
      params: {
        field: "FPC alignment-hole position along the tail",
        value: "hole centres 4.0 mm from the tail end, 2.0 mm beyond the 2.00 mm window (CAD x = 18.41 mm in the installed state); across the tail they follow the drawing: y = -4.70 mm (pin-12 side, 1.00 from the edge) and +5.30 mm",
        reason: "No dimension places the holes along the tail; the drawing's 1.00 is the sideways offset from the pin-12 side edge. Scaled from the 2019 drawing rendered at 1200 dpi: the drawing is stretched (50.0 px/mm along the tail from the 38.10, 32.40 and 2.00 dimensions; 45.6 px/mm across it from 35.60, 32.40, 10.00 and 11.4), and the hole centres sit 200 px from the tail end, so 4.0 mm. Read at the cross-tail scale it would be 4.4 mm (2.4 beyond the window).",
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD tail pad widening",
        value: "the tail pad is 0.9 mm wider than 11.4 mm on the pin-1 side, from 3.8 mm in from the tail end to the end of the 10.0 mm pad, with a chamfer from 2.6 to 3.8 mm",
        reason: "Drawn but not dimensioned; scaled from the 2019 drawing as above. The 1.00 and 10.00 dimensions put the pin-1 hole centre 0.40 mm from the 11.4 mm edge, so the pad must be wider there.",
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD installed state",
        value: "Installed as in the wearable watch (display / cell / board, OQ-W5): the FPC leaves the tab, stands the full 0.50 mm proud of the backlight frame, drops 4.65 mm behind the panel rear face (0.25 mm foam tape, the 4.0 mm cell, and 0.53 mm left for the cell to swell, less the 0.13 mm FPC) and runs inwards along the board with its front side (the 2.00 mm window side) towards the board; contacts flush with the tail's rear face at z = -4.78 mm, centred at x = 15.41 mm. The tail's path length is kept from the shipped state (tail end 12.24 mm beyond the backlight edge), with square bends, so the contacts sit 6.09 mm in from the fold. Polarizer concentric with the active area. The body envelope is 38.30 x 35.60 x 6.28 mm (z -4.78..1.50). The backlight lead region (H 0.45 mm max) is not modelled.",
        reason: "The drawing gives the shipped (unfolded) tail length and the folded position (2.00 mm window side facing out, fold 0.50 mm max beyond the backlight frame); how far the tail drops is this project's stack, not a datasheet value, and the bend radii are not stated; the 2019 issue gives the same §2.2 outline as its backlight dimension (38.10 BL). Whether the backlight has a pocket for the tail, the contact thickness and the polarizer offset are not stated.",
      },
    },
    {
      type: "data_gap",
      params: {
        fields: ["manufacturer CAD"],
        note: "No manufacturer CAD with usable terms: the BuyDisplay product page lists no 3D model for ER-TFT1.28-1 (only for the ER-TFTM1.28-1 breakout); a BuyDisplay-posted model on GrabCAD states no licence and needs a login, so it was not downloaded. Geometry generated from the datasheet drawing (parts/local/eastrising-er-tft128-1/eastrising-er-tft128-1.py).",
        source: [SRC.product, SRC.grabcad],
      },
    },
    {
      type: "data_gap",
      params: { fields: ["panel SPI clock limit"], note: "The panel datasheet gives no SPI clock; the clock_freq range is the GC9A01A Table 48 write timing (twc >= 10 ns). Board-level signal integrity on the FPC is not characterised." },
    },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from the §3.1 drawing (not manufacturer CAD).
// Coordinates: active-area centre on the origin, x towards the FPC tab, y
// across (pin 1 at +y), z = 0 the backlight rear face, z = 1.5 the viewing face.
// The folded FPC tail lies on the rear face, contacts facing -z.
// ---------------------------------------------------------------------------

const PIN = (n: number, y: number) => ({
  refs: [feature(`pin_${n}`, { area_mm2: 0.7, centroid: [15.41, y, -4.78], normal: [0.0, 0.0, -1.0] }), own(`pin_${n}`)],
});

export const EASTRISING_ER_TFT128_1: ModuleDef = withGeometry(
  EASTRISING_ER_TFT128_1_BASE,
  {
    // contact plane: centre of the 12-contact row, normal towards the board, xAxis from pin 1 to pin 12;
    // the two dia 1.0 alignment holes are a second feature
    fpc_tail: {
      frame: { origin: [15.41, 0, -4.78], normal: [0, 0, -1], xAxis: [0, -1, 0] },
      refs: [
        feature("fpc_tail", { area_mm2: 8.4, centroid: [15.41, 0.0, -4.78], normal: [0.0, 0.0, -1.0] }),
        own("fpc_tail"),
        feature("fpc_holes", { area_mm2: 0.817, centroid: [18.41, 0.3, -4.715] }),
      ],
    },
    // viewing face: active-area centre on the polarizer, normal out of the screen, xAxis towards the FPC tab
    display_face: {
      frame: { origin: [0, 0, 1.5], normal: [0, 0, 1], xAxis: [1, 0, 0] },
      refs: [feature("display_face", { area_mm2: 936.412, centroid: [0.0, 0.0, 1.5], normal: [0.0, 0.0, 1.0] }), own("display_face")],
    },
    // each FPC contact's solder face (pin 1 at +y, 0.7 mm pitch)
    pin_1: PIN(1, 3.85),
    pin_2: PIN(2, 3.15),
    pin_3: PIN(3, 2.45),
    pin_4: PIN(4, 1.75),
    pin_5: PIN(5, 1.05),
    pin_6: PIN(6, 0.35),
    pin_7: PIN(7, -0.35),
    pin_8: PIN(8, -1.05),
    pin_9: PIN(9, -1.75),
    pin_10: PIN(10, -2.45),
    pin_11: PIN(11, -3.15),
    pin_12: PIN(12, -3.85),
  },
  cadArtifacts({
    dir: "parts/local/eastrising-er-tft128-1",
    name: "eastrising-er-tft128-1",
    generator: "parts/local/eastrising-er-tft128-1/eastrising-er-tft128-1.py",
    tool: "build123d 0.13.0",
    interfaces: ["fpc_tail", "display_face", ...Array.from({ length: 12 }, (_, i) => `pin_${i + 1}`)],
  }),
);
