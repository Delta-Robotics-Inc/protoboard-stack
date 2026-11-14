# 03 - FDM Materials and How Material Choice Changes the Design

Research lane 3 of 6 for the AI CAD agent DFM playbook. Accessed 2026-11-12.
Scope: PLA family, PETG family (incl. PCTG, PETG-CF), ABS, ASA, TPU, nylon (PA6/PA12, PA-CF/GF), PC, PP, support materials (PVA/BVOH, breakaway, HIPS).

## 0. How to read the numbers (read this first)

Vendor data sheets are not comparable one to one. Always check the method before comparing.

| Source | Standard | Specimen state | Z orientation meaning | Bias |
|---|---|---|---|---|
| Bambu Lab TDS V3.0 (2025-2026 sheets) | ISO 527 / ISO 178 / ISO 179 (Charpy, mostly unnotched) | **Annealed and dried before test** (PLA 55 C 8 h, PC 80 C 12 h, PA6-CF 80 C 12 h); printed on X1-Carbon (enclosed), 100% infill | Specimen printed standing (pull across layers) | Best case. Annealed, enclosed, ideal print. Z values optimistic, especially for ABS/ASA. |
| Polymaker TDS (wiki) | ISO 527 / 178 / 179 (notched Charpy) | As printed; 2 shells, 100% infill. ABS and PC specimens printed in a **90 C environment** | Standing | ABS/PC Z values reflect a hot chamber most users do not have. |
| Prusament TDS | ISO 527-1 / 178 / 179-1; plus in-house "Interlayer Adhesion [MPa]" | As printed, stock Prusa settings, 2 perimeters | "Vertical xz" = printed **on edge**, still loaded along layers. Not a Z test. Z data only in the in-house interlayer adhesion number. | Their "vertical" column must not be read as layer adhesion. |
| CNC Kitchen hooks and coupons | Non-standard (hooks, round coupons) | As printed on open printers unless stated | Hook printed standing | Most representative of a typical open-frame print. Use as the conservative case. |

Rule for the agent: when a design depends on Z strength, use the **lower** of the vendor Z value and the CNC Kitchen Z/XY ratio (roughly 30-55% of XY for open-air prints), not the Bambu annealed value (70-90%).

Bambu V3 tensile strengths are low across the board (PLA Basic 35 MPa XY) compared with Polymaker (PolyLite PLA 52 MPa) and Prusament (PLA 51 MPa yield). Treat absolute Bambu V3 tensile values as conservative, and use them mainly for Z/XY ratios and HDT.

---

## 1. PLA family

### 1.1 PLA (standard, Bambu PLA Basic, Polymaker PolyLite, Prusament)

**Mechanical**
| Property | Bambu PLA Basic (V3, annealed) | Polymaker PolyLite PLA (as printed) | Prusament PLA |
|---|---|---|---|
| Tensile strength XY | 35 +/- 4 MPa | 52.3 MPa | 51 +/- 3 MPa yield (horizontal) |
| Tensile strength Z | 31 +/- 3 MPa (**89%** of XY) | 40.5 MPa (**77%**) | Interlayer adhesion 17 +/- 3 MPa (in-house test) |
| Young's modulus XY / Z | 2580 / 2060 MPa | 3427 / 3065 MPa | n/a |
| Flexural modulus XY | 2750 MPa | 3231 MPa | n/a (CNC Kitchen measured 3300 MPa) |
| Elongation at break XY / Z | 12.2% / 7.5% (annealed) | 6.3% / 1.8% | n/a |
| Impact | Charpy unnotched XY 26.6, notched 7.9, Z 13.8 kJ/m2 | Notched Charpy 3.3 kJ/m2 | Charpy unnotched 13 kJ/m2 |

- CNC Kitchen hook test (Prusament PLA, open MK3S): flat 73 kg, standing 40 kg = **55% of XY**. Fails suddenly after slight yield (brittle). Notched Izod 5 kJ/m2.
- Failure mode: brittle in impact and in notches; modest yielding under slow load. Elongation numbers vary from 1.8% (Polymaker Z) to 12% (Bambu annealed XY); design to the low end.

**Thermal**
- Tg 60-61 C (Bambu, Polymaker). HDT 0.45 MPa: 57 C (Bambu), 60 C (Polymaker), 55 C (Prusament). Vicat 57-63 C.
- CNC Kitchen oven sag test: starts to give at 60 C, fails at 65 C.
- Bambu wiki: not recommended in environments at about 50 C or higher.
- Practical service limit: **about 45-50 C under load**. A parked car cabin reaches 60-72 C and a dashboard can approach 100 C in extreme sun (two cabin studies, see Sources). PLA fails in a hot car.
- Annealing helps heat resistance only. CNC Kitchen (100 C, 45 min): tensile +7.5% (63.5 to 68.2 MPa), impact unchanged (5.7 vs 5.5 kJ/m2), **layer adhesion unchanged (42 kg vs 42 kg)**, but dimensions change up to 10% (shrink in XY, grow in Z). Prusa blog: HDT of PLA rises dramatically after annealing at 90 C or above, but PLA warps badly above 70 C. Bambu recommends only 50-60 C for 6-12 h (stress relief, little crystallization). Specialty "HT-PLA" grades are designed to anneal with less distortion (Polymaker HT-PLA Pro: annealed tensile XY 38.2, Z 25.0 MPa; elongation XY drops 13% to 4.3%).

**Long-term**
- Creep: worst of the common rigid materials. Dogan (short-term creep, 10 MPa, 3 h, 25 C, machined FDM specimens): PLA 91 um vs ABS 64, tough PLA 37, CPE 33, PC 3 um. CNC Kitchen spring test at only 25% of UTS: PLA crept more than unannealed PA6-CF over the first 3 days. Reddit creep data set (5-55 MPa, 4 h) also shows clear PLA creep (UNVERIFIED, page could not be read; search excerpt only).
- Counterpoint (CNC Kitchen bolt-preload test, 0.8 N m on M4, about 50% of tensile): plain PLA was in the same group as ASA and PA12 (needed one retightening in a week), while PLA+ and unannealed PA6-CF crept more. Creep ranking depends on stress state (compression under a bolt vs bending).
- Fatigue (Martins et al. 2024, R = 0.2, 7 Hz, tension): PLA has **higher fatigue strength than PETG at the same life** in stress terms, with less scatter. Applied max stresses 32.4/24.3/16.2 MPa for PLA vs 20.4/15.3/10.2 MPa for PETG (60/45/30% of each UTS). Basquin exponent PLA -0.192.
- Snap-fit allowable strain: about **2% for a one-time snap, 1% for a clip opened daily** (Mandarin 3D, derived from Bambu data and the Covestro 70%/60% rule, then halved for layer lines). Secondary blog table (FabFlow, UNVERIFIED): 1.0-1.5% allowable; 0.7% strain for 10,000 cycles.
- UV/outdoor: embrittles and discolors with prolonged outdoor use (Opsytec summary). Not for long-term outdoor.
- Moisture: saturated absorption 0.43% (Bambu, 25 C/55% RH); Prusament 0.13% in 24 h. Dimensionally stable in humidity.
- Chemical (Bambu TDS): not resistant to acid, alkali or some organic solvents; resistant to most oils and grease.

**Printing**
- Easiest material. No enclosure; with an enclosed printer open the door/lid if bed > 45 C (filament softens in the extruder; Bambu).
- Nozzle 190-230 C, bed 35-65 C (plate dependent), fan 100% (Prusament) / 50-100% (Bambu). Up to 300 mm/s (Bambu Basic).
- Bambu TDS: max overhang 55 deg, max bridge 30 mm. CNC Kitchen: overhangs fine to 55 deg, degrade at 65 deg; PLA was best at bridging of PLA/PETG/ASA.
- Shrink: about 0.3% (range 0.2-0.5%; secondary calculators, not TDS). Warping: very low.
- Drying: optional (Bambu 50-55 C 8 h).
- 0.2 mm nozzle: compatible. AMS/AMS lite: compatible.
- Support: same-material supports with about 0.2 mm top Z gap, or Bambu Support for PLA / PVA for zero gap.

