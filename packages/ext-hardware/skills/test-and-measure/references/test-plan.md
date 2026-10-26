# Test plan template, with the quadcopter's first rows

```md
# Test plan — <project> (<revision>)

Scope: what this plan accepts and what it does not (e.g. "bench and hover;
no endurance or crash testing in this revision").

| id | requirement | model claim (value queries) | level | pass criterion | depends on | status |
| --- | --- | --- | --- | --- | --- | --- |
```

## Quadcopter-5in: first rows (derived from `docs/brief.md` and the model)

Requirements quoted from the brief: "True-X 5-inch … ≥ 5 mm prop clearance",
"6S LiPo power (CNHL 1100 mAh 100C)", "Acceptance: … the unit is assembled per
the generated guide, and bench/flight measurements replace the stand-in data
in the datasheet."

| id | requirement | model claim | level | pass criterion | depends on |
| --- | --- | --- | --- | --- | --- |
| `frame-inspection` | frame fabricated from its CAD | frame CAD: plate DXF, `frames.json`, feature manifest; hole Ø = fastener + 0.2 mm | inspection | every hole pattern within ±0.1 mm of the DXF (caliper/pin gauge); plate thickness as `plate_thickness_mm` | — |
| `prop-clearance` | ≥ 5 mm prop clearance | wheelbase and prop diameter (frame metadata, prop part) | inspection | measured tip-to-tip gap ≥ 5 mm on all adjacent pairs | `frame-inspection` |
| `fastener-torque` | assembled per the guide | every `fastenerStack` torque (all assumptions today) | inspection | torque driver at the model value; no stripped thread, no crushed grommet; record any change as a new assumption | `frame-inspection` |
| `power-up` | 6S power | supply budgets per rail (`UHD_SUPPLY_BUDGET` details) | bench | current-limited supply, no props: idle current within the budget; BEC rails 5 V / 10 V / 4.5 V within the parts' stated tolerance | `fastener-torque` |
| `peripherals` | ELRS, O4, GNSS/compass | link `rx_crsf`; cables `dji_fc`/`dji_o4` (derived UART5 ↔ MSP) and `gnss_socket`/`gnss_pads` (derived UART1, I2C1); firmware CLI | bench | receiver link, OSD visible in goggles, GPS fix, compass detected (**firmware-verify**) | `power-up` |
| `motor-order-direction` | Quad-X, correct spin | Betaflight Quad-X order; motor/prop spin | bench | Motors tab: M1…M4 at rear-right, front-right, rear-left, front-left; directions match the props | `peripherals` |
| `throttle-sweep` | replaces the datasheet stand-in | stand-in `throttle-sweep` (same columns) | propulsion | curve recorded on a thrust stand; within ±15 % of the maker's points or a design issue is opened | `motor-order-direction` |
| `hover-current` | replaces the stand-in | stand-in `hover-current`; all-up weight | flight | measured hover current and AUW recorded; weigh before flight | `throttle-sweep` |
| `propulsion-peak-current` | retire `UHD_PROPULSION_CURRENT` | `details.totalPeak` 171.88 A vs pack 110 A continuous / 220 A burst | flight | Blackbox current log of full-throttle punches; decision recorded (accept bursts / limit current) | `hover-current` |

Stand-in files the documents currently use (the project's
`docs/test-data/`, written by `protoboard run tech-docs`): `throttle-sweep`,
`hover-current`, `flight-time`, `thrust-to-weight`, `esc-temp-punchout`,
`battery-discharge`. Each needs a row whose id matches.
