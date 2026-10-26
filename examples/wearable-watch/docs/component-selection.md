# Wearable watch: component selection

Input for the parts-research, board and enclosure tracks. Every fact
carries a source tag such as [W6]; the [sources](#sources) table at the end
gives the URL, the document revision and, where the official file could not be
fetched in this session, the copy that was read. Anything not taken from a
source is written as **Assumption:** with its reason.

Stock figures come from the JLCPCB in-stock catalog through the unofficial
`jlcsearch.tscircuit.com` mirror, read on 2026-10-02 [W21]. They are a
snapshot, not a reservation. Digi-Key and Mouser were not queried (no API
credentials in this environment), so a part missing from JLCPCB is marked
"distributor stock not checked".

## Bill of materials (purchased parts)

| Ref | Function | Manufacturer | Part number | Qty | Body | Tier | Part id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U1 | BLE SoC module (nRF52840) | Raytac | MDBT50Q-1MV2 | 1 | 10.5 × 15.5 × 2.05 mm, 61 pads | project-researched | `raytac-mdbt50q-1mv2` |
| DS1 | 1.28-inch round TFT, 240×240, GC9A01 | EastRising (BuyDisplay) | ER-TFT1.28-1 | 1 | 35.60 × 37.80 × 1.5 mm (FPC folded), 12-pin 0.7 mm FPC | project-researched | `eastrising-er-tft128-1` |
| U2 | 6-axis IMU | Bosch Sensortec | BMI270 (sales no. 0 273 017 008) | 1 | LGA-14, 2.5 × 3.0 × 0.83 mm | **in UHD library** | `bosch-bmi270` |
| U3 | Heart-rate / SpO2 optical module | Analog Devices (Maxim) | MAX30102EFD+T | 1 | OESIP-14, 5.6 × 3.3 × 1.55 mm | project-researched | `adi-max30102efd` |
| U4 | Haptic driver (LRA/ERM) | Texas Instruments | DRV2605LDGSR | 1 | VSSOP-10, 3.00 × 3.00 mm | project-researched | `ti-drv2605ldgs` |
| M1 | LRA, 8 mm coin, Z axis | Vybronics | VG0832012 | 1 | Ø8.0 × 3.25 mm, wire leads | project-researched | `vybronics-vg0832012` |
| U5 | Fuel gauge, 1 cell | Analog Devices (Maxim) | MAX17048G+T10 | 1 | TDFN-8, 2 × 2 mm | project-researched | `adi-max17048g-t10` |
| U6 | Li-ion/LiPo linear charger | Microchip | MCP73831T-2ACI/OT | 1 | SOT-23-5 | project-researched | `microchip-mcp73831t-2aci-ot` |
| U7 | 3.0 V LDO, 200 mA, 25 nA IQ | Texas Instruments | TPS7A0230PDBVR | 1 | SOT-23-5, 2.90 × 1.60 mm | project-researched | `ti-tps7a0230pdbv` |
| U8 | 1.8 V LDO for the MAX30102 | Texas Instruments | TPS7A0218PDBVR | 1 | SOT-23-5, 2.90 × 1.60 mm | project-researched | `ti-tps7a0218pdbv` |
| J1 | USB-C receptacle, USB 2.0, top mount | GCT | USB4105-GF-A | 1 | ≈ 8.94 × 7.35 × 3.31 mm (drawing), 12 pads | project-researched | `gct-usb4105-gf-a` |
| D1 | USB ESD array (VBUS + D+/D−) | STMicroelectronics | USBLC6-2SC6 | 1 | SOT-23-6 | project-researched | `st-usblc6-2sc6` |
| SW1, SW2 | Side-push tact switch | Alps Alpine | SKRTLAE010 | 2 | 4.5 × 3.4 × 3.3 mm | project-researched | `alps-skrtlae010` |
| Y1 | 32.768 kHz crystal, 12.5 pF | Epson | FC-135 32.768 kHz (Q13FC13500004) | 1 | 3.2 × 1.5 × 0.9 mm | project-researched | `epson-fc-135-32k768-12p5` |
| Q1 | Backlight low-side switch, N-MOSFET | Alpha & Omega | AO3400A | 1 | SOT-23 | project-researched | `aos-ao3400a` |
| BT1 | LiPo cell 200 mAh with protection board | LiPol Battery Co. | LP402030 | 1 | 4.0 × 20 × 30 mm, AWG30 leads | project-researched | `lipol-lp402030` |
| — | Spring bar, 22 mm, Ø1.5 mm, double flange | Esslinger | 82.2225 | 2 | 25.0 mm overall, Ø0.80 mm tips | project-researched | `esslinger-82-2225-spring-bar` |
| — | Heat-set insert M2, brass | ruthex | RX-M2x4 (order no. GE-M2x04-001) | 4 | Ø3.6 × 4.0 mm | project-researched | `ruthex-rx-m2x4` |
| — | Screw M2 × 6, pan head, A2 | Accu | SPP-M2-6-A2 (ISO 7045 / DIN 7985Z) | 4 | head Ø4.0 × 1.72 mm | project-researched | `iso-7045-m2x6-a2` |
| — | Strap, 22 mm two-piece | user-supplied | — | 1 | — | not modelled | — |
| — | Resistors and capacitors | chosen in the board track | — | ≈ 30 | 0402/0603 | project-specific (board) | — |

Passives (decoupling, I2C pull-ups, PROG and CC resistors, crystal load
capacitors) are not listed by part number here. Their values come from the
reference circuits cited below and are chosen as JLCPCB basic parts by the
board track.

## U1 — Raytac MDBT50Q-1MV2 (nRF52840 module)

**Why this one.** A small certified module with the nRF52840 in its aQFN
package, a ceramic chip antenna, the 32 MHz crystal and the REG1 DC/DC
inductor inside [W1]. It exposes USB D+/D−, VBUS, VDDH and SWD [W1], so one
module covers BLE, USB charging detection and USB firmware update.

**Alternatives considered.**

| Option | Why not |
| --- | --- |
| Raytac MDBT50Q-P1MV2 (PCB antenna) | Same pin table and L × W outline, 2.0 mm high [W1]. No reason to prefer it; kept as a drop-in fallback if the chip-antenna version is unavailable. |
| u-blox NINA-B306 | Certified nRF52840 module, but JLCPCB stock was 38 and 13 pieces at about $13–14 [W21]. |
| Ebyte E73-2G4M08S1C | In stock at JLCPCB [W21] but 18 × 13 mm [W21]: too large next to a 30 mm battery. |
| Bare nRF52840 aQFN-73 | Needs our own RF design, crystal and certification; out of scope. |

**Key facts.**

| Fact | Value | Source |
| --- | --- | --- |
| SoC | Nordic nRF52840, 1 MB flash, 256 kB RAM, 48 GPIO | [W1] |
| Size | L 15.5 × W 10.5 (−0.15/+0.2) × H 2.05 mm | [W1] §2.1 |
| Pads | 61 numbered pads (pin table §2.5) | [W1] |
| Supply | 1.7 V to 5.5 V across VDD/VDDH | [W1] |
| VDD (normal voltage mode, VDD tied to VDDH) | 1.7 to 3.6 V, typ 3.0 V | [W2] §5.3.1, VDD table |
| VDDH (high voltage mode) | 2.5 to 5.5 V | [W2] |
| VBUS (USB regulator input) | 4.35 to 5.5 V | [W2] |
| Sleep, System ON, full RAM, RTC wake | 3.16 µA typ (ION_RAMON_RTC) | [W2] §5.2.1.1 |
| Sleep, System ON, wake on GPIOTE PORT event | 2.36 µA typ | [W2] §5.2.1.1 |
| Sleep, wake on a GPIOTE IN channel | 17.37 µA typ | [W2] §5.2.1.1 |
| CPU 64 MHz from flash, DC/DC | 3.3 mA typ (ICPU0) | [W2] §5.2.1.3 |
| Radio TX 0 dBm / RX 1 Mbps, DC/DC | 6.40 mA / 6.26 mA typ | [W2] §5.2.1.5 |
| Radio TX +8 dBm, DC/DC | 16.40 mA typ | [W2] §5.2.1.5 |
| LFXO load capacitance | ≤ 12.5 pF; run current 0.23 µA typ | [W2] LFXO table |
| Inside the module | 32 MHz crystal, REG1 DC/DC inductor; 32.768 kHz crystal is external | [W1] §8 notes |
| GPIO restriction | P0.02, P0.03, P0.09, P0.10, P0.28–P0.31, P1.01–P1.07 and P1.10–P1.15 are "standard drive, low frequency I/O only" (≤ 10 kHz; SPI, I2C, UART and PWM are not low-frequency) | [W1] §2.5–2.6 |
| Antenna | No ground in any layer under the antenna; place the module at the board edge | [W1] §2.3 |
| Factory firmware | Raytac test code; default LDO mode, needs the external 32.768 kHz crystal | [W1] §8 notes |

**Availability.** Not in the JLCPCB catalog [W21]; Digi-Key carries the
module (product highlight page [W1b]). Distributor stock not checked. Plan for
consigned or global-sourced assembly.

**Assumption:** the module mass is about 1 g. Raytac's sheet gives no mass;
the value only feeds the mass estimate.

## DS1 — EastRising ER-TFT1.28-1 (1.28-inch round TFT)

**Why this one.** It is the 1.28-inch, 240×240, GC9A01, 4-wire SPI panel the
brief asks for, sold bare (no carrier PCB) with a published datasheet giving
pinout, outline and backlight figures [W3].

**Alternatives considered.**

| Option | Why not (yet) |
| --- | --- |
| Winstar WFN0128A2T0YADNN000 | Same GC9A01 panel class, 35.6 × 37.74 × 1.48 mm, 17-pin interface with separate IOVCC (1.65–3.3 V), 500 cd/m², −20 to 70 °C [W4]. A strong second source; its FPC pitch and connector type were not in the page read. Revisit if the solder-tab FPC (below) is unacceptable. |
| Waveshare / Makerfabs 1.28-inch round modules | Panel on a carrier PCB with pin headers; too thick for a watch and adds a second board. |

**Key facts.**

| Fact | Value | Source |
| --- | --- | --- |
| Format | 240 × RGB × 240, IPS, 262K colours | [W3] §2.1, §2.4 |
| Active area | Ø32.4 mm (visual Ø33.4 mm) | [W3] §2.2 |
| Outline | 35.60 (W) × 37.80 (H) × 1.5 (T) mm with FPC folded | [W3] §2.2 |
| Controller / interface | GC9A01, 4-wire serial SPI (SCL, SDA, CS, D/C, RESET) | [W3] §2.3, §4.1 |
| FPC | 12 pins, 0.7 mm pitch, "hollow out" FPC (solder tabs, not a ZIF tail) | [W3] §2.1, outline drawing |
| Pinout | 1 GND, 2 LEDK, 3 LEDA, 4 VDD, 5 GND, 6 GND, 7 D/C, 8 CS, 9 SCL, 10 SDA, 11 RESET, 12 GND | [W3] §4.1 |
| VDD | 2.5 to 3.3 V, typ 2.8 V; absolute max 4.6 V | [W3] §4.2–4.3 |
| Logic levels | VIH 0.7 VDD, VIL 0.3 VDD | [W3] §4.3 |
| Logic current | 8.5 mA typ, 10.5 mA max operating; 15 µA typ, 30 µA max in sleep-in | [W3] §4.3 |
| Backlight | 2 LED chips; Vf 2.9 / 3.0 / 3.1 V at 30 mA; 30 mA typ, 40 mA max | [W3] §4.4 |
| Brightness | 400 cd/m² typ | [W3] §2.4 |
| Operating temperature | −20 to +70 °C | [W3] §2.1 |
| Supply rule | The display's VDD must also power every device that drives its bus | [W3] §6.2 |

**Consequences.** Run VDD from the 3.0 V rail (inside 2.5–3.3 V). Drive the
backlight from VBAT through a series resistor and Q1, because 3.0 V cannot
forward-bias a 2.9–3.1 V LED with headroom. The solder-tab FPC is a hand or
hot-bar soldering step after reflow (open question OQ-W1).

**Availability.** Sold directly by BuyDisplay [W3]; not in the JLCPCB
catalog [W21].

**Assumption:** display mass about 4 g (glass panel of this outline; not in
the datasheet).

## U2 — Bosch BMI270 (already in the UHD library)

**Why this one.** Agreed default. It has wrist-specific features (wrist wear
wake-up, wrist-worn step counter) [W5] and is already a verified UHD part
(`bosch-bmi270`), so this project reuses it rather than researching it again.

| Fact | Value | Source |
| --- | --- | --- |
| VDD / VDDIO | 1.71–3.6 V / 1.2–3.6 V | [W5] Table 1 (as recorded in the library part) |
| Package | LGA-14, 2.5 × 3.0 mm, 0.83 mm high | [W5] |
| Current, accel only, low power, 25 Hz | 10 µA typ | [W5] Table 1 |
| Current, accel + gyro normal | 685 µA typ | [W5] Table 1 |
| Suspend | 3.5 µA typ | [W5] Table 1 |
| Advanced features | 3 µA typ, depends on features enabled | [W5] Table 1 |
| I2C address | 0x68 (SDO to GND), 0x69 (SDO to VDDIO) | [W5] §6.5 |
| Bus | I2C up to 1 MHz or SPI up to 10 MHz | [W5] |

**Availability.** JLCPCB C2836813, 14,657 in stock [W21].

## U3 — Analog Devices MAX30102EFD+T (heart rate / SpO2)

**Why this one.** Agreed default: an integrated red + IR LED, photodiode and
18-bit ADC module designed for wearables, I2C, with 0.7 µA shutdown [W6].

**Alternatives considered.** Other ADI optical front ends (for example the
MAX30101 and MAX86141) were not researched: the MAX30102 is the agreed
default and meets the brief.

| Fact | Value | Source |
| --- | --- | --- |
| VDD | 1.7 / 1.8 / 2.0 V; absolute max 2.2 V | [W6] Electrical Characteristics, Absolute Maximum Ratings |
| VLED+ | 3.1 / 3.3 / 5.0 V | [W6] |
| Other pins (SDA, SCL, INT) absolute max | −0.3 to +6.0 V | [W6] Absolute Maximum Ratings |
| SCL/SDA input levels | VIH ≥ 0.7 × VDD, VIL ≤ 0.3 × VDD | [W6] |
| IDD, SpO2 and HR mode, PW 215 µs, 50 sps | 600 µA typ, 1200 µA max | [W6] |
| Shutdown | 0.7 µA typ, 10 µA max | [W6] |
| LED current | programmable 0–51 mA (0x1F ≈ 6.2 mA) | [W6] Table 8 |
| I2C address | write 0xAE / read 0xAF (7-bit 0x57) | [W6] |
| INT | active-low open drain, external pull-up | [W6] Pin Description |
| Package | 14-pin OESIP, 5.6 × 3.3 × 1.55 mm, 0.8 mm pitch | [W6] Features, Ordering Information |

**Consequences.** VDD needs its own 1.8 V rail (U8); VLED+ runs from VBAT,
which stays above 3.1 V while the system is on (firmware cut-off 3.40 V, see
power budget). SDA/SCL tolerate the 3.0 V pull-ups (6 V absolute maximum,
VIH 1.26 V at 1.8 V).

**Availability.** JLCPCB C6454833, 97 in stock at about $12.52 each [W21]. The
datasheet header says "click here for production status"; the ADI product page
could not be loaded in this session (timeouts), so the lifecycle status is not
confirmed (open question OQ-W8).

## U4 — Texas Instruments DRV2605LDGSR (haptic driver)

**Why this one.** Agreed default. It drives LRAs with closed-loop
auto-resonance, has an effect library, an I2C interface and a 2.0–5.2 V
supply that runs straight from the cell [W7].

| Fact | Value | Source |
| --- | --- | --- |
| VDD | 2 to 5.2 V; below 2 V not recommended | [W7] Recommended Operating Conditions, §8.4.1.1 |
| Shutdown (EN = 0) | 4 µA typ, 7 µA max | [W7] Electrical Characteristics |
| Standby (EN = 1, STANDBY = 1) | 4.1 µA typ, 7 µA max | [W7] Electrical Characteristics |
| Quiescent, no signal | 0.5 mA typ, 0.65 mA max | [W7] Electrical Characteristics |
| Digital levels | VIH ≥ 1.3 V, VIL ≤ 0.5 V (EN, IN/TRIG, SDA, SCL) | [W7] Electrical Characteristics |
| SDA/SCL/EN absolute max | VDD + 0.3 V | [W7] Absolute Maximum Ratings |
| I2C address | 0x5A (7-bit), fixed | [W7] I2C interface section |
| Load | ≥ 8 Ω at VDD 5.2 V | [W7] Recommended Operating Conditions |
| Package | VSSOP-10, 3.00 × 3.00 mm (DSBGA-9 1.50 × 1.50 mm also exists) | [W7] |

**Consequences.** VDD = VBAT. Its SDA/SCL limit is VDD + 0.3 V, so the
3.0 V I2C bus is legal whenever VBAT ≥ 2.7 V, which always holds while the
3.0 V LDO is in regulation. EN goes to a GPIO so it can sit in shutdown.

**Availability.** JLCPCB C527464, 3,878 in stock [W21].

## M1 — Vybronics VG0832012 (LRA)

**Why this one.** An 8 mm, 3.25 mm thick Z-axis coin LRA that Vybronics
markets for wearables [W8]. Its 235 Hz resonance [W8] is inside the DRV2605L's
125–300 Hz LRA range [W7] Recommended Operating Conditions. Z-axis vibration couples into the wrist through the back
cover.

| Fact | Value | Source |
| --- | --- | --- |
| Size | Ø8.0 × 3.25 mm | [W8] |
| Rated voltage | 1.8 Vrms AC sine; operating 0.1–1.85 Vrms | [W8] |
| Resonant frequency | 235 ± 5 Hz | [W8] |
| Current | 80 mA rms max, 58 mA typ | [W8] |
| Coil resistance | 22.5 Ω ± 10 % | [W8] datasheet |
| Vibration | 1.00 Grms; rise ≤ 50 ms, fall ≤ 80 ms | [W8] |
| Termination | wire leads; no adhesive (VG0832013D has adhesive) | [W8] |
| Operating temperature | −20 to +60 °C | [W8] |

Alternative considered: VG0832029D, identical but 205 Hz [W8b]; Vybronics now
lists VG0832012 as its recommended replacement for it [W8b].

**Availability.** Vybronics showed 426 in stock [W8]; not in JLCPCB [W21].

**Assumption:** lead length is not stated in the pages read; the LRA-to-board
leads are a project harness and are cut to the routed length.

## U5 — Analog Devices MAX17048G+T10 (fuel gauge)

**Why this one.** ModelGauge needs no sense resistor, runs from the cell, and
hibernates at 3 µA [W9]; its fixed address does not collide with the other
I2C parts.

| Fact | Value | Source |
| --- | --- | --- |
| VDD | 2.5 to 4.5 V (connect to the cell) | [W9] Electrical Characteristics, Pin Description |
| Current | 3 µA hibernate (reset comparator disabled), 4 µA (enabled), 23 µA active; sleep 0.5 µA | [W9] |
| Voltage measurement | ±7.5 mV per cell | [W9] |
| I2C | 0x6C write / 0x6D read (7-bit 0x36), fixed; up to 400 kHz | [W9] I2C Bus System |
| ALRT | open-drain, active low | [W9] Pin Description |
| SDA/SCL | internal pull-downs; bus held low for more than 1.75–2.5 s puts the IC to sleep | [W9] |
| Pin absolute max (non-VDD) | −0.3 to +6 V | [W9] |
| Package | 8-pin TDFN 2 × 2 mm (also 0.9 × 1.7 mm WLP) | [W9] |

**Availability.** JLCPCB C2682616, 15,108 in stock [W21].

## U6 — Microchip MCP73831T-2ACI/OT (charger)

**Why this one.** A single-chip linear CC/CV charger in SOT-23-5 with one
programming resistor [W10]. The "-2AC" option gives 4.20 V regulation, 10 %
preconditioning and 7.5 % termination [W10].

**Alternatives considered.**

| Option | Why not |
| --- | --- |
| TI BQ25120A | Wearable charger with I2C, 300 mA, 700 nA quiescent, in a 25-ball DSBGA [W21]. **Assumption:** it also integrates regulators and a power path; its datasheet was not read in this session. A chip-scale package and new research for v0.1; recorded as the leading alternative in OQ-W3 (power path). |
| TI BQ25101 | 250 mA charger in a 6-ball DSBGA [W21]; a chip-scale package for no functional gain here. |

| Fact | Value | Source |
| --- | --- | --- |
| VDD (input) | 3.75 to 6 V; absolute max 7.0 V | [W10] §1.0 |
| Regulation | 4.20 V ± 0.75 % (4.168–4.232 V) | [W10] |
| Charge current | IREG = 1000 V / RPROG (kΩ → mA); 10 kΩ gives 90/100/110 mA | [W10] §5, Electrical Characteristics |
| Battery discharge with no input | 0.15 µA typ, 2 µA max | [W10] |
| Supply current while charging | 510 µA typ | [W10] |
| STAT | tri-state output | [W10] |
| Package | SOT-23-5 | [W10] |

**Setting.** RPROG = 12 kΩ → 83 mA nominal (91.7 mA at the +10 % limit),
below the cell's 100 mA maximum charge current [W12].

**Availability.** JLCPCB C424093, 10,971 in stock [W21].

## U7, U8 — Texas Instruments TPS7A0230PDBVR and TPS7A0218PDBVR (LDOs)

**Why these.** 25 nA quiescent current, even in dropout, and 200 mA output
[W11]. At watch sleep currents (tens of µA) the regulator's own quiescent
current matters more than its efficiency.

| Fact | Value | Source |
| --- | --- | --- |
| Input | 1.5 to 6.0 V | [W11] |
| Output current | 0 to 200 mA | [W11] |
| Ground current, no load | 25 nA typ, 46 nA max at 25 °C | [W11] Electrical Characteristics |
| Shutdown | 3 nA typ | [W11] |
| Dropout at 200 mA (−40 to 125 °C) | 360 mV max for 2.5 ≤ VOUT < 3.3 V; 450 mV max for 1.8 ≤ VOUT < 2.5 V | [W11] Electrical Characteristics |
| Current limit | 240 / 450 / 750 mA | [W11] |
| Orderables | TPS7A0230PDBVR and TPS7A0218PDBVR, both Active, SOT-23 (DBV) 5-pin | [W11] Package Option Addendum |
| "P" suffix | active output discharge | [W11] Table 9-1 |

**Availability.** TPS7A0230PDBVR: JLCPCB C3747031, 44,063 in stock. TPS7A0218PDBVR:
C3748843, 2,463 in stock [W21].

## J1, D1 — GCT USB4105-GF-A and ST USBLC6-2SC6

**USB4105-GF-A.** A USB 2.0 Type-C receptacle, horizontal, SMT [W13, W21];
the recommended layout also has four holes (2 × Ø0.65 mm, 2 × Ø0.50 mm) for
the shell [W13]. The drawing names 16 contacts (the USB 2.0
subset of A1–A12 and B1–B12) on 12 SMT pads (4 × 0.60 mm and 8 × 0.30 mm wide), which is
why JLCPCB lists it as "12P" [W13, W21]. Outline from the drawing: 8.94 mm wide,
7.35 mm deep, 3.31 mm high [W13] (**Assumption:** the 3.31 mm figure is the
body height; the drawing labels are not tagged in the text extraction).
JLCPCB C3020560, 11,505 in stock [W21]. USB 2.0 data is kept so the nRF52840
can take firmware updates over USB.

**USBLC6-2SC6.** ESD protection for VBUS and the two data lines, IEC 61000-4-2
level 4 (15 kV air, 8 kV contact), 3.5 pF max line capacitance, 150 nA max
leakage, SOT23-6L, Active [W14]. JLCPCB C7519, 36,380 in stock [W21]. The ST
datasheet PDF could not be downloaded in this session (HTTP/2 errors); facts
come from ST's product page.

## SW1, SW2 — Alps Alpine SKRTLAE010

Side-push SMD tact switch: 4.5 × 3.4 × 3.3 mm, 1.6 N, 0.2 mm travel, 100,000
cycles, 50 mA 12 V DC max, −40 to +90 °C [W15]. Placed at the board edge, it is
pressed through the case wall by a printed plunger. JLCPCB C110293, 33,262 in
stock [W21]. Alps' page read in this session did not state mass production
status clearly (open question OQ-W8).

Alternative: C&K KMR2 series (top-actuated, 4.6 × 2.8 mm) [W21]; it would need
a lever in the case to turn a side press into a top press.

## Y1 — Epson FC-135, 32.768 kHz, 12.5 pF (Q13FC13500004)

3.2 × 1.5 × 0.90 mm crystal [W16]; 32.768 kHz, 12.5 pF load, ±20 ppm, 70 kΩ
ESR (JLCPCB listing) [W21]. The nRF52840 accepts up to 12.5 pF load [W2]. An
external crystal gives the BLE sleep clock better than ±500 ppm accuracy,
which the internal RC oscillator does not [W2] §5.4.2.4. JLCPCB C32346, basic
part, 444,985 in stock [W21]. A lower-load (7–9 pF) FC-135 variant would start
faster and draw less [W2]; see OQ-W9.

## Q1 — Alpha & Omega AO3400A

30 V N-MOSFET, VGS(th) 0.65 / 1.05 / 1.45 V, RDS(on) < 48 mΩ at VGS 2.5 V,
SOT-23 [W17]. The 3.0 V GPIO fully enhances it; it switches the backlight's
cathode (LEDK) with PWM. JLCPCB C20917, basic part, 1,535,925 in stock [W21].

## BT1 — LiPol Battery LP402030 (200 mAh)

| Fact | Value | Source |
| --- | --- | --- |
| Capacity | 200 mAh min / typ | [W12] |
| Voltage | 3.7 V nominal; 2.75 to 4.20 V operating | [W12] |
| Charge | 4.2 V ± 50 mV, 100 mA max | [W12] |
| Discharge | 200 mA continuous max; cut-off 2.75 V | [W12] |
| Internal impedance | < 500 mΩ | [W12] |
| Protection | PCM: over-charge 4.275 V, over-discharge 2.75 V, over-current 1–2.5 A | [W12] |
| Thermistor | none | [W12] |
| Size | 4.0 × 20 (±0.5) × 30 mm | [W12] drawing; [W12b] size table |
| Mass | about 4.0 g | [W12] |
| Leads | AWG30 UL1007, red (+) / black (−) | [W12] |
| Temperature | charge 0–45 °C, discharge −20–60 °C | [W12] |
| Compliance | IEC 62133, RoHS (maker's statement) | [W12] |

**Assumption:** the 30 mm length includes the folded PCM (the drawing shows a
3.2 mm PCM zone). Confirm on a sample before the case is frozen.

Alternatives considered: LP502025 (5.0 × 20 × 25 mm, 200 mAh, 200 mA max
charge) [W12c] is shorter but 1 mm thicker; thickness costs more than length
in a watch.

## Mechanical purchased parts

- **Spring bars — Esslinger 82.2225.** Fits 22 mm lugs; compressed length
  21.8 mm, overall 25.0 mm, body 18.6 mm, tip Ø0.80 mm, bar Ø1.50 mm, double
  flange, stainless steel [W18]. Lug holes are blind Ø0.9–1.0 mm (enclosure
  track to confirm the printed hole size).
- **Heat-set inserts — ruthex RX-M2x4.** M2, outer Ø3.6 (D1), Ø3.1 (D2),
  recommended hole Ø3.2 (D3), length 4.0 mm, minimum wall 1.3 mm, brass
  [W19].
- **Screws — Accu SPP-M2-6-A2.** M2 × 6 mm pan head, PZ0, head Ø4.0 mm
  (+0/−0.3), head height 1.72 mm, A2 stainless, ISO 7045 / DIN 7985Z, 19 g per
  100 [W20].
- **Strap.** Any 22 mm two-piece strap for 1.5 mm spring bars. Not modelled.

## Part tiers

The three tiers follow [tool integrations §6](../../../docs/specs/tool-integrations.md#6-parts-three-tiers).
"In UHD library" means a part with that id exists today in
UHD's part library (`uhd/library/parts`, checked 2026-10-02); it is vendored
into `parts/catalog/` and becomes a cloud-catalog part when the library moves
to the parts service.

| Part | Tier | Where | Part id | Note |
| --- | --- | --- | --- | --- |
| Bosch BMI270 | cloud catalog (in UHD library today) | `parts/catalog/` | `bosch-bmi270` | Reused as is |
| Raytac MDBT50Q-1MV2 | project-researched | `parts/local/` | `raytac-mdbt50q-1mv2` | Library has `adafruit-feather-nrf52-bluefruit-le-3406` (a board, not this module) |
| EastRising ER-TFT1.28-1 | project-researched | `parts/local/` | `eastrising-er-tft128-1` | |
| ADI MAX30102EFD+T | project-researched | `parts/local/` | `adi-max30102efd` | |
| TI DRV2605LDGSR | project-researched | `parts/local/` | `ti-drv2605ldgs` | |
| Vybronics VG0832012 | project-researched | `parts/local/` | `vybronics-vg0832012` | |
| ADI MAX17048G+T10 | project-researched | `parts/local/` | `adi-max17048g-t10` | Shared with the smart bottle; publish once |
| Microchip MCP73831T-2ACI/OT | project-researched | `parts/local/` | `microchip-mcp73831t-2aci-ot` | Shared with the smart bottle |
| TI TPS7A0230PDBVR | project-researched | `parts/local/` | `ti-tps7a0230pdbv` | |
| TI TPS7A0218PDBVR | project-researched | `parts/local/` | `ti-tps7a0218pdbv` | Same family as U7; one evidence set |
| GCT USB4105-GF-A | project-researched | `parts/local/` | `gct-usb4105-gf-a` | |
| ST USBLC6-2SC6 | project-researched | `parts/local/` | `st-usblc6-2sc6` | Shared with the smart bottle |
| Alps SKRTLAE010 | project-researched | `parts/local/` | `alps-skrtlae010` | Shared with the smart bottle |
| Epson FC-135 32.768 kHz 12.5 pF | project-researched | `parts/local/` | `epson-fc-135-32k768-12p5` | |
| AOS AO3400A | project-researched | `parts/local/` | `aos-ao3400a` | |
| LiPol LP402030 | project-researched | `parts/local/` | `lipol-lp402030` | |
| Esslinger 82.2225 spring bar | project-researched | `parts/local/` | `esslinger-82-2225-spring-bar` | Hardware part, like the quad's screws |
| ruthex RX-M2x4 insert | project-researched | `parts/local/` | `ruthex-rx-m2x4` | Shared with the smart bottle |
| Accu SPP-M2-6-A2 screw | project-researched | `parts/local/` | `iso-7045-m2x6-a2` | Named by standard, like `iso-4762-m3x30-socket-head-cap-screw` |
| Main board | project-specific | `src/boards/watch-main/` | `watch-main-board` | `circuit` provider |
| Case body (bezel, lugs, button plungers) | project-specific | `src/enclosures/watch-case/` | `watch-case` | `cad` provider |
| Back cover (sensor window, screw bosses) | project-specific | `src/enclosures/watch-case/` | `watch-back-cover` | `cad` provider |
| Battery leads (cell → board) | project-specific harness | `src/harnesses/` | `watch-battery-leads` | AWG30 leads supplied on the cell |
| LRA leads (LRA → board) | project-specific harness | `src/harnesses/` | `watch-lra-leads` | |
| Display FPC solder joint | project-specific link | `src/watch.uhd.ts` | — | The FPC belongs to DS1; its 12 solder joints are links to the board |
| Back cover fastening (4 × screw + insert) | project-specific fastener harness | `src/harnesses/` | `watch-back-cover-screws` | Same pattern as the quad's fastener stacks |
| Strap bars (2 × spring bar in lugs) | project-specific mates | `src/watch.uhd.ts` | — | |

Shared parts (MAX17048, MCP73831, USBLC6-2SC6, SKRTLAE010, RX-M2x4) are
researched once and are the first candidates to publish to the cloud catalog.

## Mass estimate

| Item | Mass | Basis |
| --- | --- | --- |
| Cell | 4.0 g | [W12] |
| Display | 4 g | Assumption (see DS1) |
| Module | 1 g | Assumption (see U1) |
| LRA | 1 g | Assumption (not in [W8]) |
| Board, Ø36 mm × 0.8 mm FR-4, with components | 3 g | Assumption: 0.81 cm³ × 1.85 g/cm³ ≈ 1.5 g laminate, plus about 1.5 g of parts |
| Case and back cover, PETG | 10 g | Assumption: about 8 cm³ of printed material at 1.27 g/cm³ |
| 4 screws | 0.8 g | [W20] (19 g per 100) |
| 4 inserts, 2 spring bars | 1.2 g | Assumption |
| **Total, no strap** | **≈ 25 g** | Target ≤ 40 g |

## Sources

All read on 2026-10-02. "Copy read" is given when the official URL could not
be fetched from this environment; the copy is the same document and revision
unless noted.

| Tag | Document | URL | Copy read / note |
| --- | --- | --- | --- |
| W1 | Raytac MDBT50Q-1MV2 / MDBT50Q-P1MV2 approval sheet, Ver. K, 2022-07-01 | https://www.raytac.com/product/ins.php?index_id=24 | https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf |
| W1b | Digi-Key product highlight, MDBT50Q-1MV2 | https://www.digikey.com/en/product-highlight/r/raytac/mdbt50q-1mv2-module | search result only |
| W2 | Nordic nRF52840 Product Specification v1.11 (4413_417, 2024-10-01) | https://docs.nordicsemi.com/bundle/ps_nrf52840/page/keyfeatures_html5.html | https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/6469/NRF52840-DK.pdf |
| W3 | EastRising ER-TFT1.28-1 datasheet, rev 1.0 (2019-12-02), drawing dated 2025-02-07 | https://www.buydisplay.com/download/manual/ER-TFT1.28-1_Datasheet.pdf | read through the Protoboard fetch service |
| W4 | Winstar WFN0128A2T0YADNN000 product page | https://www.winstar.com.tw/products/tft-lcd/round-tft-lcd-display/wfn0128a2t0yadnn000.html | |
| W5 | Bosch BMI270 datasheet BST-BMI270-DS000-08, rev 1.6 | https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmi270-ds000.pdf | also cited by UHD part `bosch-bmi270` |
| W6 | MAX30102 datasheet 19-7740 Rev 1, 10/18 | https://www.analog.com/media/en/technical-documentation/data-sheets/MAX30102.pdf | https://download.mikroe.com/documents/datasheets/MAX30102_datasheet.pdf |
| W7 | TI DRV2605L datasheet SLOS854D (rev. March 2018) | https://www.ti.com/lit/ds/symlink/drv2605l.pdf | |
| W8 | Vybronics VG0832012 product page and datasheet | https://www.vybronics.com/coin-vibration-motors/lra/v-g0832012 | datasheet: https://vybronics.hk/wp-content/uploads/datasheet-files/Vybronics-VG0832012-datasheet.pdf (read as a search extract) |
| W8b | Vybronics VG0832029D product page | https://www.vybronics.com/coin-vibration-motors/lra/v-g0832029d | |
| W9 | MAX17048/MAX17049 datasheet 19-6171 Rev 7, 11/16 | https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17048-MAX17049.pdf | https://cdn.sparkfun.com/assets/learn_tutorials/1/4/6/3/MAX17048-MAX17049.pdf |
| W10 | Microchip MCP73831/2 datasheet DS20001984H | https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP73831-Family-Data-Sheet-DS20001984H.pdf | |
| W11 | TI TPS7A02 datasheet SBVS277C (rev. September 2022) | https://www.ti.com/lit/ds/symlink/tps7a02.pdf | |
| W12 | LiPol Battery LP402030 datasheet (drawing 2021-06-28) | https://www.li-polymer-battery.com/wp-content/uploads/2021/06/LP402030-Datasheet.pdf | |
| W12b | LiPol Battery size table (LP402030 = 4.0 × 20 × 30 mm) | https://li-polymer-battery.com/li-polymer-battery-lp502025-3-7v-200mah/ | |
| W12c | LiPol Battery LP502025 datasheet | https://www.lipolbattery.com/LiPo-Battery-Datahseet/LiPo_Battery_LP502025_3.7V_200mAh.pdf | search extract |
| W13 | GCT USB4105 drawing | https://gct.co/files/drawings/usb4105.pdf | |
| W14 | ST USBLC6-2 product page | https://www.st.com/en/protections-and-emi-filters/usblc6-2.html | datasheet https://www.st.com/resource/en/datasheet/usblc6-2.pdf not downloadable here |
| W15 | Alps Alpine SKRTLAE010 product page | https://tech.alpsalpine.com/e/products/detail/SKRTLAE010/ | |
| W16 | Epson FC-135 product page | https://www.epsondevice.com/crystal/en/products/crystal-unit/fc135.html | |
| W17 | AOS AO3400A datasheet Rev 3.1, July 2023 | https://www.aosmd.com/res/datasheets/AO3400A.pdf | |
| W18 | Esslinger 1.5 mm double-flange spring bars (82.2225) | https://www.esslinger.com/stainless-steel-1-5mm-double-flange-watch-band-spring-bar-assortment-900-pc/ | |
| W19 | ruthex RX-M2x4 | https://www.ruthex.de/en/products/ruthex-gewindeeinsatz-m2-70-stuck-rx-m2x4-messing-gewindebuchsen | dimensions from https://www.3djake.com/ruthex/threaded-insert-m2-70-pieces |
| W20 | Accu SPP-M2-6-A2 | https://www.accu.co.uk/pozi-pan-head-screws/9242-SPP-M2-6-A2 | |
| W21 | JLCPCB in-stock catalog through jlcsearch (unofficial mirror) | https://jlcsearch.tscircuit.com/components/list.json?search=<part> | queried with a jlcsearch client script; snapshot 2026-10-02 |
