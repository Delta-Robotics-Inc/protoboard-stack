# Procedure template

```md
# <test-id>: <title>

Plan row: docs/test-plan.md#<test-id> · Result file: docs/test-data/<test-id>.json

## Preconditions
- Release / revision: <release id or git revision>; unit: <serial>
- Firmware: <version>, configuration dump <file> (sha256 <…>)
- Battery: <pack id>, resting voltage <V> (record it in conditions)
- Tests passed first: <ids>

## Equipment
| instrument | model | range / resolution | calibration date |

## Safety and abort
- Props off unless the step says otherwise; current-limited supply for first power.
- Abort if: <smoke, current above X A, temperature above Y °C, loss of link>.

## Steps
1. …
2. Record <quantity> in <raw file> (column `<id>`, unit <unit>).

## Pass criterion
<quoted from the plan; decided before the test>

## Result
Write docs/test-data/<test-id>.json (status "measured", same columns as the
stand-in), validate it with scripts/test-data.ts, and list the raw files in
provenance.rawFiles. Record failures the same way.
```

## Example: hover-current (quadcopter-5in)

- Preconditions: `motor-order-direction` passed; props fitted per the
  assembly guide; all-up weight measured on a scale (condition "All-up weight
  (weighed)").
- Equipment: FC current sensor, calibrated against a clamp meter at 3
  currents; scale 0.1 g.
- Steps: hover in still air 60 s per ballast step; Blackbox logging on;
  average current over the steady 40 s.
- Columns (must match the stand-in): `auw` g, `thrust_motor` g,
  `current_total` A, `power_total` W; summary `auw_g`, `hover_current_A`,
  `hover_power_W`, `avionics_current_A`.
