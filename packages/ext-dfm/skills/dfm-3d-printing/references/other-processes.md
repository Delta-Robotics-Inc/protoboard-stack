# Other printing processes

FDM is the house default and the rest of this playbook is FDM. This file is
the reference for the other additive processes, so the agent does not apply
FDM rules where they do not hold: a wall safe in SLA can fuse shut in SLS; a
support rule from FDM is meaningless in a powder bed; a metal part needs
machining stock. Pick the process first, then use that process's table.

Values are conservative defaults for when the vendor is unknown. When a
specific vendor or machine is chosen, use its published rules and cite them.
Bureau tolerances are "typical for well-designed parts", apply before
post-processing and are usually not guaranteed on a first order (Xometry,
S21). For parts over about 100 mm, add at least 0.5 mm to any minimum wall
here (JLC3DP scales SLA walls from 0.5 mm at 5 mm to 2.0 mm at 200 mm, S29).

Source keys are listed at the end of this file. Tags as in
[FDM rules](fdm-rules.md); a value marked UNVERIFIED was seen only in a search
excerpt or secondary page. Choosing a process up or down the cost ladder is
the **dfm** skill's job ([process ladder](../../dfm/references/process-ladder.md)).

## 1. How each process differs from FDM

| Process | Key differences from FDM |
| --- | --- |
| SLA, DLP, MSLA resin | Supports almost always; brittle thermosets; finest detail and smoothest finish; **drain holes** in every hollow; suction "cupping" on hollows open to the plate; parts drift in size for days after cure |
| SLS | **No supports** (powder supports the part), so overhang rules vanish; **escape holes** for trapped powder; gaps under about 0.8 mm sinter shut; flats and parts over about 178 mm warp |
| MJF | Like SLS, slightly finer; trapped powder can be left in by agreement; close to isotropic in Z |
| Metal powder bed fusion | Supports always, for heat as well as gravity, and they must be reachable by saw or EDM; residual stress; **machining stock** on every datum and sealing face; stress relief before anything else |
| Binder jetting (metal) | No supports in print, but parts sag and shrink up to about 20 percent in the furnace: design self-supporting for sintering |
| Material jetting (PolyJet) | Whole part encased in gel support; multi-material and Shore 30A to 95A elastomers; gel must wash out of gaps and hollows |
| Continuous fiber | FDM rules plus fiber placement: fiber only in XY; minimum reinforceable widths |
| Large-format pellet | Beads 4 to 8 mm wide; FDM rules scaled up about 10x; mill the surface back |

## 2. SLA, DLP, MSLA resin

Layers 25 to 100 um, typically 50 (S16). Bureau numbers include margin for
cleaning and shipping; use them by default.

