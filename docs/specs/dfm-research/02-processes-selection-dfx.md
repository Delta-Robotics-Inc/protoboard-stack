# DFM Research Lane 02: Non-FDM Additive Processes, Process Selection, and Design for X

Lane scope: (A) additive processes other than FDM, (B) process selection and the low-cost-first manufacturing ladder, (C) Design for X (DfX).
Date of research: 2026-11-12. All sources accessed 2026-11-12 unless noted.
Units: mm unless stated. Inch values from US sources are converted (1 in = 25.4 mm). "Conservative" = the value an AI CAD agent should default to when it does not know the exact machine or vendor.

Conventions used in this file:
- **[S#]** points to the numbered Sources list at the end.
- **UNVERIFIED** = number seen only in a search-engine excerpt, a secondary page, or an ambiguous extraction; not confirmed on the primary page.
- **Disagreement** notes give both values and name the conservative one.
- Direct quotes are kept under 15 words; everything else is paraphrased.

---

## How to use this file (rules of thumb for the agent)

1. Pick the process first (Part B), then apply that process's table (Part A). Rules do not transfer between processes; a value that is safe for SLA can fuse shut in SLS.
2. When the vendor is unknown, use the **Conservative default** column. When a specific vendor or machine is chosen, use that vendor's value and cite it.
3. Minimum feature sizes scale with part size. JLC3DP publishes wall minimums that grow from 0.5 mm (5 mm SLA part) to 2.0 mm (200 mm SLA part) [S29]. For parts over ~100 mm, add at least 0.5 mm to any "minimum wall" in this file.
4. Any closed cavity in a vat or powder process needs escape holes. No exceptions, unless the vendor agrees to leave powder trapped (HP and Xometry both describe this as an option for MJF) [S13][S21].
5. Tolerances quoted by bureaus are "typical for well-designed parts," apply before post-processing, and are usually not guaranteed on a first order [S21]. Design critical fits to be reamed, machined, or shimmed.

---

# PART A. Additive processes other than FDM

ISO/ASTM 52900 groups additive processes into seven families: vat photopolymerization (SLA, DLP, MSLA), powder bed fusion (SLS, MJF, DMLS/SLM, EBM), material jetting (PolyJet), binder jetting, material extrusion (FDM/FFF, pellet extrusion, continuous-fiber), directed energy deposition, and sheet lamination [S40][S41]. ISO/ASTM 52910:2018 is the companion design standard; its scope is "requirements, guidelines and recommendations" for using AM in product design, written to be process-general rather than to give per-machine numbers [S42]. Practical numbers therefore come from vendors and bureaus, below.

## A1. Vat photopolymerization: SLA, DLP, MSLA resin

Typical layer 25 to 100 um (most common 50 um) [S16]. Desktop printers (Formlabs Form 4) and service-bureau SLA (Protolabs, Xometry, JLC3DP) publish different minimums: desktop numbers are what the machine can resolve; bureau numbers include a margin for cleaning, shipping, and survival. Use the bureau numbers by default.

| Rule | Values found (source) | Conservative default |
|---|---|---|
| Min supported wall | 0.2 mm Form 4 [S5]; 0.4 mm [S11]; 0.152 mm HR / 0.305 mm NR for ABS-like [S2]; 0.5 to 2.0 mm scaling with part size 5 to 200 mm [S29]; 1.0 mm [S30] | **1.0 mm** (0.6 mm on small parts under 50 mm) |
| Min unsupported wall | 0.2 mm Form 4 [S5]; 0.6 mm [S11] | **1.0 mm**; add ribs or a fillet at the root |
| Min positive feature | XY 0.254 mm NR / 0.102 mm HR / 0.064 mm micro; Z 0.406 mm NR/HR, 0.203 mm micro [S3]; Xometry: features under 0.76 mm at risk, under 0.51 mm will not build (standard res) [S21]; 1.0 mm [S30] | **0.8 mm** for anything that must survive handling |
| Thin vertical pins/wires | 0.3 mm dia OK up to 7 mm tall; 0.6 mm dia up to 30 mm tall [S5] | Keep pin height under 10x diameter |
| Min hole | 0.5 mm Form 4 [S5]; 0.5 mm [S11]; NR 0.635 / HR 0.508 / micro 0.381 mm [S3]; holes under 0.508 mm may seal, channels 0.635 mm, slots 0.381 mm [S1] | **1.0 mm** through hole; drill or ream anything critical |
| Embossed detail | 0.1 mm high Form 4 [S5]; 0.1 mm [S11]; text depth 0.305 mm recommended [S2]; 0.8 mm deep and wide [S29]; 0.5 mm [S27] | **0.5 mm high, 0.5 mm stroke** |
| Engraved detail | 0.15 mm deep and wide Form 4 [S5]; 0.4 mm wide and deep [S11]; 0.8 mm [S29] | **0.5 mm deep, 0.5 mm wide** |
| Clearance, separate mating parts | 0.2 mm assembly, 0.1 mm push/snug fit [S11]; 0.2 mm [S29]; slip fit 0.125 to 0.2 mm per side, press fit 0 to 0.05 mm per side [S30] | **0.2 mm per side** slip fit |
| Clearance, moving / print-in-place | 0.4 mm minimum clearance Form 4 [S5]; 0.5 mm between moving parts [S11]; 0.5 mm [S29]; moving fit 0.2 to 0.3 mm per side, printed-assembled "not recommended" [S30] | **0.5 mm**, and avoid print-in-place in SLA (supports and trapped resin) |
| Drain / escape holes | Form 4: 0.75 mm min [S5]; Form 3: 2.5 mm min [S6]; Form 2: 3.5 mm min [S7]; 3.5 mm, at least one per hollow section [S11]; 2.5 mm min, two holes if under 3 mm [S29]; at least two escape holes per cavity [S27] | **Two holes, at least 3.5 mm, at opposite ends**, one close to the build platform |
| Hollowing wall | at least 2 mm [S11] | **2 to 3 mm shell** |
| Overhang / supports | Supports always required for most geometry [S16]; max unsupported overhang length 5 mm, min unsupported overhang angle 10 deg from level, max horizontal support span 29 mm for a 5 x 3 mm beam (Form 4) [S5]; overhangs under 1.0 mm long and 19 deg or more from level, bridges under 21 mm [S11] | Plan supports; keep unsupported spans under 20 mm; keep support contact off cosmetic and mating faces |
| Max build volume | Protolabs NR 736 x 635 x 533 mm; HR 254 mm cube; micro 127 x 127 x 63.5 mm [S3]; JLC3DP up to 780 x 780 x 530 mm [S29]; desktop 145 x 145 x 175 (older Form 2), industrial up to 1500 x 750 x 500 mm [S16] | Desktop ~200 x 125 x 200 mm class; split larger parts |
| Tolerance | XY +/-0.05 mm first 25 mm + 0.1% of length; Z +/-0.127 mm first 25 mm + 0.1% [S3]; Form 4: 1-30 mm +/-0.15% (min +/-0.02 mm), 31-80 mm +/-0.2%, 81-150 mm +/-0.3% [S5]; Xometry std res XY +/-0.127 mm first 25 mm + 0.05 mm per 25 mm, Z +/-0.254 mm + 0.05 mm per 25 mm; Formlabs-material jobs XY +/-0.2 mm + 0.076 mm per 25 mm [S21]; +/-0.2 mm under 100 mm, +/-0.3% over 100 mm [S29]; prototyping +/-0.5% (floor +/-0.10 mm), industrial +/-0.15% (floor +/-0.05 mm) [S16] | **+/-0.2 mm or +/-0.3%, whichever is larger** |
| Warp / shrink | Resin shrinks on cure; thin and flat sections warp; peel forces on large cross-sections [S27]; slicer compensates post-cure shrink [S44]; JLC3DP notes SLA dimensions drift 0.15 mm or 0.15% in 1 to 3 days and 0.2 mm or 0.2% in 3 to 7 days [S29]; hobby measurement of 0.3 to 0.6% linear shrink (UNVERIFIED, single blog) [S45] | Keep walls uniform; rib large flats; do not rely on resin parts holding dimension over weeks |
| Surface finish | ~60 to 120 uin Ra (1.5 to 3.0 um) as printed, excluding supported faces [S21] | Best of the common processes; support stubble needs sanding |
| Orientation | Tilt to cut per-layer cross-section and peel force; minimize Z cross-section [S11][S27]; supports go on the "down" side | Put cosmetic faces up, away from supports |
| Post-processing that changes size | Thin walls absorb IPA and can deform with long washes [S5]; post-cure shrink (compensated if cured per vendor recipe) [S44]; sanding removes 0.05 to 0.2 mm (UNVERIFIED, typical shop practice) | Spec "cured per resin data sheet"; leave 0.1 mm stock on faces to be sanded |

Material notes: standard resins are brittle thermosets; tough, flexible, and high-temp resins exist but generally creep and UV-age. Use SLA for appearance, fine detail, smooth master patterns for urethane casting, and molds for low-volume injection molding [S16][S36][S38].

Cupping failure: a hollow cavity printed open to the build plate seals a suction cup that can tear the part; drain holes near the plate break the seal [S6][S7].

## A2. Selective Laser Sintering (SLS): PA12, PA11, and variants

No supports: unsintered powder supports the part. Typical layer 80 to 120 um (most common 100 um) [S16]; Protolabs runs 0.1016 mm [S4].

| Rule | Values found (source) | Conservative default |
|---|---|---|
| Min wall | 0.762 mm nylon, 1.016 mm PP and TPU [S4][S2]; Fuse: 0.6 mm vertical, 0.3 mm horizontal (supported or not) [S8]; 0.8 mm PA12 to 2.0 mm carbon-filled [S12]; 1.0 mm [S28]; 1.0 to 2.0 mm by part size [S29]; xometry.pro 0.5 supported / 0.6 unsupported (UNVERIFIED excerpt) | **1.0 mm** (1.5 mm for TPU, PP, filled grades, and parts over 100 mm) |
| Min feature / pin | 0.8 mm [S12]; positive features under 0.76 mm may not resolve [S21]; Materialise min detail 0.3 mm [S28]; knife-edge (distal end of counterbores) keep 0.762 mm [S1] | **1.0 mm** |
| Min hole | 1.0 mm in X, Y, Z [S8]; 1.5 mm [S12]; 1 mm [S28]; holes under 1.0 mm may sinter shut [S21] | **1.5 mm**; ream to size |
| Channel gap between features | 0.762 mm [S1]; features under 0.5 mm apart may fuse [S27] | **0.8 mm** |
| Embossed / engraved | Fuse guide gives detail depth 0.1 to 0.35 mm, width 0.3 to 0.4 mm, text height 3.0 to 4.5 mm at 0.3 mm depth, larger values on vertical faces (which set maps to embossed vs engraved is UNVERIFIED from the extraction) [S8]; 1 mm depth/height [S12]; 0.8 mm [S29] | **1.0 mm high or deep, 4.5 mm text height, bold sans font** |
| Clearance, mating separate parts | assembly 0.2 to 0.4 mm [S29]; Materialise leave 0.6 mm between parts [S28] | **0.4 mm per side** |
| Clearance, moving / print-in-place | integrated assemblies 0.3 mm for features under 20 mm2, 0.6 mm over 20 mm2; PA11 and TPU at least 1 mm [S8]; 0.3 mm running axle, 0.2 mm ball joint [S12]; 0.5 to 0.6 mm [S28]; 0.6 mm [S29] | **0.6 mm** (1.0 mm for PA11, TPU, long channels) |
| Escape holes | at least 2 holes, each 3.5 mm or larger [S8]; 3.5 mm [S12]; 4 mm (UNVERIFIED excerpt, Forge Labs); lattices with gaps no smaller than 8 mm and open faces [S8] | **Two or more, 4 to 5 mm, on opposite sides**; bigger and more holes clean faster |
| Hollowing / uniform wall | hollow thick features to a 2.54 to 3.175 mm shell [S1]; keep a uniform 3.175 mm thickness for stability [S4] | **2.5 to 3.5 mm** uniform shell |
| Overhang / supports | Not required [S16]; powder is support | Unlimited overhangs, but flats still warp |
| Max build volume | 309.9 x 261.6 x 254 mm (PA12 etc.), 482 x 482 x 431 mm PA12 white large frame [S4]; Fuse ~160 x 160 x 295 mm [S8]; average ~300 mm cube, large machines 700 x 380 x 580 mm [S12] | 300 mm cube |
| Tolerance | +/-0.25 mm + 0.1% [S4]; +/-0.3% with floor +/-0.3 mm, or +/-0.3 mm + 0.05 mm per extra 25 mm [S12]; PA12 +/-0.38 mm or +/-0.05 mm per 25 mm, whichever is greater; PA11/TPU +/-0.51 mm or +/-0.076 mm per 25 mm [S21]; +/-0.3 mm under 100 mm, +/-0.4% over [S29] | **+/-0.4 mm or +/-0.4%** |
| Warp / shrink | Parts over ~178 mm (7 in) and thin parts warp most [S1][S4]; print wide flat parts tilted ~20 deg; PA11 and TPU warp more [S8]; machine pre-scales 3 to 3.5% for shrink [S12]; differential shrink at thick-thin transitions [S1] | Uniform walls, ribs or draft on cantilevers, no large flat plates |
| Surface finish | ~315 to 520 uin Ra (8 to 13 um) as printed [S21]; vapor smoothing to 64 to 100 uin Ra [S4]; grainy matte, edges round to ~0.4 mm radius [S12] | Matte, slightly grainy |
| Orientation | Holes and pins along Z; snap-fit flex in the XY plane; smooth faces down, crisp faces up; keep away from chamber walls for some powders; CF grades strongest along X [S8] | Put round features vertical |
| Post-processing that changes size | Bead blast (removes powder, slight size loss); dyeing (negligible); vapor smoothing (rounds edges); tumbling needs parts at least 30 mm smallest dimension and 1 mm walls [S28] | Hold fine features above 1 mm if tumbling |

## A3. HP Multi Jet Fusion (MJF): PA12, PA11, PP, TPU

Powder bed fusion with fusing and detailing agents, 80 um layers [S9]. Rules are close to SLS, slightly finer.

| Rule | Values found (source) | Conservative default |
|---|---|---|
| Min wall | 0.508 mm (PA12 black) [S9][S2]; HP: 0.3 mm short walls in XY, 0.5 mm in Z [S13]; minimum 0.8 mm, ideal 2.5 to 4.0 mm [S14]; 1.0 mm [S30]; 1.0 to 2.0 mm by size [S29] | **1.0 mm**; 2.5 to 4.0 mm for production parts |
| Min feature | 0.5 mm [S9]; HP min detail width 0.1 mm, slit between walls 0.5 mm [S15]; raised text and small features no smaller than 0.5 mm [S14]; positive features under 0.76 mm risky [S21] | **0.8 mm** |
| Min hole | 0.5 mm at 1 mm wall thickness [S15]; holes under 1.0 mm may sinter shut [S21]; 1.0 mm [S30] | **1.5 mm** |
| Emboss / deboss text | 6 pt minimum font; 1 mm emboss/deboss shown as reference [S15] | **1 mm high/deep, 8 pt or larger** |
| Clearance, mating separate parts | 0.4 mm total gap (0.2 mm per part) as a start [S13]; slip fit 0.2 to 0.3 mm per side [S30] | **0.3 mm per side** |
| Clearance, moving / print-in-place | 0.7 mm minimum; can drop to 0.3 mm when walls are under 3 mm, test first; larger gaps for very thick walls [S13]; 0.5 mm minimum, more on long channels [S30]; 0.6 mm [S29] | **0.7 mm** |
| Escape holes | At least two drain holes on opposing faces, 5 mm or larger (Xometry MJF guide, read via search excerpt of the PDF, UNVERIFIED) [S22]; Protolabs lists missing escape holes as a pitfall [S14]; 4 mm recommended, 2 mm minimum (UNVERIFIED excerpt, Tempus3D) | **Two or more, 5 mm, opposite faces** |
| Hollowing | HP: minimum hollow wall 2 mm, thicker is stronger; trapped powder can be left in (heavier, no extraction) [S13]; hollow sections over 4 mm thick to a 2 to 4 mm shell [S14]; Xometry may hollow thick full-color parts to 4 mm and leave powder inside [S21]; uniform 3.175 mm recommended [S9] | **2.5 to 4 mm** shell |
| Threads and snaps | Print threads only at M6 and larger; use self-tapping screws, inserts, or machined threads below that; snap-fit cantilever base at least 1 mm, overhang depth at least 1 mm [S15] | Inserts for anything under M6 |
| Max build volume | 284 x 380 x 380 mm [S9]; 370 x 276 x 360 mm [S29]; 380 x 284 x 380 mm [S30] | 270 x 270 x 350 mm usable |
| Tolerance | +/-0.30 mm + 0.1% per additional 25 mm [S9]; Xometry production (engineer reviewed), rigid materials: XY +/-0.25 mm under 30 mm, +/-0.30 mm 30-50 mm, +/-0.39 mm 50-80 mm, +/-0.5% over 80 mm; Z roughly 1.5x looser; prototype orders much looser (+/-0.70 mm under 30 mm, +/-1.75% over 80 mm) [S21]; +/-0.3 mm under 100 mm, +/-0.4% over [S29] | **+/-0.3 mm or +/-0.5%** (plan Z looser) |
| Warp / shrink | Thin-long parts, abrupt section changes, thin curved shells warp; thicken long walls, avoid ribs on large flats, smooth transitions, hollow or lattice [S13]; parts over ~178 mm and uneven walls deviate [S21]; account for shrink in fits [S14] | Uniform walls, avoid flat plates |
| Surface | 250+ uin Ra as printed; vapor smoothing to 64 to 100 uin [S9]; ~395 to 560 uin Ra [S21]; natural gray is uneven, dyed black recommended [S21] | Dye black for cosmetics |
| Orientation | Bureau usually chooses; affects cost (Z height), finish, accuracy [S14]; close to isotropic in Z vs other AM [S14] | Shortest Z for cost |
| Post-processing | Bead blast then dye black (standard) [S9]; vapor smoothing; primer, taps, inserts [S9] | Specify finish on order |

Disagreement SLS vs MJF on walls: Protolabs gives MJF 0.5 mm vs SLS 0.76 mm [S1]; HP's own 0.3 mm XY figure is the most aggressive [S13]. Conservative: 1.0 mm for both.

## A4. Metal powder bed fusion (DMLS, SLM, LPBF)

| Rule | Values found (source) | Conservative default |
|---|---|---|
| Min wall | HR 0.152 mm, NR 0.381 mm (steels, Ti, Inconel, CoCr); aluminum 0.381 HR / 0.762 NR [S2]; aluminum generally 0.76 to 1.0 mm [S1]; 0.4 mm [S17]; Materialise 316L: 1 mm standard grade, 0.5 mm performance grade [S26]; 1.5 to 2.5 mm by size [S29] | **1.0 mm** (1.5 mm over 100 mm parts; aluminum 1.0 mm minimum) |
| Min feature | Vertical/in-plane: HR 0.152 mm, NR 0.305 mm; horizontal or angled walls: HR 0.381 mm, NR 0.762 mm [S1]; 0.6 mm [S17]; Materialise min detail 0.4 mm [S26]; Xometry: positive features under 0.51 mm risky [S21] | **0.8 mm** |
| Min hole | HR 0.508 mm, NR 0.635 mm [S2]; holes under 0.635 mm may seal or shrink [S1]; 1.5 mm [S17]; 2 mm [S26] | **2 mm**; ream or drill critical holes |
| Self-supporting horizontal holes/channels | Channels up to 8 mm diameter self-support [S18] | Use teardrop or diamond profiles above 8 mm |
| Overhang / supports | Self-supporting surfaces no less than 45 deg; overhangs longer than 0.5 mm need support [S18][S1]; Materialise: below 45 deg from the plate needs support [S26]; Hubs lists 50 deg (extraction ambiguous, UNVERIFIED) and "support always required" [S17] | **45 deg from horizontal minimum, 50 deg preferred**; design so supports can be reached by saw, EDM wire, or cutter |
| Support removal access | Supports removed by band saw, wire EDM, or machining [S17]; shot peen/grit blast cannot reach inaccessible surfaces, finish will be non-uniform [S2]; dense metal supports raise post-processing cost [S27] | No supports inside closed channels; leave tool access to every support |
| Escape holes (powder) | At least one opening 3 mm or larger; large or complex cavities need several, preferably 7 mm [S26] | **Two or more, 5 to 7 mm** |
| Clearance | Assembly 0.5 mm, moving 1.0 mm [S29] | **0.5 mm / 1.0 mm** |
| Max build volume | NR 245 x 245 x 330 mm; HR 88 x 88 x 70 mm (Al 98 x 98 x 94); large format 800 x 400 x 500 mm [S10][S2]; typical 250 x 150 x 150 mm, up to 500 x 280 x 360 mm [S17]; Materialise 316L 250 x 250 x 305 mm [S26]; JLC3DP 390 x 290 x 390 mm [S29] | 240 mm cube |
| Tolerance | XY +/-0.076 mm first 25 mm + 0.1%; Z +/-0.152 mm first 25 mm + 0.1% [S10]; +/-0.1 mm [S17]; Xometry +/-0.127 mm first 25 mm + 0.05 mm per 25 mm, not guaranteed on first order, flatness-critical parts a poor fit [S21]; Materialise: ISO 2768-1 coarse / DCTG 6-8, e.g. +/-0.2 mm up to 30 mm, +/-0.5 mm 30-60 mm, +/-0.7 mm 60-120 mm, +/-0.9 mm 120-250 mm [S26]; +/-0.3 mm under 100 mm, +/-0.4% over [S29] | **Materialise / ISO 2768-c values as-printed**; machine every mating face |
| Warp / residual stress | High thermal gradients build internal stress; supports anchor against distortion [S17]; residual stress can crack or warp; fillet transitions [S27] | Avoid large flat areas parallel to the plate; fillet all transitions |
| Surface | 10.16 to 15.24 um Ra as printed, 5.08 to 10.16 um with standard finishing [S19]; Ra 8 to 10 um [S17]; ~200 to 1000 uin Ra [S21] | Like a sand casting; machine sealing and bearing faces |
| Orientation | Drives support volume, distortion, and which faces are rough (down-skin) [S27] | Minimize down-facing area and support volume |
| Post-processing that changes size | Stress relief before any other step [S17]; HIP closes porosity [S18]; machining allowance 0.5 to 1.0 mm on critical faces [S27]; add 0.1 to 0.2 mm hole compensation or ream [S27]; extra stock for reaming tight holes [S18]; brushed, satin, polished, passivation, EDM, tapping offered [S10] | **Add 0.5 to 1.0 mm stock** on every machined face and datum |

Costs (Hubs, indicative): stress relief USD 500 to 600 per build, support removal USD 100 to 200 per part, HIP or heat treat USD 500 to 2,000 per build, finish machining USD 500 to 2,000 per part [S17]. Hollow parts print faster and cheaper [S18].

## A5. Metal binder jetting

Two very different product families share the name:
- **Bronze-infiltrated stainless (older ExOne style).** Hubs rules: wall 2.0 mm, unsupported walls/fins 3.0 mm, emboss/engrave 0.5 mm, unsupported edges 2.0 mm thick and no longer than 20 mm, fillets 1.0 mm minimum, holes 1.5 mm, escape holes 5.0 mm with at least two, features 2.0 mm. Green part ~60% porous; infiltrated ~90% dense; sintered ~97% dense. Shrink 0.8 to 2% for 25 to 75 mm parts, ~3% for larger [S20].
- **Sintered fine-powder systems (Desktop Metal, HP Metal Jet style).** Shrinkage up to about 20% during sintering, so parts are scaled up as much as 25%; parts are soft during sintering and sag, so avoid overhangs longer than 10 to 15 mm unless supported; setters (ceramic support trays) do not shrink [S23, read via search-index excerpt of the PDF; UNVERIFIED in detail]. Azoth gives ideal part size 5 to 75 mm, recommended max 150 mm, min wall 0.30 mm, min hole 0.20 mm, inaccessible internal channels 3 mm, height-to-wall ratio 8:1 or less, hole depth-to-diameter 4:1 under 2 mm and 8:1 over 2 mm, text spacing 0.3 mm and 0.4 mm deboss depth [S24].

| Rule | Values found | Conservative default |
|---|---|---|
| Min wall | 2.0 mm [S20]; 0.30 mm [S24]; features below 0.75 mm must be thickened, minimum feature over 1 mm [S21]; 1.5 to 2.0 mm by size [S29] | **2.0 mm** (Hubs value is conservative; Azoth's 0.3 mm assumes their tuned process) |
| Min hole | 1.5 mm [S20]; 0.2 mm [S24] | **1.5 mm** |
| Escape holes | 5 mm, at least two [S20] | **Two at 5 mm** |
| Clearance | assembly 0.5 mm, moving 1.0 mm [S29] | 0.5 / 1.0 mm |
| Overhangs | not supported in print (powder bed) but must survive sintering: avoid overhangs over 10 to 15 mm [S23] | Design self-supporting for the furnace, not the printer |
| Max size | JLC3DP 100 mm cube [S29]; Azoth max 150 mm recommended [S24] | Under 100 mm for low risk |
| Tolerance | +/-0.3 mm or +/-0.4% up to 50 mm; +/-1.3% over 50 mm [S29] | **+/-1.5%** over 50 mm |
| Shrink and distortion | up to ~20% (sintered) [S23]; 0.8 to 3% (infiltrated) [S20]; non-uniform shrink must be planned with the operator [S20] | Ask the vendor to own scaling; keep sections uniform |
| Surface | ~120 to 315 uin Ra [S21]; tumbling can trap media in gaps and text [S21] | Avoid narrow slots if tumbled |
| Layer | 0.1 mm, parts oriented lowest Z [S21] | |

Disagreement: Azoth (0.30 mm walls) vs Hubs (2.0 mm). Default to Hubs 2.0 mm unless a specific vendor is chosen.

## A6. Material jetting (PolyJet)

Whole part is encased in gel support, removed with water jet and a chemical bath [S25-service]. Multi-material and Shore A 30 to 95 plus rigid are available [S25-service]. Layer 30 um.

| Rule | Values found (source) | Conservative default |
|---|---|---|
| Min wall | major supported walls 1 mm, other walls 0.5 mm [S25]; min freestanding wall, hole, or channel 0.76 mm [S25-service]; 0.762 mm for all Digital materials [S2] | **1.0 mm** |
| Min feature | 0.25 mm [S25]; 0.3 mm [S25-service]; Xometry: features under 1.0 mm may break in post-processing, 1.27 mm or larger recommended [S21] | **1.0 mm** |
| Min pin / hole | pins 0.5 mm, holes 0.5 mm [S25]; holes and channels 0.76 mm [S25-service] | **1.0 mm** |
| Emboss / engrave | 0.5 mm height and depth [S25] | **0.5 mm** |
| Moving / assembled clearance | 0.15 to 0.2 mm on all sides [S25] | **0.3 mm** (support gel must be washed out of the gap) |
| Escape holes | Needed to empty support from hollows (Shapeways MJP page, UNVERIFIED excerpt) | Avoid closed hollows; gel is hard to extract |
| Max build | 490 x 390 x 200 mm [S25-service] | |
| Tolerance | +/-0.1 mm first 25 mm + 0.1% [S25-service]; +/-0.1 to 0.3 mm [S25]; Xometry +/-0.1 mm first 25 mm + 0.05 mm per 25 mm [S21] | **+/-0.2 mm** |
| Surface | ~32 to 80 uin Ra (0.8 to 2 um) [S21]; glossy vs matte depends on support contact (UNVERIFIED, not on fetched pages) | Smoothest AM finish |
| Warp / aging | Photopolymer: creeps and yellows with UV over time (UNVERIFIED general knowledge) | Prototypes, overmold mockups, multi-material models; not long-life load parts |

## A7. Continuous-fiber composite extrusion (Markforged style)

Base is nylon/onyx FFF; continuous carbon, glass, or Kevlar fiber is laid only in the XY plane inside chosen layers.

| Rule | Value (source) |
|---|---|
| Fiber path width | about 1 mm per fiber ring, with two nylon shell paths on each side [S31] |
| Min reinforceable width | 2.9 mm for a region joined at both ends; 3.8 mm for a projecting (open) feature [S31] |
| Holes and walls | Reinforce bolt holes and outer walls with two concentric fiber rings [S32] |
| Top/bottom | 2 to 4 layers of isotropic fiber at top and bottom planes (fiber at the extremes matters more than at the core) [S32] |
| Roof/floor | Fiber needs at least four plastic roof and floor layers; reinforced faces start four layers from the nearest roof/floor [S32] |
| Orientation | Orient so major loads lie in the print plane; Z (between layers) is the weak direction; clamp layers with a through-bolt if Z shear matters [S32] |
| DfAM principles | Use ribs instead of solid blocks; split complex corners into separately printed pieces joined by pins or dowels [S33] |
| Tolerance, max size | UNVERIFIED (not found on fetched pages); treat as FDM-class tolerance, see the FDM lane |

## A8. Large-format pellet extrusion (FGF, BAAM, robot extruders)

| Rule | Value (source) |
|---|---|
| Min wall / feature | 4.5 mm wall and feature [S30]; avoid details under 10 mm [S34] |
| Bead and layer | Bead 4 to 8 mm wide [S35]; nozzles 2 to 24 mm [S34]; layer 0.5 to 2.0 mm [S30] |
| Holes, clearance | Min hole 6.0 mm; 2.0 mm clearance per side; press fits not recommended [S30] |
| Overhang | Avoid overhangs [S30] |
| Tolerance | +/-1.0 mm [S30]; large-format AM generally +/-0.2 to 0.5 mm (Fictiv, all large processes) [S35] |
| Size | Objects should generally be 300 mm or larger [S34]; build up to 2400 x 2400 x 1000 mm [S30] |
| Post | Plan to mill the coarse surface back; leave machining stock (several mm, UNVERIFIED exact value) [S34] |
| Economics | Large-format AM suits roughly 1 to 50 parts; molding/machining wins above ~500 [S35] |

## A9. Awareness-level processes

**Ceramic printing (vat photopolymerization of ceramic slurry, binder jetting, paste extrusion).** The printer makes a fragile "green" part that must be cleaned, debinded, and sintered; dimensions change during firing, so the design must be pre-scaled and validated with the actual firing cycle [S46]. Uniform, thin sections control differential shrink and cracking; closed cavities trap slurry and hinder binder removal, so avoid them [S46]. One LCM bureau quotes 100 um minimum sintered wall, 200 um minimum hole, overhangs under 45 deg (UNVERIFIED, search excerpt) [S47]. Treat it like metal binder jetting plus brittleness: no sharp internal corners, no thin cantilevers.

**Food and chocolate printing.** Material is extruded from a heated syringe; the constraint is thermal, not mechanical: chocolate must be hot enough to flow yet set fast enough to hold shape, and tempering governs crystallization [S48][S49]. Gravity and slow solidification make tall, steep-overhang, and large models fail; vendors advise against unsupported overhangs and very large models [S49]. Food-safe hygiene and short shelf life also constrain design. Design rule of thumb: thick, self-supporting walls, low height, no bridges.

**Bioprinting.** Printability depends on bioink rheology, printing process, and scaffold design together [S50]. The design must also keep cells alive: shear stress in the nozzle, mechanical impact, heat, and laser exposure all cut viability [S51]. Pore size and interconnectivity are functional requirements (nutrient diffusion), so the "geometry" is set by biology and regulatory constraints rather than by a mechanical part. Out of scope for a general CAD agent beyond flagging these limits.

---

# PART B. Process selection and the low-cost-first ladder

## B1. Requirements-to-process decision guide

Ask these first (Formlabs' four questions: form, volume/cost, lead time, material) [S36]:

| Requirement | Points toward | Points away from |
|---|---|---|
| Quantity 1 to 10 | Desktop FDM, desktop SLA, laser cutting, bureau 3DP; FDM is cost-effective for 1 to 10 parts [S27b] | Injection molding (tooling) |
| Quantity 10 to ~1,000 | SLS/MJF (nesting), urethane casting (~50 casts per silicone mold), 3D printed injection molds (under ~500), CNC [S36][S37][S38][S27b] | Steel tooling |
| Quantity 500 to 10,000 | Aluminum-tool injection molding (USD 2,000 to 5,000 tool, 3 to 4 weeks) [S38]; sheet metal | Per-part AM if parts are simple |
| Quantity 5,000+ | Steel-tool injection molding, stamping, extrusion [S36][S39] | AM except for complex or custom parts |
| Size over ~300 mm | Large SLA (to ~736 mm), large SLS (482 mm), FDM industrial (900 mm), pellet extrusion (meters), sheet metal, CNC, split-and-join | Small-bed processes |
| Tolerance tighter than +/-0.1 mm | CNC (+/-0.125 standard, +/-0.025 feasible) [S52]; or AM plus post-machining | As-printed SLS/MJF/FDM/metal AM |
| Smooth cosmetic surface | SLA, PolyJet, injection molding, urethane cast from SLA master | FDM, SLS, MJF as-printed |
| Functional polymer, tough, snaps, hinges | SLS/MJF nylon, injection molded PP/PA, FDM PETG/ABS/ASA [S16] | Standard SLA resin (brittle) |
| Elastomer | PolyJet (Shore 30 to 95A), SLS/MJF TPU, urethane casting, silicone molding, FDM TPU [S25-service][S37] | |
| Metal, complex internal channels | DMLS/SLM [S18] | CNC (tool access) |
| Metal, cheap, simple, moderate strength | Sheet metal, CNC, binder jet [S20] | DMLS |
| High temperature or chemical resistance | PEEK/PEI (FDM, CNC), metal, high-temp resins | PLA, standard resin |
| Lead time under 3 days | In-house FDM/SLA/laser; bureau 3DP (1 to 5 days) [S30]; printed molds (1 to 3 days) [S38] | Tooling (weeks to months) |
| Lowest budget | Desktop FDM, laser cutting, hand finishing | DMLS, steel tooling |

Relative cost and lead time (indicative, plastics):

| Process | Setup cost | Cost per part | Sweet-spot quantity | Lead time | Source |
|---|---|---|---|---|---|
| 3D printing (general) | $ | $$$ | ~1 to 1,000 | under 24 h in-house | [S36] |
| CNC machining | $$ | $$$$ | ~1 to 5,000 | under 24 h to days | [S36] |
| Polymer (urethane) casting | $ | $$ | ~1 to 1,000 | days; ~10 days from master to parts | [S36][S37] |
| Vacuum forming | $ to $$$$ | $ to $$$ | any | 1 day to weeks | [S36] |
| Injection molding, 3D printed mold | under USD 100 mold | low | under 500 | 1 to 3 days | [S38] |
| Injection molding, aluminum | USD 2,000 to 5,000 mold | low | 500 to 10,000 | 3 to 4 weeks | [S38] |
| Injection molding, steel | USD 10,000 to 100,000 mold | $ | 5,000+ | 4 to 8 weeks to parts; 2 to 4 months per Formlabs table | [S38][S36] |
| Rotational molding | $$$ | $$ | ~200 to 5,000 | days to weeks | [S36] |
| Extrusion | $$$ | $ | 1,000+ | weeks | [S36] |

Breakeven example: one Formlabs case put SLA vs injection molding breakeven at about 13,050 parts for a small latch with a USD 3,600 tool plus USD 0.32 per part (vendor-authored, so treat as optimistic for AM) [S53]. Hubs gives aluminum tools from USD 3,000 to 5,000 lasting 5,000 to 10,000 cycles, simple tools USD 250 to 1,000, side actions adding 15 to 30%, recommended minimum molding run ~500 units, typical 6 to 10 weeks to parts [S39]. Disagreement: Formlabs aluminum tool USD 2,000 to 5,000 vs Hubs USD 3,000 to 5,000; use USD 3,000 to 5,000 as the conservative planning number.

## B2. "Make it work before you make it pretty": the low-cost-first ladder

Order is rough cost and difficulty from cheapest to most committed. The guiding principle: prove function on the cheapest rung that can test the question being asked, then climb only when a requirement (volume, strength, finish, tolerance) forces it. Each rung lists what changes in the CAD when moving up from the rung below.

### Rung 1. Desktop FDM
- Good for: form, fit, function checks, jigs, enclosures, first iterations; hours per print; ~USD 1 to 10 of material.
- Design notes: covered by the FDM lane. Keep in mind the FDM habits that will NOT transfer upward: varying wall thickness, sharp internal corners, zero draft, undercuts, holes printed undersize and drilled.

### Rung 2. Desktop resin (MSLA/SLA)
- Good for: small precise parts, cosmetic models, snap and fit checks at small scale, master patterns for silicone molds, molds for low-volume injection molding [S37][S38].
- Changes from FDM: add drain holes to hollows (two, 3.5 mm or larger) [S11]; plan support side and tilt; thinner walls allowed (0.6 to 1.0 mm); tighter clearances (0.2 mm per side slip fit) [S30]; resin is brittle, so add fillets to snap-fit roots; include washing and curing in the process.
- Cost/quantity: printer USD hundreds to a few thousand; parts cents to dollars; 1 to tens of parts.

### Rung 3. Laser cutting (acrylic, plywood, MDF, thin sheet)
- Good for: flat panels, faceplates, gaskets, tab-and-slot boxes, stencils, 2D brackets; minutes per part.
- Changes from 3D: everything becomes 2D profiles of one stock thickness; joints become tab-and-slot, finger joints, or fastened; bends need living hinges (kerf patterns) or separate parts.
- Headline DFM rules (for a later laser package):
  - Kerf: CO2 and fiber kerf typically 0.1 to 0.3 mm, compensated in the file or CAM [S54][S55]; Ponoko machine tolerance +/-0.12 mm plus material kerf [S56]; UPenn shop quotes nominal 0.007 in (0.18 mm) and notes it grows with thickness [S57].
  - Tab-and-slot press fit: tab = slot + 2 x kerf + 2 x overlap, overlap ~0.025 to 0.05 mm for acrylic, 0.05 to 0.10 mm for MDF; measure stock and test-cut first [S57].
  - Material thickness tolerance: cast acrylic commonly +/-10% (secondary sources, UNVERIFIED); Xometry states sheet thickness tolerance follows raw stock, independent of cut tolerance [S58][S21]. Design slots to measured thickness, or add flex (compliant tabs).
  - Minimum feature (sheet metal service): Xometry: hole-to-edge 2 x MT or 0.125 in, whichever smaller; hole-to-hole 6 x MT or 0.125 in, whichever smaller; corner fillet 0.5 x MT or 0.125 in, whichever smaller; tab at least 0.063 in or 1 x MT, whichever greater; slot at least 0.040 in or 1 x MT, whichever greater; relief cuts at least 0.010 in or 1 x MT [S58]. SendCutSend: holes, slots, cutouts ~50% of MT; min part ~1 x 2 in [S59]. Disagreement: hole at least 1 x MT (Xometry slot rule, Hubs sheet metal, Geomiq) vs 0.5 x MT (SendCutSend). Conservative: **hole and slot at least 1 x MT**.
  - Laser cut edge tolerance +/-0.010 in (0.25 mm) on the top face; thick stock tapers; holes under 0.100 in may be oversize on top [S21]. Hubs gives laser cutting tolerance 0.05 mm (machine capability) [S60].
  - Thick-stock taper: put the narrow (exit) side inside the assembly for faceplates [S56].
- Cost/quantity: makerspace or desktop CO2 laser; bureau from a few dollars per part; 1 to thousands.

### Rung 4. UV printing (flat graphics on parts)
- Good for: labels, logos, front-panel legends, color graphics directly on flat or gently curved printed, cut, or molded parts; replaces stickers and pad printing at low volume.
- Changes: provide a flat, upward-facing graphic zone with limited height variation; printhead gap is the limit, and large height differences cause blur, overspray, and head strikes; deep recesses under-cure [S61]. Use primers for adhesion on low-energy plastics (PP, PE); avoid heavy ink on sharp height transitions [S61]. Fixture parts flat.
- Cost/quantity: bureau or makerspace; per-job setup; good from 1 to hundreds. Exact maximum height and minimum line width are machine-specific: UNVERIFIED.

### Rung 5. Vinyl / craft cutting
- Good for: decals, masks for painting, labels, simple gaskets and adhesive shapes.
- Rules: strokes at least ~3 mm (1/8 in), text at least ~6 to 10 mm tall for clean weeding (single decal vendor, UNVERIFIED) [S62]; convert text to outlines, weld overlapping paths, avoid duplicate paths, add weeding boxes [S63].
- Cost: very low; minutes.

### Rung 6. Desktop CNC routing (wood, plastics, PCB-style aluminum)
- Good for: plywood and HDPE structures, panels thicker than a laser can cut, soft aluminum plates.
- Changes from laser: internal corners now carry the end-mill radius; add dogbone or T-bone reliefs where square parts must seat into a pocket; minimum hole and slot width equals the tool diameter (SendCutSend routed parts: 0.125 in min hole) [S59]; dogbone joints and tool-diameter spacing guidance (UNVERIFIED excerpt) [S64]; fixture with tabs or vacuum; deep narrow slots need long tools that chatter.
- Cost: router USD hundreds to a few thousand; stock cost dominates.

### Rung 7. Sheet metal services (laser cut and press-brake bent)
- Good for: brackets, chassis, enclosures, covers in aluminum and steel; strong and cheap at low volume.
- Changes from printed or routed parts: one uniform thickness throughout; every 3D shape is a flat pattern plus bends.
- Rules [S60]: thickness 0.5 to 10 mm for laser cutting, 0.5 to 6 mm for bending; inside bend radius at least material thickness; bend reliefs at least MT wide; flange length at least 2 x MT + bend radius; holes at least MT in diameter, at least 2 x MT apart, at least MT from edges, at least 2 x MT from the start of a bend. (Hubs lists K-factor as 0.3 to 0.5, average 0.4468; it is dimensionless despite the page's mm label.) Xometry default tolerances: +/-0.015 in edge-to-bend and bend-to-hole, +/-0.030 in across bends and overall formed, +/-1 deg bend angle [S21]. Finishing adds roughly: bead blast +5%, powder coat +15%, anodize +20% [S60].
- Cost/quantity: bureaus (SendCutSend, Xometry, Protolabs) quote from 1 piece; days.

### Rung 8. Urethane casting and silicone molds
- Good for: 10 to a few hundred production-look parts in rigid or rubbery urethanes; molded-quality surfaces from an SLA or CNC master.
- Changes from printing: master pattern must be smooth (SLA preferred), parting line chosen, gates and vents considered; walls 1.5 to 4 mm (absolute min 1 mm) [S37]; ribs can be ~60% of wall [S37]; screw-boss wall equals hole diameter [S37]; draft 1 to 2 deg recommended (xometry.pro excerpt, UNVERIFIED); undercuts are OK because the mold is flexible [S37].
- Numbers: ~50 casts per silicone mold (up to 300 to 500 with HTV silicone); mold USD 200 to 1,000; parts USD 10 to 100; ~10 days lead time; tin-cure silicone shrinks 1 to 4%; max ~50 cm and 1.5 kg [S37]. Xometry: tolerance +/-0.010 in or +/-0.003 in per inch, whichever larger; expect +0.15% shrink; sharp corners and text round slightly [S21].

### Rung 9. Low-volume injection molding (3D printed molds, desktop press)
- Good for: tens to hundreds (sometimes thousands) of parts in real thermoplastics (PP, TPE, PE, POM, ABS) for functional testing and pilot runs.
- Changes: this is the rung where injection-molding DFM becomes mandatory (see "FDM enclosure to injection molding" below). Printed molds add: mold inserts ~10 mm thick, held in an aluminum frame; avoid thin mold sections; print molds flat on the plate; machine the parting line to reduce flash; use release agent [S38][S65].
- Numbers: mold under USD 100, 1 to 3 days, ideal under 500 parts [S38]; mold life from ~10 shots (PA at 270 C) to hundreds (PP, TPE, POM at lower temperature) [S38]; case results 60+ ABS and 100+ PP parts per mold, one study 1,000 PP parts with a multi-material mold, another 1,500 to 2,500 shots per insert [S65]; desktop press about one-tenth the cost of an industrial press, 3 to 5 minute cycles [S65].

### Rung 10. Service-bureau SLS / MJF
- Good for: functional nylon parts at 10 to a few thousand, no tooling, complex geometry, living hinges, snap fits, print-in-place assemblies.
- Changes from FDM: no supports, so overhangs and internal channels are free; add escape holes; make walls uniform and 1 to 4 mm; avoid large flat plates; leave 0.6 to 0.7 mm for print-in-place moving parts [S8][S13]; expect a grainy matte, dye black for looks.
- Cost/quantity: per part pricing depends on bounding volume and nesting; becomes efficient as quantity rises [S27b]; lead time from ~5 days [S30].

### Rung 11. CNC machining services
- Good for: tight tolerances, metal strength, heat resistance, production-material prototypes, low to medium volume.
- Headline DFM rules (for a later CNC package) [S52]:
  - Internal vertical corner radius: larger than 1/3 of pocket depth; same radius everywhere to avoid tool changes; floor edges sharp or 0.1 mm / 1 mm radius; use undercut reliefs where a square corner is required.
  - Pocket depth: recommended 4 x pocket width; feasible up to 10 x tool diameter.
  - Walls: metal 0.8 mm recommended (0.5 mm feasible); plastic 1.5 mm recommended (1.0 mm feasible).
  - Holes: standard drill sizes; depth 4 x diameter recommended, 6 x maximum (typical).
  - Threads: length 3 x diameter; M6 and up preferred, M2 feasible.
  - Small features 2.5 mm recommended, 0.5 mm feasible.
  - Undercuts: width 3 to 40 mm in standard increments, depth up to 2 x width, clearance 4 x depth.
  - Tolerances: +/-0.125 mm standard, +/-0.025 mm feasible; Xometry default +/-0.005 in metal / +/-0.010 in plastic per ISO 2768 unless noted, 125 Ra as-machined, edges deburred by default [S21].
  - Setups: design for one or two setups on a 3-axis mill; otherwise split the part; 3+2 and continuous 5-axis cost more; mill-turn is cheapest 5-axis for round parts.
  - Typical envelope: milling 400 x 250 x 150 mm, turning 500 mm dia x 1000 mm.
  - Pick the cheapest material that meets requirements [S52].

### Rung 12. Production injection molding (aluminum then steel tools)
- Good for: 500 to millions; lowest cost per part, best repeatability.
- Rules: see transition list below; tolerance +/-0.25 mm typical, down to +/-0.125 or +/-0.025 mm on request [S39]; Xometry: mold +/-0.005 in plus +/-0.002 in per inch for shrink, part-to-part repeatability under +/-0.004 in [S21].

### Transition checklist: FDM-printed enclosure to injection molding

| Change | Rule | Source |
|---|---|---|
| Uniform walls | Keep nominal wall in the material's range; ABS 1.14 to 3.56 mm, PC 1.02 to 3.81 mm, PP 0.64 to 3.81 mm, nylon 0.76 to 2.92 mm (converted from inches) | [S66] |
| Thickness transitions | Chamfer or fillet over a length of 3 x the thickness difference | [S39] |
| Draft | 1 deg per 1 in of depth (Protolabs) vs 2 deg minimum on all vertical walls, +1 deg per 25 mm over 50 mm tall, +1 to 2 deg for texture (Hubs). Conservative: Hubs | [S66][S39] |
| Ribs | Protolabs: 40 to 60% of adjacent wall; Hubs: at most 0.5 x wall, height under 3 x thickness, spacing at least 4 x thickness. Conservative: 50% | [S66][S67][S39] |
| Bosses | Wall 40 to 60% of surrounding wall (Protolabs); OD = 2 x screw or insert nominal size, ID = screw core diameter (Hubs); connect bosses to walls with ribs | [S67][S39] |
| Radii | Inside radius at least 0.5 x wall; outside radius = inside + wall (about 1.5 x wall) | [S39] |
| Undercuts | Remove, or use shutoffs, a moved parting line, bump-offs (30 to 45 deg lead, up to ~5% of diameter, not for fiber-filled), or side actions (+15 to 30% tooling cost) | [S39] |
| Snap fits | Draft the snap walls; thickness above 0.5 x wall | [S39] |
| Gate and ejector marks | Expect ejector pin witness marks on the core side and a gate vestige (tab gate vestige within 0.005 in; hot tip ~0.050 in dia); keep both off cosmetic faces; gating, ejection, knit lines are the molder's choice unless specified | [S66][S21] |
| Coring | Core out thick sections; no solid FDM-style infill blocks | [S66] |
| Tolerances | +/-0.25 mm default | [S39] |

---

# PART C. Design for Excellence (DfX)

DfX is a family of concurrent-engineering methods that build downstream lifecycle goals (manufacture, assembly, cost, quality, reliability, service, environment) into the earliest design decisions [S68][S69]. Each discipline below has a definition, 3 to 6 checklist questions an agent can answer from the CAD and BOM, and what changes for a **small-run 3D printed product** (roughly 1 to 500 units, printed parts plus bought electronics and fasteners).

### Design for Manufacturing (DfM)
Shape the design to fit the chosen process's real capabilities so cost, lead time, and defect risk stay low [S69].
- Is the process chosen for the quantity and requirements (Part B), and are all features within that process's table (Part A)?
- Are tolerances justified, with tight tolerances only on functional interfaces? [S69]
- Are standard tooling and stock sizes used (drill sizes, sheet gauges, thread sizes)? [S52][S69]
- Are walls uniform and transitions filleted?
- Does every hollow have escape holes, and every support region tool access?
- Small-run 3D printing: orientation, support side, and print time are the "tooling"; design so one orientation serves all critical faces, and keep parts inside one build volume or split them with alignment features.

### Design for Assembly (DfA)
Reduce assembly time, cost, and errors, mainly by cutting part count [S70].
- Boothroyd-Dewhurst minimum-part test, for each part: must it move relative to its neighbors; must it be a different material (insulation, seal, window, conductor); must it be separate for assembly access or service? A part that fails all three is a candidate to merge or delete [S70][S71]. Fasteners usually fail all three [S71].
- Can it assemble top-down along one axis, without flipping? [S70]
- Are parts self-locating (tabs, slots, pins) so no holding step is needed? [S70]
- Are parts fully symmetric or obviously asymmetric, so orientation errors are impossible (poka-yoke)? [S70]
- Can screws become snap fits, integral hinges, or press fits? Are fastener types standardized? [S70]
- Small-run 3D printing: consolidation is nearly free in AM (print hinges and clips in), but keep a serviceable split; use heat-set inserts instead of printed threads below M6 [S15]; add keyed features so the board, battery, and lid only go in one way.

### Design for Reliability (DfR)
Make the product perform its function under stated conditions for a specified time [S72].
- Are safety factors applied to the worst-case load, with printed-part anisotropy (weak Z) considered? [S69][S32]
- Will the material survive the environment (heat, UV, moisture, chemicals, creep)? [S69]
- Are stress concentrations filleted, especially at snap-fit roots and boss bases?
- Is there a failure mode and effects analysis (FMEA) for the top risks? [S69]
- Has a printed sample been aged or cycled (thermal, drop, fatigue)?
- Small-run 3D printing: print orientation is a reliability decision; resin parts drift dimensionally over days [S29] and creep; prefer SLS/MJF nylon or PETG/ASA over standard resin or PLA for long-life loaded parts.

### Design for Cost (Design to Cost)
Meet a target cost while keeping function [S69].
- Has a target unit cost been set, and is each part quoted (instant quotes) [S69]?
- Is part count minimized and are standard components used? [S69]
- Is the process matched to volume (no tooling for 20 units, no per-part AM for 20,000)? [S36]
- Is material the cheapest that meets requirements? [S52]
- Are finishes (anodize +20%, powder coat +15%) and tight tolerances only where needed? [S60]
- Small-run 3D printing: cost drivers are bounding-box volume and Z height (powder processes), print time and supports (FDM/SLA), and labor for post-processing; nest-friendly shapes and fewer supports pay off immediately.

### Design for Sustainability (Environment)
Minimize environmental impact across materials, use, and end of life [S69].
- Are materials recyclable or bio-based, and are dissimilar materials separable (no overmolding plastic onto metal unless required)? [S69]
- Is mass minimized (hollowing, ribs, lattices)? [S69][S13]
- Is the product repairable, so failure of one part does not scrap the whole?
- Is power consumption minimized for electronic products? [S69]
- Small-run 3D printing: print only what is needed (no inventory), reuse powder (MJF/SLS recycle unfused powder) [S14], avoid support-heavy orientations, mark the polymer type on each part.

### Design for Testability (DfT)
Make it practical to test and validate the product and subsystems [S69].
- Can each subsystem be tested on its own before integration? [S69]
- Are test points, debug ports, and programming headers reachable with the enclosure closed or with one cover removed? [S69]
- Are there clear reference surfaces and pass/fail criteria? [S69]
- Is there a built-in self-test or status indicator? [S69]
- Small-run 3D printing: add a removable test hatch or pogo-pin access hole in the printed housing; design a printed test fixture alongside the product.

### Design for Serviceability / Maintainability
Make it fast to diagnose and repair [S69].
- Can wear items (batteries, filters, belts) be replaced without full disassembly? [S69]
- Are fasteners reachable, standard, and few in type? [S69]
- Are there visible wear indicators or self-diagnostics? [S69]
- Is a service document or exploded view part of the deliverable? [S69]
- Small-run 3D printing: printed threads strip on repeated service, so use metal inserts at every screw that a user will remove; keep spare printable part files with version labels embossed on the part.

### Design for Inspection
Make critical features easy to measure in production and in the field [S69].
- Are critical dimensions directly measurable with calipers, gauges, or CMM (no calculated dimensions)? [S69]
- Are datum features clear and physically present? [S69]
- Is there a go/no-go gauge or printed check fixture for key fits?
- Small-run 3D printing: add a measurable witness feature (a printed reference block or coupon) to each build to catch shrink and calibration drift.

### Design for Safety
Identify and remove hazards for users and service staff [S69].
- Are sharp edges and pinch points removed or guarded? [S69]
- Are moving parts, heat, and electrical hazards covered, and do fail-safes exist? [S69]
- Are warnings and labels present where needed? [S69]
- Are ergonomic and chemical exposure risks considered? [S69]
- Small-run 3D printing: printed plastics can be flammable (check UL 94 rating needs for mains-powered products), resin parts must be fully cured before skin contact, and battery compartments need venting and strain relief.

### Design for Supply Chain
Reduce single-source and procurement risk [S69].
- Is every bought part available from more than one source, in stock, and not end-of-life?
- Is fastener variety limited (Xometry suggests 20 to 40 unique types, a few lengths each, for large products) [S69]?
- Are printed parts printable on more than one machine or bureau (no exotic resins)?
- Small-run 3D printing: keep an approved alternate material and process for each printed part (for example MJF PA12 alternate to SLS PA12) and record supplier part numbers in the BOM at selection time.

### Design for Compliance
Identify regulatory and standards needs at the start (electrical safety, EMC, medical, material restrictions) [S69].
- Which standards apply (UL/IEC safety, FCC/CE EMC, RoHS/REACH, food contact)?
- Do enclosure materials meet flammability and food-contact needs?
- Small-run 3D printing: printed enclosures may not carry the flammability ratings of molded resins; verify grade and documentation before selling.

### Design for Quality
Robust designs that work under normal variation [S69].
- Are mechanisms robust to the process's full tolerance band (stack-up done with Part A tolerances)?
- Are proven materials and processes used? [S69]
- Small-run 3D printing: design fits with adjustable or compliant features (crush ribs, flexures) so normal print variation does not reject parts.

---

# Sources

Accessed 2026-11-12 unless noted. "Excerpt" = read through a search-index excerpt, not a full page fetch.

| # | URL | Used for |
|---|---|---|
| S1 | https://www.protolabs.com/resources/design-tips/7-mistakes-to-avoid-when-designing-3d-printed-parts/ and https://www.protolabs.com/resources/design-tips/how-to-design-for-nylon-3d-printing/ | DMLS/SLA feature table, nylon walls, channel gaps, warp threshold, hollowing |
| S2 | https://www.protolabs.com/resources/design-for-3d-printing-toolkit/ | Min wall, small gap, max size tables per material; text depth; inaccessible surfaces |
| S3 | https://www.protolabs.com/services/3d-printing/stereolithography/ | SLA build size, layer, features, holes, tolerances |
| S4 | https://www.protolabs.com/services/3d-printing/selective-laser-sintering/ | SLS build, layer, walls, tolerance, finishes |
| S5 | https://formlabs.com/support/Design-specifications-for-3D-models-Form-4-generation/ | Form 4 SLA rules and tolerances |
| S6 | https://formlabs.com/support/Design-specifications-for-3D-models-form-3/ | Form 3 drain hole 2.5 mm (excerpt) |
| S7 | https://formlabs.com/support/Design-Specs/ | Form 2 values, drain hole 3.5 mm, cupping (excerpt) |
| S8 | https://formlabs.com/white-papers/fuse-series-sls-design-guide/ | Fuse SLS rules, escape holes, clearances, orientation, warp |
| S9 | https://www.protolabs.com/services/3d-printing/multi-jet-fusion/ | MJF build, walls, tolerance, finishes |
| S10 | https://www.protolabs.com/services/3d-printing/direct-metal-laser-sintering/ | DMLS build, layer, features, tolerance, post-processing |
| S11 | https://www.hubs.com/knowledge-base/how-design-parts-sla-3d-printing/ | SLA rules incl. drain holes, clearances, hollowing |
| S12 | https://www.hubs.com/knowledge-base/how-design-parts-sls-3d-printing/ | SLS rules, tolerance, shrink scaling |
| S13 | https://www.hp.com/us-en/printers/3d-printers/learning-center/how-to-design-3d-print-model.html | HP MJF walls, clearances, warpage, hollowing (excerpt) |
| S14 | https://www.protolabs.com/en-gb/resources/blog/designing-a-part-for-multi-jet-fusion/ | MJF wall 0.8 / 2.5-4.0, hollowing, pitfalls (excerpt) |
| S15 | https://endeavor3d.com/wp-content/uploads/2025/06/HP-MJF-Design-Handbook_Special-Edition.pdf | HP MJF min specs, threads, snap fits (excerpt of HP handbook) |
| S16 | https://www.hubs.com/knowledge-base/selecting-right-3d-printing-process/ | Process selection, accuracy, build size, layer tables |
| S17 | https://www.hubs.com/guides/metal-3d-printing/ | Metal PBF rules, post-processing costs |
| S18 | https://www.protolabs.com/resources/design-tips/how-to-design-and-manufacture-metal-3d-printed-parts/ | 45 deg, 0.5 mm overhang, 8 mm channels, machining allowance |
| S19 | https://www.protolabs.com/resources/guides-and-trend-reports/metal-3d-printing-materials-guide/ | DMLS Ra values (excerpt) |
| S20 | https://www.hubs.com/knowledge-base/how-design-parts-binder-jetting-3d-printing/ | Binder jet rules, shrink, density |
| S21 | https://www.xometry.com/manufacturing-standards/ | Default tolerances, Ra, feature limits for all processes; sheet, CNC, IM, urethane |
| S22 | https://xometry.pro/wp-content/uploads/2024/05/EN-EU-MJF-Design-Guide.pdf | MJF drain holes 5 mm, two holes (excerpt) |
| S23 | https://www.desktopmetal.com/uploads/81-00239_Rev01_EN_Binder-Jet-Design-Guide.pdf | Binder jet shrink up to 20%, overhang 10-15 mm (excerpt; full fetch redirected) |
| S24 | https://www.azoth3d.com/design-guidelines/binder-jetting | Binder jet walls, holes, aspect ratios |
| S25 | https://www.hubs.com/knowledge-base/how-design-parts-material-jetting-3d-printing/ | PolyJet rules |
| S25-service | https://www.protolabs.com/services/3d-printing/polyjet/ | PolyJet build, features, tolerance, Shore range |
| S26 | https://www.materialise.com/en/academy/industrial/design-am/stainless-steel-ss316l | Metal walls, holes, 45 deg, escape holes, tolerance classes |
| S27 | https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing | Process pitfalls, machining allowance, general rules |
| S27b | https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide | Wall ranges, tolerance ranges, FDM 1-10 parts guidance |
| S28 | https://www.materialise.com/en/academy/industrial/design-am/pa12-sls | SLS PA12 walls, clearances, tumbling (excerpt) |
| S29 | https://jlc3dp.com/help/article/3d-printing-design-guideline | Size-scaled walls, clearances, escape holes, tolerances, build sizes, SLA drift |
| S30 | https://www.makelab.com/design-guidelines | Cross-process table incl. FGF; fit clearance table |
| S31 | https://markforged.com/resources/blog/threading-the-needle-with-ease | Continuous fiber minimum widths |
| S32 | https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/fiber-reinforcement-strategies | Fiber placement strategies |
| S33 | https://markforged.com/resources/blog/design-for-additive-manufacturing-dfam | DfAM principles (qualitative) |
| S34 | https://ceadgroup.com/resources/blog/guidelines-for-large-format-3d-printing/ | LFAM nozzle sizes, min object and detail size (excerpt) |
| S35 | https://www.fictiv.com/articles/large-format-3d-printing | Pellet bead width, large-format tolerance and economics (excerpt) |
| S36 | https://formlabs.com/blog/guide-to-manufacturing-processes-for-plastics/ | Process comparison table, decision questions |
| S37 | https://formlabs.com/blog/vacuum-casting-urethane-casting-polyurethane-casting/ | Urethane casting rules and economics |
| S38 | https://formlabs.com/blog/low-volume-injection-molding/ | Low/mid/high volume molding table, printed mold use (excerpt) |
| S39 | https://www.hubs.com/guides/injection-molding/ | IM draft, ribs, bosses, radii, undercuts, cost, lead time |
| S40 | https://www.3dmag.com/3d-wikipedia/iso-astm-52900-3d-printing-vocabulary-standard/ | ISO/ASTM 52900 categories (excerpt) |
| S41 | https://wohlersassociates.com/terminology-and-definitions/the-seven-am-processes/ | Seven AM processes (excerpt) |
| S42 | https://www.iso.org/obp/ui/#iso:std:iso-astm:52910:ed-1:v1:en | ISO/ASTM 52910 scope (excerpt) |
| S44 | https://formlabs.com/blog/how-to-post-cure-3d-prints/ | Post-cure shrink compensation (excerpt) |
| S45 | https://blog.honzamrazek.cz/2022/06/getting-perfectly-crisp-and-dimensionally-accurate-3d-prints-on-a-resin-printer-fighting-resin-shrinkage-and-exposure-bleeding/ | Resin linear shrink 0.3-0.6% (excerpt, hobby source) |
| S46 | https://3dceram.com/ceramic-sla-3d-printing-the-essential-guide/ | Ceramic green part, firing, cavities (excerpt) |
| S47 | https://coreceramic3d.com/blog/custom-ceramic-3d-printing.php | LCM numbers (excerpt, UNVERIFIED) |
| S48 | https://www.sciencedirect.com/science/article/abs/pii/S0260877417302753 | Chocolate printing platform study (excerpt) |
| S49 | https://3dprint.com/236829/benefits-and-limitations-of-3d-printing-chocolate/ | Chocolate thermal and overhang limits (excerpt) |
| S50 | https://pmc.ncbi.nlm.nih.gov/articles/PMC8572712/ | Bioprinting printability factors (excerpt) |
| S51 | https://www.researchgate.net/publication/372727114 | Bioprinting cell stresses (excerpt) |
| S52 | https://www.hubs.com/guides/cnc-machining/ | CNC design rules |
| S53 | https://formlabs.com/blog/race-to-1000-parts-3d-printing-injection-molding/ | Breakeven example (excerpt) |
| S54 | https://rpmfast.com/blogs-laser-cutting-tolerances-material-limits-design/ | Kerf 0.1-0.3 mm, hole >= thickness (excerpt) |
| S55 | https://jdlinnovations.au/tools/tolerance-guide | Laser kerf and tolerances (excerpt) |
| S56 | https://www.ponoko.com/blog/digital-manufacturing/laser-cutting/laser-cut-metal-mistakes/ and https://help.ponoko.com/en/articles/9358110-ponoko-manufacturing-standards | Kerf taper, machine tolerance (excerpt) |
| S57 | https://medesign.seas.upenn.edu/index.php/Guides/LaserCuttingFits | Tab/slot press-fit formula and overlaps (excerpt) |
| S58 | https://www.xometry.com/resources/sheet/sheet-cutting-tips/ | Laser/waterjet feature rules |
| S59 | https://sendcutsend.com/blog/understanding-small-geometry-in-laser-cutting/ | 50% thickness holes, min part, routed min hole |
| S60 | https://www.hubs.com/guides/sheet-metal-fabrication/ | Sheet metal bend, hole, flange rules; finish cost adders |
| S61 | https://kingjetprinter.com/how-to-print-on-uneven-surfaces-with-uv-flatbed-printer/ | UV printing height and curing limits (excerpt) |
| S62 | https://www.decals.com/c/how-small-can-a-vinyl-decal-be-design-limits-readability-and-cutting-tips | Vinyl stroke and text minimums (excerpt) |
| S63 | https://sassydigitizing.com/blog/vector-art/vinyl-cutting-vector-files | Vinyl cut-file rules (excerpt) |
| S64 | https://toolstoday.com/learn/advanced-cnc-joinery-techniques | Dogbone joints (excerpt) |
| S65 | https://formlabs.com/white-papers/low-volume-rapid-injection-molding-with-3d-printed-molds/ | Printed mold case data (excerpt) |
| S66 | https://www.protolabs.com/resources/design-tips/injection-molding-basics/ | IM draft, wall ranges, rib ratio, gate vestige |
| S67 | https://www.protolabs.com/resources/design-tips/improving-part-design-with-uniform-wall-thickness/ | Rib/boss 40-60% (excerpt) |
| S68 | https://www.sciencedirect.com/topics/engineering/design-for-x | DfX definition (excerpt) |
| S69 | https://xometry.pro/en/articles/design-for-x/ | DfX disciplines and checklist items |
| S70 | https://www.dfma.com/design-for-assembly.asp | DFA principles, minimum part criteria, checklist, poka-yoke |
| S71 | https://www.wevolver.com/article/dfma-design-for-manufacturing-and-assembly-explained | DFA criteria wording, fasteners (excerpt) |
| S72 | https://neuronicworks.com/blog/dfx/ | Reliability definition (excerpt) |

Also opened but yielding no usable numbers: protolabs.com/resources/design-tips/ (index), protolabs.com/resources/design-aids/ (gated downloads), formlabs.com/blog/design-for-manufacturing-with-3d-printing/ (qualitative only), xometry.com/resources/design-guides/ index and its CNC, IM, urethane, laser guides (gated ebooks), xometry.com/resources/design-guides/design-guide-binder-jet-metal-3d-printing/ (gated).

Count: 72 numbered source entries; about 40 pages fully fetched and about 32 read as search excerpts.

---

# Gaps

1. **Not fetched:** xometry.com/technical-resources/, xometry.com/materials/, xometry.com/finishes/, protolabs.com/resources/guides-and-trend-reports/ (index only seen in search), EOS design guidelines, Shapeways and Sculpteo material rules (only search excerpts). Xometry design guides are behind lead-capture forms; not filled per privacy rules.
2. **Desktop Metal binder jet PDF** redirected to another site; its numbers (20% shrink, 10 to 15 mm overhang, 25% scale) are from the search excerpt only. HP Metal Jet design guide not found.
3. **Metal PBF overhang:** Hubs value read as 50 deg in an ambiguous extraction; 45 deg is confirmed by Protolabs and Materialise.
4. **Fuse SLS emboss vs engrave mapping:** the extraction gave two value sets; which is embossed and which is engraved is unconfirmed.
5. **MJF escape hole size** (5 mm, two holes) comes from a Xometry PDF excerpt; HP's own handbook value not confirmed.
6. **Continuous-fiber composite** tolerances, max build, and hole minimums not found; Markforged composites design guide page was not fetched in full.
7. **PolyJet** escape-hole rule and gloss vs matte finish behavior not confirmed on a primary page.
8. **Large-format pellet** machining allowance not found; tolerance figures come from one bureau (Makelab) and one general article.
9. **UV printing:** no vendor-neutral numbers for maximum height variation or minimum line width; only qualitative guidance.
10. **Vinyl cutting** minimums from one decal vendor; not authoritative.
11. **Laser cutting material thickness tolerance** (cast acrylic +/-10%) comes from secondary retailer and forum sources.
12. **Desktop MSLA (LCD) printers** have no vendor-neutral design spec found; Formlabs values (laser SLA) were used as proxies, with bureau values as conservative defaults.
13. **ISO/ASTM 52910** read at scope level only; standard text is paywalled.
14. **Ceramic, food, and bioprinting** covered from excerpts only, per the awareness-level brief.
15. **Cost figures** (tooling, casting, molds) are vendor-authored and dated; treat as order-of-magnitude.
