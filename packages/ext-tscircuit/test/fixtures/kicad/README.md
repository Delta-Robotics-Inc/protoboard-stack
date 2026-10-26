# KiCad fixtures

Hand-written KiCad 10 files (board format 20260206, schematic 20260306) for
the KiCad handoff's unit tests (`test/kicad.test.ts`): a divider board,
`divider`, with a two-pin header `j1` (J1) and two 0402 resistors `r1` (R1)
and `r2` (R2) on nets `vin`, `mid` and `gnd`. Only what the readers use is
present: footprints with their fields and pads' nets, symbols with their
fields, and the netlist KiCad's `kicad-cli sch export netlist --format
kicadsexpr` writes for the schematic. KiCad itself is not needed to read
them.
