# 5-inch 6S quadcopter: decisions

Design decisions taken while finishing the quadcopter on Stack v0.1,
with the requirement or finding behind each. Earlier design choices are in
[harnesses and CAD](harnesses-and-cad.md), the fastener stacks
(`src/harnesses/harnesses.uhd.ts`) and the parts' own notes. Decisions here
are D-Q*.

## Requirements trace

| Brief item | Shown by |
| --- | --- |
| R1 True-X, 225 mm wheelbase | `quadcopter-5in-frame` (mechanical `wheelbase_mm`, layout), its cut order and first-article hole-pattern checks; FN-1 |
| R2 ≥ 5 mm prop clearance | the frame's arm length and motor pads (datasheet mechanical section); FN-2 on the built quad |
| R3 power and propulsion parts | the BOM and ordering list (catalog parts pinned in `parts/origins.json`); FN-3 |
| R4 ELRS link | `rx_pads` / `rx_fc_pads` (CRSF on UART2), `serialrx_provider = CRSF` in the configuration; bench checks failsafe and receiver; FN-4 |
| R5 O4 video and OSD | `dji_fc` / `dji_o4` (10 V BEC, UART5 MSP DisplayPort, S.Bus); `osd_displayport_device = MSP`; FN-5 |
| R6 GNSS and compass | `gnss_socket` / `gnss_pads` (UART1, I2C1 at 0x2C); bus scan BU-12, `align_mag` with the arrow forward; FN-6 |
| R7 purchased modules only | the BOM: no custom board; stock Betaflight with a generated CLI file |
| R8 pack current | `UHD_PROPULSION_CURRENT` (D-Q05), `docs/power-budget.md`; FN-8 |
| R9 acceptance | `protoboard check` (0 errors), the release, the test record |

## Decisions

