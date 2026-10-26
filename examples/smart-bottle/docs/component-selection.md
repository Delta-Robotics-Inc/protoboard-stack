# Smart water bottle: component selection

Input for the parts-research, board and enclosure tracks. Every fact
carries a source tag such as [B3]; the [sources](#sources) table at the end
gives the URL, the document revision and, where the official file could not be
fetched in this session, the copy that was read. Anything not taken from a
source is written as **Assumption:** with its reason.

Stock figures come from the JLCPCB in-stock catalog through the unofficial
`jlcsearch.tscircuit.com` mirror, read on 2026-10-02 [B26]. Digi-Key and
Mouser were not queried (no API credentials in this environment).

Five parts are shared with the [wearable watch](../../wearable-watch/docs/component-selection.md):
MAX17048G+T10, USBLC6-2SC6, Alps SKRTLAE010, ruthex RX-M2x4 and the ISO 7045
M2 × 6 screw. The MCP73831 is the same die in a different package here (DFN
instead of SOT-23, for heat; see U5).

## Bill of materials (purchased parts)

| Ref | Function | Manufacturer | Part number | Qty | Body | Tier | Part id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U1 | Wi-Fi + BLE module (ESP32-C3, 4 MB flash, PCB antenna) | Espressif | ESP32-C3-MINI-1-H4X | 1 | 13.2 × 16.6 × 2.4 mm, 53 pads | project-researched | `espressif-esp32-c3-mini-1-h4x` |
| U2 | Time-of-flight sensor, 940 nm, 1–1300 mm | STMicroelectronics | VL53L4CDV0DH/1 | 1 | Optical LGA12, 4.4 × 2.4 × 1 mm | project-researched | `st-vl53l4cdv0dh-1` |
| TP1 | Sealed temperature probe (DS18B20 in a stainless tube) | Adafruit | 381 | 1 | tube Ø6 × 30 mm, cable Ø4 mm × 91 cm | project-researched | `adafruit-381-ds18b20-probe` |
| U3 | 24-channel I2C RGB LED driver | Texas Instruments | LP5024RSMR | 1 | VQFN-32, 4.00 × 4.00 mm | project-researched | `ti-lp5024rsm` |
| D1–D8 | RGB LED, 1.6 × 1.6 mm, common anode | Kingbright | APTF1616LSEEZGKQBKC | 8 | 1.6 × 1.6 × 0.7 mm | project-researched | `kingbright-aptf1616lseezgkqbkc` |
| U4 | Buck-boost converter, 1.8–5.5 V in, 3.3 V out | Texas Instruments | TPS63020DSJR | 1 | VSON-14, 3 × 4 mm | **in UHD library** | `ti-tps63020dsjr` |
| L1 | 1.5 µH power inductor for U4 | Coilcraft | XFL4020-152ME | 1 | 4 × 4 × 2.1 mm | project-researched | `coilcraft-xfl4020-152me` |
| U5 | Li-ion/LiPo linear charger | Microchip | MCP73831T-2ACI/MC | 1 | DFN-8, 2 × 3 mm | project-researched | `microchip-mcp73831t-2aci-mc` |
| U6 | Fuel gauge | Analog Devices (Maxim) | MAX17048G+T10 | 1 | TDFN-8, 2 × 2 mm | project-researched (shared) | `adi-max17048g-t10` |
| J1 | USB-C receptacle, USB 2.0, IP67, mid-mount | GCT | USB4720-03-A | 1 | body length 6.50 mm, profile 2.13 mm | project-researched | `gct-usb4720-03-a` |
| D9 | USB ESD array | STMicroelectronics | USBLC6-2SC6 | 1 | SOT-23-6 | project-researched (shared) | `st-usblc6-2sc6` |
| SW1 | Side-push tact switch | Alps Alpine | SKRTLAE010 | 1 | 4.5 × 3.4 × 3.3 mm | project-researched (shared) | `alps-skrtlae010` |
| BT1 | LiPo cell 1000 mAh with protection board | LiPol Battery Co. (polybattery.com) | LP503450 | 1 | 5 × 34 × 50 mm | project-researched | `lipol-lp503450` |
| — | Bottle, 32 oz wide mouth, Tritan Renew | Nalgene | 32oz Wide Mouth Bottle | 1 | Ø89 × 210 mm, 63 mm cap | project-researched | `nalgene-32oz-wide-mouth` |
| — | O-ring, bottle lip face seal | any AS568 supplier | AS568-138, silicone 70A, FDA-grade | 1 | ID 53.64 × CS 2.62 mm | project-researched | `as568-138-silicone` |
| — | O-ring, electronics lid seal | any AS568 supplier | AS568-040, silicone 70A | 1 | ID 72.75 × CS 1.78 mm | project-researched | `as568-040-silicone` |
| — | O-ring, probe tube seal | any AS568 supplier | AS568-010, silicone 70A, FDA-grade | 1 | ID 6.07 × CS 1.78 mm | project-researched | `as568-010-silicone` |
| — | Heat-set insert M2 | ruthex | RX-M2x4 (GE-M2x04-001) | 6 | Ø3.6 × 4.0 mm | project-researched (shared) | `ruthex-rx-m2x4` |
| — | Screw M2 × 6 pan head, A2 | Accu | SPP-M2-6-A2 | 6 | head Ø4.0 × 1.72 mm | project-researched (shared) | `iso-7045-m2x6-a2` |
| — | Resistors and capacitors | chosen in the board track | — | ≈ 35 | 0402/0603 | project-specific (board) | — |

The O-ring dash sizes are proposals for the enclosure track; the material
grade and supplier are chosen there (OQ-B5).

## U1 — Espressif ESP32-C3-MINI-1-H4X

**Why this one.** Agreed default family (Wi-Fi + BLE, certified module, PCB
antenna). Espressif marks ESP32-C3-MINI-1-N4X and -H4X as *Recommended* and
the older -N4, -H4 and -H4-AZ as *NRND* [B1] Table 1-1. The X variants carry
chip revision v1.1 [B1].

**N4X or H4X.** Both have 4 MB of in-package flash; N4X is rated −40 to
85 °C, H4X −40 to 105 °C [B1]. The H4X is chosen because it is in JLCPCB
stock (C41349510, 911 pieces) and N4X did not appear in the JLCPCB
catalog [B26]. The two are footprint-identical (same 13.2 × 16.6 × 2.4 mm
size, same table [B1]).

**Alternatives considered.**

| Option | Why not |
| --- | --- |
| ESP32-C3-MINI-1U-H4X (external antenna connector) | 13.2 × 12.5 mm [B1]; needs a separate antenna and cable inside the cap. Keep as the fallback if the PCB antenna performs badly next to water (OQ-B6). |
| `espressif-esp32-c3-devkitm-1-n4x`, `seeed-xiao-esp32c3` (both in the UHD library) | Development boards, not modules; too large and they carry their own USB and regulators. Their evidence (the same module datasheet) is reusable. |

**Key facts.**

| Fact | Value | Source |
| --- | --- | --- |
| Supply (3V3) | 3.0 / 3.3 / 3.6 V; the supply must deliver ≥ 0.5 A | [B1] Recommended Operating Conditions |
| Size | 13.2 × 16.6 × 2.4 mm | [B1] Table 1-1 |
| Pads | 53 (GND 1, 2, 11, 14, 36–53; 3V3 3; EN 8; 15 GPIO; rest NC) | [B1] Table 3-1 |
| Wi-Fi TX peak | 350 mA (802.11b 1 Mbps, 20.5 dBm); 290–295 mA (802.11g/n) | [B1] Table 6-4 |
| Wi-Fi RX | 82–84 mA | [B1] Table 6-4 |
| BLE TX / RX | 170 mA at 0 dBm, 190 mA at 9 dBm / 86 mA | [B1] Table 6-5 |
| Modem-sleep, CPU running | 23–28 mA at 160 MHz; 17–22 mA at 80 MHz | [B1] Table 6-6 |
| Light-sleep | 130 µA | [B1] Table 6-7 |
| Deep-sleep (RTC timer + RTC memory) | 5 µA | [B1] Table 6-7 |
| Power off (EN low) | 1 µA | [B1] Table 6-7 |
| Strapping pins | GPIO2, GPIO8, GPIO9. SPI boot: GPIO9 = 1. Download boot: GPIO8 = 1, GPIO9 = 0. GPIO2 pull-up recommended. GPIO9 has a weak internal pull-up | [B1] §4, Tables 4-1, 4-3 |
| USB | GPIO18 = USB D−, GPIO19 = USB D+ (USB Serial/JTAG) | [B1] Table 3-1 |
| Deep-sleep wake pins | Only GPIO0–GPIO5 (RTC domain) can wake the chip from deep sleep; in deep sleep GPIO6–21 are high impedance | [B2] |
| Antenna | Keep-out zone around the PCB antenna on the base board | [B1] §3 pin layout note |

**Availability.** JLCPCB C41349510 (H4X), 911 in stock at about $3.08 [B26].

## U2 — ST VL53L4CDV0DH/1 (time of flight)

**Why this one.** Agreed default. It ranges from 1 mm to 1300 mm with an 18°
field of view, works behind a cover window with crosstalk calibration, and
has a 5 µA hardware standby [B3]. The UHD library already has the Adafruit
5396 breakout built on this sensor (`adafruit-5396-vl53l4cd`); its ST evidence
is reusable for the bare sensor.

| Fact | Value | Source |
| --- | --- | --- |
| Range | 0–1300 mm full FoV; FoV 18° | [B3] Features |
| Emitter | 940 nm VCSEL | [B3] |
| AVDD | 2.6 / 2.8 / 3.5 V | [B3] §4.2 |
| IOVDD | 1.6 / 1.8 or 2.8 / 3.5 V | [B3] §4.2 |
| Current | HW standby 5 µA typ (3–7); SW standby 6 µA typ (4–9); ranging 22 mA average (24 max), 40 mA peak | [B3] §4.4 Table 12 |
| I2C | address 0x52 write / 0x53 read (7-bit 0x29), up to 1 Mbit/s | [B3] §3 |
| XSHUT | active-low shutdown; must always be driven; raise only when AVDD is on; 10 kΩ pull-up recommended when the host state is unknown | [B3] §1.4, §2.7 |
| GPIO1 | open-drain interrupt output, 10 kΩ pull-up | [B3] §1.3, §1.4 |
| I/O failsafe | No supply sequencing; I/Os have no diode to AVDD | [B3] §4.1–4.2 |
| Cover glass | Can sit behind cover glass; crosstalk calibration needed | [B3] §2.3 |
| Package | Optical LGA12, 4.4 × 2.4 × 1 mm | [B3] |
| Lifecycle | Active, in volume production; VL53L4CDV0DH/1 and VL53L4CDV9DH/1 orderable | [B3b] |

**Availability.** JLCPCB C3178291, 11,661 in stock [B26].

**Note on the copy read.** The official datasheet could not be downloaded
here; the copy read is DS13812 Rev 5 (June 2022). The UHD library part cites
Rev 8 (July 2024) [B3]. The parts-research track re-checks every value above
against Rev 8.

## TP1 — Adafruit 381 waterproof DS18B20 probe

**Why this one.** A ready-made sealed probe: a DS18B20 inside a 6 mm × 30 mm
stainless tube on a 4 mm PVC cable [B4]. Being digital (1-Wire), it needs one
GPIO and a pull-up [B4, B5].

| Fact | Value | Source |
| --- | --- | --- |
| Tube | stainless steel, Ø6 mm × 30 mm | [B4] |
| Cable | 91 cm (36 in), Ø4 mm, PVC jacket | [B4] |
| Wires | 3-wire: red 3–5 V, black GND, yellow/white data. A 4-wire variant adds the shield | [B4] |
| Supplied with | 4.7 kΩ pull-up | [B4] |
| DS18B20 supply | 3.0–5.5 V | [B5] |
| Accuracy | ±0.5 °C from −10 to +85 °C | [B5] |
| Current | standby 750 nA typ (1 µA max); active 1 mA typ (1.5 mA max) | [B5] DC Electrical Characteristics |
| Conversion time | 93.75 ms (9-bit) to 750 ms (12-bit) | [B5] |

**Availability.** Adafruit product 381 [B4]; not a JLCPCB part.

**Assumptions.** The 3-wire variant is used (Adafruit ships either [B4]). The
cable is cut to the routed length inside the cap; the PVC jacket stays inside
the electronics compartment, so only the stainless tube touches the bottle's
interior (food-contact question OQ-B5).

**Alternatives considered.** An NTC thermistor probe (analog; needs a divider,
ADC calibration and a sealed tube of our own) and an on-board sensor such as
a TMP117 (it would read the cap, not the water). Neither was researched
further.

## U3, D1–D8 — TI LP5024RSMR and Kingbright APTF1616LSEEZGKQBKC (LED ring)

**Why LP5024.** It sinks up to 24 constant-current channels (8 RGB LEDs) with
independent PWM per channel, runs from 2.7–5.5 V so it can sit directly on
the cell, and drops to 0.2 µA with EN low [B6].

**Alternatives considered.** Addressable RGB LEDs (WS2812-class) were not
chosen. **Assumption:** each such LED keeps its own controller powered, so
the ring would need a switched supply to reach the sleep budget, and their
supply ranges were not checked against the cell's 3.0–4.2 V. LP5018 (18
channels, 6 RGB) [B6] would do with fewer LEDs; 8 gives a smoother ring.