**Design consequences**
- Default walls: no special thickening; stiffest common material, so thinnest sections for a given stiffness.
- Load path along layers. Use Z strength at about 50% of XY for open-air prints (CNC Kitchen 55%).
- Avoid sharp internal corners in snap arms and hooks (brittle, notch sensitive): root fillet at least half the arm thickness.
- Snap fits: 1-2% strain; flex arms printed lying flat so they bend along layers.
- Not for sustained preload (screw-clamped joints, press fits, heat-set inserts under constant load) above room temperature. Prefer through-bolts with large washers or metal inserts sized for low bearing stress.
- Never for parts above 45-50 C, in cars, near motors or heaters.

**Safety and use**: low odor. Bambu TDS lists no skin hazard. Food contact: base PLA resin can be food grade, but FDM parts are not food safe by default (layer lines trap bacteria, brass nozzles can contain lead; Formlabs guide). Flammable.

**Cost**: lowest. Prusament: EUR 25/kg PLA vs EUR 30 PETG vs EUR 35 ASA (per kg after density correction); 7.5 vs 9 cents per meter (CNC Kitchen).

### 1.2 PLA+ / tough PLA (Bambu PLA Tough+)
- Bambu PLA Tough+ (V3, annealed 50 C 8 h): tensile XY 34.9, Z 20.9 MPa (**60%**); modulus XY 1860 MPa (softer than PLA Basic 2580); elongation 9.4% XY / 9.3% Z; impact XY 80.6 unnotched, **72.3 notched**, Z 25.9 kJ/m2. HDT 61 C (0.45 MPa), Tg 61 C. Water 0.27%.
- So: about 3x the impact and 9x the notched impact of PLA Basic, but lower stiffness and lower Z tensile ratio. Same heat limit as PLA.
- Creep warning: CNC Kitchen observed PLA+ creeping in the bolt test and reports that coat hangers in modified PLA deformed while plain PLA ones did not. Impact modifiers trade stiffness and creep resistance for toughness. Do not use PLA+ for sustained preload.
- Design: good choice for snap fits and clips at room temperature (FabFlow table 1.5-2.5%, UNVERIFIED).
- "PLA+" is not a standard; formulations vary by vendor. UNVERIFIED for non-Bambu PLA+.

### 1.3 High-speed PLA, matte, silk
- Bambu bending and Z impact (Charpy unnotched, kJ/m2): PLA Basic Z 13.8; PLA Matte Z 6.6; PLA Silk Z 4.6; PLA Silk+ Z 8.5; PLA Lite Z 6. Matte and silk have roughly **half or less** of PLA Basic's layer toughness.
- PLA Matte tensile XY 30 / Z 22 MPa (73%), elongation Z 4.8% (filamentdb transcription of Bambu TDS; secondary, not read at source).
- Silk: HDT 53 C, bending modulus 2370 MPa. Cosmetic only.
- High-speed PLA: Prusament markets PLA High Speed for 20-40% faster prints with good interlayer adhesion (vendor claim, numbers UNVERIFIED). Bambu PLA Basic is itself formulated for up to 300 mm/s.
- Design: matte and silk for appearance parts only; never for snap fits, thin flex arms or Z-loaded features.

### 1.4 PLA-CF
- Bambu PLA-CF (V2, annealed 55 C 8 h): tensile XY 38, Z 26 MPa (**68%**); modulus XY 2790, Z 2160 MPa; bending modulus XY 3700 (+35% vs PLA Basic); bending strength 96 MPa; elongation XY 12.7% / Z 3.6%; impact XY 23.2, Z 7.8 kJ/m2. HDT 55 C (no heat gain). Water 0.42%.
- Bambu store comparison vs PLA Matte: tensile XY +19%, Z +4%, bending strength +68% (secondary excerpt).
- CF adds stiffness and matte finish; adds little Z strength and **no heat resistance**. Layer impact is lower than PLA Basic (7.8 vs 13.8).
- Printing: hardened steel nozzle required; 0.4 mm hardened recommended for Bambu PLA-CF (0.6 mm first choice for generic CF); **0.2 mm not compatible**; 0.4 high-flow not recommended. Bambu PLA-CF is AMS compatible; abrasive fillers wear AMS PTFE tubes over time.
- Design: use for stiff, dimensionally stable brackets at room temperature. Not for heat, not for impact.

---

## 2. PETG family

### 2.1 PETG
| Property | Bambu PETG Basic (V3, 2025 upgrade) | Bambu PETG HF (V1) | Polymaker PolyLite PETG | Prusament PETG (V0 FR grade) |
|---|---|---|---|---|
| Tensile XY | 51 +/- 1 MPa | 34 +/- 4 MPa | 50.8 MPa | 39 +/- 2 MPa yield |
| Tensile Z | 35 +/- 6 MPa (**69%**) | 23 +/- 4 MPa (**68%**) | 42.8 MPa (**84%**) | Interlayer adhesion 16.4 +/- 1.3 MPa |
| Young's modulus XY / Z | 2780 / 2550 MPa | Z 1540 MPa | 2117 / 1899 MPa | 1.7 GPa |
| Flexural modulus XY | 1950 MPa | Z 1810 MPa | 1899 MPa | n/a |
| Elongation XY / Z | 9.5% / 5.2% | Z 5.1% | 8.4% / 3.3% | 3.5% at yield |
| Impact | Charpy unnotched XY 34.2, Z 10.5 kJ/m2 | XY 31.5 (notched 6.2), Z 10.6 | Notched 2.6 kJ/m2 | Unnotched 23 kJ/m2 |
| Tg / HDT 0.45 / HDT 1.8 | 69 / 71 / 68 C | Vicat 70; HDT 69 / 62 C | 81 / 78 / 75 C | HDT 68 / 74 C (as listed) |

- Prusament PETG Recycled: interlayer 15 +/- 5 MPa; notched Charpy 12 kJ/m2.
- CNC Kitchen hooks (Prusament PETG, open MK3S): flat 55 kg (vs PLA 73), standing 25 kg = **46% of XY**. PETG "never snapped through, it just stretched", i.e. ductile, robust failure under slow load. Flexural modulus 1900 MPa = about **70% of PLA**. Notched Izod 8.6 kJ/m2 (only 1.7x PLA): ductility under slow load does not carry over to impact (strain-rate dependence).
- Failure mode: ductile under slow load, moderately brittle in notched impact.

**Thermal**: HDT 68-78 C depending on brand. CNC Kitchen sag test: gives at 80 C, fails at 85 C. Practical service limit about **60-65 C** under load. Survives a parked car cabin marginally; not a dashboard.
- Annealing: Bambu says not recommended for PETG Basic (very limited gain, shapes may deform; if needed 60-70 C, 6-12 h). Prusa blog: PETG annealed at 110 C gave the best impact results of the tested materials, but 70-90 C annealing degraded it; HDT only improved from 110 C. Polymaker: amorphous, so stress relief only (about 70 C). Conflict: Prusa positive at 110 C vs Bambu "not recommended". Conservative: do not rely on annealing PETG.

