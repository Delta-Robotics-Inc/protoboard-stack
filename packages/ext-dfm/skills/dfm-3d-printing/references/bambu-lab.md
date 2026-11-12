# Bambu Lab printers: vendor reference data

Public vendor reference data for one common printer family, read when a Bambu
Lab model is named. The shipped profile assumes no printer model
(`machine.family` is `generic`, 0.4 mm nozzle), and the design rules do not
depend on a model; this file gives what does once a model is known: build
volume, enclosure and chamber heat (which materials are possible), nozzle
options, pause behavior, multi-material limits and plate textures. Machine data
is also in `profiles/printers-bambu-lab.json` with a `confirmed` flag per
field. Data for other printer families can be added the same way.

Lineup as listed on https://bambulab.com/en/compare, accessed 2026-11-12.
Specs read on a Bambu spec page or official spec PDF are marked confirmed;
others came from search excerpts, forums, third parties or a Bambu overview
page (marked "unconfirmed"). The follow-up pass
(`docs/specs/dfm-research/08-skipped-sources-addendum.md`) read the spec pages
and PDFs the first pass missed. This file never starts, uploads or sends a
print; a person does.

## 1. Lineup

| Model | Build volume, mm (W x D x H) | Nozzle max C | Bed max C | Enclosure, chamber | Nozzles: default / options | Multi-material | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 mini | 180 x 180 x 180 | 300 | 80 | open bed slinger | 0.4 / 0.2, 0.6, 0.8 | AMS lite | confirmed (https://bambulab.com/en/a1-mini/tech-specs); AMS count unconfirmed |
| A1 | 256 x 256 x 256 | 300 | 100 | open bed slinger | 0.4 / 0.2, 0.6, 0.8 | AMS lite | confirmed (https://bambulab.com/en/a1/tech-specs) |
| A2L | 330 x 320 x 325 | 300 | 80 | open bed slinger | stainless; 0.4 / 0.2, 0.6, 0.8 | AMS lite and 2nd-gen AMS, up to 19 colors | confirmed (https://bambulab.com/en/a2l/specs); the household-power reason for the 80 C bed unconfirmed |
| P1S | 256 x 256 x 256 | 300 | 100 | enclosed, not actively heated | stainless; 0.4 / 0.2, 0.6, 0.8; CF and GF filled filaments not recommended | AMS | confirmed (spec PDF, https://store.bblcdn.com/s7/default/9e9c1948dd61491199a52c3f1497b9c7/bambu-lab-P1S-tech-specs.pdf; the /en/p1/tech-specs page returns 404) |
| P2S | 256 x 256 x 256 | 300 | 110 | enclosed, about 50 C by flap-controlled airflow, no active heater stated | hardened steel 0.4 / 0.2, 0.6, 0.8 | AMS 2 Pro (4 spools, drying) | confirmed (https://bambulab.com/en/p2s/specs) except the 50 C chamber, which is on the overview page only (https://bambulab.com/en/p2s) |
| X1 Carbon | 256 x 256 x 256 | 300 | 110 at 220 V, 120 at 110 V | enclosed, no active heater | hardened steel; 0.4 / 0.2, 0.6, 0.8 | AMS | confirmed (spec PDF, https://public-cdn.bambulab.com/store/X1-Carbon%20tech%20specs.pdf; the /en/x1/tech-specs page returns 404) |
| X2D | 256 x 256 x 260 main nozzle; 235.5 x 256 x 256 auxiliary or both | 300 | 120 | enclosed, actively heated 65 C | hardened steel 0.4 / 0.2, 0.6, 0.8 | 2 nozzles (auxiliary for easy-remove supports); AMS | confirmed (https://bambulab.com/en/x2d/specs); 50 micron motion accuracy from https://bambulab.com/en/x2d |
| H2S | 340 x 320 x 340 | 350 | 120 | enclosed, active 65 C | 0.4 / 0.2, 0.6, 0.8 | AMS | confirmed (https://bambulab.com/en/h2s/tech-specs) |
| H2D | 325 x 320 x 325 single; 300 x 320 x 320 both nozzles | 350 | 120 | enclosed, active 65 C, flame-retardant chamber | 0.4 / 0.2, 0.6, 0.8 | 2 nozzles; AMS 2 Pro, AMS HT | confirmed (https://bambulab.com/en/h2d/tech-specs) |
| H2D Pro | 325 x 320 x 325 single; 300 x 320 x 320 both nozzles | 350 | 120 | enclosed, 65 C chamber | tungsten-carbide; sizes not captured | 2 nozzles; AMS options not read | confirmed by a targeted extract (https://bambulab.com/en-us/h2d-pro/tech-specs) except nozzle sizes and AMS |
| H2C | 325 x 320 x 320 left; 305 x 320 x 325 right; 300 x 320 x 320 dual | 350 | 120 | enclosed, active 65 C | hardened steel; 0.2, 0.4, 0.6, 0.8; no mixed diameters in one print | 1 fixed left hotend + 6 induction hotends right (7); TPU to 85A | bed, nozzle and chamber confirmed (https://bambulab.com/en/h2c/specs); hotends from the buying guide (https://bambulab.com/en/support/buying-guide); build volumes and nozzle sizes SNIPPET |
| H3C | 330 x 320 x 325 | 350 | 120 | enclosed, active 65 C, HEPA and carbon filter | hardened steel 0.4 / 0.2, 0.6, 0.8; mixed diameters supported | 9-tool changer; AMS 3H plus external AMS, up to 24 colors | buying guide confirmed; retail availability unconfirmed |

The R1 named on bambulab.com is a CO2 laser cutter, not a 3D printer, and is
not part of this lineup.

**Material consequences:** ABS, ASA and PC need an enclosure; open printers
(A1 mini, A1, A2L) are PLA, PETG and TPU machines. Across-layer strength of ABS
and PC improves markedly with an actively heated chamber (ABS 54 to 75 percent,
PC Blend 65 to 77 percent of in-layer strength, MEASURED,
https://www.cnckitchen.com/blog/does-a-heated-chamber-make-your-3d-prints-stronger),
so a 65 C chamber model (X2D, H2S, H2D, H2D Pro, H2C, H3C) justifies the
higher Z fraction in [materials](materials.md); a passive enclosure does not.
Measured chamber air on other makers' printers: an unheated enclosure reached
about 40 to 45 C, an actively heated one about 60 C, and the bed surface
differed from its display by up to about 14 C (MEASURED,
https://toms3d.org/2026/02/10/the-prusa-core-one-l-is-so-hot-right-now-does-it-handle-engineering-filaments-better-than-the-h2c/).
Large ABS or PC parts need a heated chamber.

## 2. Nozzles, layers, line width

| Setting | Value | Source |
| --- | --- | --- |
| Default nozzle | 0.4 mm on every model | lineup above |
| Layer height for a 0.4 mm nozzle | 0.08 to 0.28 mm | https://wiki.bambulab.com/en/software/bambu-studio/layer-height (VENDOR) |
| Default first layer | 0.2 mm | same |
| Stock line widths, 0.4 mm nozzle | 0.42 mm default, outer wall, top surface, solid infill and support; 0.45 mm inner wall and sparse infill; 0.5 mm first layer | Bambu Studio's official process profiles (VENDOR): https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/process/fdm_process_common.json and https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/process/fdm_process_single_0.20.json |
| Stock compensation | XY hole compensation 0; elephant's foot compensation 0 in the common profile, 0.15 mm in the 0.20 mm single-nozzle profile | same profiles (VENDOR) |
| Recommended line width range | 0.75 to 1.5 x nozzle; the wiki page gives no default number | https://wiki.bambulab.com/en/software/bambu-studio/parameter/line-width (VENDOR) |
| Line width, 0.6 / 0.8 nozzle | about 0.62 / 0.82 mm | https://calibr.pro/tables/nozzle-size-layer-height-chart/ (SNIPPET); not read in a Bambu profile |
| Usable layer height | about 1/4 to 3/4 of the nozzle (a quality range, not a strength range); a 0.6 mm nozzle is happiest at 0.2 mm | PRACTITIONER, https://www.youtube.com/watch?v=WgXM2zPusXo |
| House line width for design | 0.45 mm (1.125 N), unchanged | PrusaSlicer default and Bambu's own inner-wall width; rounds walls up, the safe side |

Design implications: walls in multiples of about 0.42 to 0.45 mm (two lines
about 0.85 to 0.9 mm; on stock Bambu settings a two-perimeter wall is one 0.42
outer plus one 0.45 inner line, about 0.87 mm); Z features in multiples of
0.2 mm print cleanest; with a 0.6 or 0.8 mm nozzle every rule in
[FDM rules](fdm-rules.md) recomputes from `machine.nozzle`. The house formula
(`line.width` = 1.125 x nozzle) was kept after the Bambu values were
confirmed: it matches Bambu's inner-wall width, which makes up most of a
structural wall, and it rounds walls up.

## 3. Pause at a layer

- In Bambu Studio, right-click the "+" on the layer slider and choose Add
  Pause. The printer stops **before** printing that layer and waits for a
  manual resume (VENDOR, https://wiki.bambulab.com/en/software/bambu-studio/view-slicing-information).
- The pause G-code is `M400 U1` (SNIPPET, Bambu forum).
- The bed stays heated while paused (SNIPPET); users report the nozzle cooling
  and oozing (UNVERIFIED; the follow-up pass found nothing more on nozzle and
  bed behavior during a pause).
- Bambu's own tip: pause at layer 1 to remove flow-calibration lines on large
  first layers (VENDOR).
- Filament (color) change at a layer is on the same slider (UNVERIFIED in
  this research; standard Bambu Studio feature).
- Which layer to pick and how to design the cavity: [hardware](hardware.md)
  section 5.

## 4. Multi-material

- **AMS limits:** TPU cannot go in the AMS (except "TPU for AMS", 63D; AMS HT
  and 3H have bypass ports for 85A to 95A); PETG-CF and ABS are not
  recommended for AMS lite; generic PA-CF and PET-CF are too brittle or
  abrasive; PVA only when dry
  (https://wiki.bambulab.com/en/general/filament-guide-material-table).
- **Purge waste:** each change purges into the chute plus into infill,
  supports or a sacrificial object (VENDOR,
  https://wiki.bambulab.com/en/software/bambu-studio/reduce-wasting-during-filament-change);
  users report waste exceeding the part mass (85 g print, 250 g waste,
  SNIPPET). Design rule: minimize color changes per layer, group colors by Z
  height (a color band on a geometric step), and prefer multi-nozzle machines
  (H2D, H2C, H3C, X2D) for many changes.
- **Support interfaces:** "Support for PLA", "Support for PLA/PETG" and PVA;
  PLA and PETG bond poorly, so each serves as interface for the other (VENDOR
  and SNIPPET). The X2D's auxiliary nozzle exists for easy-remove supports.
  A soluble or breakaway interface allows zero top gap and clean undersides;
  without one, Bambu uses about a 0.2 mm top Z gap.

## 5. Plates: the bed face as a cosmetic face

| Plate | Bottom face it gives | Note |
| --- | --- | --- |
| Textured PEI (standard on most models) | uniform textured finish | glue may be needed for PC, PA, ABS, ASA |
| Smooth PEI | smooth matte | Bambu says it improves Z precision and suits tight-fit parts |
| Dual-Texture PEI | either side | |
| Engineering Plate | smooth | all Bambu filaments |
| Cool Plate SuperTack | | |

Source: https://wiki.bambulab.com/en/filament-acc/acc/plates (VENDOR). The
256 mm plates are shared across X1, P1, A1, P2S and X2D (SNIPPET); H2C plates
are reported not to fit H2D (SNIPPET).

A textured plate can make the largest show face of a product-look part; first
layer squish affects its look. Keep text and fine islands off it (they shift),
except deliberate inlaid first-layer text, which is a styling decision for
**cad-style** and must still be proven with a coupon.

## 6. Files

- Bambu Studio imports 3MF, STL, STEP, AMF, OBJ (and SVG) (VENDOR, H2D
  manual). A Bambu Studio 3MF stores geometry plus process, filament and
  printer settings, orientation and plate layout.
- Deliver STEP for editing and a 3MF in the intended orientation for printing,
  with variants on named plates. Publishing (for example to MakerWorld) is a
  person's action and has its own rules (one print photo per profile, cloud
  slicing checks compatibility).

## 7. What the design assumes by default, and what to ask

Assume, unless told otherwise, and write the assumption down:

- No printer model (the shipped `machine.family` is `generic`): design to a
  bed common desktop printers share (for example 256 x 256 mm, the bed of
  several models in section 1; a 180 mm cube when a small printer such as the
  A1 mini is possible), 0.4 mm nozzle, 0.2 mm layers, PLA, a textured plate,
  no multi-material unit, no soluble support, slicer hole and contour
  compensation 0. When a Bambu Lab model is named, use its row in section 1.
- A tuned printer (house clearances); if the user says the printer is new or
  untuned, use the unknown-printer clearances.

Ask, when the answer changes the design:

1. Which model (build volume; enclosure and chamber for ABS, ASA, PC; multi-
   nozzle for supports or color)?
2. Which nozzle, if not 0.4 mm (every geometry rule recomputes)?
3. Which material, if the part is warm, outdoors, preloaded, flexing or
   impact-loaded?
4. Is an AMS or a soluble or breakaway support interface available?
5. Which plate (textured vs smooth bottom face)?
6. Will the part go to someone else's printer or a service (use unknown-printer
   values)?
