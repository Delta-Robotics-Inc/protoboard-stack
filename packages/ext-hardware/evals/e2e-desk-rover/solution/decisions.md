# Decisions

One entry per engineering decision: context, options, choice, evidence.

## D1. Composition (R1-R3)

The agreed catalog parts only. The shield stacks on the UNO (mount mate, 11 mm
header stack height assumed); its I2C, 5 V, IOREF and GND come from the UNO's
headers. The VL53L4CD breakout is on the UNO's I2C and 5 V with a common ground.

## D2. Requirements trace

| ID | Shown by |
| --- | --- |
| R1 | UHD links shield_mount (mate) and shield_i2c; `protoboard check` |
| R2 | UHD links shield_5v, shield_ioref, shield_gnd; check reports no UHD_UNPOWERED on them |
| R3 | UHD links tof_i2c, tof_power, tof_gnd; check |
| R4 | I2C addresses 0x60 (shield) and 0x29 (sensor) are distinct; the test plan's bus scan |
| R5 | Assembly and bring-up from USB in the release's work order and test plan |
| R6 | release/0.1.0 (manifest, documents) |

## D3. Warnings left open

- UHD_UNPOWERED on uno:usb: the bench is powered from a USB host (R5), which is not modelled.
- uno:vin, uno:dc_jack, shield:arduino_vin, shield:vmotor_in are marked `unconnected` on their instances (check reports them as info, not UHD_UNPOWERED warnings): VIN, the DC jack and the motor terminal stay unconnected until the rover's battery is chosen (R5). The test plan does not power them; the motor-output checks come after a temporary supply on the motor terminal.
- PB_ARTIFACT_UNAVAILABLE: vendor CAD not redistributed by the catalog; the documents lack those figures.