| LP5024 fact | Value | Source |
| --- | --- | --- |
| VCC | 2.7 to 5.5 V; under-voltage shutdown at 2.0 V (falling), restart at ≤ 2.5 V | [B6] §6.5 |
| Shutdown (EN = 0) | 0.2 µA typ, 1 µA max | [B6] §6.5 |
| Standby (EN = 1, Chip_EN = 0) | 6 µA typ | [B6] §6.5 |
| Power-save (all LEDs off > 30 ms) | 6 µA typ, 10 µA max | [B6] §6.5, §7.3.4 |
| Normal mode | 5 mA typ with 10 mA per output | [B6] §6.5 |
| Output current | 25.5 mA max per channel (35 mA with VCC ≥ 3.3 V and Max_Current_Option = 1) | [B6] §6.5 |
| Output saturation | 0.25 V typ, 0.35 V max at 20 mA | [B6] §6.5 |
| Logic levels | VIH ≥ 1.4 V, VIL ≤ 0.4 V; EN, SCL, SDA absolute max 6 V | [B6] §6.1, §6.5 |
| I2C address | 0b0101 0 A1 A0: 0x28–0x2B by ADDR1/ADDR0; broadcast 0x3C | [B6] §7.5.1.4, Table 7-2 |
| Package / status | VQFN-32 (RSM) 4.00 × 4.00 mm; LP5024RSMR Active, −40 to 85 °C | [B6] |

