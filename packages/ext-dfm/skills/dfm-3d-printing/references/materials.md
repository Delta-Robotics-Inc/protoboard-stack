# FDM materials and how they change the design

Material choice changes geometry: section depth, which way the layers run,
clearances, whether an insert holds, whether a flexure survives. This file
gives the comparison, the per-material design adjustments, a selection guide,
the ease-of-printing ranking and the default. Field-by-field values with
sources and tags are in `profiles/materials-fdm.json`.

Tags as in [FDM rules](fdm-rules.md): MEASURED, VENDOR, PRACTITIONER, DERIVED,
UNVERIFIED, SNIPPET.

## 1. Read data sheets with care

Vendor data sheets are not comparable one to one, and the most common trap is
across-layer (Z) strength:

| Source | Specimen state | Effect on the numbers |
| --- | --- | --- |
| Bambu Lab technical data sheets (V3, 2025 to 2026) | **annealed and dried** before test, printed on an enclosed X1-Carbon, 100 percent infill | Best case; Z values optimistic, especially ABS and ASA (https://wiki.bambulab.com/filament-acc/abs-asa-pc/bambu_pla_basic_technical_data_sheet.pdf) |
| Polymaker data sheets | as printed, but ABS and PC specimens printed in a **90 C environment** | ABS and PC Z values reflect a hot chamber most printers do not have (https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/abs-asa/polylite-tm-abs.md) |
| Prusament data sheets | as printed; "vertical" means printed on edge, still loaded along layers | Their vertical column is not layer adhesion; only the in-house "interlayer adhesion" number is (https://prusament.com/wp-content/uploads/2022/10/PLA_Prusament_TDS_2021_10_EN.pdf) |
| CNC Kitchen hooks and coupons | as printed on open printers | Closest to a typical print; the conservative case (https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament) |

**Rule:** when a design depends on Z strength, use the lower of the vendor Z
value and the open-printer ratio (roughly 30 to 55 percent of XY), never the
annealed vendor value (70 to 90 percent). On untuned stock profiles the
ratios were lower still (PLA 0.40 to 0.48, PETG 0.35; single samples,
MEASURED, https://www.youtube.com/watch?v=a6m_GnN5j4c), and across-layer
**impact** strength was only about 0.25 of in-layer for both PLA and PETG
(same source; `strength.z.impact.fraction` in `profiles/fdm.json`): impact
loads must never cross the layers. Bambu V3 absolute tensile values are
also low across the board (PLA Basic 35 MPa vs Polymaker 52 and Prusament 51),
so use them for ratios and heat deflection, not absolute strength.

## 2. Comparison

Z = conservative across-layer fraction of in-layer strength on an open printer
unless noted. HDT at 0.45 MPa. Snap strain = allowable strain, one-time /
repeated. Ease 1 easiest. Clearance = per-side addition to the profile's fit
clearances.

| Material | Z | HDT C | Service limit C | Creep | Snap strain | Enclosure | Hardened nozzle | Dry | Ease | Clearance per side |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PLA | 0.5 MEASURED | 55 to 60 VENDOR | 45 to 50 DERIVED | high MEASURED | 2% / 1% DERIVED | no | no | optional | 1 | 0 (baseline) |
| PLA Tough+ | 0.5 DERIVED (vendor annealed 0.6) | 61 | 45 to 50 | high (modified PLA creeps) MEASURED | about 2% UNVERIFIED | no | no | optional | 1 | 0 UNVERIFIED |
| PLA Matte / Silk | poor (Z impact half of PLA) VENDOR | 53 to 58 | 45 | high | avoid | no | no | optional | 1 | 0 UNVERIFIED |
| PLA-CF | 0.5 DERIVED (vendor annealed 0.68) | 55 | 45 to 50 | high | avoid | no | yes | recommended | 3 | 0 UNVERIFIED |
| PETG | 0.45 MEASURED (0.35 for an unknown printer) | 68 to 78 | 60 to 65 | medium MEASURED | 2.5% / 1.25% DERIVED | recommended | no | recommended (HF required) | 2 | +0.05 VENDOR |
| PCTG | 0.45 UNVERIFIED | 76 UNVERIFIED | 60 to 65 | medium UNVERIFIED | at least PETG UNVERIFIED | no | no | recommended | 2 | +0.05 UNVERIFIED |
| PETG-CF | 0.45 DERIVED | 74 | 60 to 65 | medium | avoid | recommended | yes | recommended | 3 | +0.05 UNVERIFIED |
| ABS | 0.5 open, 0.7 heated chamber MEASURED | 87 to 100 | 80 to 85 | medium MEASURED | about 2% / 1.2% UNVERIFIED | required | no | recommended | 5 | +0.1 VENDOR |
| ASA | 0.3 open MEASURED (about 0.6 heated, UNVERIFIED) | 100 | 90 | medium MEASURED | about 2% / 1.2% UNVERIFIED | required (Bambu) | no | recommended | 4 | +0.1 VENDOR |
| TPU 95A | 0.8 VENDOR | n/a | about 60 (soft) UNVERIFIED | compression set UNVERIFIED | elastic | no | no | required | 5 | no source |
| PA6-CF | 0.45 VENDOR (design to wet properties) | 186 | 150+ | high unless annealed MEASURED | avoid | recommended | yes | required | 6 | no source; ream after conditioning |
| PAHT-CF | 0.5 VENDOR | 194 | 150+ | lower than PA6-CF VENDOR | avoid | recommended | yes | required | 6 | no source |
| Unfilled nylon | 0.5 UNVERIFIED | no data | no data | high MEASURED | about 4% UNVERIFIED | recommended | no | required | 9 | no source |
| PC | 0.65 open, 0.75 heated MEASURED | 93 to 117 | 100 to 110 | lowest MEASURED | about 2% UNVERIFIED | required | no | required | 7 | no source |
| PP | no data | no data | 80 to 100 UNVERIFIED | medium UNVERIFIED | best for hinges | recommended | no | light | 8 | no source |

Sources by column: Z from https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament
(PLA, PETG, ASA hooks), https://www.cnckitchen.com/blog/does-a-heated-chamber-make-your-3d-prints-stronger
(ABS, PC Blend versus chamber temperature) and the Bambu data sheets for the
CF grades and TPU; HDT and enclosure, nozzle and drying from
https://bambulab.com/en-us/filament/guide and
https://wiki.bambulab.com/en/general/filament-guide-material-table; creep from a
short-term creep study of six FDM polymers
(https://www.sv-jme.eu/?ns_articles_pdf=/ns_articles/files/ojs30/191/63073da9a438a.pdf&id=6869:
PC 3 um, CPE 33, ABS 64, PLA 91 um at 10 MPa for 3 h) and CNC Kitchen's nylon
tests (https://www.youtube.com/watch?v=u8dIpwd6tzo); snap strain for PLA and
PETG derived at https://mandarin3d.com/blog/cantilever-snap-fit-design (data
sheet strain times the molding 70 percent rule, halved for layer lines); others
from the conservative FDM reading of molded values (Fictiv, BASF, SNIPPET);
clearance from https://www.sovol3d.com/blogs/news/fdm-3d-printing-tolerances-clearances-how-to-design-parts-that-fit.
The ease ranking is a judgment from Bambu's enclosure, nozzle, drying and AMS
requirements plus CNC Kitchen's experience, not a measurement.

Print temperature: hotter is not stronger. PLA's Z strength was best near its
default (about 215 C) and fell at 195 C and above about 255 C; PETG printed at
230 C bonded its layers worse than at 250 C. Print at the filament's default
temperature (MEASURED, Prusament on an MK3 with a 0.6 mm nozzle; the strength
values were on charts, so only the trends were captured,
https://www.youtube.com/watch?v=YJdkE7A8stM).

Shrink (slicer scale, secondary calculator sources, not data sheets):
PLA +0.3 percent, PETG +0.4, ASA +0.6, PC +0.7, ABS +0.8, nylon +1.5, PP +2
(https://printfarmcalc.com/reference/shrinkage/). Calibrate with a test part.

## 3. Design adjustments per material

| Material | Change the design how |
| --- | --- |
| PLA | No thickening needed: stiffest common material. Load along layers; Z at 0.5. Root fillet on snap arms and hooks at least half the arm thickness (brittle, notch sensitive). Not for sustained preload: through-bolts with large washers rather than clamped plastic. Never above 45 to 50 C, in cars, near motors or heaters. |
| PLA Tough+ | Good for clips and snap fits at room temperature; same heat limit; no sustained preload. |
| PLA Matte / Silk | Appearance parts only; never snap fits, thin flexing arms or Z-loaded features. |
| PLA-CF | Stiff, stable brackets at room temperature. No heat or impact gain. Hardened nozzle, no 0.2 mm nozzle. Chopped-fiber filaments in general are stiffer, not stronger, usually weaker than the base polymer, with tighter tolerances; carbon-fiber filled walls are slightly conductive and weakly shield an internal antenna, glass-filled ones insulate (PRACTITIONER, https://www.youtube.com/watch?v=ct-n2lI0I9g). |
| PETG | About 30 percent less stiff than PLA: scale bending section depth by about 1.12 (cube root of 1 / 0.7, DERIVED) or accept more deflection (a one-sample spring test found about 22 percent less stiff, https://www.youtube.com/watch?v=8_adY2K-YIc; the conservative 30 percent is kept). Clearance +0.05 per side; holes print slightly small (oozes). Inserts and bosses fine to 60 C (one source reports PETG usable to about 70 to 80 C; the lower limit is kept for creep and inserts under load); heat-set inserts hold less than in PLA, so prefer self-tapping inserts or deeper engagement ([hardware](hardware.md) section 1). Glue on smooth PEI; same-material supports fuse hard. |
| PCTG | PETG rules; choose it for impact-loaded or clear parts. |
| ABS | Round all footprint corners generously; brim or mouse ears; avoid long thin flat plates; keep walls under 6 loops and infill under 50 percent (Bambu warping advice, https://wiki.bambulab.com/en/filament/abs_asa_pc). Scale about +0.8 percent. Clearance +0.1 per side. Z at 0.5 unless the printer has an actively heated chamber. |
| ASA | As ABS, plus: Z only 0.3 on an open printer, so reorient or thicken anything loaded across layers. Outdoors and UV: the material of choice. |
| TPU 95A | Wall count and infill set softness (by more than an order of magnitude in compression, section 9); avoid bridges over about 20 mm and fine detail; dry it. Use as the flexing half of a two-material part. Not in the AMS (except "TPU for AMS"). |
| PA6-CF, PAHT-CF | Design to wet properties (PA6-CF stiffness to about a third and strength to about 56 percent of dry in humid air, MEASURED). Anneal parts under sustained load; through-bolts and metal washers; re-torque after conditioning. Ream holes after conditioning. Not for flexing. |
| Unfilled nylon, PP | The FDM materials for living hinges and repeated snaps. Hinge 0.4 to 0.6 mm, hinge line a continuous strand in the layer plane. Both are hard to print (warp, adhesion, moisture). |
| PC | Best creep resistance: the choice for clamped joints and inserts under sustained load when warm; in a PC blend self-tapping inserts held much more than heat-set inserts (MEASURED, https://www.youtube.com/watch?v=lYXTiJo_FQQ). Generous footprint radii, brim (Prusament PC Blend: 4 mm brim over 5 cm), avoid thick solid sections, low fan; stress-relief anneal soon after printing. |

## 4. Selection guide

| Requirement | Pick | Trade-off |
| --- | --- | --- |
| Fastest, cheapest prototype | PLA | Fails above about 50 C, creeps, brittle in impact |
| Tight-tolerance cosmetic prototype | PLA Basic or Matte | Lowest shrink and warp; Matte and Silk have weak layers |
| Structural bracket, indoor, room temperature | PLA, or PLA-CF for stiffness | Brittle; creeps under sustained load. Bolt-preloaded or warm: PETG to 60 C, else PC or ASA |
| Structural, sustained load or heat | PC, else ASA or ABS in an enclosure | Harder printing, enclosure, warping. CF-nylon only annealed and designed to wet properties |
| Repeated flexing, living hinge | PP, unfilled nylon, or TPU as the flexing half | Hard to print. PLA and PETG living hinges failed in tens of cycles (Hubs example: 25 cycles, https://www.hubs.com/knowledge-base/how-design-living-hinges-3d-printing/) |
| Snap fit assembled a few times | PETG or PLA Tough+ (or PLA within 1 to 2 percent strain) | PETG takes more strain, PLA more stress: size the arm to the strain limit |
| Outdoor, sun | ASA | Enclosure; poor layer adhesion on open printers |
| Hot, over 60 C | ASA or ABS to 85 to 90 C; PC to 100 to 110 C; PA-CF 150 C+ | Dashboards in sun approach 100 C |
| Gasket, grip, bumper | TPU 95A (softer 85A, 90A exist) | Slow, short bridges, must be dry |
| Clear or translucent | PETG translucent, PCTG, natural PC | Slow, hot, thick single walls; translucent PETG not on a 0.2 mm nozzle |
| Food adjacent | Certified food-contact PLA or PETG grade, stainless nozzle, smooth surface, single use or indirect contact | FDM parts are not food safe by default: layer lines harbor bacteria, brass nozzles may contain lead (https://formlabs.com/blog/guide-to-food-safe-3d-printing/, SNIPPET). Tell the user |
| Impact or drop | PC, PLA Tough+, ASA/ABS, PCTG, wet PA6 | PLA and PETG are close in notched impact |
| Wear, sliding | PA12 or PAHT-CF | PA6 properties move with moisture |
| Flame rating | PC FR (V-0) or Prusament PETG V0 | Check the rated thickness against the wall (thickness not captured, UNVERIFIED) |
| Complex internals needing support | Any, with PVA or BVOH soluble support or a breakaway interface | Print time, purge, PVA must be bone dry |

## 5. PLA versus PETG for compliant mechanisms: what the research found

The common belief is "PLA is too brittle for flexures; use PETG." It is partly
right:

1. **Slow, large deflection: PETG is more forgiving.** In CNC Kitchen's hook
   test PLA failed suddenly at 73 kg; PETG failed at 55 kg but stretched rather
   than snapping (MEASURED). PETG's higher strain capacity allows about 25
   percent more design strain (2.5 vs 2 percent one-time, DERIVED).
2. **Stress-controlled fatigue: PLA is better.** A 2024 tension fatigue study
   found PLA withstands higher stress than PETG for the same life, with less
   scatter (MEASURED, https://www.mdpi.com/2073-4360/16/13/1868).
3. **In strain terms they are closer than either camp says.** At that study's
   top load level, PLA at 32.4 MPa and PETG at 20.4 MPa correspond to about 1.4
   and 1.7 percent strain (DERIVED from the study's moduli). PETG tolerates
   somewhat more strain for equal life, not dramatically more.
4. **Impact: PETG is not much better.** Notched Izod 5 vs 8.6 kJ/m2 (CNC
   Kitchen); Polymaker notched Charpy PLA 3.3 vs PETG 2.6 kJ/m2. PETG's
   toughness is a slow-load property.
5. **Creep favors PETG for flexures held deflected.** PLA creeps at room
   temperature, so a PLA latch that stays closed relaxes (MEASURED, creep
   study). PLA+ creeps too.
6. **Neither is a living-hinge material** (Hubs: nylon, PP or TPU).
7. **Practitioner flexure ranking** (no fatigue data): nylon best, PETG best
   practical, ASA works but whitens, PLA snapped after a few cycles, TPU too
   soft and takes a set (PRACTITIONER, https://www.youtube.com/watch?v=xV36ITRjP_4).
   Flexure geometry is in [hardware](hardware.md) section 9.

**Rule:** PLA flexures are fine under 1 percent strain, infrequently cycled,
not held deflected. Choose PETG or PCTG when the design needs over 1.5 to 2
percent strain, must survive over-travel, or stays deflected. Choose PP,
nylon or TPU for over about 100 cycles at hinge strains. The trade-off to state
to the user: PETG strings more, bonds hard to smooth PEI and needs drying, so
it is somewhat harder to print and slightly less accurate; it is also about 30
percent less stiff, so the flexure geometry changes. A circulating table of
cycle-count strains (PLA 0.7 percent for 10,000 cycles, PETG 1.5) is
UNVERIFIED and not used.

## 6. Ease of printing (Bambu-class printer)

Ties share a rank; a judgment, not a measurement.

1. PLA (Basic, Matte, high-speed, Tough+): no drying, no enclosure, every nozzle, AMS.
2. PETG, PETG HF, PCTG: drying recommended, stringing, plate bonding.
3. PLA-CF, PETG-CF: hardened nozzle, no 0.2 mm nozzle, AMS lite limits.
4. ASA: enclosure, some warping, less odor than ABS.
5. TPU 95A: drying required, slow, no AMS. ABS: enclosure, warping, odor and VOC.
6. PA-CF, PAHT-CF: dry and keep dry, hardened nozzle, glue, anneal. PVA and BVOH supports: drying and storage.
7. PC: enclosure, high temperatures, warping, stress-relief anneal.
8. PP: bed adhesion and high shrink.
9. Unfilled nylon: warping plus moisture.

## 7. The default and when to leave it

**Default: PLA (standard grade, such as PLA Basic) on a 0.4 mm nozzle**
(`material.default`). It is the easiest and most reliable material on any
printer, has the lowest shrink and warping (best dimensional accuracy), the
highest stiffness and in-layer strength of the common materials, the lowest
cost, every nozzle and AMS compatible, and the lowest emissions.

Leave the default, and say why, when:

- the part sees over about 45 to 50 C, outdoors, or a vehicle: PETG (to 60
  C), ASA (to 90 C, outdoors), PC (to 110 C);
- it carries sustained load or preload (bolted clamps, press fits, insert
  retention, latches that stay closed): PETG at room temperature, PC when warm;
- it must survive impact or not shatter: PETG or PCTG, PLA Tough+, ASA, PC;
- it flexes repeatedly beyond about 1 percent strain: PETG, then PP, nylon or
  TPU.

When the use is "functional but unknown", PETG is the safer second default: it
trades about 30 percent stiffness and some print quality for 15 to 20 C more
heat headroom, ductile failure and less creep. The material the user names
always wins.

## 8. Nozzle and multi-material compatibility (Bambu)

- 0.2 mm nozzle only with PLA, PETG, ABS, ASA and breakaway support; never CF or
  GF filled, wood, glow, PVA or BVOH, or TPU; PC not recommended
  (https://wiki.bambulab.com/en/general/filament-guide-material-table).
- AMS: TPU cannot go in it (except "TPU for AMS", 63D); PETG-CF, ABS and ABS-GF
  are not recommended for AMS lite; generic PA-CF and PET-CF are too brittle or
  abrasive; PVA only when dry (same source and
  https://wiki.bambulab.com/en/knowledge-sharing/tpu-printing-guide).
- PLA and PETG bond poorly to each other, so each makes a support interface for
  the other ([Bambu Lab](bambu-lab.md)).

Never drop a specified feature to suit a material; change the material or the
process instead, and say so.

## 9. Practitioner notes from a production print farm

From one print farm's videos (PRACTITIONER, with CLAIMED-TEST where it showed
a test; mostly single specimens). The record, and the claims this playbook
does not adopt, are in `docs/specs/dfm-research/10-slant-3d-videos.md`
section 6.

### 9.1 TPU 95A stiffness by infill

30 mm TPU 95A cubes, rectilinear infill, compressed to the load cell's limit
(about 5 to 6 kN), walls not stated, one cube per density (CLAIMED-TEST,
https://www.youtube.com/watch?v=3gxsLZITN2c):

| Infill | Behavior |
| --- | --- |
| 10% | buckles at once, plateau about 40 to 60 N; some permanent set |
| 20% | about 150 N before the walls buckle (about 3 times 10 percent) |
| 30% | about 400 to 600 N before collapse |
| 50% | levels at about 2,000 N; recovers fully |
| 100% | barely deforms at about 6,000 N; recovers fully |

So one grade prints soft or stiff by its internal structure: specify the shape
and a target hardness, then tune the pattern with sample prints
(https://www.youtube.com/watch?v=XtU0p-bdZMo,
https://www.youtube.com/watch?v=pZLxi9OaFLg). A TPU impact enclosure used
about 15 to 20 percent infill in the base and more in the shell
(https://www.youtube.com/watch?v=3WvN8uVnSpU). TPU prints flat and cannot be
ejected automatically, so its removal is manual and costs more (same video).

### 9.2 PETG: overhangs against layer bonding

PETG needs the part-cooling fan to print overhangs, and the fan weakens its
bond to the next layer, so a fan-heavy PETG part turns brittle: design PETG
parts with fewer overhangs than PLA parts. PETG also strings and blobs, is
harder to eject, and its gloss varies with color, so agree the color and grade
where appearance must match (https://www.youtube.com/watch?v=vE0806yUq7U).

### 9.3 Pigment and color

- **Light colors cost more in production.** White, yellow and light blue show
  burnt residue that drops from the nozzle and show every defect and
  fingerprint, so they scrap more; dark colors hide it
  (https://www.youtube.com/watch?v=NaQ_Sa1BaqU,
  https://www.youtube.com/watch?v=scv4am8kbqs,
  https://www.youtube.com/watch?v=iiCsQIN_PyQ). Dark filament also gives text
  more contrast (https://www.youtube.com/watch?v=upf9ixYtDG4).
- **White and gray (titanium dioxide) flow like paste**, need tuned
  retraction and prime, and skip at hole starts otherwise; the pigment is
  abrasive and wears a brass nozzle over a production run so white parts get
  rougher; carbon black is much finer and prints cleaner
  (https://www.youtube.com/watch?v=22p4ThOfEO0,
  https://www.youtube.com/watch?v=ZgrlGfftm0k,
  https://www.youtube.com/watch?v=m20UPm0TOto). One green dye wore a nozzle
  wide too (https://www.youtube.com/watch?v=ZgrlGfftm0k).
- **Color changes fit.** Colorant changes flow and thermal expansion, so
  settings or a fit tuned on one color can fail on another; the farm built one
  profile robust across colors after about 100 iterations
  (https://www.youtube.com/watch?v=PbGnxQifEq0). A color change alone flipped
  a marginal thin overhang (https://www.youtube.com/watch?v=EoIlALcMJB8).
  Prove tight fits per color ([test coupons](test-coupons.md) section 4).
- **Lots vary.** Spool-to-spool color varies within one product and color;
  for color-matched production use suppliers that check color with a
  colorimeter, or control lots (https://www.youtube.com/watch?v=DiupjIdI3KQ).

### 9.4 Filled filaments and nozzle wear

Carbon-fiber filament wears a brass or plain steel nozzle out in about 500 g;
use hardened steel or a gem-tipped nozzle
(https://www.youtube.com/watch?v=0rdIIvhLghw). Fine splines and small teeth in
carbon-fiber-filled prints are brittle and knock off
(https://www.youtube.com/watch?v=kQ8FkVi-Kes). Both agree with section 3's
PLA-CF row (stiffer, not stronger).

### 9.5 Other practitioner material notes

- Compression, one sample each: PLA strongest, PETG and ABS close, PA6 nylon
  far lower (moisture state not stated), TPU lowest but recovers
  ([FDM rules](fdm-rules.md) section 9.1); for blocky compressive parts PLA,
  if heat allows (https://www.youtube.com/watch?v=5CFVcPYFEiE).
- Impact, qualitative: PLA shattered, PETG and ABS broke into strandy shards
  and held together longer, TPU held together best
  (https://www.youtube.com/watch?v=rYjZvSz2O_M); ABS or nylon for striking
  faces, with metal on a wear face (https://www.youtube.com/watch?v=qDcskdl16UM).
  Consistent with section 7 (leave PLA for impact).
- UV: PLA fades fast; ABS and PETG are fairly resistant; ASA, TPU and some
  nylons are UV-rated (https://www.youtube.com/watch?v=nF5k_tmQ7k0). ASA stays
  this playbook's outdoor choice; see the claims below.
- ESD-safe and UL 94 flame-rated filaments exist for enclosures at higher cost
  (https://www.youtube.com/watch?v=MiCRp2uV1MM,
  https://www.youtube.com/watch?v=9ERY20MRJPo); check the rated thickness.
- PLA grades range from a brittle low-cost grade to a tougher grade sold as
  an ABS replacement (https://www.youtube.com/watch?v=GRlX27WgySQ; the grade
  numbers spoken are unverified).

### 9.6 Claims not adopted

These practitioner claims are not adopted; the playbook's sourced position
holds (reasons in `docs/specs/dfm-research/10-slant-3d-videos.md` section 6):
printed parts food safe if well designed and lead from brass nozzles a
non-issue (section 4, food-adjacent row); PETG, or PLA with a UV clear coat,
as the default outdoor material (sections 4 and 7: ASA; PLA out for heat and
creep); carbon-fiber nylon as strong as aluminum (section 3: chopped fiber is
stiffer, not stronger); PETG surviving a 6 ft drop as an impact claim
(section 5 item 4); PLA near hot liquids (section 7: leave PLA over about 45
to 50 C); polypropylene absorbing water from the air (section 2: drying
light).
