# 09 - Isogrid on FDM parts: recheck of the stiffness claim

Recheck of the claim in [06, part B.4](06-product-design-and-patterns.md): "isogrid beats a solid wall of equal
weight, never a solid wall of equal envelope". The style guide repeats it and tells the agent to treat patterns as
decorative unless analyzed. A house-style review disputes it for FDM. This note separates the baselines, works the numbers for
two realistic panels, collects measured evidence, and proposes corrected wording with file and line.

Tags: **MEASURED** (the source ran a physical test and reports numbers), **VENDOR** (company documentation or
marketing), **PRACTITIONER** (an experienced maker's advice without a test), **DERIVED** (my reasoning or arithmetic
in this note), **UNVERIFIED** (seen only in an abstract or snippet). Quotes are under 15 words.

---

## 0. Verdict in one page

The disagreement is mostly about the baseline. The earlier sentence is true for its own baseline, but it is the wrong
baseline for most FDM decisions. It also gave the agent an unhelpful rule ("decorative unless analyzed") for the most
common real use: ribs added to a thin wall.

| Comparison (flat panel, global bending) | Who is stiffer | Mass | Confidence |
| --- | --- | --- | --- |
| (a) Isotropic solid plate T vs isogrid of total depth T | Solid, by 5.4 to 6.7x | Solid is 2.0 to 2.7x heavier | High (exact NASA theory) |
| (b) Isotropic solid of equal mass vs isogrid | Isogrid, by 1.8 to 3.5x | Equal | High |
| (c) Printed "solid-looking" wall (5 top + 4 bottom layers, 10 to 20% infill) of depth T vs printed isogrid of depth T | **Printed wall, by about 2.7 to 3.9x** for house-size ribs (b 1.25 mm). Heavy ribs narrow it to 1.5 to 2x, but then the isogrid is 1.2 to 1.75x heavier. Parity only with heavy ribs plus thin, weak skins | About equal for house-size ribs (printed wall 0.87 to 1.24x the isogrid) | Medium (DERIVED, not measured) |
| (c, short span or point load, about 30 mm or less) | Isogrid can win: the sparse core's shear compliance dominates | About equal | Low to medium |
| (d) Printed 100% wall of depth T vs printed isogrid | 100% wall, by 4.6 to 5.7x | 100% wall is 2.0 to 2.7x heavier | High |
| (e) Bare skin t vs the same skin plus ribs | Ribs, by 3.6 to 27x for d = 1.5t to 4t (1.8x even at d = 1 mm) | Ribs add 26 to 113% | High |
| (e') Plain printed wall of equal mass vs printed isogrid | Isogrid, by 1.75 to 3.6x | Equal | High |

On the review's points (details in section 9):

- *Stiffer than a "solid" part in some cases:* **true** against a thinner wall, either the original thin wall or a
  plain wall of the same mass (cases e and e'). **Not supported** against a printed two-skin wall of the same depth
  (case c), except for short-span and local loads.
- *Sometimes not lighter and not less material:* **true**. Against a thin wall it is always heavier. Against a
  same-depth printed wall it is lighter only when the cells are large enough (break-even in section 6).
- *A printed solid wall is not solid; it is perimeters around sparse infill:* **true**, and it matters for material.
  But that wall gets its stiffness from its two skins, and two skins far apart beat one skin plus ribs in bending.
- *Filament runs along the ribs, so the part is much stronger and stiffer:* **partly true**. Along-bead material is
  much stronger than crossed or across-bead material (MEASURED, section 5). The modulus gain is small: crossed-raster
  skins are nearly isotropic in modulus (MEASURED). In global bending the one-sided section also puts the rib tips far
  from the neutral axis, so a printed isogrid fails at about a quarter of the bending moment of a same-depth printed
  wall (DERIVED). The strength advantage is real for local loads, nodes and fasteners. It is not real for whole-panel
  bending.
- *Large parts usually end up using slightly less material:* **true** when the cells grow with the panel. The model
  gives 3 to 19% less material than the same-depth printed wall for a 250 x 200 x 6 mm panel at 20 mm cells. The
  stiffness at that depth is still lower.
- *It looks good:* not in dispute. It is a legitimate reason to choose it, as long as the guide does not claim it as
  stiffness.

No physical test was found that compares a printed isogrid panel with a slicer-default printed wall of the same depth
or the same mass, in either direction (section 5). A coupon pair settles it (section 10).

---

## 1. Sentences to correct (file, line, current text, proposed replacement)

These files were read on 2026-11-12. None of them was edited. Line numbers refer to the current working tree.

### packages/ext-style/skills/cad-style/references/patterns.md

| Line | Current | Problem | Proposed replacement |
| --- | --- | --- | --- |
| 15-16 | "It is recorded as cosmetic in the part's notes unless an analysis or a test shows it carries load (`pattern.structural.claim`). Presenting decoration as structure is dishonest design." | Labels every pattern decorative by default, including ribs that stiffen a thin wall 4 to 27x. | "Its part note states what it replaces and what it does (`pattern.structural.claim`). Ribs added to a thin wall stiffen it (see the honest limit). A pattern cut into a wall that could have been a closed two-skin wall of the same depth is styling. A load rating needs a calculation or a coupon test. Presenting styling as structure is dishonest design." |
| 17 | "It does a job: lightening, stiffening per weight, airflow, grip, or a deliberate signature on a chosen face." | "Stiffening per weight" is ambiguous about the baseline. | "It does a job: stiffening a thin wall or lid, carrying local loads to nodes, lightening, airflow, grip, or a deliberate signature on a chosen face." |
| 56-65 (the whole "honest limit" paragraph) | "Isogrid is stiffer than a solid wall of the **same weight**, never stiffer than a solid wall of the **same overall thickness**. ... On FDM, a thick wall printed with normal infill is already a sandwich, so an isogrid gains most when the wall is printed vertically as perimeters only, ... Shallow pockets (rib depth under about one and a half skins) add almost nothing and are decoration. ..." | True for an isotropic solid. Silent on the printed baselines. The "shallow adds almost nothing" sentence is wrong: d = 1.5 t still gives about 3.6x the skin's stiffness. The "perimeters only" condition is not what limits a sandwich. | Replace with the corrected statement in section 11 (i), then: "Worked numbers (dfm-research 09): a 150 x 100 mm lid 4 mm deep (1.2 mm skin, 1.25 mm ribs, 15 mm cells) is about 8x as stiff as its bare skin and about 1.75x as stiff as a plain printed wall of the same mass. A printed wall 4 mm thick with normal skins and 10 to 20% infill is about 3.7x stiffer than the isogrid, at about the same mass. With fewer than three cells across a panel the smeared formulas over-predict." |
| 94-96 | "Leave the wall solid when ... when the pockets would be shallow, ... or when a thicker wall with sparse infill does the job in less print time." | "Shallow" is not a reason (see above). The rest holds. | "Use a closed wall instead when the part fails by layer splitting, when bending stiffness at a fixed depth is the goal (a two-skin printed wall of the same depth is stiffer at about the same mass), when the panel is too small for three cells, or when print time matters (isogrids usually print slower)." |
| 144 | "1. Stiffness per weight: isogrid." | Misleading: at a fixed depth a two-skin wall wins. | "1. Stiffening a thin wall or lid, where one face may be open or seen, loads are local or at nodes, or a mounting grid is useful: isogrid. Use ribs in one direction when bending is one-way. Maximum bending stiffness at a fixed depth: a closed two-skin wall, optionally with internal rib walls (section 11 iii)." |
| 148 | "4. Always a bounded zone with a solid border at the margin token, cosmetic unless analyzed." | Same default-decorative rule. | "4. Always a bounded zone with a solid border at the margin token, its role stated against the wall it replaces." |

### packages/ext-style/skills/cad-style/SKILL.md

| Line | Current | Proposed replacement |
| --- | --- | --- |
| 122-123 | "Record the pattern as cosmetic in the part's notes unless `pattern.structural.claim` is `analyzed` with evidence linked." | "Record in the part's notes what the pattern replaces and its role from the patterns reference: stiffening (ribs on a thin wall), local load paths, or styling (where a same-depth closed wall was the alternative). Claim a load rating only when `pattern.structural.claim` is `analyzed` with evidence linked." |
| 146 | "Every pattern in a bordered zone, labeled cosmetic unless analyzed" | "Every pattern in a bordered zone, with its role and baseline stated" |
| 168 | "... isogrid for stiffness per weight, Voronoi for an organic look under low load ..." | "... isogrid to stiffen a thin wall or lid or carry local loads (a closed two-skin wall when stiffness at a fixed depth is the goal), Voronoi for an organic look under low load ..." |
| 169 | "Cosmetic unless an analysis or a coupon test is linked; the claim is a `structural` token, never set for looks." | "The role is stated against the baseline (stiffens a thinner wall: yes; stiffer than a same-depth closed wall: no). A load rating needs an analysis or a coupon test. The claim is a `structural` token, never set for looks." |
| 210 | "Patterns sit in bounded zones with a solid border and are cosmetic unless analyzed." | "Patterns sit in bounded zones with a solid border, with their structural role stated against the wall they replace." |

### packages/ext-style/skills/cad-style/references/product-design.md

| Line | Current | Proposed replacement |
| --- | --- | --- |
| 20 | "No fake vents or screws; no decorative pattern presented as structure." | Keep the principle and make the baseline explicit: "No fake vents or screws; a pattern is called structural only for what it does against the wall it replaces." |
| 110 | "Isogrid or Voronoi on faces that carry no load, presented as structure, or cutting through a wall." | "A pattern on a face that carries no load presented as structure, a pattern claimed stiffer than the closed wall of the same depth it replaced, or a pattern cutting through a wall." |

### packages/ext-style/skills/cad-style/references/hazard-protocol-cad.md

| Line | Current | Proposed replacement |
| --- | --- | --- |
| 17-19 | "... Patterns add flair and are sometimes structural, not always." | This is a house-style statement and it is accurate; keep it. |
| 92-94 | "... where weight or print time matters, an open or skinned isogrid web ... The pattern is recorded as cosmetic unless a calculation or a coupon test shows it carries the load." | "... where weight matters, a skinned isogrid web laid out from node to load point, with solid bosses only at the bolts (it usually prints slower than a solid web). Its part note states the baseline and role; a load rating needs a calculation or a coupon test." |
| 107 | "Not decoration pretending to be structure: a pattern is cosmetic until shown otherwise." | "Not decoration pretending to be structure: a pattern's role is stated against the wall it replaces, and a load rating needs evidence." |

### packages/ext-style/themes/cad/hazard-protocol.json

| Line | Current | Proposed replacement |
| --- | --- | --- |
| 5 (end of `description`) | "Patterns are decorative unless analyzed." | "Patterns state their role against the wall they replace: ribs stiffen a thin wall, a same-depth closed wall is stiffer still, and a load rating needs evidence." |

### packages/ext-style/themes/cad/tokens.json (and the generated mirror, cad-style/references/tokens.md)

| Line | Token | Current | Proposed replacement |
| --- | --- | --- | --- |
| 56 (tokens.md 92) | `pattern.structural.claim` | values `decorativeUnlessAnalyzed`, `analyzed`; description: recorded as cosmetic unless shown to carry load | Values `roleStated` (default) and `analyzed`. Description: "roleStated: the part note names the wall the pattern replaces and its role from the patterns reference (stiffens a thinner wall, carries local loads, or styling against a same-depth closed wall), with no load rating; analyzed: a load rating, set only with a calculation, simulation or coupon test linked." Renaming the enum needs the resolver tests checked; `packages/ext-style/test/resolve-style.test.ts` does not reference this token by value today. |
| 59 (tokens.md 95 has no guard text) | `pattern.isogrid.rib.depth` guard | "Depth at most about six rib widths ... and at least about one and a half skin thicknesses (shallower adds almost no stiffness)" | "Depth at most about five rib widths (a rib with a free top edge reaches local buckling near the material's strength around d = 5b, derived; root fillets and nodes add margin). Shallow ribs still stiffen a thin skin (d = t gives about 2x the skin's stiffness), but most of the gain comes with depth." |
| 52 | `pattern.default` description | "lightening, stiffening or flair in a bounded zone" | Fine as is. |

### docs/specs/style-system.md

No sentence states or implies the claim. Line 117 lists "structural claim" as a token name only. Update it only if
the token's values are renamed. Lines 29-31 (the house isogrid convention) are accurate.

### docs/specs/dfm-research/06-product-design-and-patterns.md (the source of the claim)

| Line | Current | Proposed replacement |
| --- | --- | --- |
| 27 | "No ... decorative isogrid/Voronoi presented as structure when it is not structural." | Keep, and add: "(structural relative to the wall it replaces; see 09)". |
| 143 | "Decoration as fake structure: isogrid or Voronoi on faces that carry no load, ..." | Keep, and add: "or a pattern claimed stiffer than the closed wall of the same depth." |
| 195 | Worked example ending "a solid 5.2 mm wall ... about 6.5 times stiffer than the isogrid." | Keep the arithmetic (it is correct for isotropic material). Add: "A printed 5.2 mm wall with normal skins and 15% infill is about 3.5 to 4x stiffer than this isogrid at about the same mass (09, section 3)." |
| 196 | "Rule: isogrid beats a solid wall of equal weight, never a solid wall of equal envelope. Use it only when weight, material, or print time matters more than envelope depth." | Replace with 09 section 11 (i). Drop "print time": isogrids usually print slower. |
| 197 | "FDM-specific catch: ... an isogrid often gains little over simply making the wall thicker with sparse infill. Isogrid pays off mainly when (a) the wall is printed vertically as perimeters only, ..." | "FDM-specific: a thick printed wall is a two-skin sandwich and is stiffer in bending than a one-sided isogrid of the same depth at about the same mass (09). Isogrid pays off when depth is available but a second skin is not wanted (an open or visible back, access, mounting at nodes), when it replaces a thinner wall, and for local or short-span loads where a sparse core is shear-soft." |
| 198 | "... pockets so shallow (d/t under about 1.5) that the stiffness gain is negligible." | "... shallow ribs give a modest gain (d = 1.5 t is about 3.6x the skin), so they are worth it only if depth is constrained." |
| 211 | Print time "can take longer" | Keep. 09 estimates about 1.4 to 1.5x longer for the two example panels (DERIVED, low confidence). |
| 278 | "(1) if the job is stiffness per weight, isogrid" | "(1) to stiffen a thin wall or lid with one open face, or to carry local loads, isogrid (ribs aligned with the load when bending is one-way); for maximum bending stiffness at a fixed depth, a closed two-skin wall." |

---

## 2. Cases and assumptions

A flat panel of fixed outline in global bending. Every stiffness is a smeared bending stiffness per unit width,
D = sum of E_i times the layer's second moment about the section's neutral axis. Poisson effects are ignored; they
scale every case by nearly the same factor, so the ratios hold. E is normalized to 1 for fully dense printed material
loaded along the bead (PLA is about 3.0 to 3.5 GPa).

| Symbol | Meaning | Value used |
| --- | --- | --- |
| T | overall depth | 4 mm (G1), 6 mm (G2, G2b) |
| t | isogrid skin | 1.2 mm (6 layers); 1.6 mm in G2b |
| b | rib width | 1.25 mm (house; about 3 lines at 0.45 mm); 1.7 mm in G2b |
| d | rib depth | T - t |
| h | triangle height (rib spacing per family) | 15 mm (G1), 20 mm (G2), 25 mm (G2b) |
| Isogrid grid layer | smeared modulus (b/h) E_rib over depth d, NASA CR-124075 p. 2.0.020 | the layered model reproduces the handbook's beta^2/(1+alpha) exactly (check: 12.61 = 12.61 for 06's example) |
| E_rib | ribs printed as perimeters, beads along the rib | 0.95 |
| E_skin | flat-printed skins: solid infill, crossed rasters | 0.85 (sensitivity 0.6) |
| Printed-wall skins | top 5 layers (1.0 mm), bottom 4 layers (0.8 mm) at 0.2 mm | sensitivity: 3 + 3 layers (0.6 + 0.6 mm) |
| Sparse core | nominal 10, 15, 20%, actual density = 1.1 x nominal (CNC Kitchen weighed about 33% at 30% nominal) | |
| Core modulus | gyroid or cubic: 1.3 rho^2 (fit to Bean et al. PLA gyroid: 22% gives 6.3%, 25% gives 8.3% of solid); grid, optimistic: 0.5 rho | |
| Core shear modulus | gyroid: 0.375 E_core; grid: 0.3 rho G_s | DERIVED, rough |
| 100% printed wall | 0.85 | |
| Isogrid extra material | pocket corner fillets r = b in 60 degree corners, plus rib-root fillets 0.5 b | adds about 10% to the rib mass |
| Mass | PLA 1.24 g/cm^3, panel area only (the outline perimeters and border are the same for every case and left out) | |
| Deflection | simply supported strip, center line load, span = short side, bending plus Timoshenko shear term | |

Cases: (a) isotropic solid T vs isotropic isogrid T. (b) isotropic solid of the isogrid's mass. (c) printed two-skin
wall T vs printed isogrid T. (d) 100% printed wall T. (e) bare skin t, and (e') a plain printed wall of the isogrid's
mass.

The calculation scripts are in docs/specs/dfm-research/calc/ ([isogrid_fdm.py](calc/isogrid_fdm.py) and [sens.py](calc/sens.py); run `sens.py` from that folder, since it loads `isogrid_fdm.py` by relative path). Their key lines are summarized here so the note
stands alone: layered D about the neutral axis, smeared grid modulus (b/h) E, mass t + 3bd/h + fillets, sandwich mass
t_top + t_bot + rho (T - t_top - t_bot).

---

## 3. Results

### G1: lid 150 x 100 mm, T = 4 mm (t 1.2, b 1.25, d 2.8, h 15; d/b 2.2; alpha 0.19; 6.7 cells across)

| Case | D / D_isogrid | Mass / isogrid | Equivalent thickness (mm) | Mass (g) | Deflection / isogrid at 100 mm span | Shear share of deflection |
| --- | --- | --- | --- | --- | --- | --- |
| (a) isotropic solid 4 mm | 5.36 | 2.00 | 4.00 | 74.4 | 0.19 | 0.5% |
| (a) isotropic isogrid (no fillets) | 1.08 | 0.95 | 1.90 | 35.3 | 0.92 | 0.3% |
| (b) isotropic solid of equal mass, 1.90 mm | 0.57 | 0.95 | 1.90 | 35.3 | 1.74 | 0.1% |
| (c) printed wall, 10% gyroid | 3.77 | 1.02 | 2.04 | 38.0 | 0.31 | 15% |
| (c) printed wall, 15% gyroid | 3.79 | 1.08 | 2.16 | 40.2 | 0.28 | 7% |
| (c) printed wall, 20% gyroid | 3.82 | 1.14 | 2.28 | 42.5 | 0.27 | 4% |
| (c) printed wall, 15% grid (optimistic core) | 3.84 | 1.08 | 2.16 | 40.2 | 0.27 | 5% |
| **printed isogrid (with fillets)** | **1.00** | **1.00** | **2.00** | **37.3** | **1.00** | 0.3% |
| (d) printed 100%, 4 mm | 4.55 | 2.00 | 4.00 | 74.4 | 0.22 | 0.5% |
| (e) bare skin 1.2 mm | 0.12 | 0.60 | 1.20 | 22.3 | 8.1 | 0% |
| (e') plain printed wall of equal mass, 2.0 mm | 0.57 | 1.00 | 2.00 | 37.3 | 1.75 | 0.1% |

To match the isogrid's stiffness, a printed wall needs T = 2.43 mm (0.93 to 0.97x the isogrid's mass) or 2.41 mm at
100% (1.21x the mass).

### G2: panel 250 x 200 mm, T = 6 mm (t 1.2, b 1.25, d 4.8, h 20; d/b 3.8; alpha 0.25; 10 cells across)

| Case | D / D_isogrid | Mass / isogrid | Equivalent thickness (mm) | Mass (g) | Deflection / isogrid at 200 mm span |
| --- | --- | --- | --- | --- | --- |
| (a) isotropic solid 6 mm | 6.73 | 2.74 | 6.00 | 372 | 0.15 |
| (b) isotropic solid of equal mass, 2.10 mm | 0.29 | 0.96 | 2.10 | 130 | 3.5 |
| (c) printed wall, 10% gyroid | 3.75 | 1.03 | 2.26 | 140 | 0.29 |
| (c) printed wall, 15% gyroid | 3.80 | 1.14 | 2.49 | 155 | 0.27 |
| (c) printed wall, 20% gyroid | 3.87 | 1.24 | 2.72 | 169 | 0.26 |
| **printed isogrid** | **1.00** | **1.00** | **2.19** | **136** | **1.00** |
| (d) printed 100%, 6 mm | 5.72 | 2.74 | 6.00 | 372 | 0.18 |
| (e) bare skin 1.2 mm | 0.05 | 0.55 | 1.20 | 74 | 22 |
| (e') plain printed wall of equal mass, 2.19 mm | 0.28 | 1.00 | 2.19 | 136 | 3.6 |

To match the isogrid, a printed wall needs T = 3.5 mm (0.91 to 0.99x the mass), or 3.35 mm at 100% (1.53x).

### G2b: the same panel with heavier ribs (t 1.6, b 1.7, d 4.4, h 25; d/b 2.6; 8 cells across)

Printed wall at 10/15/20% vs the isogrid: D ratio 3.50/3.55/3.61, mass ratio 0.87/0.96/1.04. To match the isogrid's
stiffness, a printed wall needs T = 3.6 mm, at 0.77 to 0.84x the isogrid's mass.

### Sensitivity: D of the printed wall (15% gyroid) / D of the printed isogrid, same T

| Geometry | Base | Weak skins (E 0.6) | Thin skins (3 + 3 layers) | Thin and weak | Printed-wall mass / isogrid (base; thin skins) |
| --- | --- | --- | --- | --- | --- |
| T 4, b 1.25, h 15 | 3.65 | 2.58 | 2.94 | 1.76 | 1.08; 0.83 |
| T 4, b 1.25, h 10 | 2.71 | 1.92 | 2.18 | 1.30 | 0.88; 0.68 |
| T 4, b 0.9, h 15 | 4.66 | 3.30 | 3.76 | 2.25 | 1.23; 0.95 |
| T 6, b 1.25, h 20 | 3.65 | 2.60 | 2.80 | 1.69 | 1.14; 0.91 |
| T 6, b 1.7, h 12 | 1.99 | 1.42 | 1.53 | 0.93 | 0.68; 0.54 |
| T 10, b 1.7, h 20 | 2.10 | 1.52 | 1.56 | 0.97 | 0.85; 0.71 |
| T 10, b 1.6/2.0, h 15 | 1.49 | 1.07 | 1.11 | 0.69 | 0.57; 0.48 |

The isogrid reaches parity only when it is much heavier than the printed wall (by 1.4 to 2x) and that wall has thin,
weak skins. Here the ribs are 0.95 and the isogrid skin 0.85, which favors the isogrid.

### Span dependence (G1, printed wall at 10% gyroid vs isogrid, center line load)

| Span (mm) | Printed wall: shear share | Isogrid: shear share | Deflection, printed wall / isogrid |
| --- | --- | --- | --- |
| 20 | 81% | 6% | 1.33 (isogrid stiffer) |
| 30 | 66% | 3% | 0.76 |
| 50 | 41% | 1% | 0.45 |
| 100 | 15% | 0% | 0.31 |

The core shear model is rough. The trend is robust: the shear compliance of a sparse core matters at short spans and
under local loads. The isogrid's ribs are full-density webs and do not have this problem.

### Strength proxy (DERIVED, low to medium confidence)

Assume the first failure is at the outer fiber, with an allowable of 1.0 for along-bead material (ribs) and 0.62 for
crossed-raster skins (Ahn: ±45 at 12.2 MPa vs 0° at 19.8 MPa). Then the isogrid's failure moment is 0.26 to 0.28x the
printed wall's at the same depth. The rib tips govern because the neutral axis sits 1.0 to 1.3 mm above the skin face,
so the tips are 3 to 5 mm out.

Check of the printed wall: at spans up to about 100 to 130 mm the sparse core may fail in shear first. At 15% gyroid,
the core shear strength is roughly 0.7 MPa (derived), which puts the core-shear load near the skin-failure load at a
100 mm span. Even so, the printed wall stays several times stronger than the isogrid.

Rib local buckling, with the rib treated as a plate with one free edge (k = 0.43), PLA E = 3.2 GPa: d/b = 2.2 gives
257 MPa, d/b = 3.8 gives 87 MPa. Buckling stress falls to the material's strength (about 50 MPa) at **d/b of about
5.1**.

### Print time (DERIVED, low confidence: check in the slicer)

Model: rib path at an effective 120 mm/s, 0.25 s per pocket loop start, sparse infill at 250 mm/s, solid at 200 mm/s.
G1: printed wall about 31 min, isogrid about 44 min (about 1,600 pocket-loop starts). G2: 115 vs 160 min (about
5,200 starts). Direction: **the isogrid usually prints slower**, by roughly 1.3 to 1.5x, because of many short loops,
seams and travels. A machine with high acceleration narrows the gap. This agrees with 06's untested assertion and
nothing contradicts it.

### Case (e) sweep: ribs on a 1.2 mm skin (b 1.25, h 15)

| Rib depth d (mm) | D / bare skin | Mass / bare skin | Stiffness per mass vs skin |
| --- | --- | --- | --- |
| 1.0 | 1.8 | 1.26 | 1.4 |
| 1.8 (d = 1.5 t) | 3.6 | 1.44 | 2.5 |
| 2.8 | 8.1 | 1.67 | 4.9 |
| 4.0 | 17.8 | 1.94 | 9.2 |
| 4.8 | 27.3 | 2.13 | 12.8 |

---

## 4. Where two skins beat a one-sided ribbed plate, and where they do not

**Why the sandwich wins in global bending (DERIVED, high confidence for the mechanism).** Bending stiffness grows with
material placed far from the neutral axis on both sides. A printed wall has dense skins on both faces; the sparse core
only holds them apart. A one-sided isogrid has one dense face. On the other side it has only rib material, smeared at
b/h (about 6 to 8% of a skin), spread down the full depth rather than concentrated at the far face. This is the
I-beam versus T-beam difference. The NASA handbook optimized isogrid against a monocoque skin of equal weight for
buckling, where depth costs little. It did not compare isogrid with a sandwich.

The printed wall loses, or the comparison tightens, in these cases:

| Situation | What happens | Edge to |
| --- | --- | --- |
| Short spans, point loads, loads near supports | sparse-core shear compliance dominates (81% of deflection at 20 mm); thin skins dent between infill lines | isogrid (full-density webs) |
| Skin-to-core bonding and peel | the top skin bonds only where infill lines touch (about rho of the area, 11 to 22%); rib feet cover 3b/h of the skin (25% for G1), with root fillets | roughly even; ribs slightly ahead with fillets |
| Top-skin pillowing, sag over sparse infill | the first top layers bridge infill gaps and can pillow at 10% infill, so the effective skin modulus drops (sensitivity case 0.6) | isogrid (its top layers are rib tips; nothing bridges) |
| Local skin buckling, wrinkling | sandwich skin cells about 2w/rho = 4 to 8 mm wide, skins 0.8 to 1.0 mm: wrinkling stress is high, not limiting at these loads. Isogrid pocket skins (8.75 mm inscribed at h 15) are not limiting either | neither governs |
| Torsion of the panel | both smear to isotropic plates; the twisting stiffness ratio is about the bending ratio. Orthogrid is weak in shear without a skin (NASA). For an enclosure, the closed box section governs torsion, not the panel | printed wall |
| Impact, dents | thin skins over sparse core dent and crush locally; a skin backed by full-density ribs distributes load to nodes | isogrid, on the skin face (UNVERIFIED, no test) |
| Edge and fastener loads | a sparse core crushes under a screw boss unless it is locally solid; isogrid nodes and borders are full-density by design, and bosses sit on nodes | isogrid, if bosses sit on nodes |
| Warping during printing | a one-sided rib field shrinks on one side and can cup a thin flat skin; a two-skin wall is nearly symmetric in structure | printed wall |
| Strength in global bending | rib tips far from the neutral axis carry high stress: failure moment about 0.26x (proxy) | printed wall |
| One open face wanted (access, cooling, mounting, cable routing, show face) | the printed wall has no open face | isogrid by function |

A third option combines both. A closed wall whose core is a full-density triangular rib lattice has two skins plus
isogrid-pattern webs (for example b 0.9, h 15). It gives about 3.8x the open isogrid's stiffness at 1.1 to 1.2x its
mass (DERIVED). The slicer's "triangles" infill is a sparse version of this. Slant 3D's slit technique (section 5)
forces perimeter walls along chosen rib paths inside a closed solid; that is the same idea, and it is the best bending
structure of the ones considered here.

---

## 5. Evidence

No physical test was found that compares an FDM isogrid or rib-stiffened panel with a slicer-default printed plate of
the same depth, or of the same mass, in bending. Two independent searches came up empty: one through practitioner and
vendor sources, one through peer-reviewed sources. Everything below bears on the question indirectly.

**Perimeters versus infill (material near the surface is worth more per gram)**

- CNC Kitchen, perimeters vs infill (PLA hooks): **6 perimeters + 15% infill matched 2 perimeters + 100% infill**, so
  shells were far more efficient than infill. Print time at equal strength was similar. This is strength only.
  MEASURED. https://www.youtube.com/watch?v=AmEaNAwFSfI
- Same test: 30% nominal infill weighed out at about 33% for most patterns and 45% for triangular. MEASURED.
- CNC Kitchen, gradient infill (three-point bend): stiffness per weight was **3.2 to 3.4** for gradient bars, **2.85**
  for uniform 30% and **2.7** for uniform 46%. Raising uniform infill lowered stiffness per gram. MEASURED, page read
  and rechecked. https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints
- CNC Kitchen, prints vs wood: PLA bending strength was 91 MPa at 100% vs 61 MPa at 30% with 3 perimeters; density
  about 1.2 vs 0.8 g/cm^3. MEASURED. https://www.cnckitchen.com/blog/whats-stronger-3d-prints-or-wood
- Made with Layers (PETG, equal filament mass, bend load): a thicker shell beat more infill in every case. The caveat
  for large flat parts: a little infill helps rigidity more than extra shells. MEASURED (strength) plus PRACTITIONER
  (caveat). https://www.youtube.com/watch?v=nV3GbN6hLjg
- Lubombo and Huneault 2018: at the same density, 3 shells instead of 1 raised stiffness up to 2x. UNVERIFIED
  (abstract). https://doi.org/10.1016/j.mtcomm.2018.09.017
- Alvarez et al. 2016 (ABS, 2 perimeters): **0% infill carried 41%** of the 100% part's tensile force, and 20% infill
  carried 51%. MEASURED. https://doi.org/10.15446/ing.investig.v36n3.56610

These sources support the review's point that a printed "solid" wall is mostly skin and that infill is inefficient per
gram. They do not show that ribs beat the two skins.

**Sparse infill modulus**

- Bean, Lopez-Anido and Vel 2022, PLA gyroid in compression: at 22/25/47/51/75% relative density the modulus was
  6.3/8.3/21/23/62% of solid. That is a bending-dominated core (effective exponent about 1.8 to 2.2). MEASURED.
  https://doi.org/10.3390/app12042180
- Cuan-Urquizo et al. 2022: bare infill lattices in three-point bending were roughly linear in density from 20 to
  50%. MEASURED. https://doi.org/10.3390/polym14020337
- Porter et al. 2018: flexural rigidity was roughly linear in infill above 10% and fell fast below it; specific
  rigidity peaked at 10 to 20%. UNVERIFIED (abstract). https://doi.org/10.1080/17452759.2018.1537064
- No experimental shear modulus for sparse infill was found. The core-shear numbers here are DERIVED.

**Printed sandwiches**

- Sarvestani et al. 2018, one-piece PLA sandwich beams in three-point bend: failure was face, core buckling or core
  shear, with no debonding when printed integrally. Theory over-predicted stiffness by up to 12%. MEASURED.
  https://doi.org/10.1016/j.matdes.2018.08.061
- Faidallah et al. 2023 (Acta Polytechnica Hungarica 20(5):135), one-piece PLA beams with 0.75 mm skins: the rhombus
  core reached a bending modulus of 528 MPa vs 233 MPa for honeycomb at a similar density. The honeycomb cores failed
  by skin wrinkling. MEASURED. Core topology matters and thin skins can wrinkle.

**Printed isogrid and grid-stiffened structures**

- Harvey and Virgin 2018: printed isogrid vs orthogrid cantilever panels at constant mass, with an unstiffened
  baseline. Stiffness rose nonlinearly with rib height. The snippet suggests orthogrid came out stiffer in the tested
  direction, which fits section 11 (iii): aligned ribs win under one-way bending. UNVERIFIED (abstract only; printer
  and infill not stated). https://doi.org/10.1061/(ASCE)EM.1943-7889.0001415
- Ramirez Chavez et al., ASU, SFF Symposium 2019. **SLS nylon, not FDM.** Ribs gave higher specific in-plane
  stiffness than the best solid plate (68 to 70 vs 60.5 kgf/(g·mm)), but "no cellular stiffening strategy
  outperformed the solid plate" on specific buckling load. Single specimens. MEASURED.
  https://utw10945.utweb.utexas.edu/sites/default/files/2019/157%20An%20Experimental%20Study%20of%20Design%20Strategies%20for%20Sti.pdf
- Forcellese 2020, Di Pompeo 2021, Gentili 2022 (skinless carbon-fiber PA isogrid and anisogrid in compression):
  specific strength was above 1xxx and 3xxx aluminum. The best design had ribs 3 mm wide and 15 mm deep at 18 mm
  cells. There was no plate baseline. MEASURED.
  https://doi.org/10.1007/s00170-020-05770-4 ; https://doi.org/10.1007/s11665-021-05659-7 ;
  https://www.scientific.net/KEM.926.115
- Vasques et al. 2021, skinless PLA isogrid cylinders in compression: no plate baseline. MEASURED.
  https://repositorio.ipvc.pt/bitstream/20.500.11960/3080/1/Manufact_3D_2022.pdf

**Practitioner and vendor guidance on ribs**

Slant 3D does not say "use ribs, not infill" about open ribs. It says the opposite about molding-style ribs:

- Making ribs open "you've lost one wall"; make a solid part and let infill fill it. PRACTITIONER/VENDOR.
  https://www.youtube.com/watch?v=9Hp-VRO1hVQ
- Open trusses are wrong for printing. Instead, cut 0.2 mm slits in a solid block along the truss lines, so the
  slicer prints internal walls there. No numbers given. VENDOR.
  https://www.youtube.com/watch?v=OcxfQeeKn-s
- Slots along a rod's outer edge (more wall material) made it about 3x stronger, with more material used. Strength
  only, mass not quantified. VENDOR, MEASURED by the vendor. https://www.youtube.com/watch?v=Lq-SoGgKOcQ

That is the closed-wall-with-rib-walls option in section 4, not an open isogrid.

- Fictiv on Core77: rib thickness 60 to 80% of the wall, height no more than 3x the wall; three ribs cut plate
  deflection by nearly an order of magnitude. This is FEA against a thin plate, so case (e). VENDOR.
  https://www.core77.com/posts/66446/Best-Practices-for-Adding-Ribs-and-Gussets-to-3D-Printed-Parts-for-Structural-Integrity
- A forum reply argued that a thicker wall at the same volume beats an isogrid in stiffness. UNVERIFIED (snippet).
  https://www.reddit.com/r/3Dprinting/comments/m968wk/

---

## 6. Material and weight: when is a printed isogrid lighter, equal or heavier?

Equivalent thickness per unit area (DERIVED, from 06 B.1 and section 2):

- isogrid: m_iso = t + 3 b d (1 + f) / h, where f is about 0.1 for corner fillets r = b and root fillets 0.5 b
- printed two-skin wall of the same depth T = t + d: m_wall = t_top + t_bot + rho_actual (T - t_top - t_bot)
- bare skin: m = t

Against a thinner wall the isogrid is always heavier: it adds 3bd(1 + f)/h, which is 26 to 113% of a 1.2 mm skin in
the examples. Against a same-depth printed wall, the isogrid is lighter when

**h > h\* = 3 b d (1 + f) / [ (t_top + t_bot - t) + rho_actual (T - t_top - t_bot) ]**

| Geometry | h* vs 10% | h* vs 15% | h* vs 20% | Cell used | Verdict at 15% |
| --- | --- | --- | --- | --- | --- |
| G1 (T 4, b 1.25, t 1.2) | 14.3 | 12.5 | 11.1 | 15 | isogrid 7% lighter |
| G2 (T 6, b 1.25, t 1.2) | 18.7 | 15.3 | 13.0 | 20 | isogrid 12% lighter |
| G2b (T 6, b 1.7, t 1.6) | 38.0 | 28.2 | 22.4 | 25 | isogrid 4% heavier |

What drives it: wider and deeper ribs, a thicker skin and lower infill in the alternative all push h* up, so the
isogrid becomes heavier. Larger cells and the printed wall's fixed 1.8 mm of skins push h* down.

The review's "large parts end up slightly less material" holds when the cells grow with the panel (h of 15 to 25 mm)
and the ribs stay at 2 to 3 lines. In that range the isogrid uses 3 to 19% less than the same-depth printed wall. It
fails with heavy ribs (G2b) or small cells. In every case where it is lighter, the same-depth printed wall is still
about 3.5 to 4x stiffer. A thinner printed wall (2.4 mm for G1, 3.5 mm for G2) matches the isogrid's stiffness at 0.91
to 0.99x its mass. For equal stiffness, then, a plain wall is about as light and thinner. The isogrid's material
advantage is real only against the same-depth wall.

---

## 7. FDM anisotropy

**Measured ratios**

- Unidirectional PLA: transverse/longitudinal modulus 0.51, strength 0.25. MEASURED (Sabik et al. 2022,
  https://doi.org/10.1016/j.mechmat.2022.104506).
- ABS tensile strength: 0° 19.8 MPa, ±45 12.2, 0/90 12.5, 90° 2.8 (14% of 0°) at zero air gap. MEASURED (Ahn et al.
  2002, https://doi.org/10.1108/13552540210441166).
- Crossed-raster ABS and PC coupons: modulus nearly the same in all orientations, including upright (Z/flat 1.0 to
  1.04). Upright strength was about 0.92 of flat. MEASURED (Cantrell et al. 2017, Rapid Prototyping Journal 23(4):811,
  manuscript hosted at web.mae.ufl.edu).

**What that means for an isogrid printed flat (skin on the bed, ribs rising in Z)**

Each rib is a stack of layers with beads running along the rib. Every rib is along-bead, so along-rib tension and
compression, the bending-critical stress at the rib tips, get the best strength the process offers. That supports the
review's "continuous filament along the rib". The modulus gain over crossed-raster skins is small, about 1.1x, because
crossed rasters are nearly isotropic in modulus. The gain is mostly strength.

The weak direction is rib-to-skin peel and rib-tip delamination across layers. That stress appears where a rib is
pried sideways, at a load point on a rib top, or at a free rib end. Root fillets help, and so do continuous ribs that
end in the border rather than free ends.

Loads it helps: panel bending (stiffness through depth, strength at the rib tips) and point loads on the skin that the
ribs spread to nodes. Loads it does not help: anything that pulls ribs off the skin (Z peel), and bending of a rib
about its own weak axis (lateral).

**Isogrid on a vertical wall (an enclosure side, ribs grown sideways)**

With one rib family horizontal, that family is along-bead and continuous. The two 60 degree families are built as
stair-stepped stacks: each layer lays a short segment, so stress along those ribs crosses layer interfaces at 30
degrees from the layer plane. Their stiffness is near full (the Z modulus is about the same) but their strength is
interlayer-limited. Pocket ceilings print as bridges (apex down) or as 60 degree self-supporting faces (apex up).

The smeared isogrid is therefore stiff about equally in every direction but strong mainly along the horizontal family.
The same wall printed as a two-skin "solid" has perimeter skins with horizontal beads. Bending about a horizontal axis
then loads those skins across layers (strength about 0.25 to 0.9 of along-bead, depending on adhesion), so both
designs share the same weakness for that load.

---

## 8. The Voronoi variant

Voronoi struts of constant width also print as perimeters (two or three lines), with the same along-bead benefit and
the same peel weakness. The structural logic is the same as for the isogrid: a one-sided strut field on a skin
stiffens a thin skin a lot and does not beat a same-depth two-skin wall.

Irregular cells make it less predictable:

- stiffness varies locally with the seeds
- long struts and large cells set the local skin span
- the stiffness is not isotropic, especially with few cells across
- the weakest strut and node govern strength

No smeared formula like NASA's applies. A relaxed Voronoi (5 or more passes) behaves roughly like a hexagonal rib
field. That field is bending-dominated in plane, so it is less efficient than triangles as a stretching grid, but as
deep ribs on a skin it still gives depth.

Treat it as a skin stiffener when the struts are at least 2 to 3 lines wide, deep (d at least 2t), and dense enough
(at least about 4 cells across the span). Otherwise, and always when it is a shallow recessed texture, treat it as
styling. On vertical faces its random ceiling angles are a print risk (06, C.4). All of this is DERIVED, medium to low
confidence. No printed Voronoi-on-skin bending data was found; the UT/ASU SFF 2019 work is SLS and in-plane.

---

## 9. The review's points, one by one

1. "Stiffer than a solid part in some cases." **Correct.** It is stiffer than the thin wall it replaces (3.6 to 27x)
   and than any plain wall of equal mass (1.75 to 3.6x). It is not stiffer than a same-depth printed two-skin wall in
   global bending (that wall is 2.7 to 3.9x stiffer for house-size ribs), except at short spans and under local
   loads.
2. "Sometimes not lighter and not less material." **Correct.** Against a thin wall it is always heavier. Against a
   same-depth printed wall it depends on h vs h* (section 6).
3. "A nominally solid FDM wall is perimeters around sparse infill; thick walls can take more material than light
   infill." **Correct**, and the earlier note under-weighted it for material. But the two skins of that wall are
   exactly why it stays stiffer in bending.
4. "Filament laid as continuous perimeters along rib directions, so much stronger and stiffer." **Partly.** The
   strength-per-bead advantage is MEASURED (along-bead strength is 1.6 to 7x crossed or across-bead). The stiffness
   advantage is small (about 1.1x vs crossed-raster skins). In global bending the one-sided section loses strength
   because of rib-tip stress. The strength claim holds for local loads, nodes and bosses.
5. "For large parts it usually ends up using slightly less material." **Correct** when the cells scale with the
   panel and the ribs stay at 2 to 3 lines (3 to 19% less than the same-depth printed wall). It is not correct for
   heavy ribs or small cells.
6. "It looks good." Not in dispute. Recording it as the reason is honest.

---

## 10. Confidence and the coupon test that settles it

| Statement | Confidence | Basis |
| --- | --- | --- |
| Isotropic solid of depth T is stiffer than an isogrid of depth T; isogrid beats equal-mass solid | High | NASA theory, exact arithmetic |
| Ribs stiffen a thin skin 4 to 27x for 1.3 to 2.1x mass | High | theory; consistent with Fictiv FEA (VENDOR) |
| Same-depth printed two-skin wall is about 2.5 to 4x stiffer than a one-sided isogrid at about equal mass (global bending, spans of 50 mm or more) | Medium | DERIVED; skins and core moduli from MEASURED sources; not tested |
| Isogrid stiffer than the printed wall at short spans and under point loads | Low to medium | DERIVED from a rough core-shear model |
| Isogrid lighter than the same-depth printed wall when h > h* | Medium to high | geometry and measured actual infill density |
| Isogrid fails at about 0.25x the printed wall's bending moment | Low to medium | DERIVED proxy; allowables from Ahn |
| Isogrid prints slower (about 1.3 to 1.5x) | Low | DERIVED time model |
| Rib local buckling limits d/b to about 5 | Medium | plate buckling with a free edge, conservative |

**Coupon test.** Print three of each in one material and process (PLA, 0.4 mm nozzle, 0.45 mm lines, 0.2 mm layers),
flat on the bed, and weigh every coupon. Run a three-point bend over a 100 mm span with a 60 mm wide coupon (four or
more cells across) and a 10 mm loading nose. Record the initial slope (N/mm) and the peak load. Test the isogrid both
ways up: ribs in tension and ribs in compression.

| Pair | Coupon 1 | Coupon 2 | Prediction (DERIVED) | What it settles |
| --- | --- | --- | --- | --- |
| A, equal depth | isogrid T 4, t 1.2, b 1.26, h 15 | plain 4 mm wall, slicer default (2 walls, 5 top and 4 bottom layers, 15% gyroid) | plain wall about 3 to 4x the slope, about 3 to 4x the peak load, mass within ±10% | the disputed sentence |
| B, equal mass | the same isogrid | plain wall thinned to the isogrid's measured mass (about 2.0 mm, prints solid) | isogrid about 1.7x the slope | the equal-weight claim, on FDM |
| C, short span | A's coupons at a 30 mm span, or a 5 mm indenter at panel center on a 100 mm span | | isogrid equal or stiffer | the local-load advantage |
| D (optional) | closed wall 4 mm, 1.8 mm skins, internal triangle walls b 0.9 at h 15 (or slits per Slant 3D) | pair A coupons | D at least as stiff as the plain wall and well above the isogrid | the best structure for fixed depth |

If pair A shows the isogrid within about 1.5x of the plain wall, the core or skin assumptions here are too generous to
the sandwich, and this note should be revised.

---

## 11. Conclusions

### (i) Corrected statement (replaces the one-line claim)

> A one-sided isogrid stiffens the thin wall it sits on many times over (about 4 to 25 times the bare skin) and is
> stiffer than any wall of the same mass made thinner instead, whether machined or printed. It is not stiffer in
> panel bending than a wall of the same overall depth: a normal print of that depth (two skins over sparse infill) is
> about 2.5 to 4 times stiffer at about the same weight, and a machined or 100 percent wall is stiffer still; the
> isogrid can weigh slightly less when its cells are large, and it does better under local and short-span loads. Call it structural when it replaces a thinner wall or carries local loads; call it styling when a closed
> wall of the same depth was the alternative.

### (ii) Decision guide

**Use an isogrid for stiffness when:**

- a thin wall or lid is floppy and you can add depth on one side only
- the back face must stay open: access, cooling, cable routing, mounting at nodes, a visible signature face
- loads are local or short-span: knobs, buttons, screw bosses on nodes, hand pressure
- you need near-isotropic stiffness under unknown or multi-direction loads

If bending is one-way (a long narrow panel), put more of the rib material along the load. At the same rib mass, ribs
in one direction contribute up to 3x the rib stiffness of an isogrid in that direction.

**Use a closed two-skin wall (slicer default, or with internal rib walls or slits) when:**

- maximum bending stiffness or strength at a fixed depth is the goal
- the part may warp with a one-sided rib field
- print time matters
- the load is global bending of a large panel and both faces can be closed

**The pattern is styling when:**

- a closed wall of the same depth was the alternative and the open face does no job
- the ribs are a shallow recessed texture (d under about t) on a wall that is already stiff enough
- there are fewer than three cells across the span
- it is a through-cut lattice in a thin wall
- it is Voronoi with thin struts or large cells

### (iii) Design rules that make a printed isogrid structural

1. **Rib width in whole line widths**, so ribs print as perimeters only. At 0.45 mm lines and 0.2 mm layers:
   2 lines = 0.86 mm, 3 = 1.26 mm, 4 = 1.67 mm (n w - (n - 1) h (1 - pi/4)). Use 3 lines (1.26 mm) for handled
   parts. With Arachne, in-between widths still print, as widened beads.
2. **Rib depth:** d/b at most about 5 (rib-tip buckling and wobble while printing). d/t of 2 or more for a worthwhile
   gain; most of the gain comes from depth (D grows roughly with d^2 to d^3).
3. **Skin:** at least 1.2 mm (6 layers flat, 3 perimeters vertical). Keep the pocket inscribed diameter, 2(h/3 - b/2),
   under about 20 to 25 t, so skin pockets do not drum or dent.
4. **Cell size:** at least three cells across the shortest span (smeared theory), and preferably four or more. Choose
   h from the mass target, h = 3bd(1 + f)/(m_target - t). Compare it with h* (section 6) when the alternative is a
   same-depth printed wall.
5. **Fillets:** pocket corners r = b (house), capped at 0.4 times the pocket inradius; rib roots about 0.5 b; no node
   circles except bosses at fastener nodes; drop pockets with inradius under 2b.
6. **Orientation:** flat panels skin on the bed, ribs up, no supports. Run ribs continuously into a solid border at
   least 2b wide; avoid free rib ends. On vertical walls one rib family is horizontal (pocket ceilings self-support or
   bridge one short side). Put bosses on nodes.
7. **Load direction:** where possible, have the main load put the skin in tension and the rib tips in compression, or
   accept the lower rib-tip strength. Check d/b at most 5 when the tips are in compression.
8. **Warping:** on large flat panels in shrink-prone materials (ABS, ASA, PC), expect cupping toward the ribs.
   Mitigate with a border, a brim, a slightly thicker skin, or ribs on both faces.
9. **Print time:** check it in the slicer. Expect slower prints than a plain wall.

### (iv) Confidence and the deciding test

See section 10. Two coupon pairs settle the dispute in an afternoon: same outline and depth (pair A), same outline and
mass (pair B), three-point bend, weighed.

---

## Sources

| # | URL | Used for | Tag |
| --- | --- | --- | --- |
| 1 | https://ntrs.nasa.gov/citations/19730011184 | Isogrid equations, smeared modulus (b/h)E, beta, typical optima (via 06 B.1) | Source (read in 06) |
| 2 | https://www.youtube.com/watch?v=AmEaNAwFSfI | Perimeters vs infill strength; actual vs nominal infill | MEASURED (transcript read) |
| 3 | https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints | Stiffness per weight vs infill in three-point bend | MEASURED (read, rechecked) |
| 4 | https://www.cnckitchen.com/blog/whats-stronger-3d-prints-or-wood | Bending strength and density at 30% vs 100% | MEASURED (read) |
| 5 | https://www.youtube.com/watch?v=nV3GbN6hLjg | Equal-mass shell vs infill; large flat part caveat | MEASURED + PRACTITIONER (transcript read) |
| 6 | https://www.youtube.com/watch?v=9Hp-VRO1hVQ | Slant 3D: open molding ribs lose a wall | PRACTITIONER/VENDOR (transcript read) |
| 7 | https://www.youtube.com/watch?v=OcxfQeeKn-s | Slant 3D: slits inside solids instead of open trusses | VENDOR (transcript read) |
| 8 | https://www.youtube.com/watch?v=Lq-SoGgKOcQ | Slant 3D: slot "ribs" add wall, about 3x strength, more material | VENDOR, vendor-measured (transcript read) |
| 9 | https://www.core77.com/posts/66446/Best-Practices-for-Adding-Ribs-and-Gussets-to-3D-Printed-Parts-for-Structural-Integrity | Rib rules; ribs on a thin plate (FEA) | VENDOR (read) |
| 10 | https://www.reddit.com/r/3Dprinting/comments/m968wk/ | Thicker wall vs isogrid opinion | UNVERIFIED (snippet) |
| 11 | https://help.prusa3d.com/article/infill-patterns_177130 ; https://help.prusa3d.com/article/arachne-perimeter-generator_352769 ; https://help.prusa3d.com/article/layers-and-perimeters_1748 | Infill material, Arachne widths, top layers | VENDOR (read) |
| 12 | https://doi.org/10.1061/(ASCE)EM.1943-7889.0001415 | Printed isogrid vs orthogrid at equal mass | UNVERIFIED (abstract) |
| 13 | https://utw10945.utweb.utexas.edu/sites/default/files/2019/157%20An%20Experimental%20Study%20of%20Design%20Strategies%20for%20Sti.pdf | SLS stiffened vs solid plates, specific stiffness and buckling | MEASURED (SLS, full text) |
| 14 | https://doi.org/10.1007/s00170-020-05770-4 ; https://doi.org/10.1007/s11665-021-05659-7 ; https://www.scientific.net/KEM.926.115 | Skinless CF-PA isogrid/anisogrid in compression | MEASURED (no plate baseline) |
| 15 | https://repositorio.ipvc.pt/bitstream/20.500.11960/3080/1/Manufact_3D_2022.pdf | PLA isogrid cylinders | MEASURED (no plate baseline) |
| 16 | https://doi.org/10.1016/j.matdes.2018.08.061 | Printed sandwich beam failure modes, theory vs test | MEASURED |
| 17 | Faidallah et al., Acta Polytechnica Hungarica 20(5):135, 2023 | Printed sandwich core type, skin wrinkling | MEASURED |
| 18 | https://doi.org/10.1080/17452759.2018.1537064 | Flexural rigidity vs infill | UNVERIFIED (abstract) |
| 19 | https://doi.org/10.3390/app12042180 | Gyroid modulus vs density | MEASURED |
| 20 | https://doi.org/10.3390/polym14020337 | Infill lattice bending modulus vs density | MEASURED |
| 21 | https://doi.org/10.15446/ing.investig.v36n3.56610 | Tensile force vs infill, 0% infill share | MEASURED |
| 22 | https://doi.org/10.1016/j.mtcomm.2018.09.017 | Shell count vs stiffness at same density | UNVERIFIED (abstract) |
| 23 | https://doi.org/10.1108/13552540210441166 | Raster-angle strength ratios | MEASURED |
| 24 | https://doi.org/10.1016/j.mechmat.2022.104506 | Transverse/longitudinal modulus and strength, PLA | MEASURED |
| 25 | Cantrell et al., Rapid Prototyping Journal 23(4):811, 2017 (manuscript at web.mae.ufl.edu) | Crossed-raster modulus nearly isotropic | MEASURED |
| 26 | https://doi.org/10.3390/jcs8040115 ; https://pmc.ncbi.nlm.nih.gov/articles/PMC9867140 | Modulus vs infill with walls (internal inconsistencies) | MEASURED, low confidence |
| 27 | dfm-research 06 (this folder), 01 section 9 | Prior findings and the claim | Internal |

All accessed 2026-11-12. Items 2 to 11 were gathered by a practitioner-evidence research pass and items 12 to 26 by a
peer-reviewed-evidence pass; item 3 was rechecked directly.

## Gaps

1. No physical test of a printed isogrid vs a same-depth or same-mass printed plate in bending was found. Section 10's
   coupons fill it.
2. No measured shear modulus or shear strength of sparse FDM infill; the core-shear results are rough.
3. Harvey and Virgin 2018 numbers are paywalled; only the abstract was seen.
4. The print-time model is not calibrated; check in the slicer.
5. No printed Voronoi-on-skin bending data.