**Long-term**
- Creep: better than PLA at room temperature in published hobby tests (Reddit data set says PETG has a much lower rate of decay than PLA; UNVERIFIED). Dogan tested CPE (a copolyester close to PETG): 33 um vs PLA 91 um at 10 MPa, 3 h.
- Fatigue: Martins 2024 found PETG **lower** fatigue strength than PLA at equal life in stress terms, with steeper S-N decay and more scatter. Review (Safai et al.): about 20,000 cycles at 60% UTS for diagonal raster PETG. See Section 12.
- Snap-fit strain: about **2.5% one-time, 1.25% repeated** (Mandarin 3D). FabFlow table 2.5-3.5% (UNVERIFIED, likely optimistic).
- UV: better than PLA but not designed for permanent sun; can go soft or rubbery under continuous sunlight; under UV-C 24 h PETG lost 38% tensile vs PLA 9% (Opsytec summary of a study). Bambu PETG Basic V3 claims enhanced UV and water resistance (vendor claim).
- Moisture: saturated 0.45% (Bambu). Print quality is moisture sensitive (stringing, bubbles); PETG HF must be dried. Parts are dimensionally stable.
- Chemical: Bambu TDS same as PLA (not acid/alkali resistant; oil resistant). Not acetone smoothable (ethyl acetate works on some PET/PETG grades per Formlabs table).

**Printing**
- Easy. No enclosure required, but Bambu recommends an enclosed printer to avoid cold ambient reducing layer strength. Open door if bed > 70 C.
- Nozzle 230-260 C (Basic), bed 65-80 C, fan 0-60% (Bambu) / 30-50% (CNC Kitchen) / 50% (Prusament). Speed < 200 mm/s (Basic). Glue recommended on PEI (PETG bonds very strongly to smooth PEI).
- Bambu TDS: max overhang about 70 deg, bridge about 30 mm. Conflict: CNC Kitchen found PETG slightly worse than PLA at bridging and comparable at overhangs. Conservative: treat PETG overhang and bridge as equal to or slightly worse than PLA.
- Stringing: more than PLA (CNC Kitchen); dry it.
- Shrink: about 0.4% (range 0.2-1%, secondary). Warping low.
- 0.2 mm nozzle: compatible (PETG, PETG HF). Translucent PETG: not with 0.2 mm. AMS: compatible.
- Supports: same-material PETG supports bond hard; use Bambu Support for PLA/PETG or PLA as interface (zero top gap only with dedicated interface filament).

**Design consequences**
- About 30% less stiff than PLA: increase section by about 1.12x (cube root of 1/0.7) for equal bending stiffness, or accept more deflection.
- Better than PLA for snap fits only if designed to its higher strain allowance; in stress terms PLA is stronger.
- Good for parts that must deform before failing (bumpers, clips you do not want to snap).
- Heat-set inserts and screw bosses: OK at room temperature; better than PLA up to 60 C.
- Holes: PETG oozes, so holes print slightly undersize; plan to ream or add 0.1-0.2 mm (UNVERIFIED general practice; see tolerance lane).

**Safety**: low odor; Bambu lists no skin hazard. Food contact: PETG resin is commonly food-contact grade, but the same FDM caveats apply. Prusament PETG V0 is a flame-retardant grade.

**Cost**: low, about 1.2x PLA (Prusament EUR 30 vs 25/kg).

### 2.2 PCTG
- No primary TDS read at source. Secondary transcription (filamentcompare.com) of the MAX-G PCTG producer sheet: tensile at break 45 MPa, modulus 1755 MPa, **elongation at break 24%**, Tg 78 C, HDT 0.45 MPa 76 C. Matched PETG sheet (3DXMAX) also 45 MPa.
- Vendor claims (UNVERIFIED): much higher impact toughness than PETG (3D-Fuel says 8-12x), lower moisture uptake, better clarity, better layer adhesion (3DXTech).
- Practical reading: PCTG is a tougher, clearer PETG with similar strength and heat. Prints like PETG.
- Design: choose over PETG for impact-loaded or clear parts. Use PETG design rules otherwise.

### 2.3 PETG-CF
- Bambu table: bending strength XY 70 MPa, bending modulus 2910 MPa (+50% vs PETG Basic 1950), Z impact 10.7 kJ/m2 (same as PETG), HDT 74 C, water 0.30%.
- Needs hardened nozzle; 0.2 mm not compatible; AMS compatible but **AMS lite not recommended**.
- Design: stiffer PETG with matte finish; no meaningful heat or Z gain.

---

## 3. ABS
| Property | Bambu ABS (V3) | Polymaker PolyLite ABS (90 C chamber) | CNC Kitchen (eSUN ABS) |
|---|---|---|---|
| Tensile XY | 33 +/- 3 MPa | 33.4 MPa | 39 MPa |
| Tensile Z | 28 +/- 2 MPa (**85%**) | 29.7 MPa (**89%**) | Open: 21 MPa (**54%**); passive enclosure 23 MPa; 65 C chamber 29 MPa (**75%**) |
| Modulus | Z 1960 MPa; bending XY 1880 | XY 2247 / Z 2081 MPa | n/a |
| Elongation | Z 4.7% | XY 17.9% / Z 3.1% | ductile |
| Impact | Unnotched XY 39.3, Z 7.4 kJ/m2 | Notched 18.0 kJ/m2 | n/a |
| Tg / HDT 0.45 / HDT 1.8 | Vicat about 94, HDT 87 / 84 C | 101 / 100 / 98 C | n/a |

- Shows clearly how much chamber temperature matters: Z strength from 54% (open) to 75% (65 C chamber). Vendor 85-89% assumes an annealed or hot-chamber print. **Use 50% for open-frame, 70% for a heated chamber.**
- Failure: ductile, tough (Polymaker notched 18 kJ/m2 vs PLA 3.3).
- Thermal: HDT 87-100 C. Practical service about **80-85 C**. Good for car cabins; marginal on dashboards in extreme sun.
- Annealing: amorphous, stress relief only; Prusa found ABS and ASA "unsuitable" for annealing (no gain, warp above 110 C). Bambu lists 80-90 C 6-12 h. CNC Kitchen: plain ABS at 130 C for 112 h grew about 20% in Z and shrank 5-10% in XY.
- Creep: Dogan 64 um at 10 MPa/3 h (better than PLA 91, far worse than PC 3). Fatigue review: printed ABS life 30-55% below molded ABS.
- UV: not UV stable (yellows, embrittles); use ASA outdoors. (Bambu makes no UV claim for ABS.)
- Moisture: 0.65% saturated (Bambu). Low effect on parts.
- Chemical: dissolves in acetone (vapor smoothing possible); resists many oils (general knowledge, UNVERIFIED at source).
- Printing: **enclosure required** (Bambu: not compatible with P1P/A-series open printers). Nozzle 240-280 C, bed 90-100 C, fan 0-80% low. AMS compatible, AMS lite not recommended. 0.2 mm nozzle compatible. Shrink about 0.8% (0.6-1.6%, secondary). High warping.
- Bambu warping advice: brim, glue, chamber heat, **avoid infill above 50% and more than 6 walls**, add internal fillets or chamfers.
- Design consequences: round all footprint corners (large radius on the first-layer outline), avoid long thin flat plates, add mouse ears/brim regions, keep wall count moderate. Scale about +0.8% in slicer if precise.
- Safety: odor and styrene emissions. ABS emits more particles and more VOC species than PLA (ScienceDirect indoor study; EPA/NIOSH: use enclosures, ventilation, lower-emitting materials). Bambu: ventilate, avoid bedrooms, activated-carbon mask for long jobs, pause with children or asthmatics present.
- Cost: low-moderate, similar to PETG (UNVERIFIED exact pricing).

