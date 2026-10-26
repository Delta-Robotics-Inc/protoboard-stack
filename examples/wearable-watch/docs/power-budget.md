# Wearable watch: power budget

Source tags refer to the [component selection sources](component-selection.md#sources).
Datasheet values are typical unless marked max. Every duty-cycle figure is an
**assumption** about use, chosen to be plausible for a watch, and is the first
thing to replace with measured data once firmware runs.

## Conventions

- All currents are drawn from the cell (VBAT). Both regulators are linear, so a
  load on 3V0 or 1V8 draws the same current from VBAT, plus 25 nA ground
  current per LDO [W11].
- Battery: 200 mAh rated [W12]. **Assumption:** 85 % of it (170 mAh) is usable
  between full charge and the 3.40 V cut-off, leaving margin for ageing and
  for the capacity below the cut-off.
- The sleep figure for the nRF52840 is System ON with full RAM retention and
  RTC wake-up, 3.16 µA [W2], plus the 32.768 kHz crystal oscillator, 0.23 µA
  [W2]. **Assumption:** the 3.16 µA figure (measured with the RC oscillator)
  also holds with the crystal oscillator plus its own run current.

## Cut-off voltage

Firmware shuts down at VBAT = 3.40 V, read from the fuel gauge [W9]. Reasons:
the MAX30102 LED supply needs ≥ 3.1 V [W6]; the 3.0 V LDO needs headroom
(dropout ≤ 360 mV at 200 mA [W11], about 54 mV at 30 mA by linear scaling,
**Assumption**); the cell's own protection trips at 2.75 V [W12].

## Per-component current by mode

| Component | Rail | Off / sleep | Active | Source |
| --- | --- | --- | --- | --- |
| nRF52840 module | 3V0 | 3.16 µA (+0.23 µA LFXO) | CPU 3.3 mA; TX 0 dBm 6.40 mA; RX 6.26 mA; TX +8 dBm 16.40 mA | [W2] |
| Display logic | 3V0 | 15 µA (30 µA max) sleep-in | 8.5 mA (10.5 mA max) | [W3] |
| Display backlight | VBAT | 0 (Q1 off) | 30 mA typ, 40 mA max at full; **10 mA average assumed** (PWM) | [W3] |
| BMI270 | 3V0 | 3.5 µA suspend | 10 µA accel low-power 25 Hz + 3 µA features | [W5] |
| MAX30102 VDD | 1V8 | 0.7 µA (10 µA max) shutdown | 600 µA (1200 µA max) SpO2/HR, 50 sps, PW 215 µs | [W6] |
| MAX30102 LEDs | VBAT | 0 | 2 LEDs × 6.2 mA (LEDx_PA = 0x1F) × 1.075 % duty = 0.133 mA average | [W6] Table 8; duty = 215 µs × 50 sps (**Assumption:** pulse ≈ integration time) |
| DRV2605L | VBAT | 4 µA (7 µA max) EN = 0 | 0.5 mA quiescent | [W7] |
| LRA | VBAT | 0 | 58 mA typ, 80 mA rms max | [W8] |
| MAX17048 | VBAT | 4 µA hibernate (reset comparator on) | 23 µA active | [W9] |
| MCP73831 | VBAT | 0.15 µA (2 µA max) with no input | — (charging draws from VBUS) | [W10] |
| TPS7A0230, TPS7A0218 | VBAT | 25 nA each | 0.25 % of load (1–100 mA) | [W11] |

## Use profile (assumptions)

| Activity | Assumption | Seconds per day |
| --- | --- | --- |
| BLE | Connected all day, 1 s connection interval; each event about 3 ms of radio and CPU at about 6.4 mA → 19.2 µA average | continuous |
| Screen on | 300 wrist raises or button presses × 7 s; backlight 10 mA average; CPU busy 30 % of the time while on | 2,100 |
| Heart rate | 30 s every 10 minutes; CPU busy 5 % of that time | 4,320 |
| Haptics | 20 alerts × 0.5 s | 10 |

## Sleep floor (screen off, BLE connected, HR off)

| Contributor | µA |
| --- | --- |
| nRF52840 sleep + LFXO | 3.39 |
| BLE connection (assumption above) | 19.20 |
| Display sleep-in | 15.00 |
| BMI270 low-power accel + features | 13.00 |
| DRV2605L shutdown | 4.00 |
| MAX17048 hibernate | 4.00 |
| MAX30102 shutdown | 0.70 |
| MCP73831 reverse leakage | 0.15 |
| Two LDOs | 0.05 |
| **Total** | **59.5 µA** |

The display's sleep current and the BLE link are 57 % of the floor. Gating the
display's VDD with a load switch would remove 15 µA (OQ-W6).

## Daily charge, typical day

| Item | Increment over the floor | Time | mAh per day |
| --- | --- | --- | --- |
| Floor | 59.5 µA | 24 h | 1.43 |
| Screen on | 8.485 mA display + 10 mA backlight + 0.99 mA CPU = 19.48 mA | 2,100 s | 11.36 |
| Heart rate | 0.599 mA VDD + 0.133 mA LEDs + 0.165 mA CPU = 0.898 mA | 4,320 s | 1.08 |
| Haptics | 0.5 mA + 58 mA = 58.5 mA | 10 s | 0.16 |
| **Total** | | | **14.03** |

**Estimate: 170 mAh / 14.03 mAh per day ≈ 12 days.** The brief's target is
≥ 5 days; the margin covers the unmeasured assumptions (BLE event length,
CPU time while rendering, backlight level).

Screen-on time dominates. Sensitivity, everything else unchanged:

| Screen on per day | mAh per day | Days |
| --- | --- | --- |
| 10 min | 5.91 | 28.7 |
| 35 min (profile above) | 14.03 | 12.1 |
| 60 min | 22.14 | 7.7 |
| 120 min | 41.62 | 4.1 |

Standby (floor only): 170 mAh / 1.43 mAh per day ≈ 119 days, before the
cell's self-discharge, which is not stated in [W12].

## Peak current

The cell allows 200 mA continuous [W12]; the 3.0 V LDO allows 200 mA [W11].

| Case | 3V0 | VBAT total | Notes |
| --- | --- | --- | --- |
| Worst stack-up, no limits | 10.5 mA display + 16.4 mA TX + 3.3 mA CPU + ~1 mA IMU ≈ 31 mA | 31 + 40 mA backlight + 80 mA LRA + 102 mA LED pulses (2 × 51 mA) + 1.2 mA HR VDD ≈ 254 mA | Exceeds the cell's 200 mA |
| With firmware limits | ≈ 31 mA | 31 + 39 (backlight on-current) + 80 (LRA) + 1.2 + 25 (LED pulses capped at 12.6 mA each) ≈ 177 mA | Inside both limits |

These are instantaneous currents. The backlight's PWM sets its *average*
(≤ 15 mA, the figure the battery-life tables use), but while the PWM is on
the LED draws its full current: (4.2 V − 2.9 V) / 33 Ω ≈ 39 mA at full
charge [W3]. So the peak counts the backlight at 39 mA, not 15 mA. An
earlier revision counted the 15 mA average and stated 152 mA.

Firmware limits that the firmware track must implement: backlight ≤ 15 mA
average; MAX30102 LED current ≤ 12.6 mA (LEDx_PA ≤ 0x3F [W6]); no haptic
playback during an HR measurement window.

## Charging

- Charge current 83 mA nominal (RPROG = 12 kΩ, IREG = 1000 V / RPROG [W10]);
  maximum 91.7 mA at the +10 % limit, under the cell's 100 mA [W12].
- **Estimate:** about 2.4 h of constant current from empty plus the taper;
  the brief's target is ≤ 3.5 h.
- While charging, the system load also flows through the charger's output, so
  the charger sees load plus battery current. With the watch active the
  charger may not reach its 7.5 % termination threshold [W10] (about 6 mA at
  83 mA). This is OQ-W3 (power path).
- Charge only between 0 °C and 45 °C [W12]. The MCP73831 has no thermistor
  input and the cell has no NTC [W10, W12]; the firmware reads the BMI270 or
  nRF52840 die temperature as a proxy (OQ-W3).

## Checked against the brief

`npx tsx src/power-budget.ts` recomputes the tables above and checks them
against the brief's targets. It takes the cell's capacity and ratings from
the cell's part (`parts/local/lipol-lp402030.uhd.ts`), and the peak and
charge currents from the board's cell pads (`src/boards/watch-main/lands.uhd.ts`).
It also adds up the peak stack-up above and checks that the cell pads'
`current_draw` covers it. It writes [power-budget.json](power-budget.json)
and exits 1 if any target is missed. The release's test plan cites this file at bring-up.

| Check | Result | Target |
| --- | --- | --- |
| Typical use | 12.1 days | ≥ 5 days |
| Standby | 119 days | ≥ 30 days |
| Peak current, with the firmware limits | 177 mA | ≤ 200 mA, the cell's continuous rating |
| Charge current | 91.7 mA max | ≤ 100 mA, the cell's charge rating |
| Charge time | about 2.4 h | ≤ 3.5 h |

`protoboard check` checks the same supply budget per rail from the parts' own
figures (UHD `supply_budget`).