| Rule | Conservative default | Values found |
| --- | --- | --- |
| Minimum supported wall | 1.0 mm (0.6 under 50 mm parts) | Form 4 0.2 (S5); 0.4 (S11); 0.5 to 2.0 by size (S29); 1.0 (S30) |
| Minimum unsupported wall | 1.0 mm, ribbed or filleted at the root | Form 4 0.2 (S5); 0.6 (S11) |
| Minimum positive feature | 0.8 mm | under 0.76 at risk, under 0.51 will not build (S21) |
| Thin pins | height under 10 x diameter | 0.3 mm dia to 7 mm tall, 0.6 to 30 mm (S5) |
| Minimum hole | 1.0 mm through; drill critical holes | 0.5 (S5, S11); under 0.508 may seal (S1) |
| Embossed | 0.5 mm high, 0.5 stroke | 0.1 (S5); 0.8 (S29) |
| Engraved | 0.5 mm deep and wide | 0.15 (S5); 0.4 (S11); 0.8 (S29) |
| Clearance, separate parts | 0.2 mm per side slip fit | 0.2 assembly, 0.1 snug (S11); slip 0.125 to 0.2 per side, press 0 to 0.05 per side (S30) |
| Clearance, print in place | 0.5 mm; avoid print in place (supports and trapped resin) | 0.4 (S5); 0.5 (S11, S29) |
| Drain holes | two, at least 3.5 mm, at opposite ends, one near the build platform; consider 4 mm when two are used | Form 4 0.75 min (S5); Form 3 2.5 (S6); 3.5, one per hollow (S11); two per cavity, plus vent holes as well as drains (S27); 5.0 single, 4.0 if several (S61) |
| Hollow shell | 2 to 3 mm | at least 2 mm (S11) |
| Overhangs | plan supports; unsupported spans under 20 mm; keep support contact off cosmetic and mating faces | Form 4: unsupported overhang 5 mm max (S5); bridges under 21 mm (S11) |
| Build volume | desktop about 200 x 125 x 200 mm; split larger | Protolabs up to 736 x 635 x 533 (S3) |
| Tolerance | plus or minus 0.2 mm or 0.3 percent, whichever is larger; Z is looser than XY | S3, S5, S21, S29; Xometry XY 0.127 mm for the first inch + 0.05 per inch, Z 0.254 + 0.05 per inch (S21); Protolabs XY 0.05 mm + 0.1 percent, Z 0.127 + 0.1 percent (S3) |
| Size drift | do not rely on dimensions over weeks | 0.15 mm or 0.15 percent in 1 to 3 days, 0.2 in 3 to 7 days (S29) |
| Surface | 1.5 to 3.0 um Ra as printed, except supported faces | S21 |
| Orientation | cosmetic faces up, away from supports; tilt to reduce peel force | S11, S27 |
| Post-processing | cure per the resin data sheet; leave about 0.1 mm stock on faces to be sanded (sanding removes 0.05 to 0.2, UNVERIFIED) | S44 |

Self-supporting angle: other DfAM checkers commonly use 30 deg from horizontal;
the text-to-cad rule table's 19 deg is now confirmed at Xometry Europe as 19
deg measured from vertical (VENDOR, S59); either way, plan supports. Standard resins are brittle and creep; use SLA for appearance,
fine detail, master patterns and molds, not for snap fits or living hinges.

## 3. SLS (PA12, PA11 and variants)

No supports; layers 80 to 120 um (S16).

| Rule | Conservative default | Values found |
| --- | --- | --- |
| Minimum wall | 1.0 mm (1.5 for TPU, PP, filled grades, over 100 mm parts) | 0.76 nylon, 1.0 PP and TPU (S4); Fuse 0.6 vertical (S8); 0.8 to 2.0 (S12) |
| Minimum feature, pin | 1.0 mm | 0.8 (S12); under 0.76 may not resolve (S21) |
| Minimum hole | 1.5 mm; ream to size | 1.0 (S8); 1.5 (S12); under 1.0 may sinter shut (S21) |
| Gap between features | 0.8 mm | 0.762 (S1); under 0.5 may fuse (S27) |
| Emboss, engrave | 1.0 mm high or deep, 4.5 mm text, bold sans | Fuse 0.1 to 0.35 deep, 3.0 to 4.5 mm text (S8); 1 mm (S12) |
| Clearance, separate parts | 0.4 mm per side | 0.2 to 0.4 (S29); leave 0.6 (S28); EOS loose fit for parts not built together 0.1 per side (S56); Xometry surface offset for gaps, small holes and pins 0.15 to 0.20 per side (0.30 to 0.40 diametral, S54) |
| Clearance, print in place | 0.6 mm (1.0 for PA11, TPU, long channels) | 0.3 under 20 mm2, 0.6 over; PA11 and TPU 1 mm (S8); 0.5 to 0.6 (S28); 0.7 (S59); EOS hinges built together 0.3 to 0.5 XY and 0.5 to 0.6 Z per side (S56); Shapeways and Sculpteo 0.5 (S61, S60) |
| Escape holes | two or more, 4 to 5 mm, opposite sides; about 12.7 mm, two or more, at a US bureau (Xometry) | at least two, 3.5 mm or larger (S8); 3.5 (S12); about 12.7 mm, two or more (S54); 5 mm, two (S60); 4 mm single, 2 mm if several (S61) |
| Hollow shell | 2.5 to 3.5 mm uniform | 2.54 to 3.175 (S1); 3.175 (S4) |
| Overhangs | none needed; flats still warp | S16 |
| Build volume | 300 mm cube | S4, S8, S12 |
| Tolerance | plus or minus 0.4 mm or 0.4 percent | plus or minus 0.25 + 0.1 percent (S4); 0.3 percent, floor 0.3 (S12); PA12 0.38 mm or 0.2 percent, TPU and PA11 0.51 mm or 0.3 percent (S21) |
| Warping | uniform walls (1.5 to 3.8 mm for low warp); no large flat plates; tilt wide flats 10 to 20 deg | parts over about 178 mm and thin parts warp most (S1, S4, S8); Protolabs tilts parts 10 to 15 deg (S55); surfaces at 0 or more than 20 deg to XY avoid stair-steps (S56) |
| Surface | matte, slightly grainy, 8 to 13 um Ra; edges round to about 0.4 mm | S12, S21 |
| Orientation | holes and pins along Z; snap fits flex in XY | S8 |