| APTF1616LSEEZGKQBKC fact | Value | Source |
| --- | --- | --- |
| Size | 1.6 × 1.6 × 0.7 mm, 4 pads | [B7] |
| Forward voltage at 2 mA | red 1.8 typ / 2.1 max V; green and blue 2.65 typ / 3.1 max V | [B7] |
| DC forward current max | red 30 mA, green 25 mA, blue 30 mA | [B7] |
| Luminous intensity at 2 mA | red 15, green 80, blue 14 mcd typ | [B7] |
| ESD (HBM) | red 3000 V, green 450 V, blue 250 V | [B7] |
| Common anode | yes per the JLCPCB listing [B26]; **Assumption** until the pad drawing in [B7] is checked | [B26] |

**Consequences.** LED anodes run from VBAT. At the 3.40 V cut-off the blue
and green chips need up to 3.1 V plus 0.25–0.35 V of saturation at the
driver [B6, B7], so the ring is driven at low current (2–5 mA per channel) and
the firmware dims or skips blue below about 3.5 V (OQ-B7). Blue's 250 V HBM
ESD rating means the light guide must keep fingers off the LED leads.

**Availability.** LP5024RSMR: JLCPCB C427525, 5,548 in stock. APTF1616LSEEZGKQBKC:
C3019103, 305 in stock (enough for a prototype, thin for production) [B26].

