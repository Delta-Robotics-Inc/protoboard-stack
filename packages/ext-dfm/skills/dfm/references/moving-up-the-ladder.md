# Moving up the ladder

Headline rules for the processes above FDM printing that have no playbook
yet: laser cutting, CNC machining (and desktop routing), sheet metal, and the
changes an FDM-printed enclosure needs before injection molding. These are
starting points for an agent, not a playbook: when a vendor is chosen, the
vendor's own design guide wins, and the agent says so. A full playbook for
each process (a `dfm-<process>` skill and a `profiles/<process>.json`) is on
the roadmap.

All sources accessed 2026-11-12. "Unverified" marks a number seen only in a
search excerpt or a secondary page. Inch values are converted (1 in = 25.4 mm).

## FDM-printed enclosure to injection molding

Use this when a printed part is heading for molding (rung 9 or 12 of the
[process ladder](process-ladder.md)). Most of it is worth doing at rung 1 for
any part expected to climb.

| Change | Rule | Source |
| --- | --- | --- |
| Uniform walls | Keep the nominal wall inside the resin's range: ABS about 1.14 to 3.56 mm, PC about 1.02 to 3.81 mm, PP about 0.64 to 3.81 mm, nylon about 0.76 to 2.92 mm (converted from inches) | https://www.protolabs.com/resources/design-tips/injection-molding-basics/ |
| Thickness transitions | Blend a change in thickness over about three times the difference, with a chamfer or fillet | https://www.hubs.com/guides/injection-molding/ |
| Draft | Protolabs: about 1 degree per inch of depth. Hubs: at least 2 degrees on every vertical wall, 1 degree more per 25 mm beyond 50 mm of height, 1 to 2 degrees more for texture. **Conservative: the Hubs rule.** | https://www.protolabs.com/resources/design-tips/injection-molding-basics/ ; https://www.hubs.com/guides/injection-molding/ |
| Ribs | Protolabs: 40 to 60 percent of the adjoining wall. Hubs: at most half the wall, height under three times its thickness, spaced at least four thicknesses apart. **Conservative: 50 percent.** | https://www.protolabs.com/resources/design-tips/improving-part-design-with-uniform-wall-thickness/ (excerpt) ; https://www.hubs.com/guides/injection-molding/ |
| Bosses | Boss wall 40 to 60 percent of the surrounding wall (Protolabs); outside diameter about twice the screw or insert size, bore at the screw's core diameter (Hubs); tie bosses to walls with ribs | same two sources |
| Radii | Inside radius at least half the wall; outside radius equal to inside radius plus wall | https://www.hubs.com/guides/injection-molding/ |
| Undercuts | Remove them, or use shutoffs, a moved parting line, bump-offs (shallow, with a lead angle; not for fiber-filled resin), or side actions, which add roughly 15 to 30 percent to the tool | https://www.hubs.com/guides/injection-molding/ |
| Snap fits | Draft the snap walls; keep the snap thicker than half the wall | https://www.hubs.com/guides/injection-molding/ |
| Gate and ejector marks | Expect ejector witness marks on the core side and a gate vestige; keep both off cosmetic faces; gating, ejection and knit lines are the molder's choice unless specified | https://www.protolabs.com/resources/design-tips/injection-molding-basics/ ; https://www.xometry.com/manufacturing-standards/ |
| Coring | Core out thick sections; no solid blocks standing in for printed infill | https://www.protolabs.com/resources/design-tips/injection-molding-basics/ |
| Tolerances | About +/-0.25 mm by default; tighter on request | https://www.hubs.com/guides/injection-molding/ |
| Tooling cost and runs | Aluminum tools about USD 3,000 to 5,000 lasting 5,000 to 10,000 cycles; a minimum run of about 500 units recommended | https://www.hubs.com/guides/injection-molding/ |

FDM habits that must go before molding: walls that vary with the infill
pattern, sharp inside corners, zero draft, undercuts printed for free, holes
printed undersize to be drilled, and text or ribs sized for a nozzle rather
than a mold.

## Laser cutting (headline rules)