## 4. ASA
- Bambu ASA (V3): tensile XY 37, Z 31 MPa (**84%**); Z modulus 2120 MPa; bending XY 65 MPa / 1920 MPa; impact XY 41, Z 4.9 kJ/m2 (lowest Z impact of the common materials); HDT 0.45 MPa **100 C**; water 0.45%.
- CNC Kitchen (Prusament ASA, open MK3S, 20% fan): flat hook 57 kg, standing 17 kg = **29% of XY**; 30 C enclosure raised it 20% to 20 kg. Flexural modulus 2300 MPa. Notched Izod **18 kJ/m2** (3.6x PLA). Oven: gives at 110 C, fails at 120 C.
- Conflict: Bambu Z 84% vs CNC Kitchen 29%. Conservative: 30% open-frame, about 60-70% with heated chamber and low fan (UNVERIFIED interpolation from ABS chamber data).
- UV: designed for outdoor. Retains about 85% of tensile after 2000 h ASTM G154; 122 days outdoors without significant loss (Opsytec summary). Bambu: exceptional UV and weather resistance.
- Printing: like ABS but less warping and less odor (CNC Kitchen); Prusament ASA printed acceptably without enclosure; Bambu requires enclosure. ASA overhangs printed best of PLA/PETG/ASA in CNC Kitchen test; bridging worst. Shrink about 0.5-0.7% (secondary); visible step on Benchy floor indicates more cooling contraction. 0.2 mm nozzle compatible; AMS compatible.
- Annealing: no benefit (Prusa); stress relief about 95 C (Polymaker).
- Design: same as ABS. Thicken Z-loaded features or reorient; ASA layer toughness is poor on open machines.
- Safety: lower odor than ABS but still styrenic; ventilate.
- Cost: Prusament about EUR 35/kg equivalent (1.4x PLA); per meter same as PETG (lower density).
- ASA-CF (Bambu): XY 34 / Z 30 MPa, Z impact 9.4, HDT 110 C, bending modulus 3740.

## 5. TPU (95A and softer)
- Bambu TPU 95A HF: tensile XY 27.3, Z 22.3 MPa (**82%**); elongation **> 650% XY, > 480% Z**; Shore 92A (comparison table); tear strength Z 21.1 N/mm; rebound 30%; water 1.08%.
- Bambu grades (table, tensile XY / Shore / rebound): 75A 11.5 MPa / 76A / 50%; 85A 20.8 / 84A / 42%; 90A 25.5 / 89A / 34%; 95A HF 28.9 / 92A / 30%; TPU for AMS 16.9 MPa / **63D** (much harder).
- Ultimaker TPU 95A: tensile 23.7-37.9 MPa, > 560-700% elongation by orientation; one orientation only 82% (secondary excerpt).
- Failure: very ductile; tears rather than snaps. Excellent layer bonding.
- Thermal: HDT not applicable. Softens gradually; do not use as a rigid part near heat.
- Creep/set: elastomers take compression set under sustained squeeze (general knowledge, no TDS value; UNVERIFIED).
- Moisture: hygroscopic; **must be dried** (Bambu: 70 C 8 h; spool can widen from 65.4 to about 69.4 mm while drying).
- Printing: no enclosure. Nozzle 200-250 C, bed 30-45 C. TPU 95A HF < 200 mm/s; 85A/90A < 80 mm/s. Retraction 0.8-1.4 mm (95A HF). Bambu TPU TDS: overhang about 55 deg, **bridge only 20 mm**. 0.2 mm nozzle not recommended; 85A not compatible with 0.4 mm. **Not AMS compatible** (except "TPU for AMS" 63D, and AMS HT/3H bypass ports for 85A-95A).
- Supports: use PLA as support (Bambu); separate with alcohol in the gap.
- Design: wall count and infill set softness; 0.4-0.6 mm sections for flexing hinges/membranes work in TPU. Gaskets: design 15-30% compression (UNVERIFIED general seal practice). Avoid long bridges and fine detail. Use as the flexible half of a multi-material living hinge (Hubs).
- Cost: moderate (about 1.5-2x PLA, UNVERIFIED).

## 6. Nylon: PA6, PA12, PA-CF, PA-GF

**Data**
| Property | Bambu PA6-CF (dry, annealed 80 C 12 h) | Bambu PAHT-CF (dry) | CNC Kitchen Sunlu CF-PA6 / CF-PA12 |
|---|---|---|---|
| Tensile XY | 102 +/- 7 MPa | 92 +/- 7 MPa | about 140 MPa / about 120 MPa as printed dry |
| Tensile Z | 48 +/- 6 MPa (**47%**) | 47 +/- 5 MPa (**51%**) | "significantly reduced" when wet (PA6) |
| Modulus XY / Z | 4430 / 2170 MPa; bending 5460 / 2240 | bending 4230 | CF-PA6 about 2x as stiff as PLA dry |
| Elongation XY / Z | 5.8% / 3.7% | n/a | n/a |
| Impact | XY 40.3 (notched 13.4), Z 15.5 kJ/m2 | XY 57.5 (notched 22.8), Z 13.3 | dry PA6 absorbed 15% of hammer energy, wet over 50% |
| Tg / HDT | Tg 68 C; HDT 186 (0.45) / 164 C (1.8) | HDT 194 C | oven: PA12 softens 160, fails 170 C; PA6 softens 195, fails 205 C |
| Water | 2.35% saturated | 0.88% | PA6 up to 3%; PA12 about 0.5-0.7% |

**Moisture effect (critical)** - CNC Kitchen conditioned at about 75% RH, 35 C, 3 days (PA6 to about 3% water, PA12 to 0.7%):
- CF-PA6: stiffness fell to about **one-third** (annealed: 41% retained); strength fell to **56%** of dry; impact more than **tripled**; layer adhesion "significantly reduced".
- CF-PA12: stiffness about unchanged; strength -15% (annealed -10%).
- Bambu store: PAHT-CF wet bending XY 115 vs generic PA6-CF wet 76 MPa; wet bending modulus XY 3640 vs 2210 MPa; wet Z bending 49 vs 34 MPa.
- Polymaker: conditioning takes about 48 h humid or 2 weeks ambient; annealing slightly shrinks parts; no standard dimensional change value given (geometry dependent).

**Creep** - CNC Kitchen: unannealed CF-PA6 needed retightening of a bolt joint almost daily for a week and deformed under 25% UTS bending; annealing (110 C, 8 h) greatly reduced creep to near other polymers. PA12 crept about like PLA and ASA; annealing did not change PA12 much. Dogan: unfilled nylon showed the largest elongation (820 um in 1200 s at 10 MPa). His conclusion: for constantly loaded parts prefer fiber-reinforced ASA or PC over nylon.

**Annealing** - Polymaker 80-100 C, 6-16 h for full crystallinity (nylon is semicrystalline). Bambu PA6-CF 80-130 C, 6-12 h. CF parts warp < 0.5% on annealing (vs PLA > 10%; CNC Kitchen). Annealing did not raise CNC Kitchen's HDT result.

**Printing** - Bambu: enclosure recommended; hardened nozzle required for CF/GF; 0.6 mm recommended, 0.2 mm not compatible, 0.4 high-flow not recommended; drying **required** (80 C 8-12 h) and keep < 20% RH; glue stick; bed 100-120 C; chamber 45-60 C; speed < 100 mm/s. Only Bambu PA-CF/PAHT-CF are AMS compatible (generic PA-CF too brittle/abrasive). Fiber-filled PA prints "basically like PLA" with little warp (CNC Kitchen); unfilled PA warps significantly (shrink about 1.5%, range 0.7-3%, secondary). Polymaker Warp-Free nylon slows crystallization to cut warp.

**Design consequences**
- Design to **wet** properties for anything used in normal air: CF-PA6 stiffness about 1/3 and strength about 1/2 of TDS dry numbers. PA12-CF or PAHT-CF if stiffness must hold.
- Z strength about 50% of XY even dry; CF reinforces only the XY plane.
- Anneal PA6 parts under sustained load; otherwise expect bolt preload loss. Use metal washers and through-bolts; re-torque after conditioning.
- Use nylon for wear, high temperature (150-180 C class with CF), and impact (wet PA6 is very tough). Living hinges and snap fits: unfilled PA is the best FDM option (Hubs recommends nylon 12; FabFlow table 4-6% PA6, UNVERIFIED). CF-filled nylon is not for flexing.
- Size holes after conditioning, or ream; expect slight shrink after annealing.

