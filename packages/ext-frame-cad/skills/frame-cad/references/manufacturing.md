# Manufacturing export: CNC-routed carbon plates

The generator produces geometry; the shop needs profiles, a material and
thickness, quantities, and tolerances. Send:

| File | Use |
| --- | --- |
| `out/body.dxf` layer `plate` | 2D toolpath source: outline + every through hole, mm, 1:1. Qty 1 per frame. |
| `out/body.dxf` layers `clamp_<interface>` | side-clamp plates, drawn beside the plate. Qty 2 each (manifest `manufacturing.quantities`). |
| `out/body.step` | 3D reference for the shop and for incoming inspection. |
| a drawing or note | material (e.g. 3K twill carbon, stated grade), thickness per layer (`manufacturing.thickness_mm`), hole tolerance, edge finish (chamfer/sand edges; carbon edges fray and cut wires), quantity, revision. |

Before sending:

1. **Thickness exists.** Carbon sheet comes in fixed thicknesses (e.g. 1.5, 2,
   3, 4, 5, 6 mm depending on the supplier). Check the stated thickness is a
   stock item from the supplier you will use and cite the listing; otherwise
   change `plate_thickness_mm` and regenerate (then re-bind and re-derive the
   fastener stacks).
2. **Minimum features.** Router bit diameter (commonly 1.5–3 mm for carbon)
   sets the smallest inside radius and slot width: slots narrower than the bit
   cannot be cut, and inside corners get the bit radius. The quad's 3 mm strap
   slots and 5 mm arm slots need a bit of 3 mm or less. Holes below ~1.5× the
   plate thickness in diameter are better drilled than routed; say so.
3. **Hole sizes.** Holes are fastener + 2 × `hole_clearance_mm` (M3 → Ø 3.2,
   M2 → Ø 2.2). A shop's routing tolerance can eat that clearance; for press
   or tight fits change `hole_clearance_mm` in the module's `cad.config.ts`,
   not in the DXF.
4. **Edge distance.** A hole closer than about one diameter to an edge in
   carbon risks breakout; check the stack and standoff holes against the
   outline (**frame-cad-verify**).
5. **What the DXF leaves out.** The raised motor pads (0.5 mm) are a modelling
   device giving each motor a distinct mating face; a flat carbon plate has
   none. Either accept the flat face (bindings stay; the pad is 0.5 mm of
   stack-up to remove from the motor screw arithmetic) or make them as shims.
   Clamp plates need a joint to the plate (tabs and slots, or brackets) that
   the generator does not draw yet: agree it with the shop and record it.

Record the order (supplier, quote, material, thickness, file digests from the
operation record) against the release (**release**), and inspect the parts
on arrival against the STEP and the hole patterns (the test plan's
`frame-inspection`).