| Topic | Rule | Source |
| --- | --- | --- |
| Kerf | CO2 and fiber kerf is typically about 0.1 to 0.3 mm; compensate in the file or the CAM | https://rpmfast.com/blogs-laser-cutting-tolerances-material-limits-design/ (excerpt) ; https://jdlinnovations.au/tools/tolerance-guide (excerpt) |
| Machine tolerance | One bureau states +/-0.12 mm plus the material's kerf; a university shop gives a nominal kerf of about 0.18 mm that grows with thickness | https://help.ponoko.com/en/articles/9358110-ponoko-manufacturing-standards (excerpt) ; https://medesign.seas.upenn.edu/index.php/Guides/LaserCuttingFits (excerpt) |
| Tab-and-slot press fit | Make the tab the slot width plus twice the kerf plus twice a small overlap (smaller for acrylic than for MDF); measure the stock and cut a test piece first | https://medesign.seas.upenn.edu/index.php/Guides/LaserCuttingFits (excerpt) |
| Stock thickness | Sheet thickness follows the raw stock, not the cut tolerance; cast acrylic varies by about +/-10 percent (unverified, secondary sources). Design slots to the measured thickness, or make tabs compliant | https://www.xometry.com/resources/sheet/sheet-cutting-tips/ |
| Smallest hole and slot | Xometry and others: at least one material thickness. SendCutSend: about half the thickness for many materials. **Conservative: at least one material thickness.** | https://www.xometry.com/resources/sheet/sheet-cutting-tips/ ; https://sendcutsend.com/blog/understanding-small-geometry-in-laser-cutting/ |
| Hole to edge, hole to hole | Xometry gives hole-to-edge and hole-to-hole minimums as multiples of thickness with an absolute cap; read the page for the chosen material | https://www.xometry.com/resources/sheet/sheet-cutting-tips/ |
| Edge tolerance and taper | Cut edges hold about +/-0.25 mm on the top face; thick stock tapers, and small holes can be oversize on top; put the narrow (exit) side inside a faceplate assembly | https://www.xometry.com/manufacturing-standards/ ; https://www.ponoko.com/blog/digital-manufacturing/laser-cutting/laser-cut-metal-mistakes/ (excerpt) |

The **frame-cad** skill already designs cut plates and holds its own
manufacturing reference; use it for structures, and these rules for a quick
panel or box.

## CNC machining and routing (headline rules)

| Topic | Rule | Source |
| --- | --- | --- |
| Inside vertical corners | Radius larger than a third of the pocket depth, the same radius everywhere; undercut reliefs (dogbones) where a square corner must seat a part | https://www.hubs.com/guides/cnc-machining/ |
| Pocket depth | About four times the pocket width recommended | https://www.hubs.com/guides/cnc-machining/ |
| Walls | Metal about 0.8 mm recommended (0.5 mm feasible); plastic about 1.5 mm recommended (1.0 mm feasible) | https://www.hubs.com/guides/cnc-machining/ |
| Holes | Standard drill sizes; depth about four diameters recommended, six at most | https://www.hubs.com/guides/cnc-machining/ |
| Threads | Length about three diameters; M6 and larger preferred, M2 feasible | https://www.hubs.com/guides/cnc-machining/ |
| Small features | About 2.5 mm recommended, 0.5 mm feasible | https://www.hubs.com/guides/cnc-machining/ |
| Tolerances | About +/-0.125 mm standard, +/-0.025 mm feasible; Xometry's defaults follow ISO 2768 unless the drawing says otherwise | https://www.hubs.com/guides/cnc-machining/ ; https://www.xometry.com/manufacturing-standards/ |
| Setups | Design for one or two setups on a 3-axis mill, or split the part; more axes cost more | https://www.hubs.com/guides/cnc-machining/ |
| Desktop routing | Smallest hole and slot equal the cutter; SendCutSend's routed parts state a minimum hole of 0.125 in (3.2 mm) | https://sendcutsend.com/blog/understanding-small-geometry-in-laser-cutting/ |
| Material | Pick the cheapest material that meets the requirements | https://www.hubs.com/guides/cnc-machining/ |

## Sheet metal (headline rules)

| Topic | Rule | Source |
| --- | --- | --- |
| Thickness | One thickness per part; about 0.5 to 6 mm for bent parts | https://www.hubs.com/guides/sheet-metal-fabrication/ |
| Bends | Inside bend radius at least the thickness; bend relief at least the thickness wide; flange at least twice the thickness plus the bend radius | https://www.hubs.com/guides/sheet-metal-fabrication/ |
| Holes | Diameter at least the thickness, at least twice the thickness apart, at least the thickness from an edge, at least twice the thickness from the start of a bend | https://www.hubs.com/guides/sheet-metal-fabrication/ |
| Default tolerances | Xometry lists default tolerances for edge-to-bend, across bends and bend angle | https://www.xometry.com/manufacturing-standards/ |

## Disagreements kept visible

| Topic | Values | Conservative choice |
| --- | --- | --- |
| Molding draft | about 1 degree per inch (Protolabs) against 2 degrees minimum plus height and texture allowances (Hubs) | Hubs |
| Rib thickness | 40 to 60 percent (Protolabs) against at most 50 percent (Hubs) | 50 percent |
| Laser hole minimum | about half the thickness (SendCutSend) against one thickness (Xometry and others) | one thickness |
| Aluminum tool cost | USD 2,000 to 5,000 (Formlabs) against USD 3,000 to 5,000 (Hubs) | USD 3,000 to 5,000 for planning |