**Safety**: hardened nozzle wear; CF dust from sanding (wear a mask, general practice). Cost: CF-PA6 about $50/kg (CNC Kitchen), PA12-CF higher; about 2-3x PLA.

## 7. PC and PC blends
| Property | Bambu PC (V2, annealed 80 C 12 h) | Polymaker PolyMax PC (90 C chamber) | Prusament PC Blend |
|---|---|---|---|
| Tensile XY | 62 +/- 2 MPa | 53.4 MPa | 63 +/- 1 MPa yield |
| Tensile Z | 56 +/- 2 MPa (**90%**) | 41.4 MPa (**78%**) | Interlayer 21 +/- 2 MPa |
| Modulus XY / Z | 2110 / 1450 MPa; bending 2310 | 2435 / 2149 MPa | 1.9 GPa |
| Elongation | XY 3.8% / Z 2.1% (annealed, low) | 4.5% / 2.8% | 5.8% at yield |
| Impact | XY 34.8 (notched 7.5), Z 9.0 kJ/m2 | Notched 21.3; -30 C 9.2 kJ/m2 | Unnotched no break; notched 12 |
| Tg / HDT 0.45 / 1.8 | 145 / 112 / 117 C (as printed in TDS) | 113 / 114 / 99 C | HDT 113 / 93 C |
| Water | 0.25% | n/a | 0.13% (24 h) |

- CNC Kitchen heated chamber test (Prusament PC Blend, round coupons): Z/XY 65% open, 72% passive enclosure, **77% at 65 C chamber**. PC Blend is engineered for open printers.
- Creep: **best** of tested FDM polymers (Dogan: 3 um at 10 MPa/3 h vs PLA 91). Best choice for screw-clamped joints and heat-set inserts under sustained load at temperature.
- Thermal: HDT 93-117 C. Practical service about 100-110 C. Survives dashboards.
- Annealing: needed for stress relief, not crystallinity. Polymaker: put the print into a 90 C oven immediately after printing, at least 2 h, cool slowly; otherwise layers can crack. Bambu: 85-100 C, 6-12 h.
- UV: no claim from Bambu; generic PC yellows (UNVERIFIED). Chemical: PC is attacked by some solvents and is stress-crack sensitive (general knowledge, UNVERIFIED at source).
- Flame: Bambu **PC FR rated V-0** (thickness not captured; UNVERIFIED thickness). Prusament PETG V0 is another FR option.
- Printing: Bambu: enclosure required, nozzle 260-280 C, bed 90-120 C, chamber 45-60 C, overhang about 70 deg, bridge about 40 mm, 0.2 mm not recommended, AMS compatible, drying required (80 C 8 h). Prusament PC Blend: 4 mm brim for parts over 5 cm; cooling sharply reduces interlayer adhesion. Shrink about 0.6-0.7% (secondary). Warping high.
- Design: generous corner radii on the footprint, brim, avoid thick solid sections, keep fan low. Good for tough, hot, clear (natural PC) parts.
- Prusament PC-CF: interlayer 23 MPa; HDT 114 C; modulus 2.6-3.2 GPa.
- Cost: moderate-high (about 1.5-2.5x PLA, UNVERIFIED).

## 8. PP (brief)
- Semicrystalline, very low density, hydrophobic (not hygroscopic per Xometry; Polymaker still suggests 70 C 4-6 h drying).
- Best FDM material for **living hinges** and high-cycle fatigue; Xometry: hinges as thin as 0.4 mm.
- Hard to print: low surface energy (needs PP sheet, PP packing tape or Magigoo PP), shrink about 1-3% (secondary), high warping. Polymaker: nozzle 210-230 C (pure PP), bed 50-80 C (Xometry says >= 85 C), 30-50 mm/s, brim 25-35 mm, enclosure recommended. Prusa forum: fans off.
- Excellent chemical resistance. Food-contact resin grades exist (Formlabs lists PP among food-safe-capable filaments).
- Design: hinge thickness 0.4-0.6 mm, oriented so the hinge is a continuous strand in the XY plane; large brims; avoid big flat footprints.

## 9. Support materials (PVA, BVOH, breakaway, HIPS)
- **PVA** (Bambu): water soluble; zero top interface gap possible; saturated water absorption **6.25%**; drying required (55 C 8 h oven; AMS HT 85 C 18 h) and must be kept sealed; 0.2 mm nozzle not compatible; AMS compatible only if dry. Dissolve in warm water, **max 50 C when supporting PLA** to avoid deforming the part. Dissolution takes hours; agitation helps.
- **BVOH**: same handling class as PVA in Bambu nozzle tables (dry, not 0.2 mm); dissolves faster than PVA (general claim, UNVERIFIED).
- **Breakaway** (Bambu Support for PLA, Support for PLA/PETG): interface-only use with zero top Z distance; compatible with all nozzles including 0.2 mm; AMS compatible. Bambu: without a dedicated interface filament use about 0.2 mm top Z gap.
- **HIPS** (Bambu Support for ABS is HIPS-type, UNVERIFIED composition): pairs with ABS/ASA; dissolves in d-limonene (a solvent; handle with care). Water absorption 0.14% (Bambu table).
- Design consequence: soluble support lets the agent use internal channels, captive features and flat undersides that same-material support would ruin; cost is extra print time, purge waste and drying logistics.

---

## 10. Comparison table (headline values; method notes in Section 0)

Z% = Z tensile / XY tensile. "Open" = CNC Kitchen-type open-frame print (conservative). HDT at 0.45 MPa. Snap strain = one-time / repeated.

| Material | Tensile XY (MPa) | Z% vendor (Bambu / Polymaker) | Z% open-frame (CNC Kitchen) | Flex modulus (MPa) | Elong. XY | Impact XY unnotched (Bambu, kJ/m2) | HDT (C) | Service limit (C, practical) | Creep | Snap strain | Enclosure | Hardened nozzle | Dry | Shrink % (secondary) | 0.2 mm nozzle | AMS | Ease (1 easy-10 hard) | Cost vs PLA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PLA | 35-52 | 89 / 77 | 55 | 2750-3300 | 6-12% | 26.6 | 55-60 | 45-50 | High | 2% / 1% | No | No | Optional | 0.3 | Yes | Yes | 1 | 1.0x |
| PLA Tough+ | 35 | 60 / - | n/a | 2140 | 9% | 80.6 | 61 | 45-50 | High (modified PLA creeps) | ~2% (UNVERIFIED) | No | No | Optional | 0.3 | Yes | Yes | 1 | ~1.1x |
| PLA Matte / Silk | 30 | 73 (matte, secondary) | n/a | 2360-2370 | - | 19-25 | 53-58 | 45 | High | Avoid | No | No | Optional | 0.3 | Yes | Yes | 1 | ~1.0x |
| PLA-CF | 38 | 68 / - | n/a | 3700-3950 | 12.7% | 23.2 | 55 | 45-50 | High | Avoid | No | Yes | Rec. | ~0.3 | No | Bambu only | 3 | ~1.5-2x |
| PETG | 34-51 | 69 / 84 | 46 | 1900-1950 | 8-10% | 34.2 | 68-78 | 60-65 | Medium | 2.5% / 1.25% | Rec. | No | Rec. (HF req.) | 0.4 | Yes | Yes | 2 | 1.2x |
| PCTG | 45 (secondary) | n/a | n/a | ~1755 (tensile) | 24% | n/a (claimed much higher) | 76 | 60-65 | Medium (UNVERIFIED) | >= PETG (UNVERIFIED) | No | No | Rec. | ~0.4 | UNVERIFIED | UNVERIFIED | 2 | ~1.3x |
| PETG-CF | n/a | n/a | n/a | 2910 | n/a | 41.2 | 74 | 60-65 | Medium | Avoid | Rec. | Yes | Rec. | ~0.3 | No | AMS yes, lite no | 3 | ~1.5-2x |
| ABS | 33-39 | 85 / 89 | 54 (75 at 65 C chamber) | 1880-2127 | 18% | 39.3 | 87-100 | 80-85 | Medium | ~2-3% (UNVERIFIED) | Yes | No | Rec. | 0.8 | Yes | AMS yes, lite no | 5 | ~1.2x |
| ASA | 37 | 84 / - | 29 (35 at 30 C) | 1920-2300 | n/a | 41 | 100-110 | 90 | Medium | ~2-3% (UNVERIFIED) | Yes (Bambu) | No | Rec. | 0.5-0.7 | Yes | Yes | 4 | 1.4x |
| TPU 95A | 27 | 82 / - | high | n/a (elastomer) | >650% | n/a | n/a | ~60 (soft) | Compression set | n/a (elastic) | No | No | Required | 0.6-0.8 | Not rec. | No (except TPU for AMS) | 4 | ~1.5-2x |
| PA6-CF | 102 (dry) | 47 / - | n/a | 5460 dry, ~1/3 wet | 5.8% | 40.3 | 186 | 150+ | High unless annealed | Avoid | Rec. | Yes | Required | 1.5 (unfilled) | No | Bambu only | 6 | 2-3x |
| PAHT-CF | 92 (dry) | 51 / - | n/a | 4230 dry, 3640 wet | n/a | 57.5 | 194 | 150+ | Lower than PA6 | Avoid | Rec. | Yes | Required | low | No | Bambu only | 6 | 2-3x |
| PC | 53-63 | 90 / 78 | 65 (77 at 65 C, PC Blend) | 2050-2310 | 3.8-5.8% | 34.8 | 93-117 | 100-110 | Lowest | ~2-3% (UNVERIFIED) | Yes | No | Required | 0.6-0.7 | Not rec. | Yes | 7 | 1.5-2.5x |
| PP | n/a | n/a | n/a | low | high | n/a | n/a | ~80-100 (UNVERIFIED) | Medium | Best for hinges | Rec. | No | Light | 1-3 | UNVERIFIED | UNVERIFIED | 8 | ~2x (UNVERIFIED) |
| PVA | n/a | n/a | n/a | n/a | n/a | n/a | n/a | support only | - | - | No | No | Required (6.25% water) | - | No | Yes if dry | 6 | ~3-4x (UNVERIFIED) |