## 4. HP Multi Jet Fusion (PA12, PA11, PP, TPU)

80 um layers (S9); rules close to SLS.

| Rule | Conservative default | Values found |
| --- | --- | --- |
| Minimum wall | 1.0 mm; 2.5 to 4.0 for production | 0.5 (S9); HP 0.3 XY, 0.5 Z (S13); 0.8 min, ideal 2.5 to 4.0 (S14) |
| Minimum feature | 0.8 mm | 0.5 (S9); under 0.76 risky (S21) |
| Minimum hole | 1.5 mm | 0.5 at 1 mm wall (S15); under 1.0 may sinter shut (S21) |
| Text | 1 mm high or deep, 8 pt or larger | 6 pt minimum (S15) |
| Clearance, separate parts | 0.4 mm per side (0.8 diametral for a shaft in a bore) | HP: at least 0.4 mm gap at the interface, with plus or minus 0.2 mm being each part's tolerance (the reason for the gap, not a split of it) (S13, S52); Xometry Europe 0.4 (S22); 0.2 to 0.3 per side (S30). Reading the 0.4 mm face-to-face gap as per side is an inference (UNVERIFIED) |
| Clearance, print in place | 0.7 mm | 0.7, can drop to 0.3 under 3 mm walls with a test, more over 30 mm walls (S13); 0.5 (S52, 2018 deck); 0.6 Shapeways (S61); 0.5 Sculpteo (S60); 0.7 Xometry |
| Escape holes | two or more, 5 mm, aligned on opposite faces | HP deck: 5 mm minimum, at least two, two aligned recommended (S52, HP-authored, reseller-hosted); Xometry Europe, read in full: two or more on opposite faces, 5 mm, plus exit holes every 12.7 mm in blind holes (S22); Sculpteo 5 mm, two, opposite sides (S60); Shapeways 4 mm single, 2 mm if several (S61) |
| Hollow shell | 2.5 to 4 mm; trapped powder may be left in by agreement | 2 mm minimum, 2.5 on big parts; over about 15 mm consider a lattice (8 mm cell, 1.2 mm beam, gaps at least 5 mm) (S13, S53, S52); 2 to 4 (S14) |
| Threads | print threads only at M8 and up (HP 2018 deck, S52); M6 and up as the alternative (HP handbook, S15) | custom threads: 0.2 to 0.4 mm gap between threads (per side or diametral not stated), 0.1 mm root radius, or design to the ISO 965-2 lower limit (S52) |
| Snap fits | base at least 1 mm, hook depth at least 1 mm, root radius half the base, assembly angle 35 to 40 deg | S22, S15 |
| Build volume | 270 x 270 x 350 mm usable | S9, S29, S30 |
| Tolerance | plus or minus 0.3 mm or 0.5 percent; Z looser (typical default) | S9, S29. Worst case for an unreviewed bureau order, Xometry prototype MJF: plus or minus 0.70 mm under 30 mm, 0.85 at 30 to 50, 1.40 at 50 to 80, then 1.75 percent (TPU looser); its reviewed production XY 0.25 / 0.30 / 0.39 mm then 0.5 percent, Z 0.42 / 0.50 / 0.60 mm then 0.75 percent (S21). HP: plus or minus 0.2 mm to 100 mm, then 0.2 percent, after bead blasting (S13). Protolabs: 0.30 mm + 0.1 percent per inch (S9) |
| Warping | risk above 10:1 length to width | S22, S13 |
| Surface | dye black for cosmetics | S21 |

