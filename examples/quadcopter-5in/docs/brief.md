# 5-inch 6S quadcopter: brief

Reference project for the Protoboard Stack.

## Scope

- True-X 5-inch freestyle frame, custom, 225 mm wheelbase; ≥ 5 mm prop clearance.
- 6S LiPo power (CNHL 1100 mAh 100C), DolphinRC F405 V3 + AM32 60A stack,
  MEPS NEON 2207 V2 1950KV motors, HQProp Ethix S5 props.
- ELRS receiver (RadioMaster RP1 V2), DJI O4 Air Unit digital video,
  Matek M9N-5883 GNSS + compass.
- Purchased modules and an existing flight-control stack; no PCB or flight
  algorithm development.
- Acceptance: model checks pass (`protoboard check`), the frame is fabricated
  from its CAD, the unit is assembled per the generated guide, and bench/flight
  measurements replace the stand-in data in the datasheet.

## Requirements

How each item of the brief is shown on the built quadcopter. The release's
test plan carries one functional check (FN) per row; the bench checks before
them are in the test plan's bring-up and flight-controller sections. A value
here that no source states is a target we set. Decisions and their reasons:
[decisions](decisions.md).

| ID | Requirement | How | Pass | Record |
| --- | --- | --- | --- | --- |
| R1 | True-X frame, 225 mm wheelbase | Calipers or a rule between the shaft centres of diagonally opposite motors, both diagonals | 225 mm on both diagonals, within 1 mm (target) | both diagonals |
| R2 | ≥ 5 mm prop clearance | Props fitted, motors unpowered: turn each prop by hand and measure the closest gap to the frame, the stack, the air unit, the antennas and the neighbouring prop | every gap ≥ 5 mm | the smallest gap per prop |
| R3 | Power and propulsion as specified: CNHL 1100 mAh 6S 100C, DolphinRC F405 V3 + AM32 60A, MEPS NEON 2207 V2 1950KV, HQProp Ethix S5 | Inspect each part's marking and its order line against system/bom.csv | every part number matches | pass or fail, with a photo |
| R4 | ELRS radio link (RadioMaster RP1 V2) | Transmitter bound; Betaflight Receiver tab; then switch the transmitter off | all channels follow the sticks; the failsafe flag shows within 2 s of switching off (target) | pass or fail; link quality shown |
| R5 | DJI O4 digital video with OSD | Goggles linked to the air unit, quad on the bench supply | live image and Betaflight's OSD elements in the goggles | pass or fail, with a goggles screenshot |
| R6 | GNSS position and compass heading (Matek M9N-5883) | Outdoors with open sky; Betaflight GPS and Sensors tabs; turn the quad through 360° | a 3D fix; the heading follows the nose (north within 15° of a hand compass, target) | satellites, time to fix, heading error |
| R7 | Purchased modules only; no PCB or flight-algorithm work | Inspect the build against system/bom.pdf | only bought, included and cut parts; stock Betaflight firmware | pass or fail |
| R8 | Pack current within its rating | Blackbox log (or OSD peak current) over a flight with full-throttle punch-outs; the pack's temperature by hand or IR right after landing | peak current ≤ 220 A (the pack's burst rating); punch-outs shorter than a few seconds (docs/decisions.md D-Q05) | peak current, longest full-throttle time, pack temperature |
| R9 | Acceptance: model checks pass, frame cut from its CAD, assembled per the guide, measured data replaces the stand-ins | `protoboard check`; this package's work order and test record; docs/test-data/ status `measured` | 0 errors; every check recorded; every test-data file measured | the release, the filled test record |
