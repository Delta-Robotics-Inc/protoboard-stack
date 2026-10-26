# 5-inch 6S quadcopter: power budget

What each rail and the pack carry, from the parts' stated figures. The
release's bring-up checks hold the bench measurements to these numbers
(`release.checks` in `protoboard.config.ts`). A figure no source states is
marked as an estimate.

## Rails (electronics)

| Rail | Source and rating | Load | Draw | Basis |
| --- | --- | --- | --- | --- |
| 10 V BEC | FC `bec_10v`, 10–12 V, 2.5 A | DJI O4 Air Unit | ≥ 10 W | O4 `min_supply_power` 10 W (DJI specs) |
| 5 V BEC | FC `bec_5v`, 5 V, 3 A | RadioMaster RP1 V2 | not stated | RadioMaster states no current; an ELRS nano receiver is a small fraction of the 3 A rating |
| 4.5 V rail | branch of the 5 V BEC (assumed, FC part) | Matek M9N-5883 | 50 mA (0.25 W) | Matek specs |
| VBAT | ESC `vbat_out` to the FC | FC and ESC logic | not stated | DolphinRC states no idle current |

`protoboard check` (UHD supply budget): the 10 V BEC is loaded to 40 % of
its 25 W, the 5 V BEC to 2 % of its 15 W with one load stating no draw.

## Bench supply (props off)

Stated loads: 10 W + 0.25 W = 10.25 W, 0.46 A at 22.2 V before regulator
losses. The FC, ESC and receiver idle draws are not stated, so the bring-up
check allows **at most 1 A** at 22.2 V with the air unit transmitting; a
reading above that is a fault to find before the battery goes on.

## Flight

From MEPS's thrust table for the NEON 2207 V2 1950KV at 25.2 V with the SZ4942
prop (the closest of the two test props to the fitted HQProp Ethix S5 5x4x3;
the Ethix S5 itself has no published table, so these are estimates):

| Condition | Per motor | Four motors | Basis |
| --- | --- | --- | --- |
| Hover, all-up weight 587 g | about 1.6 A (147 g thrust, between the table's 20 % and 30 % rows) | about 6.5 A, 7 A with the electronics | table interpolation; mass from the datasheet's systemMass |
| Full throttle | 41.8 A (100 % row) | 167 A | table |
| Model peak (check) | 42.97 A for 60 s | 171.9 A | MEPS spec table, the figure UHD's propulsion check sums |

The pack (CNHL 1100 mAh 6S 100C) is rated 110 A continuous and 220 A burst;
CNHL states no burst duration. Full throttle is therefore inside the burst
rating and above the continuous one: see [decisions](decisions.md) D-Q05 and
brief R8 for how this is accepted and measured.

Hover endurance at about 7 A, using 80 % of 1100 mAh: about 7.5 min
(estimate; `docs/test-data/flight-time.json` holds stand-in data until a
flight replaces it).
