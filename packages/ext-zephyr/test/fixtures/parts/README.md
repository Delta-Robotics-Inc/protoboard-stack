# Test copies of researched parts

The fixture board uses parts researched for the watch sample project. They
are copied here so the tests do not depend on the parts service or a parts
checkout.

| File | Part |
| --- | --- |
| `raytac-mdbt50q-1mv2.json` | Raytac MDBT50Q-1MV2 (nRF52840 module), the controller |
| `adi-max30102efd.json` | ADI MAX30102 heart-rate sensor (I2C 0x57) |
| `adi-max17048g-t10.json` | ADI MAX17048 fuel gauge (I2C 0x36) |
| `microchip-mcp73831t-2aci-ot.json` | Microchip MCP73831 charger (STAT output) |
| `ti-drv2605ldgs.json` | TI DRV2605L haptic driver (I2C 0x5A) |
| `eastrising-er-tft128-1.json` | EastRising ER-TFT1.28-1 round display (GC9A01, SPI) |
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