---

## 11. Material selection guide (requirement to material, with trade-off)

| Requirement | Pick | Trade-off / why not the alternative |
|---|---|---|
| Fastest, cheapest prototype | PLA (Basic or high-speed) | Up to 300 mm/s, no drying, no enclosure. Fails above about 50 C, creeps, brittle in impact. |
| Tight-tolerance cosmetic prototype | PLA Basic or PLA Matte (0.2-0.4 mm nozzle) | Lowest shrink (about 0.3%) and warp. Matte/silk have weak layers (Z impact half of Basic): appearance only. |
| Structural bracket, indoor, room temperature | PLA (stiffest, strongest in XY) or PLA-CF (stiffer) | Brittle, creeps under sustained load. If preloaded by bolts or warm, go PETG (up to 60 C) or PC/ASA. |
| Structural bracket under sustained load or heat | PC (best creep), else ASA/ABS in an enclosure | Harder printing, enclosure, warping. CF-nylon only if annealed and designed to wet properties. |
| Needs to flex repeatedly (living hinge, many cycles) | PP (best), unfilled nylon (PA12/PA6), or TPU as the flexing half of a two-material part | PP and nylon are hard to print. PLA/PETG living hinges fail in tens of cycles (Hubs FDM example: 25 cycles). |
| Snap fit, assembled a few times | PETG or PLA Tough+ (or PLA at <= 1-2% strain) | PETG takes more strain; PLA takes more stress. Size the arm to the strain limit, not the material reputation. |
| Outdoor, sun exposure | ASA | Needs enclosure, layer adhesion poor on open printers (29% in CNC Kitchen test). PETG is acceptable for occasional sun; PLA embrittles. |
| Hot environment over 60 C (car cabin, near motors) | ASA or ABS (to about 85-90 C), PC (to about 100-110 C), PA-CF/PAHT-CF (150 C+) | PETG tops out around 60-65 C; PLA about 50 C. Dashboard in sun can approach 100 C: PC or PA-CF. |
| Gasket, grip, bumper, vibration isolator | TPU 95A (printable, AMS-incompatible) or softer 85A/90A | Slow printing, bridges only about 20 mm, must be dried, poor fine detail. |
| Clear / translucent | PETG (translucent grades), PCTG, natural PC | Clarity needs slow, hot, thick single walls; PC needs enclosure. Translucent PETG cannot use a 0.2 mm nozzle (Bambu). |
| Food adjacent | Certified food-contact PETG or PLA grade, stainless nozzle, smooth surface; single-use or non-direct contact | FDM parts are not food safe by default (layer lines harbor bacteria, brass nozzles may carry lead). Say so to the user. |
| Impact / drop resistance | PC, PLA Tough+, ASA/ABS, PCTG, wet PA6 | PLA and PETG are similar in notched impact (CNC Kitchen 5 vs 8.6 kJ/m2). |
| Wear / sliding parts | Nylon (PA12 or PAHT-CF) | Moisture changes PA6 properties; PA12 is more stable. |
| Electrical enclosure needing flame rating | PC FR (V-0) or PETG V0 | Verify the rated thickness against the wall thickness. |
| Chemical / fuel contact | PP, nylon (oils) | PLA and PETG not acid/alkali resistant (Bambu TDS). |
| Complex internal geometry needing support | Any + PVA/BVOH soluble support (or breakaway interface) | Time, purge waste, PVA must be bone dry. |

---

## 12. "PLA is too brittle for compliant mechanisms, PETG is better": what the data says

Stated carefully, because the evidence points in two directions depending on whether the mechanism is stress-limited or strain-limited.

1. **Under slow, large deflection PETG is more forgiving.** CNC Kitchen hooks: PLA failed suddenly at 73 kg; PETG failed at 55 kg but "never snapped through", stretching instead. PETG's higher strain capacity (Martins 2024: about 6.5% vs 4.3% elongation at break; Mandarin 3D: 3.8% vs 2.8% strain at full strength) allows about 25% more design strain (2.5% vs 2%).
2. **In stress-controlled fatigue, PLA is better.** Martins et al. 2024 (R = 0.2, tension): PLA withstands higher stress than PETG for the same life, with less scatter; PETG's S-N curve falls faster. PLA modulus about 2350 MPa vs PETG 1200 MPa in that study.
3. **In strain terms they are closer than either camp says.** A flexure imposes a deflection, i.e. strain. At the top test level, PLA at 32.4 MPa and PETG at 20.4 MPa correspond to about 1.4% and 1.7% strain using that study's moduli (my calculation). So for equal life PETG tolerates somewhat more strain, but not dramatically more.
4. **In impact PETG is not much better.** Notched Izod 5 vs 8.6 kJ/m2 (CNC Kitchen); Polymaker notched Charpy PLA 3.3 vs PETG 2.6 kJ/m2. "Tough" in PETG is a slow-load property.
5. **Creep favors PETG for preloaded flexures.** PLA creeps at room temperature (Dogan; CNC Kitchen springs), so a PLA flexure held deflected (a latch that stays closed) relaxes. Modified PLA (PLA+) creeps too.
6. **Neither is a living-hinge material.** Hubs: an FDM living hinge example lasted 25 cycles; recommends nylon, PP, or TPU.

Practical rule for the agent: PLA flexures are fine for low-strain (< 1%), infrequently cycled or stress-limited compliant mechanisms that do not stay deflected; choose PETG (or PCTG) when the design needs > 1.5-2% strain, must survive accidental over-travel, or stays deflected for long periods; choose PP/nylon/TPU for > 100 cycles at hinge-level strains. The cycle-count/strain table circulating in blogs (PLA 0.7% for 10,000 cycles, PETG 1.5%) is UNVERIFIED.