## U4, L1 — TI TPS63020DSJR (in UHD library) and Coilcraft XFL4020-152ME

**Why this one.** The ESP32-C3 needs 3.0–3.6 V at up to 350 mA peaks [B1]
while the cell runs 3.0–4.2 V. A buck-boost holds 3.3 V over the whole cell
range. An LDO would need VBAT above 3.3 V plus its dropout at 350 mA
(**Assumption:** 0.2–0.4 V for common parts), giving up the bottom of the
cell. The TPS63020
is already a verified UHD part, which this project reuses.

| Fact | Value | Source |
| --- | --- | --- |
| Input | 1.8 to 5.5 V | [B8] |
| Output current | 2 A for VIN > 2.5 V at VOUT = 3.3 V | [B8] |
| Quiescent | 25 µA typ (50 max) into VIN/VINA plus 5 µA typ (10 max) into VOUT, at VIN 3.6 V, VOUT 3.3 V | [B8] §6.5 |
| Shutdown | 0.1 µA typ | [B8] |
| Power save | PS/SYNC low; entered below about 100 mA average inductor current | [B8] §7.4.4 |
| Feedback | 500 mV; R2 in the 200 kΩ range (180 kΩ in TI's example); R1 = R2 × (VOUT/VFB − 1) = 1.008 MΩ for R2 = 180 kΩ | [B8] §8.2.3 |
| Output capacitors | 3 × 22 µF recommended | [B8] §8.2.2.3 |
| Recommended inductor | 1.5 µH: Coilcraft XFL4020-152ME (5.1 A sat, 15 mΩ, 4 × 4 × 2.1 mm) or muRata FDV0530S-H-1R5M | [B8] Table 2 |

**Alternative considered.** TI TPS63802: 11 µA quiescent current, 2 A for
VI ≥ 2.3 V at 3.3 V, 0.47 µH inductor, VSON-10 2 × 3 mm [B9]; JLCPCB C2845237,
3,970 in stock [B26]. It would cut about 20 µA (about 38 %) from the sleep
floor (see [power budget](power-budget.md)) but needs a new part. Recorded as
OQ-B3.

**Availability.** TPS63020DSJR: JLCPCB C15483, 21,067 in stock.
XFL4020-152MEC (the reel packaging code of the same inductor): C3033018,
21,140 in stock [B26].

## U5 — Microchip MCP73831T-2ACI/MC

Same charger die and option as the watch's U6 (4.20 V, 10 % precondition,
7.5 % termination, IREG = 1000 V / RPROG) [B10], in the 2 × 3 mm DFN-8 package.
**Why the DFN here:** at 303 mA the worst-case dissipation is about
(5.0 − 3.0 V) × 0.303 A ≈ 0.61 W. The SOT-23-5 has θJA 230 °C/W (about
130 °C/W with large copper); the DFN-8 has 76 °C/W [B10]. The DFN keeps the
rise near 46 °C (0.61 W × 76 °C/W); the SOT-23 would rise 79–140 °C and
fall back on its thermal regulation, slowing the charge [B10].

