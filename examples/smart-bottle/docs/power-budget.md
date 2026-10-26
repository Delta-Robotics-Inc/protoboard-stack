# Smart water bottle: power budget

Source tags refer to the [component selection sources](component-selection.md#sources).
Datasheet values are typical unless marked max. Every duty-cycle and
efficiency figure is an **assumption**, the first thing to replace with
measured data once firmware runs.

## Conventions

- Battery: 1000 mAh rated [B12]. **Assumption:** 85 % (850 mAh) is usable
  above the 3.40 V cut-off, as for the watch.
- Loads on 3V3 reach the cell through the TPS63020. Battery current =
  3V3 current × 3.3 V / (VBAT × η). **Assumptions:** VBAT = 3.7 V
  (nominal [B12]); η = 90 % for active loads (tens to hundreds of mA) and
  70 % for the sleep load (tens of µA, in power-save mode [B8] §7.4.4).
  The two factors are 0.991 and 1.274.
- Loads on VBAT (LED driver, LEDs, fuel gauge, charger leakage) draw directly.

## Cut-off voltage

Firmware stops at VBAT = 3.40 V (fuel gauge [B11]). The buck-boost would keep
3V3 down to 1.8 V in [B8], but the LEDs need headroom (green and blue up to
3.1 V plus 0.25–0.35 V at the driver [B6, B7]) and the cell's protection trips
at 2.75 V [B12].

## Per-component current by mode

| Component | Rail | Off / sleep | Active | Source |
| --- | --- | --- | --- | --- |
| ESP32-C3-MINI-1 | 3V3 | 5 µA deep sleep; 130 µA light sleep | 23–28 mA CPU at 160 MHz (no radio); Wi-Fi TX 350 mA peak, RX 82 mA; BLE TX 0 dBm 170 mA | [B1] |
| VL53L4CD | 3V3 | 5 µA HW standby (XSHUT low) | 22 mA average while ranging (24 max), 40 mA peak | [B3] |
| DS18B20 | 3V3 | 750 nA (1 µA max) | 1 mA (1.5 mA max) for 750 ms at 12 bits | [B5] |
| TPS63020 | VBAT / 3V3 | 25 µA into VIN + 5 µA into VOUT | as for sleep, plus conversion loss | [B8] |
| Feedback divider | 3V3 | 3.3 V / (1.0 MΩ + 180 kΩ) = 2.8 µA | same | [B8] §8.2.3 values |
| LP5024 | VBAT | 0.2 µA (EN low) | 5 mA normal mode (datasheet condition: 10 mA per output; this board caps each output at 5.0 mA) | [B6] |
| 8 RGB LEDs | VBAT | 0 | per channel as set; **3 mA per LED, one colour, assumed for reminders** | [B6, B7] |
| MAX17048 | VBAT | 4 µA hibernate (reset comparator on) | 23 µA active | [B11] |
| MCP73831 | VBAT | 0.15 µA (2 µA max) with no input | — (charging draws from VBUS) | [B10] |

## Sleep floor

| Contributor | Rail current | Battery current |
| --- | --- | --- |
| TPS63020 VIN quiescent | — | 25.0 µA |
| 3V3 side: TPS63020 VOUT 5 µA + divider 2.8 µA + ESP32-C3 5 µA + VL53L4CD 5 µA + DS18B20 0.75 µA | 18.55 µA | 18.55 × 1.274 = 23.6 µA |
| MAX17048 | — | 4.0 µA |
| LP5024 shutdown | — | 0.2 µA |
| MCP73831 leakage | — | 0.15 µA |
| **Total** | | **53.0 µA (1.27 mAh per day)** |

The 3V3 path (the buck-boost's own quiescent current, its divider and the
converted sleep load) is 48.6 µA, 92 % of the floor; the TPS63020's own
quiescent current alone is 25 + 5 × 1.274 ≈ 31.4 µA. The TPS63802 (11 µA
quiescent [B9]) would save about 20 µA, about 38 % of the floor
(**Assumption:** its 11 µA is all drawn from VIN) (OQ-B3).

## Activities (assumptions)

| Activity | Assumption | Charge at the cell |
| --- | --- | --- |
| Sample (timer wake) | ESP32-C3 awake 0.3 s at 25 mA; ToF 3 ranges × 50 ms at 22 mA; DS18B20 750 ms conversion at 1 mA while the ESP32-C3 light-sleeps (0.13 mA). 3V3 charge 11.65 mAs | 11.54 mAs per sample |
| Wi-Fi sync | 4 s at 120 mA average on 3V3 (association with a cached IP, one TLS POST; between the 82 mA RX and 350 mA TX figures [B1]) | 475.7 mAs per sync |
| Reminder | Ring on for 3 s: 8 LEDs × 3 mA + 5 mA LP5024 on VBAT; ESP32-C3 in light sleep | 87.4 mAs per reminder |

BLE is used only for Wi-Fi provisioning after a button press and is not in the
daily budget.

## Daily charge and battery life

Baseline profile: a sample every 5 minutes (288 per day), 4 syncs, 16
reminders (hourly over 16 waking hours).

| Item | Per day | mAh per day |
| --- | --- | --- |
| Sleep floor | 24 h at 53.0 µA | 1.27 |
| Samples | 288 × 11.54 mAs | 0.92 |
| Wi-Fi syncs | 4 × 475.7 mAs | 0.53 |
| Reminders | 16 × 87.4 mAs | 0.39 |
| **Total** | | **3.11** |

**Estimate: 850 mAh / 3.11 mAh per day ≈ 273 days** before the cell's
self-discharge (not stated in [B12]).

| Profile | mAh per day | Days |
| --- | --- | --- |
| Baseline (5 min samples, 4 syncs) | 3.11 | 273 |
| Samples every minute, 4 syncs | 6.81 | 125 |
| Samples every 5 min, hourly sync | 5.75 | 148 |
| Samples every minute, hourly sync (the brief's target profile) | 9.45 | 90 |
| As above, but every sync takes 20 s (poor Wi-Fi, retries) | 22.13 | 38 |

The brief's target is ≥ 30 days in the "every minute, hourly sync" profile.
The estimate meets it with a factor of three; the poor-Wi-Fi case shows where
the margin goes. The cell is therefore larger than the baseline needs; a
smaller cell is OQ-B10.

## Peak current

| Rail | Peak | Limit | Source |
| --- | --- | --- | --- |
| 3V3 | 350 mA Wi-Fi TX + 40 mA ToF peak + 1.5 mA probe ≈ 392 mA (Wi-Fi and ToF are not run together; 350 mA in practice) | TPS63020: 2 A at 3.3 V for VIN > 2.5 V; ESP32-C3 needs a supply of ≥ 0.5 A | [B1, B3, B5, B8] |
| VBAT | 350 mA Wi-Fi TX through the buck-boost ≈ 347 mA, plus all 24 LED channels at full scale, 24 × 5.0 mA = 120 mA, plus the LP5024's 5 mA ≈ 472 mA | Cell: 1000 mA continuous | [B6, B12] |

The LED current needs no firmware limit: R_IREF = 14.7 kΩ sets the LP5024's
full scale to 5.0 mA per output ([B6] §7.3.3), so even a full-white ring
during a Wi-Fi transmission stays under half the cell's rating
(`scripts/power-budget.ts`, check `peak_vbat`). The LP5024 itself can drive
25.5 mA per output with a smaller R_IREF; this board cannot.

## Charging

- 303 mA nominal (RPROG = 3.3 kΩ, IREG = 1000 V / RPROG [B10]); 333 mA at the
  +10 % limit, under the cell's 500 mA [B12].
- **Estimate:** about 4.0 h from empty: 2.5 h of constant current, which puts
  about 75 % of the capacity in (0.75 × 1000 mAh / 303 mA), then about 1.5 h
  of constant-voltage taper to the 7.5 % termination (Assumption: typical
  LiPo CC/CV curves at 0.3 C; the maker states none). The brief's target is
  ≤ 5 h. 1000 mAh / 303 mA = 3.3 h is the time for the full capacity at the
  constant-current rate, not the charge time.
- Dissipation in U5 up to (5.0 − 3.0 V) × 0.303 A ≈ 0.61 W; with the DFN's
  76 °C/W [B10] about 46 °C of rise.
- As in the watch, a running system shares the charger output, so the
  charger may miss its 7.5 % termination (about 23 mA) while the cap is busy;
  Wi-Fi bursts during charging make this worse (OQ-B11).
- Charge only between 0 °C and 45 °C (cell, [B12]); no thermistor on the cell
  or the charger [B10, B12].