SLS vs MJF walls: Protolabs gives MJF 0.5 vs SLS 0.76 (S1), HP 0.3 (S13).
Conservative: 1.0 mm for both.

## 5. Metal powder bed fusion (DMLS, SLM, LPBF)

| Rule | Conservative default | Values found |
| --- | --- | --- |
| Minimum wall | 1.0 mm (1.5 over 100 mm; aluminum at least 1.0) | 0.152 HR / 0.381 NR (S2); Materialise 316L 1 mm (S26); 1.5 to 2.5 by size (S29) |
| Minimum feature | 0.8 mm | 0.305 NR vertical, 0.762 NR angled (S1); 0.6 (S17) |
| Minimum hole | 2 mm; ream or drill critical holes | 0.635 (S1); 1.5 (S17); 2 (S26) |
| Self-supporting channels | up to 8 mm diameter; teardrop or diamond above | S18 |
| Overhang | 45 deg from horizontal minimum, 50 preferred; 316L at least 55 deg from the plate; overhangs over 0.5 mm long need support | S18, S1, S26, S58 (316L 55 deg); Xometry 30 deg rough, over 45 smooth (S21); Hubs 50 deg is an ambiguous extraction (UNVERIFIED); an EOS legacy 25 deg figure has an ambiguous convention and is not adopted |
| Bridges | at most 2.0 mm unsupported | S58, S18 |
| Support access | every support reachable by band saw, wire EDM or cutter; none inside closed channels | S17, S2 |
| Escape holes | two or more, 5 to 7 mm | at least one 3 mm, several of 7 mm for large cavities (S26) |
| Clearance | assembly 0.5 mm, moving 1.0 mm | S29; Xometry Europe moving 0.6 as the alternative (S59) |
| Build volume | 240 mm cube | S10, S17, S26 |
| Tolerance | ISO 2768-1 coarse as printed (plus or minus 0.2 to 30 mm, 0.5 to 60, 0.7 to 120, 0.9 to 250); machine every mating face | S26 |
| Residual stress | avoid large flats parallel to the plate; fillet every transition | S17, S27 |
| Surface | 5 to 15 um Ra, like a sand casting; machine sealing and bearing faces | S17, S19 |
| Machining stock | **0.5 to 1.0 mm** on every machined face and datum; 0.1 to 0.2 mm hole compensation or ream | S27, S18; confirmed: Xometry says holes under 50 mm print 0.10 to 0.15 mm undersize, per side or diametral not stated (S21) |
| Post-processing order | stress relief first; then support removal, HIP or heat treat, machining | S17, S18 |

Indicative costs (Hubs, S17): stress relief USD 500 to 600 per build, support
removal USD 100 to 200 per part, finish machining USD 500 to 2,000 per part.

## 6. Metal binder jetting

Two families share the name. Bronze-infiltrated stainless (older style, S20):
walls 2.0, unsupported walls 3.0, holes 1.5, escape holes 5.0 (at least two),
features 2.0 mm; shrink 0.8 to 3 percent. Sintered fine-powder systems: shrink
up to about 20 percent, parts scaled up as much as 25 percent (Desktop Metal's
full design guide, S23, VENDOR); one vendor quotes 0.30 mm walls and 0.20 mm
holes on its tuned process (S24).

