# Airnode-C3: JLCPCB (PCB and PCBA)

Verdict: **not-ready**. 22 ok, 5 warn, 5 fail.

## Needs attention

- FAIL: 42 unconnected items on 15 nets: I2C_SDA, LED1, GND, USB_DN, +3V3, LED1_A, ...
- FAIL: Board rule check: 11 errors (clearance 1, edge_clearance 2, short 8)
- WARN: Board rule check: 16 warnings (clearance 2, dangling 8, silk_to_pad 3, unassigned_copper 2, via_under_footprint 1)
- WARN: Silkscreen: 58 strokes under 0.15 mm (narrowest 0.12 mm), 19 texts under 1 mm
- FAIL: 13 BOM lines without an LCSC part number: C1, C2, C3, C4, C5, D1, R1, R2, R3, R4, R5, R6, ...
- WARN: 18 parts with rotations not verified for JLCPCB
- FAIL: min spacing 0.10 mm (1 oz, 1-2 layers): 1 finding, worst 0.023 mm
- FAIL: routed board edge to copper 0.2 mm: 2 findings, worst 0 mm
- WARN: pad to silkscreen 0.15 mm (JLCPCB clips silkscreen that is nearer): 5 findings, worst 0 mm
- WARN: 4 plated pads under the recommended 0.25 mm ring (above the 0.18 mm minimum)

## Cost drivers

- Extended part types: 1 (J1); 13 lines with no library class in the part data. each Extended part type adds a loading fee per order at JLCPCB (see its fee schedule; not read live here); Basic parts do not.
- Through-hole parts: 1 (J1). a hand or wave soldering step on top of SMT assembly.
- Green solder mask: the fab's default color. minimum mask web 0.1 mm at this color.
- Vias in pads: 1. via-in-pad needs filled and capped vias, an extra fabrication process.
- Board size class: 40 x 30 mm, within 100 x 100 mm. fabs price by area and panel use; the quote decides.
- Copper layers: 2. a standard two-layer process.

## Files

- `fab/files/Airnode-C3-F_Cu.gtl` (gerber Copper,L1,Top), image `images/fab/files/Airnode-C3-F_Cu.gtl.svg`
- `fab/files/Airnode-C3-B_Cu.gbl` (gerber Copper,L2,Bot), image `images/fab/files/Airnode-C3-B_Cu.gbl.svg`
- `fab/files/Airnode-C3-F_Mask.gts` (gerber Soldermask,Top), image `images/fab/files/Airnode-C3-F_Mask.gts.svg`
- `fab/files/Airnode-C3-F_Paste.gtp` (gerber Paste,Top), image `images/fab/files/Airnode-C3-F_Paste.gtp.svg`
- `fab/files/Airnode-C3-F_Silkscreen.gto` (gerber Legend,Top), image `images/fab/files/Airnode-C3-F_Silkscreen.gto.svg`
- `fab/files/Airnode-C3-B_Mask.gbs` (gerber Soldermask,Bot), image `images/fab/files/Airnode-C3-B_Mask.gbs.svg`
- `fab/files/Airnode-C3-B_Paste.gbp` (gerber Paste,Bot), image `images/fab/files/Airnode-C3-B_Paste.gbp.svg`
- `fab/files/Airnode-C3-B_Silkscreen.gbo` (gerber Legend,Bot), image `images/fab/files/Airnode-C3-B_Silkscreen.gbo.svg`
- `fab/files/Airnode-C3-Edge_Cuts.gm1` (gerber Profile,NP), image `images/fab/files/Airnode-C3-Edge_Cuts.gm1.svg`
- `fab/files/Airnode-C3-PTH.drl` (drill Plated,1,2,PTH), image `images/fab/files/Airnode-C3-PTH.drl.svg`
- `assembly/Airnode-C3-bom-jlcpcb.csv` (BOM (jlcpcb format)), image `images/assembly/Airnode-C3-bom-jlcpcb.csv.svg`
- `assembly/Airnode-C3-bom.csv` (BOM (generic, designator-grouped)), image `images/assembly/Airnode-C3-bom.csv.svg`
- `data/Airnode-C3-bom.json` (BOM data (JSON))
- `assembly/Airnode-C3-cpl-jlcpcb.csv` (placement (jlcpcb format)), image `images/assembly/Airnode-C3-cpl-jlcpcb.csv.svg`
- `assembly/Airnode-C3-pnp.csv` (placement (generic)), image `images/assembly/Airnode-C3-pnp.csv.svg`
- `data/Airnode-C3-placements.json` (placement data (JSON))
- `netlist/Airnode-C3.ipc356` (IPC-D-356A netlist (bare-board test)), image `images/netlist/Airnode-C3.ipc356.svg`
- `mech/Airnode-C3-outline.dxf` (DXF outline for mechanical CAD), image `images/mech/Airnode-C3-outline.dxf.svg`

Look first: `images/top-composite`, `images/bottom-composite`, the placement overlay and `images/preflight`.