- RPROG = 3.3 kΩ → 303 mA nominal (333 mA at +10 %), under the cell's 500 mA
  maximum [B12].
- VDD 3.75–6 V; battery leakage 0.15 µA typ with no input [B10].
- JLCPCB C411870, 937 in stock [B26].

## U6, D9, SW1 — shared with the watch

- **MAX17048G+T10**: VDD 2.5–4.5 V on the cell, 3/4 µA hibernate, 23 µA
  active, fixed I2C 0x36, open-drain ALRT, TDFN-8 2 × 2 mm [B11]. JLCPCB
  C2682616 [B26]. Not in the agreed defaults; added for an accurate state of
  charge without a resistor divider that would load the cell (OQ-B8).
- **USBLC6-2SC6**: IEC 61000-4-2 level 4, 3.5 pF max, 150 nA max leakage,
  SOT23-6L, Active [B14]. JLCPCB C7519 [B26].
- **SKRTLAE010**: side push, 4.5 × 3.4 × 3.3 mm, 1.6 N, 0.2 mm travel,
  100,000 cycles [B15]. Pressed through the cap wall by a printed plunger
  behind a sealed membrane (OQ-B9). JLCPCB C110293 [B26].

## J1 — GCT USB4720-03-A (IP67 USB-C)

| Fact | Value | Source |
| --- | --- | --- |
| Type | USB 2.0 Type-C receptacle, 16 contacts, horizontal, SMT, mid-mount | [B13] |
| Sealing | IP67, integrated LIM gasket (USB4730 is the variant with a separate gasket) | [B13], [B13b] |
| Profile / offset | 2.13 mm profile, 1.13 mm offset height | [B13] |
| Body length | 6.50 mm | [B13] |
| Rating | 48 V DC, 5 A, 240 W; 20,000 mating cycles | [B13] |
| Status | Active | [B13] |