---

## 13. Ranking by ease of printing (Bambu-class printer)

1. PLA (Basic, Matte, high-speed, Tough+) - no drying, no enclosure, all nozzles, AMS.
2. PETG / PETG HF / PCTG - drying recommended, stringing, plate bonding.
3. PLA-CF / PETG-CF - hardened nozzle, no 0.2 mm, AMS lite limits.
4. ASA - enclosure, some warp, less odor than ABS.
5. TPU 95A - drying required, slow, no AMS.
5. ABS - enclosure, warp, odor/VOC.
6. PA-CF / PAHT-CF - dry and keep dry, hardened nozzle, glue, anneal.
6. PVA/BVOH supports - drying and storage.
7. PC - enclosure, high temps, warp, immediate stress-relief anneal.
8. PP - adhesion and high shrink.
9. Unfilled nylon - warp plus moisture.

(Ties share a rank. Based on Bambu enclosure/nozzle/drying/AMS requirements and CNC Kitchen experience; the ordering is a judgment, not a measurement.)

## 14. Default when nothing is known

**PLA (standard, e.g. PLA Basic), 0.4 mm nozzle.** Reasons: easiest and most reliable to print on any printer, lowest shrink and warp (best dimensional accuracy), highest stiffness and XY strength of the common materials, cheapest, compatible with every nozzle and the AMS, lowest emissions.

Switch away from the default when any of these is true (the agent should ask or infer):
- Temperature above about 45-50 C, outdoors, or in a vehicle: PETG (to 60 C), ASA (to 90 C, outdoors), PC (to 110 C).
- Sustained load or preload (bolted clamps, press fits, insert retention, latches that stay closed): PETG at room temperature; PC when warm.
- Impact or "must not shatter": PETG/PCTG, PLA Tough+, ASA, PC.
- Repeated flexing beyond about 1% strain or hinges: PETG, then PP/nylon/TPU.
If the use is "functional but unknown", **PETG** is the safer second default: it trades about 30% stiffness and some print quality for 15-20 C more heat headroom, ductile failure and less creep.

---

## 15. Design rule summary for the CAD agent (material-driven deltas)

- **Z strength factor** (fraction of XY to assume for loads across layers, conservative): PLA 0.5, PETG 0.45, ABS 0.5 open / 0.7 heated chamber, ASA 0.3 open / 0.6 heated chamber, PC 0.65 open / 0.75 heated, PA-CF 0.45, TPU 0.8. Reorient before thickening.
- **Stiffness**: PETG needs about 1.12x section depth to match PLA bending stiffness; CF-PA6 in humid air has about one-third its dry stiffness.
- **Footprint corners**: for ABS/ASA/PC/PA/PP, round outer footprint corners and add brims; Prusament PC Blend: 4 mm brim over 5 cm. No sourced maximum flat footprint exists; treat > 100 mm flat ABS/ASA/PC plates on open printers as high risk (UNVERIFIED heuristic).
- **Shrink compensation** (slicer scale, secondary sources): PLA +0.3%, PETG +0.4%, ASA +0.6%, PC +0.7%, ABS +0.8%, nylon +1.5%, PP +2%. Calibrate with a test part.
- **Snap fits**: PLA 2% / 1%; PETG 2.5% / 1.25% (one-time / repeated); taper the arm to half thickness at the tip; root fillet >= 0.5 t; print the arm lying flat.
- **Living hinges**: 0.4-0.6 mm, continuous strand in XY; only PP, nylon or TPU for real cycle life.
- **Screws and inserts under sustained load**: avoid PLA/PLA+ and unannealed PA6; prefer PC, ASA/ABS, PETG (room temperature), annealed nylon; spread clamp load with washers.
- **Temperature**: never specify PLA above 45-50 C; PETG above 60-65 C; ABS/ASA above 85-90 C; PC above 110 C.
- **Nozzle**: 0.2 mm only with PLA, PETG, ABS, ASA, breakaway support (Bambu); never with CF/GF, wood, glow, PVA/BVOH, TPU; PC not recommended.
- **Multi-material on Bambu AMS**: TPU (except TPU for AMS) cannot go in the AMS; PETG-CF, ABS and ABS-GF are not recommended for AMS lite; generic PA-CF/PET-CF are too brittle/abrasive; PVA only if dry.

---

## Sources (all accessed 2026-11-12)

