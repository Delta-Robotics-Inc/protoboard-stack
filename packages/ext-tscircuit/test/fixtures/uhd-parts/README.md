# Test copies of three UHD library parts

The IMU tile fixture (`../imu-tile`) uses three ICs that used to come from the
UHD repository's `library/`. That library is moving to the Protoboard parts
service (tool-integrations.md §6), so the tests carry their own copies and no
longer read `@deltarobotics/uhd`'s `library/` path.

| File | Part | Copied from |
| --- | --- | --- |
| `definitions/rp2040.json` | Raspberry Pi RP2040 | `uhd/library/parts/rp2040.ts` (export `RP2040`) |
| `definitions/bosch-bmi270.json` | Bosch BMI270 IMU | `uhd/library/parts/bosch-bmi270.ts` (export `BOSCH_BMI270`) |
| `definitions/ti-tps63020dsjr.json` | TI TPS63020 buck-boost | `uhd/library/parts/ti-tps63020dsjr.ts` (export `TI_TPS63020DSJR`) |

Copied on 2026-10-02 from uhd `mark/stack-v0.1` at commit `8a62efd`; `bosch-bmi270.json` copied again on 2026-10-03 at version 1.2.0 (its SDO `strap` trait, uhd `ce970f9`). Each
definition was evaluated and written as JSON, the form `protoboard parts add`
vendors. `files/` holds the artifacts the definitions reference, at the same
paths they name (`library/parts/<id>/artifacts/cad/…` bodies and manifests,
`library/cad/py/catalog/<id>.py` generator sources). The RP2040's photo
(`./ProtoPart/…/MFG_RP2040.jpg`) was not in the UHD checkout and is not here.

`test/fixture.ts` copies the definitions into a scratch project's
`parts/catalog/` and the files into `parts/vendor/uhd-parts/`, pinned by
digest in `parts/origins.json` with that folder as the artifact base.

These are fixtures, not a parts source. Do not edit them to change a part:
update the part where it is curated and copy it again.