| Rule | Conservative default |
| --- | --- |
| Minimum wall | 2.0 mm (S20); sintered fine powder 0.75 mm minimum, 0.75 to 2 fragile during depowdering, 25 mm maximum and not over 25 in more than two axes; aspect 4:1 under 1 mm wide, 8:1 over (S23) |
| Minimum hole | 1.5 mm (S20); sintered fine powder 0.75 mm, depth up to 8 x diameter (4 x at 2 mm or less); slots 0.5 mm; horizontal holes over 15 mm need special sintering (S23) |
| Escape holes | two at 5 mm (S20) |
| Clearance | assembly 0.5, moving 1.0 mm (S29) |
| Overhangs (sintered fine powder) | self-supporting for the furnace: an overhang over 7.5 mm, a bridge over 20 mm, or a face over 30 deg from vertical needs a sintering support; the guide's general advice is to avoid overhangs over 10 to 15 mm (S23, VENDOR, full guide) |
| Edges and text (sintered fine powder) | no edges under 70 deg (0.5 mm flat or radius); internal fillets over 1 mm and about the wall thickness; recessed text 2 mm high, 0.5 deep; raised text 4 mm high, at most 1 mm proud (S23) |
| Size | under 100 mm for low risk (S29, S24) |
| Tolerance | plus or minus 1.5 percent over 50 mm (S29) |
| Shrink | the vendor owns scaling; keep sections uniform (S20, S23); Xometry's binder jet service 0.8 to 2.5 percent, internal holes and slots up to 5 percent (S21) |

## 7. Material jetting (PolyJet)

Gel support everywhere, removed by water jet; 30 um layers; Shore 30A to 95A
plus rigid (S25-service).

| Rule | Conservative default | Values found |
| --- | --- | --- |
| Minimum wall | 1.0 mm | 1 mm supported, 0.5 other (S25); 0.76 (S25-service) |
| Minimum feature | 1.2 mm (2.0 for rubber-like materials) | 0.25 (S25); under 1.0 at risk, 1.27 recommended (S21, Xometry PolyJet guide); 1.2 rigid, 2.0 rubber-like (S59); 0.3 (S57) |
| Pins, holes | 1.0 mm | 0.5 (S25); 0.76 (S25-service); holes under 0.75 may not clear, worse at depth to width 2:1 or more (S57) |
| Emboss, engrave | 0.5 mm | S25 |
| Assembled clearance | 0.3 mm (gel must wash out) | 0.15 to 0.2 all sides (S25); 0.5 for moving parts at a bureau (S59) |
| Overmold and gasket interfaces | line-on-line: zero gap up to 0.05 mm interference | S57 |
| Hollows | closed hollows keep their gel; trapped gel usually goes unnoticed, so leave land-locked cavities closed and add weep holes only if weight matters | Protolabs (S57, VENDOR) |
| Tolerance | plus or minus 0.2 mm (conservative) | S25-service; Xometry gives plus or minus 0.10 mm for the first inch + 0.05 per inch (S21) |
| Use | prototypes, overmold mockups, multi-material models; not long-life load parts (photopolymer creeps and yellows, UNVERIFIED) | |

## 8. Continuous-fiber composite extrusion

Nylon or Onyx-style FFF with continuous carbon, glass or aramid fiber laid only
in the XY plane. FDM rules apply to the plastic, plus:

| Rule | Value |
| --- | --- |
| Fiber path | about 1 mm per fiber ring, two nylon shell paths each side (S31) |
| Minimum reinforceable width | 2.9 mm joined at both ends; 3.8 mm for a projecting feature (S31) |
| Holes and walls | two concentric fiber rings around bolt holes and outer walls (S32) |
| Top and bottom | 2 to 4 layers of fiber at the top and bottom planes (S32) |
| Roof and floor | at least four plastic layers above and below fiber (S32) |
| Orientation | major loads in the print plane; clamp layers with a through-bolt if Z shear matters (S32) |
| Tolerance, size | not found (UNVERIFIED); treat as FDM |

## 9. Large-format pellet extrusion (FGF, robot extruders)

