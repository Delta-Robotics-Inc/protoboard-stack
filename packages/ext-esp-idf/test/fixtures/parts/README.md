# Test copies of researched parts

The fixture board uses parts researched for the bottle sample project. They
are copied here so the tests do not depend on the parts service or a parts
checkout.

| File | Part |
| --- | --- |
| `espressif-esp32-c3-mini-1-h4x.json` | Espressif ESP32-C3-MINI-1-H4X module, the controller |
| `ti-lp5024rsm.json` | TI LP5024 LED driver (I2C 0x28) |
| `st-vl53l4cdv0dh-1.json` | ST VL53L4CD time-of-flight sensor (I2C 0x29) |
| `adi-max17048g-t10.json` | ADI MAX17048 fuel gauge (I2C 0x36) |
| `adafruit-381-ds18b20-probe.json` | Adafruit 381 DS18B20 probe (1-Wire) |
| `alps-skrtlae010.json` | Alps SKRTLAE010 side-push switch |
| `epson-fc-135-32k768-12p5.json` | Epson FC-135 32.768 kHz crystal |

Copied on 2026-10-02 from the parts workspace (`uhd` branch
`mark/sample-parts-wip`, commit `9a80317`, `library/parts/<id>.ts`). Each
definition was evaluated and written as JSON, the form `protoboard parts add`
vendors, with two things removed because firmware does not use them and the
files are not copied: interface `geometry` bindings and artifacts with a
`filePath` (CAD bodies, generator sources). Datasheet and product links are
kept. Pin tables, buses, addresses and every other fact are unchanged.

`test/fixture.ts` copies them into a scratch project's `parts/catalog/`,
pinned by digest in `parts/origins.json`. These are fixtures, not a parts
source: update a part where it is curated and copy it again.
