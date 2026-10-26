# Wire harnesses

## Checklist per cable

- [ ] `kind: "harness"`, `topology`, `manufacturer` (or "(custom)"), `description` naming both ends.
- [ ] One `Connector()` per end, positions in the printed order, `gender` when known.
      Connector names are shared vocabulary: use the type the mating part's socket declares (`jst_sh_8`, `xt60`, `dji_6pin`); a soldered end is `solder_leads`.
- [ ] Conductors: an internal `self` ↔ `self` link between the ends; `childLinks` only when the cable is not 1:1. The order comes from the manual or listing (cited in a usage_note).
- [ ] `performance` trait `{ kind: "cable", length_mm, wire_gauge_awg }`, each cited or in an `assumption`.
- [ ] Current: the highest current any carried link sees (supply budgets, `UHD_PROPULSION_CURRENT` details `totalPeak`),
      compared with the conductor's rating from a cited table or the cable maker. Burst-only margins are an `assumption` with the reason.
- [ ] System links: each end linked to the part's socket, or a soldered end to a link-scoped composition of the pads (`compose`). No stored functional links for what the cable carries: they are derived.
- [ ] Derived links (`deriveLinks`) list every expected connection, all `configured`; no `harness_wiring`.
- [ ] `included_with: "<part id>"` when the cable ships with a part; otherwise sources/verification like any purchased part.
- [ ] `protoboard check`: no link errors (`connector_*`, `compose_unknown_slot`, `harness_wiring` appear as `UHD_LINK_STATE`), no `PB_UNKNOWN_HARNESS`.

## The quadcopter's cables

| Harness | Ends (system links) | Derived | Facts and sources |
| --- | --- | --- | --- |
| `dolphinrc-sh8-fc-esc-cable` | FC `esc_socket` ↔ ESC `fc_socket` (inside the stack) | `fc:esc_port ↔ esc:fc_port` | 50 mm SH1.0 8-pin, straight-through (BAT GND CUR VOID M1 M2 M3 M4); stack manual; included with the FC. |
| `dji-o4-3in1-cable` | FC `dji_socket` ↔ O4 `fc_cable_socket` | 10 V → VCC, GND ×2, UART5 ↔ MSP DisplayPort, S.Bus | Wire order VCC, GND, RX, TX, GND, S.Bus (O4 user manual); included with the O4. |
| `dolphinrc-xt60-battery-lead` | battery `xt60` ↔ ESC pads (composition `battery_pads`) | `battery_out → bat_in`, `battery_gnd → bat_neg` | 12 AWG, 120 mm, XT60 male (product page); included with the ESC. The bulk capacitor is soldered across the same pads (links without a harness: a solder joint at the pads). |
| `matek-gh6p-gnss-lead` | GNSS `gh6p_1` ↔ FC pads (composition `gnss_pads`) | UART1, I2C1, 4.5 V, GND | The M9N's included 20 cm GH6P lead, one plug cut off and soldered (the FC's GPS socket has no I2C). |

The receiver is soldered directly to FC pads with no separate lead in the
reference project; if a lead is added, model it like the GNSS lead.

## Lengths from the model

The assembly places every module (`assemble(...).placements`), so the straight
distance between two linked interfaces is known once both ends have frames;
the route adds bends and a service loop. Record the length you chose and why
(`assumption`: "routed along the left arm, +20 mm service loop"). A length the
cable listing states wins over a computed one.