| ID | Decision | Why |
| --- | --- | --- |
| D-Q01 | The mounting hardware (nine ISO screws, nuts, spacers and standoffs, and the included motor screws) moved from `src/harnesses/hardware.uhd.ts` to `parts/local/<id>.uhd.ts`, one project-researched part each, with sources (`parts/evidence/<id>/sources.json`, fetched 2026-10-03) and a recorded verification. | They are bought, not designed, so they belong in the project-researched tier, not with the project's own modules. None is in the cloud catalog (searched 2026-10-03 for screw, nyloc, spacer, standoff, nut, grommet); each can be published with `protoboard parts publish` once someone with the publish token agrees. The verifications were self-audits at first; an independent stage-2 audit (uhd-part-verify, by an agent that did not author them) re-fetched every source and measured every body, and is recorded as independent in each `verification.json`. It found one wrong fact: the M2 nylon spacers' bore was the generator's nominal Ø2.4, where Ettinger's datasheet states Ø2.7; the parts now state `bore_mm` 2.7 and the bodies were regenerated (ext-frame-cad takes a stated bore). |
| D-Q02 | **ESC motor pads, resolved:** seen from above with the battery pads at the rear, M1 is rear-right, M2 front-right, M3 rear-left, M4 front-left, Betaflight Quad-X. No motor remap. | DolphinRC's manual shows the ESC twice. The wiring drawing (p.4) shows the side with the SH 8-pin socket: its silkscreen reads correctly once the drawing is turned 180°, so it is not mirrored, and it puts M1 rear-right. The photo (p.3, also the product page's photo) shows the other side: it has no socket housing at the connector edge, only eight bare pads, and its battery polarity marks are mirrored against the drawing in the same way as its motor labels. Seen from below, M1 at the photo's lower left is the quad's rear-right. The socket faces the FC, so the drawing's side is the top. The bench check "Motor order and spin" (system test plan) confirms it on the hardware. |
| D-Q03 | Motor lead gauge stays **20 AWG**, to be measured at the build (bring-up check "Motor lead gauge"). | MEPS's V2 page and spec table state no gauge. MEPS's own 4-motor listing says "Lead:20#150mm" (its other figures, 70 mΩ and 1087 W, are not the V2 table's 69 mΩ and 1036 W, so it may describe the V1); a reseller says 24#. Measured on MEPS's package photo against the 28.3 mm bell, the insulation is about 1.5 mm across, which does not settle it. At 24 AWG the drawn bundle is thinner and the lead's current rating lower: record it as a deviation and re-route if found. |
| D-Q04 | The propeller is held by a fastener stack: the motor's own M5 flanged lock nut (`meps-m5-flanged-lock-nut`, included with the motor) on the shaft over the 6 mm hub, at 1.0 N·m (assumed). | The prop joint had no carrier. UHD now takes a shaft whose `shaft` trait states a thread as the screw of a nut on it (`assemble`), so the nut is checked on thread like any other. No motor or prop maker states a torque; 1.0 N·m is about a third of the M5 class 4.6 steel reference (2.7 N·m, NPF), so the polycarbonate hub is clamped, not crushed. |
| D-Q05 | `UHD_PROPULSION_CURRENT` is **accepted**, not fixed: four motors can draw 171.9 A together (MEPS's 60 s peak, 42.97 A each), above the pack's 110 A continuous and within its 220 A burst rating. | Not a modelling gap: MEPS's thrust table with the SZ4942 prop (the closest to the Ethix S5) gives 41.8 A per motor at full throttle, 167 A together. It is the normal 5-inch 6S trade-off: full throttle is used in punch-outs of a few seconds; hover is about 7 A (`docs/power-budget.md`). CNHL states no burst duration, so brief R8 measures it: peak current and the longest full-throttle time in a blackbox log, and the pack's temperature after landing. |
| D-Q06 | The top plate's strap slots are 22 × 3 mm, long in X, at y = ±23 either side of the pack's centre (x = 7.5). | The HGLRC strap goes round the pack's 39.5 × 35 mm cross-section, so its 20 mm width lies along X. The old slots (long in Y, at x = −14 and 28) lay under the pack, so the strap could only have passed between the pack and the plate. The new slots leave 1.75 mm to the pack's sides and 3.5 mm of plate to the outline. |
| D-Q07 | The O4 camera is held by bought M2 × 5 screws (`iso-4762-m2x5`, Westfield WF2328), not the screws DJI includes. | DJI's manual (p.6): "The screws included with the camera can only be used for frames thicker than 2 mm." The side plates are 2 mm; M2 × 5 gives 3.0 mm into the camera, within DJI's 3.10 mm maximum. |
| D-Q08 | Build order: the FC/ESC cable is connected and bench-tested in the stack unit and stays plugged when the stack is mounted; the air unit goes in before the capacitor (which lies on it); the receiver is soldered, sleeved and taped under the top plate before the plate goes on; the GNSS mounts on the fitted plate. | Read as a builder, the earlier order soldered the capacitor before the air unit it lies on and never said how the receiver was held. |
| D-Q09 | Assembly materials are BOM lines specified by kind and size, with no product chosen: solder, flux, threadlocker, the receiver's heat-shrink sleeve, foam tape and cable ties (`src/materials.uhd.ts`). | The work order names them; the kit and the ordering list now carry them. The same pattern as the watch's adhesives. |
| D-Q10 | The stack's rubber grommets (`dolphinrc-m3-grommet-esc`, `-fc`, included with the stack, four used of five each) are parts of the stack's fastener stack. | The stack-up already assumed a 4 mm grommet clamp; the grommets were not in the BOM or the kit. |
| D-Q11 | The bulk capacitor is bought as the Panasonic EEU-FR1V471 the model describes; the unbranded one in the stack's box is a spare. | The model's ratings (ripple, impedance, size) are Panasonic's; the bundled part states none. |
| D-Q12 | Every CAD body is made through the `cad` capability: the plates and the hardware by `@protoboardai/ext-frame-cad`, the cables by `@protoboardai/ext-harness-cad`, the capacitor by `@protoboardai/ext-parts` running its own script (`parts/local/panasonic-eeu-fr1v471/part-cad/`). | Each body is then recorded, checked for staleness and traced by the release, like every other output. |
| D-Q13 | **Matek M9N-5883 vendor CAD: resolved.** Re-pinned to catalog revision 3 (`protoboard parts update matek-m9n-5883 --to 3`), which carries Matek's STEP, the GLB body and interface GLBs converted from it; the three `PB_ARTIFACT_UNAVAILABLE` warnings are gone. The cables were re-routed with the body as an obstacle (only the GNSS lead changed: 96.4 mm shortest clear route of its 97 mm, no bow), and the documents and release regenerated with the GNSS drawn. | Matek states no licence for the download, so the catalog marks the vendor files distribution "unknown": they are kept in the team (this private repository and its releases), not redistributed. Revision 3 also re-pins the part's definition and evidence; the other catalog parts stay at revision 2 (their newer revisions are not part of this change). |

## Warnings dispositioned

`protoboard check`: **0 errors, 1 warning.**

| Warning | Disposition |
| --- | --- |
| `UHD_PROPULSION_CURRENT` | Accepted (D-Q05); measured by brief R8. |