| Rule | Value |
| --- | --- |
| Minimum wall and feature | 4.5 mm (S30); avoid details under 10 mm (S34) |
| Bead, layer | bead 4 to 8 mm (S35); nozzles 2 to 24 mm (S34); layers 0.5 to 2.0 mm (S30) |
| Holes, clearance | minimum hole 6.0 mm; 2.0 mm clearance per side; no press fits (S30) |
| Overhangs | avoid (S30) |
| Tolerance | plus or minus 1.0 mm (S30) |
| Size | objects 300 mm or larger (S34); up to 2400 x 2400 x 1000 mm (S30) |
| Post | mill the coarse surface back; machining stock of several mm (exact value not found, UNVERIFIED) (S34) |
| Economics | suits roughly 1 to 50 parts; molding or machining wins above about 500 (S35) |

## 10. Awareness level: ceramics, food, bioprinting

These are outside a general CAD agent's scope beyond flagging their limits.
**Ceramic printing** (ceramic-slurry vat printing, binder jetting, paste
extrusion) makes a fragile green part that is cleaned, debinded and sintered;
dimensions change in firing, so the design is pre-scaled and proven with the
actual firing cycle, sections are kept thin and uniform, closed cavities are
avoided, and sharp internal corners and thin cantilevers crack (S46; one
bureau's 100 um wall and 200 um hole figures are UNVERIFIED, S47). **Food and
chocolate printing** is limited by heat, not strength: the material must flow
and then set, so designs are short, thick-walled and self-supporting with no
bridges, under food-hygiene and shelf-life constraints (S48, S49).
**Bioprinting** geometry is set by biology: bioink rheology, cell viability
under nozzle shear and heat, and pore size and interconnectivity for nutrient
diffusion, under regulatory control (S50, S51). For any of these, say the
process is outside this playbook and ask for the specialist's rules.

## Source keys

From research lane 02 (accessed 2026-11-12):

| Key | URL |
| --- | --- |
| S1 | https://www.protolabs.com/resources/design-tips/7-mistakes-to-avoid-when-designing-3d-printed-parts/ |
| S2 | https://www.protolabs.com/resources/design-for-3d-printing-toolkit/ |
| S3 | https://www.protolabs.com/services/3d-printing/stereolithography/ |
| S4 | https://www.protolabs.com/services/3d-printing/selective-laser-sintering/ |
| S5 | https://formlabs.com/support/Design-specifications-for-3D-models-Form-4-generation/ |
| S6 | https://formlabs.com/support/Design-specifications-for-3D-models-form-3/ (excerpt) |
| S8 | https://formlabs.com/white-papers/fuse-series-sls-design-guide/ |
| S9 | https://www.protolabs.com/services/3d-printing/multi-jet-fusion/ |
| S10 | https://www.protolabs.com/services/3d-printing/direct-metal-laser-sintering/ |
| S11 | https://www.hubs.com/knowledge-base/how-design-parts-sla-3d-printing/ |
| S12 | https://www.hubs.com/knowledge-base/how-design-parts-sls-3d-printing/ |
| S13 | https://www.hp.com/us-en/printers/3d-printers/learning-center/how-to-design-3d-print-model.html (excerpt) |
| S14 | https://www.protolabs.com/en-gb/resources/blog/designing-a-part-for-multi-jet-fusion/ (excerpt) |
| S15 | https://endeavor3d.com/wp-content/uploads/2025/06/HP-MJF-Design-Handbook_Special-Edition.pdf (excerpt) |
| S16 | https://www.hubs.com/knowledge-base/selecting-right-3d-printing-process/ |
| S17 | https://www.hubs.com/guides/metal-3d-printing/ |
| S18 | https://www.protolabs.com/resources/design-tips/how-to-design-and-manufacture-metal-3d-printed-parts/ |
| S19 | https://www.protolabs.com/resources/guides-and-trend-reports/metal-3d-printing-materials-guide/ (excerpt) |
| S20 | https://www.hubs.com/knowledge-base/how-design-parts-binder-jetting-3d-printing/ |
| S21 | https://www.xometry.com/manufacturing-standards/ |
| S22 | https://xometry.pro/wp-content/uploads/2024/05/EN-EU-MJF-Design-Guide.pdf (read in full in the follow-up pass) |
| S23 | Desktop Metal Binder Jet Design Guide, Rev01, December 2022, read in full from the public archived copy https://web.archive.org/web/20250523083616id_/https://www.desktopmetal.com/uploads/81-00239_Rev01_EN_Binder-Jet-Design-Guide.pdf (the original desktopmetal.com URL now redirects to another company's site) |
| S24 | https://www.azoth3d.com/design-guidelines/binder-jetting |
| S25 | https://www.hubs.com/knowledge-base/how-design-parts-material-jetting-3d-printing/ |
| S25-service | https://www.protolabs.com/services/3d-printing/polyjet/ |
| S26 | https://www.materialise.com/en/academy/industrial/design-am/stainless-steel-ss316l |
| S27 | https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing |
| S28 | https://www.materialise.com/en/academy/industrial/design-am/pa12-sls (excerpt) |
| S29 | https://jlc3dp.com/help/article/3d-printing-design-guideline |
| S30 | https://www.makelab.com/design-guidelines |
| S31 | https://markforged.com/resources/blog/threading-the-needle-with-ease |
| S32 | https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/fiber-reinforcement-strategies |
| S34 | https://ceadgroup.com/resources/blog/guidelines-for-large-format-3d-printing/ (excerpt) |
| S35 | https://www.fictiv.com/articles/large-format-3d-printing (excerpt) |
| S44 | https://formlabs.com/blog/how-to-post-cure-3d-prints/ (excerpt) |
| S46 | https://3dceram.com/ceramic-sla-3d-printing-the-essential-guide/ (excerpt) |
| S47 | https://coreceramic3d.com/blog/custom-ceramic-3d-printing.php (excerpt) |
| S48 | https://www.sciencedirect.com/science/article/abs/pii/S0260877417302753 (excerpt) |
| S49 | https://3dprint.com/236829/benefits-and-limitations-of-3d-printing-chocolate/ (excerpt) |
| S50 | https://pmc.ncbi.nlm.nih.gov/articles/PMC8572712/ (excerpt) |
| S51 | https://www.researchgate.net/publication/372727114 (excerpt) |

Added by the follow-up pass (`docs/specs/dfm-research/08-skipped-sources-addendum.md`,
accessed 2026-11-12):

| Key | URL |
| --- | --- |
| S52 | HP "Design for MJF parts" deck (HP-authored, reseller-hosted): https://www.ajatec.fi/wp-content/uploads/2024/02/Design_for_MJF.pdf |
| S53 | HP white paper 4AA7-2952ENW: https://h20195.www2.hp.com/v2/GetDocument.aspx?docname=4AA7-2952ENW |
| S54 | Xometry SLS design guide PDF: https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_SLS.pdf |
| S55 | https://www.protolabs.com/resources/design-tips/designing-for-selective-laser-sintering/ |
| S56 | EOS "Basic Design Rules for Additive Manufacturing" (EOS-authored, reseller-hosted): https://www.3dpx.com/wp-content/uploads/2019/04/EOS-Basic-Design-Rules_Additive-Manufacturing_EN.pdf |
| S57 | https://www.protolabs.com/resources/design-tips/prototyping-with-polyjet-3d-printing/ |
| S58 | Protolabs DMLS design guide PDF: https://www.protolabs.com/media/1020535/protolabs_dmls_design_guide.pdf |
| S59 | https://xometry.pro/en-eu/3d-printing-design-guide/quick-guide/ |
| S60 | Sculpteo plastics design guidelines PDF: https://www.sculpteo.com/wp-content/uploads/2026/07/3D20printing20Plastics20Design20Guidelines-pdf.pdf |
| S61 | Shapeways material pages, design-guideline sections (MJF PA12, Somos WaterShed SLA): https://www.shapeways.com/materials/pa12 |