| # | URL | Used for |
|---|---|---|
| 1 | https://wiki.bambulab.com/en/general/filament-guide-material-table | Nozzle, plate, AMS, enclosure, drying, 0.2 mm compatibility, PLA 50 C warning |
| 2 | https://bambulab.com/en-us/filament/guide | 42-material comparison: impact XY/Z, bending, HDT, water, TPU Shore/tensile, temps, speeds, annealing |
| 3 | https://wiki.bambulab.com/filament-acc/abs-asa-pc/bambu_pla_basic_technical_data_sheet.pdf | PLA Basic V3 full TDS, annealed test method |
| 4 | https://www.initial.fr/content/uploads/2026/10/fiche-technique-fff-petg.pdf | Bambu PETG Basic V3 TDS (mirror) |
| 5 | https://store.bblcdn.com/3a230e260a3a47c2b0db0156e07eef91.pdf | Bambu PETG HF TDS (search excerpt) |
| 6 | https://store.bblcdn.com/s7/default/23b4cf2b83d5470bb96d19970b5f3ae8/Bambu_ABS_Technical_Data_Sheet_V3.pdf | Bambu ABS V3 (search excerpt) |
| 7 | https://wiki.bambulab.com/filament-acc/abs-asa-pc/6eaf4c432d1d4014a1975e55a55ed00b.pdf | Bambu ASA TDS (excerpt) |
| 8 | https://wiki.bambulab.com/filament-acc/asacf-pahtcf/bambus_asa-cf_technical_data_sheet.pdf | Bambu ASA-CF (excerpt) |
| 9 | https://wiki.bambulab.com/filament-acc/abs-asa-pc/a52afdccddfd448583d119587122c8c5.pdf | Bambu PC TDS |
| 10 | https://store.bblcdn.com/s1/default/7130c176eac54e928d650e48d8b12d72/new_Bambu_PLA_Tough_Technical_Data_Sheet.pdf | Bambu PLA Tough+ TDS |
| 11 | https://store.bblcdn.eu/s8/default/16df21baf482453999b3dbb61cc110e7/Bambu_TPU_95A_HF_Technical_Data_Sheet.pdf | Bambu TPU 95A HF TDS |
| 12 | https://www.crea3d.com/en/?controller=attachment&id_attachment=1006 | Bambu PLA-CF TDS V2 (mirror) |
| 13 | https://store.bblcdn.com/s7/default/ecb663b46ebb4fb984786d33befb8d2f/PLA_Pure_TDS.pdf | PLA Pure (excerpt) |
| 14 | https://wiki.bambulab.com/filament-acc/petcf-ppacf/c750bddfb8e44af6ae9f7dd9625fa458.pdf | Bambu PA6-CF TDS |
| 15 | https://wiki.bambulab.com/filament-acc/asacf-pahtcf/65f1b18a6d6142d794a1a6a00f1496ef.pdf | Bambu PAHT-CF (excerpt) |
| 16 | https://us.store.bambulab.com/products/paht-cf | PAHT-CF vs PA6-CF wet/dry bending |
| 17 | https://wiki.bambulab.com/en/filament/abs_asa_pc | ABS/ASA/PC guide: enclosure, warping fixes, ventilation, PC FR V-0 |
| 18 | https://wiki.bambulab.com/en/knowledge-sharing/tpu-printing-guide | TPU grades, AMS, nozzles, drying, supports |
| 19 | https://wiki.bambulab.com/en/software/bambu-studio/support | Top Z distance with support filaments (excerpt) |
| 20 | https://us.store.bambulab.com/products/pva | PVA dissolution, 50 C limit with PLA (excerpt) |
| 21 | https://prusament.com/wp-content/uploads/2022/10/PLA_Prusament_TDS_2021_10_EN.pdf | Prusament PLA |
| 22 | https://prusament.com/wp-content/uploads/2023/07/PETG_V0_ENG.pdf | Prusament PETG V0 |
| 23 | https://prusament.com/wp-content/uploads/2022/03/8_PETG_RECYCLED_Prusament_TDS_2022.pdf | Prusament PETG Recycled |
| 24 | https://prusament.com/wp-content/uploads/2022/10/PCBlend_Prusament_TDS_2022_16_EN.pdf | Prusament PC Blend |
| 25 | https://prusament.com/wp-content/uploads/2023/04/TDS_Prusament-PCCF_2023_EN.pdf | Prusament PC-CF |
| 26 | https://prusament.com/wp-content/uploads/2021/12/7_PLA-Recycled_Prusament_TDS_2021_V4.pdf | Prusament PLA Recycled |
| 27 | https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/pla/polylite-tm-pla | PolyLite PLA |
| 28 | https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/petg-pet/polylite-tm-petg.md | PolyLite PETG |
| 29 | https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/abs-asa/polylite-tm-abs.md | PolyLite ABS |
| 30 | https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/polycarbonate/polymax-tm-pc.md | PolyMax PC |
| 31 | https://polymaker.com/wp-content/uploads/lana-downloads/TDS_Polymaker_HT-PLA-Pro_V1.4_2026-7-17_EN.pdf | HT-PLA Pro as printed vs annealed (excerpt) |
| 32 | https://wiki.polymaker.com/printing-tips/post-processing/annealing.md | Annealing by polymer class |
| 33 | https://wiki.polymaker.com/printing-tips/post-processing/moisture-conditioning.md | Nylon conditioning procedure |
| 34 | https://wiki.polymaker.com/the-basics/3d-printing-materials/pp | PP settings (excerpt) |
| 35 | https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament | PLA/PETG/ASA hooks, Z%, stiffness, impact, oven, cost |
| 36 | https://www.cnckitchen.com/blog/better-performing-3d-prints-with-annealing-but-part-1-pla | PLA annealing numbers |
| 37 | https://www.cnckitchen.com/blog/does-a-heated-chamber-make-your-3d-prints-stronger | ABS and PC Blend Z vs chamber temperature |
| 38 | https://www.youtube.com/watch?v=u8dIpwd6tzo (transcript) | CF-PA6/PA12 moisture, creep, annealing, temperature |
| 39 | https://www.cnckitchen.com/blog/pc-core-abs-testing-dual-material-filament-for-warp-less-annealing | ABS annealing distortion (excerpt) |
| 40 | https://blog.prusa3d.com/how-to-improve-your-3d-prints-with-annealing_31088/ | Annealing PLA/PETG/ASA/ABS (excerpt) |
| 41 | https://www.mytechfun.com/video/143 | Creep test method only (results in files not read) |
| 42 | https://www.sv-jme.eu/?ns_articles_pdf=/ns_articles/files/ojs30/191/63073da9a438a.pdf&id=6869 | Dogan short-term creep, 6 FDM polymers |
| 43 | https://www.mdpi.com/2073-4360/16/13/1868 | Martins 2024 PLA vs PETG fatigue |
| 44 | https://www.sciencedirect.com/science/article/pii/S0142112320305399 | Fatigue review: PLA, ABS, PETG (excerpt) |
| 45 | https://mandarin3d.com/blog/cantilever-snap-fit-design | Snap-fit strain derivation |
| 46 | https://fab.cba.mit.edu/classes/S62.12/people/vernelle.noel/Plastic_Snap_fit_design.pdf | Bayer/Covestro snap-fit guide (excerpt, 70% yield strain rule) |
| 47 | https://www.fabflow.app/blog/snap-fit-joints-3d-printing-engineering-guide | Strain/fatigue table (UNVERIFIED secondary) |
| 48 | https://www.hubs.com/knowledge-base/how-design-living-hinges-3d-printing/ | Living hinge rules, cycle counts |
| 49 | https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/ | Snap-fit material advice (excerpt) |
| 50 | https://www.xometry.com/resources/3d-printing/pp-3d-printing-filament/ | PP printing and hinges (excerpt) |
| 51 | https://filamentcompare.com/pctg-vs-petg/ | PCTG (MAX-G TDS values, secondary) |
| 52 | https://www.3dxtech.com/blogs/featured/pctg-filament-vs-petg | PCTG vendor claims (excerpt) |
| 53 | https://formlabs.com/blog/guide-to-food-safe-3d-printing/ | Food safety (excerpt) |
| 54 | https://www.epa.gov/chemical-research/3d-printing-research-epa | Emissions, NIOSH guidance (excerpt) |
| 55 | https://www.sciencedirect.com/science/article/pii/S0360132325008030 | ABS vs PLA PM/VOC (excerpt) |
| 56 | https://www.opsytec.com/uv-knowledge/uv-faq/uv-aging-of-3d-printing-materials | UV aging PLA/PETG/ASA (excerpt) |
| 57 | https://www.researchgate.net/publication/275952207_Experimental_Study_of_Interior_Temperature_Distribution_Inside_Parked_Automobile_Cabin | Dashboard approaching 100 C (excerpt) |
| 58 | http://www.enggjournals.com/ijet/docs/IJET19-11-06-020.pdf | Cabin 60-72 C (excerpt) |
| 59 | https://printfarmcalc.com/reference/shrinkage/ and https://grandpacad.com/en/tools/material-shrinkage-calculator | Shrink percentages (secondary convention) |
| 60 | https://www.filamentdb.app/filament/bambu-lab/pla-matte-matte | PLA Matte TDS transcription (secondary) |
| 61 | https://um-support-files.ultimaker.com/materials/2.85mm/tds/TPU-95A/Ultimaker-TPU95A-TDS-v5.00.pdf | TPU 95A orientation data (excerpt) |

## Gaps

1. **Creep data is thin and short-term.** No source gives creep modulus or allowable sustained stress vs time for any FDM material. MyTechFun results (PLA/PETG/ASA/nylon, with 45 C heating) live in a spreadsheet/image not read. The Reddit PLA/PETG creep data set could not be fetched. Heat-set insert pull-out after aging is not covered.
2. **No direct PLA vs PETG flexure (strain-controlled bending) fatigue test** was found; Section 12's strain comparison is my calculation from a stress-controlled tension study.
3. **Snap-fit allowable strains** for ABS, ASA, PC and nylon are from an unverified secondary table; only PLA/PETG values have a transparent derivation.
4. **Shrink percentages** come from calculator sites, not TDS. No vendor publishes FDM linear shrink.
5. **Maximum flat footprint before warping**: no sourced number for any material.
6. **PCTG, PP, BVOH, HIPS**: no primary TDS read at source (PCTG via secondary transcription; PP via Xometry/Polymaker overview only).
7. **Bambu ABS V3 thermal block** was only partly parsed (Vicat about 94 C, HDT 87/84 C mapping inferred). Bambu PC TDS lists HDT 1.8 MPa (117 C) above HDT 0.45 MPa (112 C), likely a transcription error in the source.
8. **UV data** for PETG/ASA is from an equipment vendor's literature summary, not a primary weathering study.
9. **Costs** beyond Prusament (2020-era prices in CNC Kitchen) and CF-PA6 about $50/kg are estimates; current Bambu store prices not checked.
10. **Chemical resistance** for ABS, PC, nylon and PP is general knowledge, not read from a data sheet.
11. Xometry/Protolabs FDM material pages and Markforged data were not read in full (only PP and Hubs pages); MatWeb not consulted.
12. PC FR V-0 rating thickness not captured.
