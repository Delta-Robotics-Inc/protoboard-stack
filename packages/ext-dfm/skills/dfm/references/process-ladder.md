# The process ladder: cheapest accessible method first

"Make it work before you make it pretty." Prove the function on the cheapest
rung that can answer the question being asked, and climb only when a stated
requirement (quantity, strength, temperature, tolerance, finish,
certification) forces it. The rungs run from the cheapest and most
forgiving to the most committed. Each lists what it is good for, rough cost
and quantity, and what changes in the CAD when moving up from the rung below.

Costs and quantities are indicative planning numbers from the sources named,
accessed 2026-11-12; a quote for the actual part replaces them. Where sources
disagree, both values are given and the conservative one is named.

Sources (short names used below):

| Name | URL |
| --- | --- |
| Formlabs processes | https://formlabs.com/blog/guide-to-manufacturing-processes-for-plastics/ |
| Formlabs casting | https://formlabs.com/blog/vacuum-casting-urethane-casting-polyurethane-casting/ |
| Formlabs low-volume molding | https://formlabs.com/blog/low-volume-injection-molding/ |
| Formlabs printed molds | https://formlabs.com/white-papers/low-volume-rapid-injection-molding-with-3d-printed-molds/ |
| Hubs molding | https://www.hubs.com/guides/injection-molding/ |
| Hubs CNC | https://www.hubs.com/guides/cnc-machining/ |
| Hubs sheet metal | https://www.hubs.com/guides/sheet-metal-fabrication/ |
| Hubs SLA | https://www.hubs.com/knowledge-base/how-design-parts-sla-3d-printing/ |
| Xometry standards | https://www.xometry.com/manufacturing-standards/ |
| Makelab | https://www.makelab.com/design-guidelines |
| Simple Machining | https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide |
| SendCutSend geometry | https://sendcutsend.com/blog/understanding-small-geometry-in-laser-cutting/ |
| Formlabs Fuse SLS | https://formlabs.com/white-papers/fuse-series-sls-design-guide/ |
| HP MJF | https://www.hp.com/us-en/printers/3d-printers/learning-center/how-to-design-3d-print-model.html |
| UV printing | https://kingjetprinter.com/how-to-print-on-uneven-surfaces-with-uv-flatbed-printer/ |
| Vinyl | https://www.decals.com/c/how-small-can-a-vinyl-decal-be-design-limits-readability-and-cutting-tips |

## The rungs

| # | Rung | Good for | Rough cost and quantity | Design changes versus the rung below |
| --- | --- | --- | --- | --- |
| 1 | Desktop FDM printing | Form, fit and function checks, jigs, enclosures, first iterations; hours per print | Material about USD 1 to 10 per part (derived from typical filament use; an assumption); 1 to 10 parts is FDM's cost-effective range (Simple Machining) | The starting point; rules in **dfm-3d-printing**. FDM habits that do not carry upward: uneven walls, sharp inside corners, no draft, undercuts, holes printed small and drilled. |
| 2 | Desktop resin (MSLA, SLA) | Small precise parts, cosmetic models, small snap and fit checks, masters for silicone molds, molds for low-volume molding | Printer from hundreds to a few thousand USD; parts cents to dollars; 1 to tens of parts (Formlabs casting, Formlabs low-volume molding) | Drain holes in every hollow (Hubs SLA); a planned support side and tilt; thinner walls; tighter slip clearance (Makelab); brittle resin wants fillets at snap roots; washing and curing join the process. |
| 3 | Laser cutting (acrylic, plywood, MDF, thin sheet) | Flat panels, faceplates, gaskets, tab-and-slot boxes, stencils, flat brackets; minutes per part | Makerspace or desktop CO2 laser; bureau parts from a few USD; 1 to thousands (an assumption from bureau pricing pages) | Every part becomes a 2D profile of one stock thickness; joints become tab-and-slot, finger joints or fasteners; bends become kerf-pattern living hinges or separate parts; kerf is compensated. See [moving up the ladder](moving-up-the-ladder.md). |
| 4 | UV printing (graphics on parts) | Labels, logos, panel legends and color graphics on flat or gently curved parts; replaces stickers and pad printing at low volume | Bureau or makerspace job setup; 1 to hundreds (an assumption) | A flat, upward graphic zone with little height variation; head gap limits height steps; deep recesses cure poorly; primer on low-energy plastics (UV printing). Exact height and line limits are machine-specific (unverified). |
| 5 | Vinyl or craft cutting | Decals, paint masks, labels, simple gaskets and adhesive shapes | Very low; minutes | Strokes and text sized for weeding (Vinyl, a single vendor, unverified); text converted to outlines; overlapping paths welded. |
| 6 | Desktop CNC routing (wood, plastics, soft aluminum plate) | Plywood and HDPE structures, panels thicker than a laser cuts, aluminum plates | Router from hundreds to a few thousand USD; stock dominates | Inside corners carry the cutter radius; dogbone or T-bone reliefs where a square part seats in a pocket; smallest hole and slot equal the cutter (SendCutSend geometry); hold-down tabs or vacuum. |
| 7 | Sheet metal services (laser cut and press-brake bent) | Brackets, chassis, enclosures and covers in aluminum and steel | Bureaus quote from one piece; days (Hubs sheet metal) | One uniform thickness; every 3D shape is a flat pattern plus bends; bend radius, relief, flange and hole-to-bend rules (Hubs sheet metal); finishes add cost (Hubs sheet metal). |
| 8 | Urethane casting in silicone molds | 10 to a few hundred production-look parts, rigid or rubbery | About 50 casts per silicone mold; mold about USD 200 to 1,000; parts USD 10 to 100; about 10 days (Formlabs casting) | A smooth master (resin print preferred); a chosen parting line; gates and vents; walls in the casting range; undercuts allowed because the mold flexes (Formlabs casting); expect slight shrink (Xometry standards). |
| 9 | Low-volume injection molding with printed molds | Tens to hundreds of parts in real thermoplastics for function tests and pilot runs | Printed mold under about USD 100, 1 to 3 days, best under about 500 parts (Formlabs low-volume molding); mold life from about 10 shots to hundreds depending on the plastic (Formlabs low-volume molding) | The rung where molding DFM becomes mandatory: uniform walls, draft, ribs and bosses to rule, no undercuts without a plan ([checklist](moving-up-the-ladder.md)); printed mold inserts held in a metal frame (Formlabs printed molds). |
| 10 | Bureau SLS or MJF (nylon powder) | Functional nylon parts from 10 to a few thousand, no tooling, complex shapes, living hinges, snaps, print-in-place | Priced by bounding volume and nesting, cheaper as quantity rises (Simple Machining); from about 5 days (Makelab) | No supports, so overhangs and channels are free; escape holes for trapped powder (Formlabs Fuse SLS, HP MJF); uniform walls; no large flat plates (warp); grainy matte finish. |
| 11 | CNC machining services | Tight tolerances, metal strength, heat resistance, production-material prototypes, low to medium volume | Setup moderate, per-part high; about 1 to 5,000 parts (Formlabs processes) | Inside corner radii, pocket depth limits, standard drills and threads, one or two setups (Hubs CNC); see [moving up the ladder](moving-up-the-ladder.md). |
| 12 | Production injection molding (aluminum, then steel tools) | 500 to millions; lowest cost per part, best repeatability | Aluminum tool USD 2,000 to 5,000, 3 to 4 weeks (Formlabs low-volume molding) or USD 3,000 to 5,000 lasting 5,000 to 10,000 cycles (Hubs molding): plan on USD 3,000 to 5,000 (the conservative figure); steel tools USD 10,000 to 100,000 (Formlabs low-volume molding) | Full molding DFM ([checklist](moving-up-the-ladder.md)); tolerance about +/-0.25 mm by default (Hubs molding); gate and ejector marks kept off cosmetic faces (Xometry standards). |

