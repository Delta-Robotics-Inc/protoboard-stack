# Desk rover sensor bench: brief

EVAL FIXTURE (a small project; the parts are real catalog parts, the project is ours).

A bench rig for developing a small rover's obstacle detection before the
chassis exists: a microcontroller board, a motor driver for the rover's two
DC motors, and a time-of-flight distance sensor, wired so firmware can be
written and tested at a desk. The motors, the motor battery and the chassis
are not part of this build.

## Agreed parts (already in `parts/catalog`, no others)

| Function | Part | Catalog id |
| --- | --- | --- |
| Controller | Arduino UNO R3 (A000066) | `arduino-uno-rev3` |
| Motor driver | Adafruit Motor Shield V2 (1438), stacked on the UNO's headers | `adafruit-1438-motor-shield-v2` |
| Distance sensor | Adafruit VL53L4CD breakout (5396) | `adafruit-5396-vl53l4cd` |

## Requirements

| ID | Requirement |
| --- | --- |
| R1 | The motor shield sits on the UNO's headers (shield stacking), and talks to the UNO over I2C. |
| R2 | The shield's logic is powered from the UNO's headers (5 V, IOREF, ground). |
| R3 | The distance sensor is on the UNO's I2C bus and powered from the UNO's 5 V pin, with a common ground. |
| R4 | Every I2C device has a distinct address on the bus. |
| R5 | The bench is powered from the UNO's USB port; the motor supply terminal on the shield stays unconnected until the rover's battery is chosen. |
| R6 | A Manufacturing Package (release 0.1.0) lets someone order the parts, assemble the bench and bring it up. |
