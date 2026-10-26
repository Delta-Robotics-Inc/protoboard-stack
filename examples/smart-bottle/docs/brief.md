# Smart water bottle: brief

Reference project for the Protoboard Stack. A sensor cap for
a purchased wide-mouth bottle. Like the watch, it exercises a custom PCB
(`circuit` capability) and a custom enclosure (`cad` capability), and adds a
sealed enclosure that mates with a purchased part's thread.

Hardware defaults agreed on 2026-10-02. Parts, sources and reasons:
[component selection](component-selection.md). Rails and battery life:
[power budget](power-budget.md). Block diagram and pin map:
[system](system.md). Decisions left for later tracks:
[open questions](open-questions.md).

Every number below is either cited in those documents or marked as an
assumption or a target. A target is a requirement we set; it is not a
measured or datasheet value.

## Purpose

A cap module that replaces the stock lid of a 32 oz Nalgene wide-mouth bottle
and reports how much water is left and how warm it is, reminds the user to
drink with a light ring, and syncs readings over Wi-Fi. It shows a custom
board in a sealed, threaded, printed housing described in UHD down to the
bottle's neck finish.

## Users

- **Engineers evaluating Protoboard Stack**, who read the project, run the
  checks and open the cap in the viewer on the bottle.
- **The agents and engineers who build the later tracks** (parts research,
  board, enclosure, firmware).
- **A drinker** in the use cases below. Nobody uses this build: it is not
  physically made in v0.1.

## Functions

| ID | Function | Hardware |
| --- | --- | --- |
| F1 | Measure the water level from the cap by time of flight to the surface | VL53L4CD looking down through a window |
| F2 | Measure the temperature inside the bottle with a sealed stainless probe | DS18B20 probe through the cap floor |
| F3 | Show reminders and status on a ring of RGB LEDs | LP5024 driving 8 RGB LEDs, light guide in the cap |
| F4 | Sync readings to a server over Wi-Fi; provision over BLE | ESP32-C3-MINI-1 module |
| F5 | Charge from USB-C; update firmware over USB or Wi-Fi | MCP73831, IP67 USB-C receptacle, ESP32-C3 USB Serial/JTAG |
| F6 | Report battery state of charge | MAX17048 |
| F7 | One button: wake, show level, pairing | Side-push tact switch behind a sealed plunger |

## Targets

| Target | Value | Basis |
| --- | --- | --- |
| Bottle | Nalgene 32 oz Wide Mouth: 946 ml, Ø89 mm, 21 cm tall, 63 mm cap | Agreed default (standard wide-mouth bottle); dimensions from Nalgene |
| Battery | One LiPo cell, 1000 mAh, 5 × 34 × 50 mm | Selected cell |
| Battery life | ≥ 30 days between charges with level sampling every minute and hourly sync | Target. Estimate 90 days for that profile and 273 days for the baseline profile (see [power budget](power-budget.md)) |
| Charge time | ≤ 5 h from empty | Target. 303 mA charge current gives about 4 h (2.5 h of constant current, then the taper; docs/power-budget.md) |
| Charging | USB-C 5 V through an IP67 receptacle, no USB Power Delivery | Agreed default (LiPo with USB-C charging) |
| Level range | Full bottle to empty: up to about 210 mm from the sensor window to the bottle floor | Assumption from the 21 cm bottle height plus the cap; the sensor ranges 1–1300 mm |
| Level resolution | ± 5 mm on a calm surface | Target. To be validated (open question OQ-B1) |
| Temperature accuracy | ± 0.5 °C at the probe, −10 to +85 °C | DS18B20 specification; whether the probe sees water or headspace air is OQ-B2 |
| Cap envelope | ≤ 80 mm diameter (the bottle is 89 mm), ≤ 45 mm above the bottle's lip | Target |
| Cap weight | ≤ 120 g including the cell | Target. Estimate in [component selection](component-selection.md#mass-estimate) |
| Ingress, bottle seal | Leak-proof when closed and inverted, at Nalgene's recommended closing torque | Target; relies on an O-ring face seal on the bottle lip (see enclosure open questions) |
| Ingress, electronics | Survives hand washing and splashes with the USB-C port open; design intent equivalent to IPX7 with the lid sealed. No rating is claimed or tested | Stance |
| Cleaning | Hand wash only; not dishwasher-safe | Stance |
| Operating temperature | 0 °C to 40 °C ambient; water 0 °C to 60 °C at the probe | Target. The cell charges only from 0 °C to 45 °C; hot water above 60 °C is excluded (cell and printed cap) |

## Constraints

- **Agreed hardware.** ESP32-C3-MINI-1 module (Wi-Fi + BLE), sealed
  water-temperature probe, VL53L4CD time-of-flight level sensing, LED ring,
  LiPo with USB-C charging, custom PCB in a 3D-printed O-ring-sealed cap
  module on a purchased standard wide-mouth bottle.
- **Purchased, current parts only**, with exact part numbers and cited
  sources. Espressif marks the original ESP32-C3-MINI-1-N4/-H4 as NRND; the
  selected "X" variant is the recommended one.
- **Food contact.** The cap touches drinking water vapour and occasionally
  water. No material is claimed food-safe in v0.1; the materials question is
  recorded (OQ-B5).
- **Pre-certified radio** with its antenna kept away from the cell, the water
  and metal.
- **UHD stays tool-neutral**: the bottle's thread is described as a neck finish
  and dimensions, never as a CAD feature; see
  [tool integrations](../../../docs/specs/tool-integrations.md).
- **No real-world actions.** No orders, fab uploads or prints in v0.1.

## Out of scope

- Physical build, leak tests, drop tests, wash tests.
- Sip-by-sip intake tracking with an IMU (level differences only).
- The phone app, the server and the cloud data model beyond a demo endpoint.
- Food-contact certification, dishwasher resistance, hot drinks above 60 °C.
- Regulatory certification of the finished product (the module carries its
  own radio certification).
- Other bottle brands or neck finishes.

## Acceptance for this reference build

The build is accepted when the project holds manufacturing-ready files and
the checks pass. It is not built physically.

1. `protoboard check` passes on the bottle project with no errors.
2. Every purchased part is a UHD part in the right tier, with evidence and an
   acceptance report. The parts shared with the watch are researched once.
3. The cap board is a UHD module whose nets are links between its components;
   the `circuit` provider exports Gerber + drill, BOM and pick-and-place keyed
   by UHD instance path, board GLB/STEP and a geometry manifest, and its
   `check` reports no drift.
4. The cap is a UHD module that holds its interfaces: the bottle's 63 mm neck
   finish, the lip O-ring, the lid O-ring, the ToF window, the probe seal, the
   USB-C opening, the button plunger, the light guide and the fasteners. The
   `cad` provider exports STEP/GLB, printable STL/3MF and a geometry manifest.
5. The bottle is a purchased UHD part with its neck finish as an interface;
   the cap mates to it, and the assembly (bottle, cap, board, cell, probe)
   shows in the viewer with labels. Every harness (cell leads, probe cable)
   has routed geometry.
6. The power budget is recomputed from the UHD model's parts and matches this
   brief's estimate, or the brief is updated.
7. Stand-in data is labelled as such in every generated document.