Rungs 1 to 3 are where the stack defaults and where most first versions
belong. Rung 10 is often the cheapest way to make a few hundred plastic parts
that must be tough, before any tooling.

## Choosing a process from requirements

Ask the four questions first: what shape, how many and at what cost, how
soon, and in what material (Formlabs processes). Then:

| Requirement | Points toward | Points away from | Source |
| --- | --- | --- | --- |
| 1 to 10 parts | Desktop FDM, desktop resin, laser cutting, a bureau print | Injection molding (tooling) | Simple Machining |
| 10 to about 1,000 parts | SLS or MJF, urethane casting, printed molds (under about 500), CNC | Steel tooling | Formlabs processes; Formlabs casting; Formlabs low-volume molding |
| 500 to 10,000 parts | Aluminum-tool molding, sheet metal | Per-part printing of simple parts | Formlabs low-volume molding |
| 5,000 parts and more | Steel-tool molding, stamping, extrusion | Printing, unless the part is complex or custom | Formlabs processes; Hubs molding |
| Larger than about 300 mm (derived from common desktop beds; an assumption) | Large-format printing, sheet metal, CNC, split-and-join | Small-bed processes | Formlabs processes |
| Tolerance tighter than +/-0.1 mm | CNC (+/-0.125 mm standard, +/-0.025 mm feasible), or a print machined afterward | As-printed FDM, SLS, MJF | Hubs CNC |
| Smooth cosmetic surface | Resin printing, PolyJet, molding, casting from a resin master | As-printed FDM, SLS, MJF | Formlabs processes |
| Tough plastic, snaps, hinges | SLS or MJF nylon, molded PP or nylon, FDM PETG, ABS or ASA | Standard resin (brittle) | Formlabs processes |
| Rubber-like | TPU (FDM, SLS, MJF), casting, silicone molding | | Formlabs casting |
| Metal, simple, moderate strength | Sheet metal, CNC | Metal powder bed fusion | Hubs sheet metal; Hubs CNC |
| High temperature or chemical resistance | High-temperature polymers (FDM or CNC), metal | PLA, standard resin | Formlabs processes |
| Under 3 days | In-house FDM, resin, laser; a bureau print (1 to 5 days); printed molds (1 to 3 days) | Tooling (weeks to months) | Makelab; Formlabs low-volume molding |
| Lowest budget | Desktop FDM, laser cutting, hand finishing | Metal printing, steel tooling | Formlabs processes |

Break-even between printing and molding depends on the part. One vendor case
put the crossover for a small latch in the thousands of parts
(https://formlabs.com/blog/race-to-1000-parts-3d-printing-injection-molding/,
vendor-authored, so read it as optimistic for printing). Get two quotes
before committing to a tool.

## When to climb

Climb one rung (or jump to the rung the requirement names) when:

- the quantity passes the sweet spot of the current rung (table above);
- a load, temperature, UV or chemical requirement is outside what the
  printable materials in **dfm-3d-printing** meet;
- a fit needs a tolerance tighter than the profile's achievable accuracy,
  even after a coupon has tuned it;
- the finish is a requirement, not a wish;
- a certification (flammability, food contact, electrical safety) needs a
  documented material and process.

Before climbing, check what the next rung forces in the CAD
([moving up the ladder](moving-up-the-ladder.md)) and design the current
version so that move is short: uniform walls, generous inside radii, no
features only the current process can make unless they earn their place.