**Why this one.** It keeps USB 2.0 data (firmware recovery over the
ESP32-C3's USB Serial/JTAG) and is rated IP67 without a separate gasket part.
The power-only USB4715 (6 pins, IP67) [B13b] would drop USB data.
**Availability.** Not in the JLCPCB catalog [B26]; distributor stock not
checked. **Assumption:** the IP67 rating applies to the receptacle sealed to
the board as GCT specifies; how the printed housing seals around it is an
enclosure task (OQ-B4).

## BT1 — LP503450 1000 mAh

| Fact | Value | Source |
| --- | --- | --- |
| Capacity | 1000 mAh min, 1010 mAh typ | [B12] |
| Voltage | 3.7 V nominal; 2.75–4.20 V | [B12] |
| Charge | 4.2 V ± 50 mV; 500 mA max | [B12] |
| Discharge | 1000 mA; cut-off 2.75 V | [B12] |
| Internal impedance | < 200 mΩ | [B12] |
| Protection / NTC | PCM yes, NTC no | [B12] |
| Size | 5 × 34 × 50 mm | [B12] |
| Mass | about 20 g | [B12] |
| Cycle life | 500 cycles to ≥ 80 % at 0.5C/0.5C | [B12] |

The 1 A discharge rating covers the 350 mA Wi-Fi peak [B1] through the
buck-boost with margin. **Assumption:** the 50 mm length includes the PCM, as
for the watch cell; confirm on a sample. The power budget shows this cell is
larger than the baseline needs; a 500 mAh cell is OQ-B10.

## The bottle — Nalgene 32 oz Wide Mouth

| Fact | Value | Source |
| --- | --- | --- |
| Capacity | 32 oz (946 ml) | [B16] |
| Size | 8.25 in (21 cm) tall, 3.5 in (89 mm) diameter | [B16] |
| Mouth / cap | 2.5 in (63 mm) | [B16] |
| Mass | 6.25 oz (177.25 g) | [B16] |
| Material | Tritan Renew, BPA/BPS free; dishwasher safe | [B16] |
| Stock cap | fits the 32 and 48 oz wide-mouth bottles; "continuous, straight shouldered semi-buttress threads" | [B17] |

**Thread standard.** Nalgene names the closure "63 mm" [B16, B17, B18].
Nalgene's 1 L wide-mouth HDPE packaging bottle (312189-0032) is listed with a
**63-415** neck finish [B19], and Thermo's lab bottle of the same size has a
53 mm inner neck [B22]. Thermo states that Nalgene threads are continuous
straight-shouldered semi-buttress threads and that the linerless closure
seals with a ring moulded inside the cap against the bottle's inner chamfer
[B20]. The SPI table for 63 mm finishes gives T (thread OD) 2.426–2.461 in
(61.62–62.51 mm), E (root) 2.332–2.367 in (59.23–60.12 mm), S 0.031–0.061 in
(0.79–1.55 mm), I ≥ 1.972 in (50.09 mm) and 6 threads per inch (4.233 mm
pitch); it lists H only for the 400 series (0.393–0.423 in) [B21].

**Assumptions, all to be measured on the purchased bottle before the cap
thread is frozen** (OQ-B4):

- the consumer 32 oz Wide Mouth uses the same 63 mm finish as the Nalgene
  63-415 packaging bottle; Thermo's 63 mm replacement closure fits both
  narrow- and wide-mouth Nalgene bottles [B18], which supports this but does
  not prove it;
- the SPI T, E, S and pitch values apply; the semi-buttress profile and the
  415-series H (finish height) are not in the SPI table read [B21];
- the inner neck is about 53 mm, as on the lab bottle [B22].

Closing torque for Nalgene 63-415 closures is 40 in-lb (46 cm-kg) minimum and
56 in-lb (64 cm-kg) maximum [B20] (**Assumption:** read from a garbled text
extract of the brochure's torque table). The printed thread must carry this.

## O-rings

Sizes from the AS568 table [B23]:

| Use | Dash | ID | CS | OD | Why |
| --- | --- | --- | --- | --- | --- |
| Bottle lip face seal | AS568-138 | 53.64 ± 0.43 mm | 2.62 ± 0.08 mm | 58.88 mm | Its centre line (56.3 mm) sits on the lip between the ~53 mm bore [B22] and the ~59–60 mm thread root [B21] (Assumption: lip geometry) |
| Electronics lid seal | AS568-040 | 72.75 ± 0.51 mm | 1.78 ± 0.08 mm | 76.31 mm | Face seal under the top lid inside an 80 mm cap (Assumption: lid size) |
| Probe tube seal | AS568-010 | 6.07 ± 0.13 mm | 1.78 ± 0.08 mm | 9.63 mm | Rod seal on the Ø6 mm probe tube [B4] |

Material: silicone, about 70 Shore A, FDA-compliant grade for the two seals
that face the water (Assumption: no supplier chosen yet).

## Fasteners

> **Superseded (D-B09):** the lid is now a bayonet sealed by the
> AS568-040 on the base's collar; it needs no screws or inserts. The text
> below records the first revision's choice.

The lid closes with 6 × M2 screws into heat-set inserts, the same parts as the
watch: ruthex RX-M2x4 (Ø3.6 × 4.0 mm, hole Ø3.2 mm, wall ≥ 1.3 mm) [B24] and
Accu SPP-M2-6-A2 (ISO 7045, head Ø4.0 × 1.72 mm) [B25]. **Assumption:** six M2
screws compress a 1.78 mm-section face seal evenly on a 76 mm circle; the
enclosure track checks the compression and may move to M2.5.

## Part tiers

"In UHD library" means a part with that id exists today in
UHD's part library (`uhd/library/parts`, checked 2026-10-02).

| Part | Tier | Where | Part id | Note |
| --- | --- | --- | --- | --- |
| TI TPS63020DSJR | cloud catalog (in UHD library today) | `parts/catalog/` | `ti-tps63020dsjr` | Reused as is |
| Espressif ESP32-C3-MINI-1-H4X | project-researched | `parts/local/` | `espressif-esp32-c3-mini-1-h4x` | Library has the DevKitM-1 board and XIAO, not the module; reuse their module-datasheet evidence |
| ST VL53L4CDV0DH/1 | project-researched | `parts/local/` | `st-vl53l4cdv0dh-1` | Library has the Adafruit 5396 breakout; reuse its ST evidence |
| Adafruit 381 probe | project-researched | `parts/local/` | `adafruit-381-ds18b20-probe` | |
| TI LP5024RSMR | project-researched | `parts/local/` | `ti-lp5024rsm` | |
| Kingbright APTF1616LSEEZGKQBKC | project-researched | `parts/local/` | `kingbright-aptf1616lseezgkqbkc` | |
| Coilcraft XFL4020-152ME | project-researched | `parts/local/` | `coilcraft-xfl4020-152me` | |
| Microchip MCP73831T-2ACI/MC | project-researched | `parts/local/` | `microchip-mcp73831t-2aci-mc` | Same die as the watch's SOT-23 part; separate orderable |
| ADI MAX17048G+T10 | project-researched (shared) | `parts/local/` | `adi-max17048g-t10` | Researched once with the watch |
| ST USBLC6-2SC6 | project-researched (shared) | `parts/local/` | `st-usblc6-2sc6` | |
| Alps SKRTLAE010 | project-researched (shared) | `parts/local/` | `alps-skrtlae010` | |
| GCT USB4720-03-A | project-researched | `parts/local/` | `gct-usb4720-03-a` | |
| LP503450 cell | project-researched | `parts/local/` | `lipol-lp503450` | |
| Nalgene 32 oz Wide Mouth | project-researched | `parts/local/` | `nalgene-32oz-wide-mouth` | Purchased mechanical part; its 63 mm neck finish is an interface |
| AS568-138, -040, -010 O-rings | project-researched | `parts/local/` | `as568-138-silicone`, `as568-040-silicone`, `as568-010-silicone` | Named by standard size |
| ruthex RX-M2x4, ISO 7045 M2 × 6 | project-researched (shared) | `parts/local/` | `ruthex-rx-m2x4`, `iso-7045-m2x6-a2` | |
| Cap board | project-specific | `src/boards/bottle-cap/` | `bottle-cap-board` | `circuit` provider |
| Cap body (thread, lip seal groove, probe boss, ToF window seat, USB opening, button membrane) | project-specific | `src/enclosures/bottle-cap/` | `bottle-cap-body` | `cad` provider |
| Cap lid (light guide ring, lid seal groove, screw holes) | project-specific | `src/enclosures/bottle-cap/` | `bottle-cap-lid` | `cad` provider; translucent print or a separate light-guide part (OQ-B7) |
| ToF window | project-specific | `src/enclosures/bottle-cap/` | `bottle-tof-window` | Cut PMMA or glass disc; material and anti-fog are OQ-B1 |
| Cell leads | project-specific harness | `src/harnesses/` | `bottle-battery-leads` | |
| Probe cable (probe → board) | project-specific harness | `src/harnesses/` | `bottle-probe-cable` | Cut from the probe's own 91 cm cable [B4] |
| Lid fastening (bayonet, no hardware; was 6 × screw + insert) | part of the cap (D-B09) | `src/enclosures/bottle-cap/` | `bottle-cap-enclosure` (`lid_joint`) | |
| Cap on bottle | project-specific mate | `src/bottle.uhd.ts` | — | Thread engagement and lip O-ring compression |

## Mass estimate

| Item | Mass | Basis |
| --- | --- | --- |
| Cell | 20 g | [B12] |
| Board, Ø70 mm × 1.6 mm FR-4, with parts | 15 g | Assumption: 6.2 cm³ × 1.85 g/cm³ ≈ 11 g laminate plus about 4 g of parts |
| Cap body and lid, PETG | 55 g | Assumption: about 43 cm³ of printed material at 1.27 g/cm³ |
| Probe tube and cable | 5 g | Assumption |
| O-rings, screws, inserts, window | 4 g | Assumption; screws 19 g per 100 [B25] |
| **Total cap** | **≈ 99 g** | Target ≤ 120 g |
| Bottle (empty) | 177 g | [B16] |

## Sources

All read on 2026-10-02. "Copy read" is given when the official URL could not
be fetched from this environment.

| Tag | Document | URL | Copy read / note |
| --- | --- | --- | --- |
| B1 | ESP32-C3-MINI-1 & MINI-1U datasheet v2.2 | https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf | |
| B2 | ESP-IDF v5.3.5 ESP32-C3 Sleep Modes; ESP-IDF v5.3.1 GPIO & RTC GPIO | https://docs.espressif.com/projects/esp-idf/en/v5.3.5/esp32c3/api-reference/system/sleep_modes.html | https://docs.espressif.com/projects/esp-idf/en/v5.3.1/esp32c3/api-reference/peripherals/gpio.html |
| B3 | ST VL53L4CD datasheet DS13812 | https://www.st.com/resource/en/datasheet/vl53l4cd.pdf | Rev 5 (June 2022) read at https://cdn-reichelt.de/documents/datenblatt/C900/VL53L4CD.pdf; latest is Rev 8 (July 2024), cited by UHD part `adafruit-5396-vl53l4cd` |
| B3b | ST VL53L4CD product page | https://www.st.com/en/imaging-and-photonics-solutions/vl53l4cd.html | |
| B4 | Adafruit 381, waterproof DS18B20 sensor | https://www.adafruit.com/product/381 | |
| B5 | DS18B20 datasheet | https://www.analog.com/media/en/technical-documentation/data-sheets/DS18B20.pdf | older Dallas revision read at https://cdn.sparkfun.com/datasheets/Sensors/Temp/DS18B20.pdf; parts research re-checks against the current ADI revision |
| B6 | TI LP5018/LP5024 datasheet SLVSEB8C (rev. July 2024) | https://www.ti.com/lit/ds/symlink/lp5024.pdf | |
| B7 | Kingbright APTF1616LSEEZGKQBKC, spec DSAO4453 V.9B, 2025-03-19 | https://www.kingbrightusa.com/images/catalog/SPEC/APTF1616LSEEZGKQBKC.pdf | |
| B8 | TI TPS6302x datasheet SLVS916I (rev. October 2019) | https://www.ti.com/lit/ds/symlink/tps63020.pdf | also cited by UHD part `ti-tps63020dsjr` |
| B9 | TI TPS63802 datasheet | https://www.ti.com/lit/ds/symlink/tps63802.pdf | |
| B10 | Microchip MCP73831/2 datasheet DS20001984H | https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf | |
| B11 | MAX17048/MAX17049 datasheet 19-6171 Rev 7 | https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17048-MAX17049.pdf | https://cdn.sparkfun.com/assets/learn_tutorials/1/4/6/3/MAX17048-MAX17049.pdf |
| B12 | LP503450 1000 mAh product page | https://polybattery.com/product/1000mah-lipo-battery-lp503450-3-7-v-lithium-rechargeable-battery-cqc | |
| B13 | GCT USB4720 product page | https://gct.co/connector/usb4720 | |
| B13b | GCT sealed USB-C range (USB4715, USB4720, USB4730) | https://www.heilind.eu/page/manufacturers/gct-global-connector-technology/sealed-usb-c-connectivity-for-industrial-and-portable-electronics/ | distributor page |
| B14 | ST USBLC6-2 product page | https://www.st.com/en/protections-and-emi-filters/usblc6-2.html | |
| B15 | Alps Alpine SKRTLAE010 | https://tech.alpsalpine.com/e/products/detail/SKRTLAE010/ | |
| B16 | Nalgene 32oz Wide Mouth Bottle | https://nalgene.com/product/32oz-wide-mouth-bottle/ | |
| B17 | Nalgene Wide Mouth Cap | https://nalgene.com/product/wide-mouth-cap/ | |
| B18 | Thermo Scientific Nalgene replacement closures, 712150-0630 (63 mm) | https://www.thermofisher.com/order/catalog/product/712150-0630 | |
| B19 | Labelmaster: Nalgene 312189-0032 wide-mouth HDPE bottle, 63-415 closure | https://www.labelmaster.com/shop/un-packaging/bottles-and-caps/plastic-bottles/nalgene-hdpe-packaging-bottles-with-closure-1/nalgene-hdpe-natural-packaging-bottles-with-closure/32oz-1-000ml-natural-nalgene-wide-mouth-hdpe-packa-11043 | distributor page |
| B20 | Thermo Scientific Nalgene Bottles and Carboys technical brochure D01705 | https://assets.thermofisher.com/TFS-Assets/LSG/brochures/D01705.pdf | read as a search extract |
| B21 | SPI neck finish specifications for standard closures | https://www.plastcaps.com/spi-neck-finish-specifications-for-standard-closures-2-4.htm | same table: https://www.bottles.com.cn/article/spi-neck-finish-specifications-for-standard-closures.html |
| B22 | Thermo Scientific Nalgene wide-mouth HDPE bottle 312104-0032 (1 L, 63 mm, inner neck 53 mm) | https://www.thermofisher.com/order/catalog/product/312104-0032 | |
| B23 | AS568 O-ring size chart | https://oringhandbook.com/as568-o-ring-size-chart/ | cross-checked -138 at https://www.americanrubbercorp.com/products/standard-o-rings/as568-o-ring-size-chart/ |
| B24 | ruthex RX-M2x4 | https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m2-70-stuck-rx-m2x4-messing-gewindebuchsen | dimensions from https://www.3djake.com/ruthex/threaded-insert-m2-70-pieces |
| B25 | Accu SPP-M2-6-A2 | https://www.accu.co.uk/pozi-pan-head-screws/9242-SPP-M2-6-A2 | |
| B26 | JLCPCB in-stock catalog through jlcsearch (unofficial mirror) | https://jlcsearch.tscircuit.com/components/list.json?search=<part> | queried with `tools/vendors/jlc-search.mjs`; snapshot 2026-10-02 |
