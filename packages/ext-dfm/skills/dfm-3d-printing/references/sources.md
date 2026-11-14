# Sources

Every source this playbook uses, grouped by topic, with what it supports. All
are recorded in the research files under `docs/specs/dfm-research/` (01
geometry, 02 other processes, 03 materials, 04 hardware, fits, Bambu,
coupons), accessed 2026-11-12. A follow-up pass read the
sources the first pass skipped or only partly read
(`docs/specs/dfm-research/08-skipped-sources-addendum.md`); its sources are
listed under each topic below, marked "(08)". "SNIPPET" means only a search
excerpt was read; values from those pages are labeled SNIPPET or UNVERIFIED
where used. A third pass read 234 videos of one production print farm's
channel (`docs/specs/dfm-research/10-slant-3d-videos.md`); the videos the
playbook cites are listed in "Production print farm videos (10)" below.

## FDM geometry rules

| URL | Supports |
| --- | --- |
| https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135 | wall per perimeter, overhang 45 to 75 deg by cooling, 0.2 mm accuracy, 0.3 mm movable clearance, chamfer vs fillet, splitting |
| https://help.prusa3d.com/article/elephant-foot-compensation_114487 | elephant's foot, 0.2 mm compensation |
| https://help.prusa3d.com/article/layers-and-perimeters_1748 | top layer counts, skin bridging, 2-perimeter minimum |
| https://help.prusa3d.com/article/seam-position_151069 | seam modes, scarf seams (excerpt with full text) |
| https://help.prusa3d.com/article/warping_2011 | warping causes, brim, helper geometry (SNIPPET) |
| https://wiki.bambulab.com/en/software/bambu-studio/wall-generator | Classic vs Arachne; 25 percent minimum feature; 85 percent minimum wall |
| https://wiki.bambulab.com/en/software/bambu-studio/xy-hole-contour-compensation | hole shrink causes; per-side XY hole and contour compensation; calibration |
| https://wiki.bambulab.com/en/software/bambu-studio/parameter/elephant-foot | elephant's foot cause and measurement |
| https://www.hydraresearch3d.com/design-rules | walls, chamfers, corners, bridges, clearances, text, features, holes, threads, sacrificial bridges, pilot percentages |
| https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/ | 45 deg overhang, 5 mm bridges, base chamfers, pins under 5 mm, layer-joint cracking |
| https://www.hubs.com/knowledge-base/what-is-fdm-3d-printing/ | accuracy plus or minus 0.5 percent, 0.5 mm floor (SNIPPET) |
| https://www.hubs.com/3d-printing/fdm/ | 2.0 mm minimum feature for orders (SNIPPET) |
| https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide | walls 1.0 to 1.2 mm, clearance 0.3 mm per side, hole oversize 0.2 to 0.4 mm, tolerances |
| https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing | walls in nozzle multiples, bridges 5 mm, clearance, text 0.5 mm, gaps 0.4 to 0.5 mm |
| https://www.protolabs.com/resources/design-tips/how-to-solve-for-size-constraints-small-gaps-and-thin-walls-in-3d-printed-parts/ | 0.75 mm gap advisory; cut and bind |
| https://ultimaker.com/wp-content/uploads/2024/06/How-to-design-for-FFF-1.pdf | 45 deg rule; wall at least one nozzle |
| https://ultimaker.com/learn/design-for-fff-3d-printing-maximize-your-success/ | 2 mm minimum hole; 0.6 mm print-together gap (SNIPPET) |
| https://www.cnckitchen.com/blog/the-effect-of-extrusion-width-on-strength-and-quality-of-3d-prints | extrusion width vs strength (MEASURED) |
| https://www.cnckitchen.com/blog/the-influence-of-layer-height-on-the-strength-of-fdm-3d-prints | layer height vs strength; Z at least 50 percent weaker; 0.15 mm overhang sweet spot (MEASURED) |
| https://www.youtube.com/watch?v=7aJ4dDyyf20 | orientation tests at 0, 30, 45, 60, 90 deg; shrink lines; split and fold (MEASURED) |
| https://www.youtube.com/watch?v=AmEaNAwFSfI | perimeters vs infill, infill patterns (MEASURED) |
| https://www.cnckitchen.com/blog/gradient-infill-for-3d-prints | gradient infill stiffness (SNIPPET) |
| https://www.cnckitchen.com/blog/big-nozzles-how-do-they-make-your-3d-prints-stronger | strength proportional to material (SNIPPET) |
| https://www.youtube.com/watch?v=9Hp-VRO1hVQ | mass-production rules: chamfers, fillets, support fins, fit features, hole reinforcement, nut and magnet slots, first layer (PRACTITIONER) |
| https://www.youtube.com/watch?v=Bd7Yyn61XWQ | teardrop holes, sacrificial layers, crush ribs, grip fins (PRACTITIONER) |
| https://www.youtube.com/watch?v=ujAwxSx63FE | curved-top terracing fixes (PRACTITIONER) |
| https://www.youtube.com/watch?v=XTvBOGgx48I | chamfer vs fillet in G-code; variable layer height (PRACTITIONER) |
| https://hydraraptor.blogspot.com/2011/02/polyholes.html | hole-shrink physics; polyhole formula (MEASURED) |
| https://hackaday.com/2017/10/17/sacrificial-bridge-avoids-3d-printed-supports/ | sacrificial bridge concept |
| https://printpal.io/docs/3d-printing-design-guide | teardrop, facet count, circumscribed polygons (SNIPPET) |
| https://hlhrapid.com/knowledge/design-guide-fdm-3d-printing/ | emboss 0.3, engrave 0.5 mm (SNIPPET) |
| https://3dprintcalcs.uk/design/text-emboss-calculator/ | nozzle-relative text formula (SNIPPET) |
| https://www.makelab.com/insights/3d-printing-tolerances-explained | tolerance plus or minus 0.2 / 0.5 mm, slip-fit clearance (SNIPPET) |
| https://www.creality.com/blog/3d-printing-bridging | 20 to 25 mm bridge upper bound (SNIPPET) |
| https://tools.creative3dp.com/blog/3d-printed-holes-too-small/ | composite hole formula (SNIPPET, not used) |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_FDM.pdf | (08) Xometry FDM guide v2.1, public PDF: 1.0 mm hole roundness floor, walls 1.2 to 1.5, rib 1.5 mm, text 0.5 to 1.0, 45 deg overhang |
| https://www.xometry.com/resources/3d-printing/mini-guide-fdm-3d-printing/ | (08) Xometry FDM mini guide: hole roundness floor |
| https://community.xometry.com/kb/articles/745-fdm-3d-printing | (08) industrial FDM layers, build size, minimum feature 0.89 / 1.14 mm |
| https://www.xometry.com/manufacturing-standards/ | (08) desktop accuracy formula; process tolerances (also S21 in other processes) |
| https://xometry.pro/en-eu/3d-printing-design-guide/quick-guide/ | (08) eight-process table: overhang length 2 mm, gaps 0.5 / 1.0, bridges 5, text 5 / 3.5, moving parts 0.5 |
| https://xometry.pro/en/articles/fdm-design-tips/ | (08) Xometry Europe FDM tips |
| https://www.protolabs.com/services/3d-printing/fused-deposition-modeling/ | (08) wall 0.8, hole 2.0, prototyping plus or minus 0.5 percent (0.5 floor), industrial 0.3 percent (0.3 floor) |
| https://www.youtube.com/watch?v=nV3GbN6hLjg | (08) equal-mass infill tests: shell beats infill, cubic strongest (MEASURED) |
| https://www.youtube.com/watch?v=a6m_GnN5j4c | (08) untuned Z fractions and across-layer impact about 0.25 (MEASURED) |
| https://www.youtube.com/watch?v=ct-n2lI0I9g | (08) small parts at 100 percent infill, severe-warp mouse ears, chopped fiber stiffer not stronger, CF and RF (PRACTITIONER) |
| https://www.youtube.com/watch?v=MqirgLJnmZM | (08) common printing mistakes; nothing new adopted |
| https://www.youtube.com/watch?v=Lq-SoGgKOcQ | (08) 0.2 mm microfeatures that force extra perimeters (PRACTITIONER) |
| https://www.youtube.com/watch?v=vsHpiHhB3RU | (08) connecting printed parts: diamond pegs, angled slots, glue pockets (PRACTITIONER) |
| https://www.youtube.com/watch?v=noYuQlQN8pw | (08) Teaching Tech design series part 4: 1 mm fit templates (PRACTITIONER) |
| https://teachingtechyt.github.io/calibration.html | (08) calibration only; nothing adopted |
| https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips | (08) critical dimensions in XY, metal pins and bushings for wear (VENDOR) |
| https://www.slant3d.com/blog/51fe073a-45f4-45ca-951b-84397418730a | (08) Slant 3D print service envelope (0.4 nozzle, 220 mm cube); its settings table is an image (excerpt only); (10) the same service's baseline settings are stated aloud in https://www.youtube.com/watch?v=f4fJ5AbUF6Q |

## Materials

| URL | Supports |
| --- | --- |
| https://wiki.bambulab.com/en/general/filament-guide-material-table | nozzle, plate, AMS, enclosure, drying, 0.2 mm compatibility, PLA 50 C warning |
| https://bambulab.com/en-us/filament/guide | 42-material comparison: impact, bending, HDT, water, TPU grades |
| https://wiki.bambulab.com/filament-acc/abs-asa-pc/bambu_pla_basic_technical_data_sheet.pdf | PLA Basic data sheet and its annealed test method |
| https://www.initial.fr/content/uploads/2026/10/fiche-technique-fff-petg.pdf | Bambu PETG Basic data sheet (mirror) |
| https://store.bblcdn.com/s1/default/7130c176eac54e928d650e48d8b12d72/new_Bambu_PLA_Tough_Technical_Data_Sheet.pdf | PLA Tough+ |
| https://www.crea3d.com/en/?controller=attachment&id_attachment=1006 | Bambu PLA-CF data sheet (mirror) |
| https://store.bblcdn.eu/s8/default/16df21baf482453999b3dbb61cc110e7/Bambu_TPU_95A_HF_Technical_Data_Sheet.pdf | TPU 95A HF |
| https://wiki.bambulab.com/filament-acc/petcf-ppacf/c750bddfb8e44af6ae9f7dd9625fa458.pdf | PA6-CF |
| https://wiki.bambulab.com/filament-acc/asacf-pahtcf/65f1b18a6d6142d794a1a6a00f1496ef.pdf | PAHT-CF (SNIPPET) |
| https://us.store.bambulab.com/products/paht-cf | PAHT-CF vs PA6-CF wet and dry |
| https://wiki.bambulab.com/filament-acc/abs-asa-pc/a52afdccddfd448583d119587122c8c5.pdf | PC |
| https://wiki.bambulab.com/en/filament/abs_asa_pc | enclosure, warping fixes, ventilation, PC FR V-0 |
| https://wiki.bambulab.com/en/knowledge-sharing/tpu-printing-guide | TPU grades, AMS, nozzles, drying |
| https://us.store.bambulab.com/products/pva | PVA dissolution, 50 C limit with PLA (SNIPPET) |
| https://prusament.com/wp-content/uploads/2022/10/PLA_Prusament_TDS_2021_10_EN.pdf | Prusament PLA, "vertical" specimen meaning |
| https://prusament.com/wp-content/uploads/2022/10/PCBlend_Prusament_TDS_2022_16_EN.pdf | PC Blend brim advice |
| https://wiki.polymaker.com/polymaker-products/more-about-our-products/documents/technical-data-sheets/abs-asa/polylite-tm-abs.md | ABS specimens printed at 90 C |
| https://wiki.polymaker.com/printing-tips/post-processing/annealing.md | annealing by polymer class |
| https://wiki.polymaker.com/the-basics/3d-printing-materials/pp | PP settings (SNIPPET) |
| https://www.cnckitchen.com/blog/comparing-pla-petg-amp-asa-feat-prusament | PLA, PETG, ASA hooks: Z percent, stiffness, impact, oven (MEASURED) |
| https://www.cnckitchen.com/blog/does-a-heated-chamber-make-your-3d-prints-stronger | ABS and PC Blend Z vs chamber temperature (MEASURED) |
| https://www.cnckitchen.com/blog/better-performing-3d-prints-with-annealing-but-part-1-pla | PLA annealing (MEASURED) |
| https://www.youtube.com/watch?v=u8dIpwd6tzo | CF-PA6 and PA12 moisture, creep, annealing; bolt-preload creep (MEASURED) |
| https://www.sv-jme.eu/?ns_articles_pdf=/ns_articles/files/ojs30/191/63073da9a438a.pdf&id=6869 | short-term creep study of six FDM polymers (MEASURED) |
| https://www.mdpi.com/2073-4360/16/13/1868 | 2024 PLA vs PETG tension fatigue study (MEASURED) |
| https://mandarin3d.com/blog/cantilever-snap-fit-design | PLA and PETG snap-fit strain derivation |
| https://www.fabflow.app/blog/snap-fit-joints-3d-printing-engineering-guide | strain and fatigue table (UNVERIFIED secondary) |
| https://www.hubs.com/knowledge-base/how-design-living-hinges-3d-printing/ | living hinge rules, 25-cycle example |
| https://www.xometry.com/resources/3d-printing/pp-3d-printing-filament/ | PP hinges (SNIPPET) |
| https://filamentcompare.com/pctg-vs-petg/ | PCTG producer values (secondary) |
| https://formlabs.com/blog/guide-to-food-safe-3d-printing/ | food safety (SNIPPET) |
| https://printfarmcalc.com/reference/shrinkage/ | shrink percentages (secondary) |
| https://www.youtube.com/watch?v=YJdkE7A8stM | (08) print temperature vs strength: hotter is not stronger (MEASURED, trends only) |
| https://www.youtube.com/watch?v=8_adY2K-YIc | (08) PETG notes: stiffness about 22 percent under PLA in one spring test, usable to 70 to 80 C (MEASURED, one sample) |
| https://www.youtube.com/watch?v=WgXM2zPusXo | (08) layer height range 1/4 to 3/4 nozzle (PRACTITIONER) |
| https://toms3d.org/2026/02/10/the-prusa-core-one-l-is-so-hot-right-now-does-it-handle-engineering-filaments-better-than-the-h2c/ | (08) measured chamber temperatures, bed display offset (MEASURED) |
| https://www.youtube.com/watch?v=xV36ITRjP_4 | (08) Teaching Tech compliant mechanisms: flexure material ranking, line-width sizing (PRACTITIONER) |

## Fits, clearances, accuracy

| URL | Supports |
| --- | --- |
| https://www.sovol3d.com/blogs/news/fdm-3d-printing-tolerances-clearances-how-to-design-parts-that-fit | per-side clearance table, material deltas |
| https://www.sovol3d.com/blogs/news/print-in-place-3d-printing-how-to-design-hinges-joints-and-moving-parts-that-actually-work | print-in-place 0.25 per side (SNIPPET) |
| https://www.youtube.com/watch?v=TYuLVN3YHw8 | tolerance gauge results on tuned and average printers (MEASURED) |
| https://3dprinting.stackexchange.com/questions/6576 | per-side rule, worked stack-up (SNIPPET) |
| https://3dprinting.stackexchange.com/questions/7651 | 608 bearing hole (SNIPPET) |
| https://cc3dlabs.com/print-tolerance-standards-explained-for-engineers/ | per-side example, budget printer accuracy (SNIPPET) |
| https://grandpacad.com/en/tools/tolerance-fit-calculator | diametral fit table, accuracy (SNIPPET) |
| https://forum.prusa3d.com/forum/original-prusa-i3-mk2-s-others-archive/general-tolerances-for-part-design/ | 0.2 mm difference fit (SNIPPET) |
| https://www.reddit.com/r/BambuLab/comments/1mg6pvj/xy_hole_compensation_madness/ | the doubling in practice (SNIPPET) |
| https://all3dp.com/2/3d-printing-tolerances-test-fdm/ | test survey; tolerance is half the clearance |
| https://www.aon3d.com/applications/engineering-fits-how-to-design-for-3d-printed-assemblies/ | crush ribs (SNIPPET) |
| https://newscrewdriver.com/2020/12/31/accommodate-3d-printer-variation-with-crush-ribs/ | crush ribs (SNIPPET) |
| https://meshra.ai/blog/3d-printed-bearing-mount-that-fits | bearing interference (SNIPPET) |
| https://formlabs.com/blog/how-to-3d-print-interlocking-joints/ | dovetail offsets (SNIPPET) |
| https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips | (08) Markforged fit table, stated diametral: press 0 to 0.05, close 0.05 to 0.10, free 0.10 to 0.20 (VENDOR) |
| https://markforged.com/resources/blog/joinery-onyx | (08) sliding joinery 0.08 per side; +0.07 per side on faces printed on support; snap fits and teeth printed on their side (VENDOR) |
| https://markforged.com/resources/blog/3d-printed-unit-tests | (08) dovetail offset ladder (MEASURED, one Mark Two) |
| https://www.youtube.com/watch?v=XKrDUnZCmQQ | (08) Slant 3D tolerance: compliant undercut gap 0.3 to 0.5 mm, lid and base features (PRACTITIONER) |
| https://www.youtube.com/watch?v=YG_8wYoxVfs | (08) Slant 3D compliant hinges: leaf 0.5 to 1.0 mm, taper (PRACTITIONER) |

## Hardware

| URL | Supports |
| --- | --- |
| https://www.cnckitchen.com/s/CNCKitchen_Heat-Set-Insert-Dimensions-and-Design-Guidelines.pdf | insert hole, depth and wall table |
| https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts | installation, temperatures, test parts |
| https://www.cnckitchen.com/blog/are-our-heat-set-insert-datasheets-wrong | hole size vs pull-out, CAD offset, hole shrink (MEASURED) |
| https://www.cnckitchen.com/blog/threaded-inserts-for-3d-prints-cheap-vs-expensive | pull and torque data, 2.7 mm self-tap hole (MEASURED) |
| https://www.cnckitchen.com/blog/helicoils-threaded-insets-and-embedded-nuts-in-3d-prints-strength-amp-strength-assessment | PETG nuts, inserts, helicoils (MEASURED) |
| https://www.youtube.com/watch?v=iR6OBlSzp7I | M5 threads vs inserts (MEASURED) |
| https://www.youtube.com/watch?v=ip70-Tw6tBE | side holes, hex holes, grip fins (PRACTITIONER) |
| https://markforged.com/resources/blog/heat-set-inserts | insert on the side away from the load; (08) tapered-hole CAD method, 343 to 399 C iron for composites |
| https://www.spirol.com/assets/files/ins-wp-how-to-design-the-proper-hole-for-heat-ultrasonic-inserts-us.pdf | insert hole taper, depth, boss |
| https://tools.creative3dp.com/blog/heat-set-insert-hole-size-chart/ | alternative insert chart (SNIPPET) |
| https://accu-components.com/us/p/488-threaded-insert-hole-size-charts-for-3d-printing-pla-petg-resin | insert holes (SNIPPET) |
| https://loftsmith.com/guides/screw-holes-3d-printing | nut traps, self-tap holes (SNIPPET) |
| https://3dprintcalcs.uk/mechanical/nut-trap-calculator/ | nut clearance (SNIPPET) |
| https://createit3d.co.za/blogs/news/how-to-design-captive-nuts-in-3d-printed-parts | nut clearance (SNIPPET) |
| https://markforged.com/resources/blog/embedding-nuts-3d-printing | (08, read in full) embedded nut cavity 0.05 to 0.08 per side over the measured nut; measure the nut; flat ceiling; square nuts (VENDOR) |
| https://markforged.com/resources/blog/embedding-components-in-3d-printed-parts | (08) component cavity about 0.08 per side; filler pieces (VENDOR) |
| https://www.youtube.com/watch?v=HgEEtk85rAY | (08) Made with Layers, adding threads: self-forming holes, square nuts, nut-slot cracking, no wood screws, threads at M6 and up (PRACTITIONER) |
| https://toms3d.org/2025/01/14/a-better-way-to-add-threads-to-your-3d-prints/ | (08) article for the same video; the self-forming geometry is only in a linked CAD document |
| https://www.youtube.com/watch?v=lYXTiJo_FQQ | (08) M5 torque by insert type; 3.6 mm perimeter for a full-strength M5; inserts in PETG and PC (MEASURED) |
| https://www.youtube.com/watch?v=eNMAFTeowFs | (08) inserts M3 to M8: perimeter-infill failure, printed threads vs inserts, torque vs metal values, tapping (MEASURED) |
| https://www.youtube.com/watch?v=yP7_qZ_Mi78 | (08) Teaching Tech design series part 5: +0.4 hole compensation, self-tap 2.9 / 3.9, slip-in M6 nut, drop-in 1 mm (PRACTITIONER) |
| https://www.youtube.com/watch?v=Fgbxgz5S2dc | (08) long tapped threads in ABS/PC (PRACTITIONER) |
| https://www.youtube.com/watch?v=QF5aZz2k0bg | (08) 3D Printing Nerd, printed nuts and bolts: scale-fit threads, slotted heads (PRACTITIONER) |
| https://www.igo3d.com/mediafiles/Sonstiges/Ruthex/ruthex_Datenblatt_RX-Serie.pdf | (08) ruthex RX-series datasheet, official, reseller-hosted: insert holes, lengths, walls, L + 1 depth (VENDOR) |
| https://www.ruthex.de/en/collections/gewindeeinsatze | (08) ruthex product table and drill set, agreeing with the datasheet (VENDOR) |
| https://cnckitchenus.store/ | (08) CNC Kitchen insert store table, matching the poster; extra sizes (VENDOR) |
| https://totalelement.com/blogs/magnet-projects/how-to-embed-magnets-in-3d-prints | magnet pockets, cover vs pull, temperature, polarity |
| https://draftid.com.au/how-to-embed-magnets-in-3d-prints/ | magnet pocket test, pause layer (MEASURED) |
| https://www.apexmagnets.com/n-grade-comparison | magnet grade temperatures (SNIPPET) |
| https://help.prusa3d.com/article/insert-pause-or-custom-g-code-at-layer_120490 | PrusaSlicer pause; magnets jumping (SNIPPET) |
| https://wiki.bambulab.com/en/software/bambu-studio/view-slicing-information | Bambu pause semantics |
| https://forum.bambulab.com/t/solved-custom-g-code-for-pause-wipe-resume/40620 | pause G-code M400 U1 (SNIPPET) |
| https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/ | snap-fit rules |
| Bayer/Covestro snap-fit guide, university-hosted copy listed as source 54 in docs/specs/dfm-research/04-hardware-fits-calibration.md (URL not repeated: its path carries a personal name) | Bayer snap-fit guide: deflection equations, 60 percent repeated-use rule (SNIPPET) |
| https://synectic.net/snap-fit-design/ | cantilever equations (SNIPPET) |
| https://www.fictiv.com/articles/how-to-design-snap-fit-components | printed strain, Z derating (SNIPPET) |
| https://jlc3dp.com/blog/considerations-for-3d-printing-threads | layer height vs pitch (SNIPPET) |
| https://wiki.bambulab.com/en/bambu-studio/manual/3d-print-large-files | splitting, connectors, glue |
| https://bigrep.com/posts/gluing-3d-printed-parts-best-adhesives/ | glues, solvent welding (SNIPPET) |

## Bambu Lab

| URL | Supports |
| --- | --- |
| https://bambulab.com/en/compare | lineup |
| https://bambulab.com/en/support/buying-guide | H3C, H2C |
| https://bambulab.com/en/a1/tech-specs, https://bambulab.com/en/a1-mini/tech-specs, https://bambulab.com/en/h2s/tech-specs, https://bambulab.com/en/h2d/tech-specs | confirmed specs |
| https://bambulab.com/en/p2s, https://bambulab.com/en/x2d | chamber temperatures, 50 micron claim |
| https://bambulab.com/en/a2l/specs, https://bambulab.com/en/h2c/specs, https://bambulab.com/en/x2d/specs, https://bambulab.com/en/p2s/specs | (08) read in full: build volumes, nozzle and bed maxima, nozzle sizes, chambers (H2C bed 120 C; A2L open bed slinger) |
| https://store.bblcdn.com/s7/default/9e9c1948dd61491199a52c3f1497b9c7/bambu-lab-P1S-tech-specs.pdf | (08) P1S official spec PDF |
| https://public-cdn.bambulab.com/store/X1-Carbon%20tech%20specs.pdf | (08) X1 Carbon official spec PDF |
| https://bambulab.com/en-us/h2d-pro/tech-specs | (08) H2D Pro specs (targeted extract) |
| https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/process/fdm_process_common.json, https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/process/fdm_process_single_0.20.json | (08) Bambu Studio stock line widths and compensation (VENDOR) |
| https://wiki.bambulab.com/en/software/bambu-studio/parameter/line-width | (08) line width 0.75 to 1.5 x nozzle; no default number |
| https://wiki.bambulab.com/en/p1/manual/faq, https://www.3dmag.com/3d-printers-comparison/bambu-p1s-vs-x1-carbon/ | P1S, X1C (SNIPPET; superseded by the spec PDFs) |
| https://wiki.bambulab.com/en/software/bambu-studio/layer-height | layer ranges, first layer |
| https://calibr.pro/tables/nozzle-size-layer-height-chart/ | line widths (SNIPPET) |
| https://wiki.bambulab.com/en/filament-acc/acc/plates | plates and bottom finish |
| https://wiki.bambulab.com/en/software/bambu-studio/reduce-wasting-during-filament-change | purge waste |

## Coupons and calibration

| URL | Supports |
| --- | --- |
| https://www.orcaslicer.com/wiki/calibration/tolerance_calib | Orca tolerance test |
| https://www.orcaslicer.com/wiki/guides/calibration_guide | calibration order |
| https://makerworld.com/en/models/423905-clearance-tolerance-test | clearance test listing |
| https://www.thingiverse.com/thing:3003732 | internal clearance test (SNIPPET) |
| https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips | unit test (print a slice) |
| https://markforged.com/resources/blog/3d-printed-unit-tests | (08) worked unit-test example: dovetail offset ladder |

## Production print farm videos (10)

One print farm's channel (Slant 3D), read from auto-captions; every item is
PRACTITIONER, with CLAIMED-TEST where a test was shown. The record, with the
conflicts, self-contradictions, claims not adopted and the full index of
videos read, is `docs/specs/dfm-research/10-slant-3d-videos.md`. Videos the
playbook already cited before this pass are listed above.

### Bed contact, ejection and production mode

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=SZwXREFoWKA | one-layer bottom recess; deeper pocket with a self-supporting roof; no large outer chamfer to cut contact |
| https://www.youtube.com/watch?v=X8kqMaxwB4M | ring contact down to 1 mm in PLA; cosmetic holes blind from above; large footprint corners |
| https://www.youtube.com/watch?v=kIFGtNMmxuM | conical underside recess, ring-only contact |
| https://www.youtube.com/watch?v=xEjtyA2b5I0 | conical underside chamfer on a lamp; hook-shaped cord slot; fillet everything |
| https://www.youtube.com/watch?v=cBVgwIjP02w | bottom cavity against staining; grip fins around a bought part |
| https://www.youtube.com/watch?v=9ERY20MRJPo | center of gravity over the contact; corner chamfer stands; board standoffs and pockets |
| https://www.youtube.com/watch?v=YMk7EfbemGY | octagon profiles; screw heads on solid walls; center of gravity; texture instead of through holes; one screw |
| https://www.youtube.com/watch?v=d6bt-QtZhqI | flat discs need depth; no multicolor; print-in-place clips vary by machine; matching bed and top faces |
| https://www.youtube.com/watch?v=rgV_mtfRLB0 | bowls printed rim down |
| https://www.youtube.com/watch?v=1n_R8shlGcs | 1.0 mm production wall floor; minimize bed contact; fillet vertical edges for speed |
| https://www.youtube.com/watch?v=iWHBH_T-xqI | moving-bed printers shake tall, thin and heavy parts loose |
| https://www.youtube.com/watch?v=uCxRJxvsoe0 | thin parts standing on a support comb; vertical racks need a fixed bed |
| https://www.youtube.com/watch?v=rszX16LFW3U | model brims, ears, textures and supports in CAD, not the slicer |
| https://www.youtube.com/watch?v=f4fJ5AbUF6Q | the print service's baseline settings; tree supports baked into the mesh; fuzzy skin changes dimensions |

### Brims, rafts and mouse ears

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=4GxZXxNraY0 | CAD brim one layer thick, ring brims, 0.5 mm break chamfer, REMOVE label |
| https://www.youtube.com/watch?v=3AZWuVRUh2c | brims, rafts and supports in CAD; removable channel block; tree supports exported into the mesh |
| https://www.youtube.com/watch?v=7KVh19WpOcc | CAD raft gap of one layer, 1 mm struts, one-layer relief under the raft |
| https://www.youtube.com/watch?v=4LTkVb6rP84 | raft gap 0.2 (0.15 matte, 0.1 fuses), 1 mm raft, corner pins, Z datum, kit tray |
| https://www.youtube.com/watch?v=ZpmiK0aY9VM | batching small parts on one raft card |
| https://www.youtube.com/watch?v=MCcFMDv_4eo | sprue mouse ears; labor dominates cost |
| https://www.youtube.com/watch?v=O33g62Kwq9s | 1 mm back plate as a raft; scaling flat mechanisms; variable infill for ballast |

### Designed supports

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=vnn4XeKQobs | fin tines flat in the layer plane, tine size, fin foot, placement; 2 mm edge land |
| https://www.youtube.com/watch?v=3VUQd_Tl5x0 | sprue size, fins inboard of corners; cube on an edge; vertical edge fillets |
| https://www.youtube.com/watch?v=8NKVNwVaZU0 | fin 0.5 to 1 mm behind a tilted part, break notches; boxes printed diagonally |
| https://www.youtube.com/watch?v=6gPPAiqSkBc | designed support beside an edge-standing part; grip fins cut free under the roots |
| https://www.youtube.com/watch?v=m3Cxw-j19bU | cup support with 0.2 mm gap; sphere truncation; no gaps under 0.2 mm |
| https://www.youtube.com/watch?v=B6r8m93MNGQ | pointed support towers with 0.5 mm contact; a flat cropped on a round hub |
| https://www.youtube.com/watch?v=YL5lYEXbLDo | thumbtack supports with a 1 mm stem; supports not scaled |
| https://www.youtube.com/watch?v=udEeJjzEQZI | dome interiors; mushroom support |
| https://www.youtube.com/watch?v=WYQbxIVLz6Y | tapered support with a rounded contact; fillets end horizontal |
| https://www.youtube.com/watch?v=3Acks3Wzjjo | support comb for tall thin parts, 1 mm fingers |
| https://www.youtube.com/watch?v=DnPu7slvBVk | breakaway outrigger fins; raised text 0.5 to 0.75 mm; smooth text on a textured face |
| https://www.youtube.com/watch?v=4wRKmcWXEkw | support block in a print-in-place channel; peaked ceilings in moving gaps |
| https://www.youtube.com/watch?v=6DkCCOc5O1Y | 1 mm sprue under a snap tab, left to break on assembly |
| https://www.youtube.com/watch?v=SWOnmWCi6bY | designed support posts at about 0.3 mm |
| https://www.youtube.com/watch?v=Iauvzy5mR90 | blunt tips; tie first-layer islands; spiked supports; check walls after scaling |

### Overhangs, edges and fillets

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=ZgrlGfftm0k | islands grown from the body; mesh defects; pigment and nozzle wear |
| https://www.youtube.com/watch?v=WfP-ZOnlFPM | rods lying down with a flat or a hex to octagon section |
| https://www.youtube.com/watch?v=IrvxX0MtGMM | non-tangent curve for a rounded bottom edge; contradictory overhang angles |
| https://www.youtube.com/watch?v=m20UPm0TOto | truncated bottom curves; angled vent slots; merged standoffs; one flat datum face |
| https://www.youtube.com/watch?v=tb1yqVOyAM8 | arcs under a semicircle; adhesive-strip pockets |
| https://www.youtube.com/watch?v=EoIlALcMJB8 | thin tabs need margin; color flipped a marginal overhang; metal hook bundled |
| https://www.youtube.com/watch?v=FMs-VGAu_PQ | chamfer over fillet under a ledge; steeper at high volume |
| https://www.youtube.com/watch?v=C0H_4fOm9CQ | vertical fillets cut print time about 2.5 to 3 percent, reduce ringing |
| https://www.youtube.com/watch?v=NaQ_Sa1BaqU | fillet top edges; light colors scrap more |
| https://www.youtube.com/watch?v=oz51t5p9gXo | blunt knife edges to about one nozzle width (auto-caption value) |
| https://www.youtube.com/watch?v=aWz1mz4hhu8 | features at least one nozzle wide; text depth limits; 1 mm fillet at a hole rim |
| https://www.youtube.com/watch?v=3BIvSiuQVWQ | edge breaks at hole rims; ring of holes 2 mm from a hole; grip fins absorb 0.1 to 0.2 |
| https://www.youtube.com/watch?v=Wd0MR4sPcK0 | screw heads on solid material; fillet to avoid nozzle catch; 1 mm per side housing fit |

### Orientation

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=8TIhkxQNINY | box turned 45 deg on a landing, no interior supports |
| https://www.youtube.com/watch?v=csUGcIPNNkk | bracket on a cropped corner; thumb screws printed flat |
| https://www.youtube.com/watch?v=lGnpz8q4STw | enclosures on an edge; strap slots parallel to layers; mounting lugs |
| https://www.youtube.com/watch?v=jNguIjkLo6g | enclosure on a corner with a rib; chunky standoffs |
| https://www.youtube.com/watch?v=-gm6hzbAqLk | cube on a corner; bottom cavity; 1 mm bed chamfer |
| https://www.youtube.com/watch?v=reIXSlL6mKA | peaked part on a cropped apex about 6 mm wide |
| https://www.youtube.com/watch?v=W5WdUF4Y_FI | tilted parting plane for enclosure halves |
| https://www.youtube.com/watch?v=31FVZIg4rDs | parting line below the ports; relief patterns, not through-cuts; the 0.1 mm co-printed gap (not adopted) |
| https://www.youtube.com/watch?v=Jps5YPF2iRU | bed contact as a narrow chamfered seam; very low infill for bulk |
| https://www.youtube.com/watch?v=WVTJOAeZLQ8 | narrow seam contact on a side-printed part |
| https://www.youtube.com/watch?v=yFUBXBoDT4I | long parts across the bed diagonal |
| https://www.youtube.com/watch?v=_y8Yvu1FQIE | ring clips printed on the side at 45 deg |
| https://www.youtube.com/watch?v=oYEV-ndgwdk | loops in the layer plane; internal channel loops |

### Walls, ribs, strength and test data

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=qpo4WsEeYJo | 1 mm default wall, about 20 percent infill; 0.3 mm layers (not adopted) |
| https://www.youtube.com/watch?v=UfJIMn4nvsA | mid-thickness disc cuts around screw holes |
| https://www.youtube.com/watch?v=81qmDc5unYM | ribbed rods, side loops, handles, ring clips |
| https://www.youtube.com/watch?v=OcxfQeeKn-s | truss patterns as 0.2 mm internal slots |
| https://www.youtube.com/watch?v=8vz9b0zNMVg | self-supporting rib shapes, diagonal ribs |
| https://www.youtube.com/watch?v=GDEMxa4WdRw | shear web on an upright arm; offset fold pivot |
| https://www.youtube.com/watch?v=as84ZBjdmxU | blended bracket junctions; start from a block |
| https://www.youtube.com/watch?v=AURCtaRrUGM | cavities do not lighten; enclosed cavities to force walls |
| https://www.youtube.com/watch?v=boN1uiaIdVA | 0.5 mm microfeature holes (contradiction); consolidation on a through rod |
| https://www.youtube.com/watch?v=ZNX7Mzjq_fk | infill versus cantilever strength table |
| https://www.youtube.com/watch?v=-LHQtlxYQII | infill versus compression, 50 percent ceiling |
| https://www.youtube.com/watch?v=IIS9UagZaWI | infill patterns crushed: cubic strongest |
| https://www.youtube.com/watch?v=SEfEicLNAfc | infill patterns crushed: grid or triangle (contradiction) |
| https://www.youtube.com/watch?v=PQHKQH5imkI | wall thickness versus compression (pound values only) |
| https://www.youtube.com/watch?v=5CFVcPYFEiE | compression by material |
| https://www.youtube.com/watch?v=FaFY1mIVBvw | claims not adopted (15 percent Z loss, under 0.1 mm); labor dominates cost |

### Warping and shrink lines

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=iPZoDltS30A | checkerboard base relief, rippled walls, corner cavities |
| https://www.youtube.com/watch?v=d61u_lKFa-U | floor groove against shrink lines; texture hides them |
| https://www.youtube.com/watch?v=cdyqNocFCpQ | thick zones beside thin walls; drawer printed with its case |
| https://www.youtube.com/watch?v=SSHoQLuVJFk | first-layer islands tied into one outline |
| https://www.youtube.com/watch?v=rsfZgT3ZEI8 | 0.3 mm connectors tying spring tips on the first layer |

### Text, texture and color

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=upf9ixYtDG4 | side-wall text depths and height; side text twice as crisp; light colors give low contrast |
| https://www.youtube.com/watch?v=TH82TSjI67I | engraved 0.5 on a side; engrave on top faces; hidden subsurface text |
| https://www.youtube.com/watch?v=FVZ5wAzNAB0 | texture options; 0.2 mm default layers |
| https://www.youtube.com/watch?v=jIanWhvsWMc | CAD texture before height map before fuzzy skin |
| https://www.youtube.com/watch?v=scv4am8kbqs | white shows every defect |
| https://www.youtube.com/watch?v=iiCsQIN_PyQ | simple first layer; light colors stain |
| https://www.youtube.com/watch?v=22p4ThOfEO0 | titanium dioxide white is abrasive and pasty |
| https://www.youtube.com/watch?v=DiupjIdI3KQ | color varies spool to spool; lot control |
| https://www.youtube.com/watch?v=rUUq4kgi7t4 | one continuous outline per layer (fin handles) |
| https://www.youtube.com/watch?v=vcgsQyMSSiY | vent slots at an angle; no grids of small holes |

### Holes, pins, fits, joints and lids

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=uMA-Wt-z_BU | vertical pins: cross section, wrinkled outline, taper |
| https://www.youtube.com/watch?v=Iyxp_Rjz3wo | keyhole pins and tapered tabs |
| https://www.youtube.com/watch?v=sza8wg5FIxQ | oval side holes; insert boss 1 to 2 mm (not adopted); thread size floor |
| https://www.youtube.com/watch?v=yzg_NXM-NRs | grip fins: free-cut, chamfered starts, trapezoid, trade-offs, material |
| https://www.youtube.com/watch?v=GRlX27WgySQ | PLA grades; wider tolerances lower cost; PLA flexes enough for fins (contradiction) |
| https://www.youtube.com/watch?v=IZKh6lo9SP4 | lid lip contact reduced; fins with 0.3 mm gap |
| https://www.youtube.com/watch?v=7YAylxQFe3k | bayonet lids; triangular thread flanks; press-on lids |
| https://www.youtube.com/watch?v=RTQjvYENR7w | sprung T-slot, round slot, clicking tongues |
| https://www.youtube.com/watch?v=djm5tCFn9S0 | diamond pegs, S-clips, C-clips |
| https://www.youtube.com/watch?v=xog9YlMt9UU | fins in slots instead of pins; cone pins; at most two locators |
| https://www.youtube.com/watch?v=qXHjM_L3vi0 | sprung shaft socket; small printed threads (not adopted) |
| https://www.youtube.com/watch?v=CpQGNRWWXs8 | drawer printed in place with its frame; shipping sprue |

### Hardware, glue, hinges and springs

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=BwUzOJ8B_H0 | magnet paired with steel; cylindrical magnets; side entry past center; pause costs pull |
| https://www.youtube.com/watch?v=WMbmDfGEygk | captive nut dropped into a channel without a pause; pauses idle the printer |
| https://www.youtube.com/watch?v=F3ViXSLH_ZM | nut side slot with friction lock; halves on hex pegs; insert for a premium thread |
| https://www.youtube.com/watch?v=d0BGz4nRjus | weight capsules instead of poured weight |
| https://www.youtube.com/watch?v=Nsv3YSTDYmA | glue injected through a bore; spiral indicator groove |
| https://www.youtube.com/watch?v=qV1xXXbzM4Y | glue pits, relief cuts, marked pads, glue channels |
| https://www.youtube.com/watch?v=7-LP9UcdAWc | identical halves; a liner for liquids |
| https://www.youtube.com/watch?v=BWsUk1xSSn4 | pin hinge orientation; cone and double-cone pins; kerf hinges |
| https://www.youtube.com/watch?v=TiEyFle6lTM | living hinge types; axle orientation trade-off; reject rate |
| https://www.youtube.com/watch?v=AAKsl8zW-Ds | print-in-place mechanisms; planar springs |
| https://www.youtube.com/watch?v=wpriGP45Unw | planar zigzag, membrane and spiral springs |
| https://www.youtube.com/watch?v=Lmr4LKI0Hfc | printed threads in backstopped compression |
| https://www.youtube.com/watch?v=hSP9CkqhZSQ | feet: side printing, chamfers, rubber-foot pockets |
| https://www.youtube.com/watch?v=m1HG1nBTD0E | side loops and zip-tie lugs |
| https://www.youtube.com/watch?v=FF4D_Moywgk | chamfered mounting tabs and clips; double-chamfered wire loops |
| https://www.youtube.com/watch?v=NLeTvSaPJIs | bracket wrapping an extrusion |
| https://www.youtube.com/watch?v=bO39lWkaspA | rain-shedding vents |
| https://www.youtube.com/watch?v=prMUfQ9y7Rk | gasketless labyrinth lid |
| https://www.youtube.com/watch?v=Yk0I4Tf-E8c | watertight claims (not adopted as general) |
| https://www.youtube.com/watch?v=cbxD8Oz9L8Q | watertight floats without overhangs or support interfaces |
| https://www.youtube.com/watch?v=MiCRp2uV1MM | ESD-safe and flame-rated enclosure materials |

### Materials

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=3gxsLZITN2c | TPU 95A stiffness by infill |
| https://www.youtube.com/watch?v=XtU0p-bdZMo | TPU tuned to a target hardness by pattern |
| https://www.youtube.com/watch?v=pZLxi9OaFLg | one TPU grade, soft to solid |
| https://www.youtube.com/watch?v=3WvN8uVnSpU | TPU enclosure infill; TPU not auto-ejected |
| https://www.youtube.com/watch?v=vE0806yUq7U | PETG overhangs against layer bonding; gloss by color |
| https://www.youtube.com/watch?v=0rdIIvhLghw | carbon fiber wears a brass nozzle in about 500 g |
| https://www.youtube.com/watch?v=kQ8FkVi-Kes | fine features in carbon-fiber prints are brittle |
| https://www.youtube.com/watch?v=rYjZvSz2O_M | qualitative impact and abrasion by material |
| https://www.youtube.com/watch?v=qDcskdl16UM | striking faces in ABS or nylon with metal on wear faces |
| https://www.youtube.com/watch?v=nF5k_tmQ7k0 | UV behavior by material (PETG outdoor default not adopted) |

### Production consistency, quality, consolidation and cost

| URL | Supports |
| --- | --- |
| https://www.youtube.com/watch?v=PbGnxQifEq0 | written QC standard; bottom cavity; bought-part variation; color changes fit |
| https://www.youtube.com/watch?v=wuoF0xLxZcM | one machine model, controlled supply, climate control; QC checklist |
| https://www.youtube.com/watch?v=vpKJZOfMO0c | the farm's per-part checks |
| https://www.youtube.com/watch?v=qD0vnoo5kh0 | QC checklist contents and sampling |
| https://www.youtube.com/watch?v=9JC8KOVKoIE | reject-rate target; assemblies that cannot go in backwards |
| https://www.youtube.com/watch?v=uvnJ9E7_VWA | 5 molded parts and 2 screws to 2 printed parts |
| https://www.youtube.com/watch?v=BTIoITF3P8U | 6 molded parts to 1 |
| https://www.youtube.com/watch?v=plzcdgsNn4M | about 35 to 55 parts to under 20 |
| https://www.youtube.com/watch?v=u52ypRRQV3c | clamp halves and pin to one part |
| https://www.youtube.com/watch?v=cbtVDk3R6XI | three parts to one; flex tabs in the layer plane |
| https://www.youtube.com/watch?v=9qe-_ClObaw | about two distinct bought items |
| https://www.youtube.com/watch?v=t0mCGcM2w7g | the one quoted cost case against injection molding |

## Other processes

Listed as S-keys at the end of [other processes](other-processes.md) (research
file 02; S22 and S23 upgraded and S52 to S61 added by the follow-up pass).

## Read in the follow-up pass, nothing adopted

These were read in full and confirm the playbook or add no numbers:
https://formlabs.com/blog/design-for-manufacturing-with-3d-printing/ (no
numeric printing rules),
https://markforged.com/resources/blog/design-for-additive-manufacturing-dfam
(no numeric FFF rules), https://markforged.com/resources/blog/threading-the-needle-with-ease
(fiber width, not threads), https://www.slant3d.com/blog (one service
article, no design guide), https://the3dprintingnerd.com and https://toms3d.org/
(indexes), https://www.xometry.com/finishes/ (summary only),
https://www.protolabs.com/resources/design-aids/ (no 3D printing design aid:
supports building the house test print), https://www.cnckitchen.com/tools (no
insert tool) and https://www.ruthex.de/pages/dokumente-downloads (soldering-iron
manuals only).

## Other published thresholds compared

The playbook's values were compared with thresholds published by other tools:
the open-source text-to-cad project's DFM rule table
(https://github.com/earthtojake/text-to-cad/pull/816; its numbers are "as
cited there", UNVERIFIED at their original pages), ForgeCAD's built-in print
check, and this repository's own enclosure-cad (`packages/ext-enclosure-cad`)
and frame-cad (`packages/ext-frame-cad`) extensions. The thresholds and the
playbook's choices are in [FDM rules](fdm-rules.md) section 11, "Comparison
with other published thresholds".

## Gaps

What the research could not verify; values that depend on these are labeled
in place.

1. **Overhang angle as a function of layer height:** atan(0.5 W / L) is
   derived from the Hubs "50 percent support" statement, not measured.
2. **Hole compensation:** no single measured table of "add X for diameter D";
   one composite formula was seen only as a search excerpt.
3. **Gothic-arch horizontal holes; support-free thread profiles:** no primary
   source. Diamond holes and pegs now have a practitioner source (Slant 3D,
   https://www.youtube.com/watch?v=vsHpiHhB3RU).
4. **Warping versus geometry** (partly closed): practitioner techniques now
   exist (checkerboard relief slits in a base, rippled or bowed walls, corner
   cavities, raft reliefs, sprue mouse ears; FDM-BED-9, FDM-BED-10) from one
   production print farm, with one demo plate and no measurement. Still open:
   a measured study of footprint size, corner radius or rib layout versus
   lift, and a sourced maximum flat footprint for any material.
5. **FDM rib and gusset ratios:** none found; molding ratios do not transfer.
   Practitioner rib shapes that self-support now exist (FDM-STR-11), still
   without a ratio.
6. **Seam crack initiation on round bosses:** practitioner lore only.
7. **High-speed machines:** no source quantified how much faster printing moves
   the overhang, bridge or accuracy numbers.
8. **Creep:** short-term only; no allowable sustained stress vs time for any
   FDM material; heat-set insert pull-out after aging not covered.
9. **Snap-fit strain** for ABS, ASA, PC and nylon: extrapolated from molding
   data and Z derating; no FDM fatigue data. No direct PLA vs PETG flexure
   fatigue test (the playbook's strain comparison is derived).
10. **Shrink percentages:** calculator sites, not data sheets.
11. **PCTG, PP, BVOH, HIPS:** no primary data sheet read.
12. **Per side vs total unstated** (partly closed): Markforged's fit table is
    now known to be diametral (press 0 to 0.05, close 0.05 to 0.10, free 0.10
    to 0.20). Still unstated, normalized by inference where used: Hubs snap
    clearance, Fictiv, the Orca tolerance test, Bambu cut-connector tolerance,
    Xometry's FDM clearances (0.5 moving, 0.2 to 0.3 sliding), HP's 0.4 mm MJF
    assembly gap (read as per side), Slant 3D's "about 0.25 larger" vertical
    pin hole, Shapeways and Sculpteo clearances, Unionfab's 0.3.
13. **Bambu** (mostly closed): H2C bed 120 C; P1S 256 mm cube, 300 C stainless
    nozzle, 0.2 to 0.8, bed 100 C, passive enclosure; X1C 256 mm cube, 300 C
    hardened nozzle, 0.2 to 0.8, bed 110 C (220 V) / 120 C (110 V), passive
    enclosure; A2L open bed slinger, bed 80 C; stock line widths 0.42 outer,
    0.45 inner and sparse infill, 0.5 first layer; H2D Pro specs read; R1 is a
    laser cutter. Still open: nozzle and bed behavior during a pause, the A1
    mini's maximum AMS unit count, the reason for the A2L's 80 C bed, the
    P2S's 50 C chamber on a spec page, H2D Pro nozzle sizes.
14. **No numeric FDM source** (partly closed): flexures now have practitioner
    values (leaf 0.5 mm minimum, 1.0 stiffer, taper 1.0 to 0.5, line-width
    multiples, root fillets) but no fatigue data; square nuts are preferred
    over hex in slots and embeds (practitioner and vendor) with no
    print-specific clearance. Zip-tie lugs and loops, threaded and bayonet
    lids and glue injection now have practitioner geometry without numbers
    ([hardware](hardware.md) sections 11, 13 and 15). Still open: heat
    staking, numeric zip-tie slot sizes, O-ring grooves in prints, a proven
    threaded-lid profile, D-shafts, RFID and spring embedding, glue bond-line
    gap, reuse count for screws in plastic, magnet loss on hot beds.
15. **ruthex official insert datasheet:** closed. Read at a reseller (official
    ruthex document, agreeing with ruthex.de): M2 hole 3.2 (L 4.0), M2.5 4.0
    (L 5.7), M3 4.0, M4 5.6, M5 6.4, M6 8.0, M8 9.6 (OD 10.1); walls as CNC
    Kitchen except the Voron-style M3 at 1.3; depth L + 1.
16. **Print-in-place Z gap of two layers** and the unknown-printer clearance
    column are not directly sourced.
17. **Other processes** (partly closed): Desktop Metal binder jet now read in
    full (archived copy: shrink to about 20 percent, scale to 25 percent,
    overhang 7.5 mm, bridge 20 mm, 30 deg, walls 0.75 to 25 mm); MJF escape
    holes confirmed in an HP-authored deck (at least two, 5 mm, aligned on
    opposite faces), though not on an hp.com page. Still open: the metal PBF
    50 deg overhang reading (Protolabs gives 45 minimum, 316L 55);
    continuous-fiber tolerances; a vendor-neutral spec for desktop MSLA
    printers (Formlabs values used as a proxy).
18. **Unread creator and vendor sources:** closed for Xometry's FDM guide (the
    older public PDF), Markforged's DfAM page, Made with Layers (nine videos),
    Teaching Tech (three), two maker videos, 3D Printing Nerd (one) and the
    Slant 3D written blog (no design guide), and now for Slant 3D videos
    xog9YlMt9UU and 3AZWuVRUh2c (read in the production-farm pass, gap 23).
    Still not read: Teaching Tech design series parts 1 to 3, 6 and 7; Made
    with Layers' PLA and ABS material videos (unmvWkfpmRE,
    YCdvL87bv0w) and 30-filament review (fjhW2NiILZc); Protolabs'
    surface-finish PDF and its material and cost tips; Xometry's MJF, binder
    jet, Carbon DLS, CNC, sheet and laser guide pages, /technical-resources/
    and /materials/; Sculpteo resin and FDM material pages.
19. **Printed thread axis:** one source's test suggests a thread with its axis
    vertical is the worse case, which may contradict "never in horizontal
    holes"; the video does not make the axis unambiguous. The rule stands
    until coupon C20 ([test coupons](test-coupons.md)) decides.
20. **Single-sample and chart-only data:** Made with Layers' Z fractions,
    impact fractions and stiffness comparison are single samples on stock
    profiles; its temperature-test strength values were on charts, so only
    trends were captured.
21. **Conflicting vendor numbers:** Protolabs' FDM minimum feature 0.2 vs 2.0
    mm, industrial FDM accuracy 0.25 vs 0.3 percent, SLA wall 0.254 to 1.0 mm,
    MJF gap 0.508 vs 0.762 mm, unit-conversion errors in its tolerance tip and
    a wall typo for one resin; Xometry's current gated guides may differ from
    the older public PDFs read; HP's MJF handbook was read only to page 40
    (Protolabs-hosted copy).
22. **Print-service settings** (closed): the Slant 3D service's baseline,
    previously available only as an image, is stated aloud in
    https://www.youtube.com/watch?v=f4fJ5AbUF6Q: 0.2 mm layers, 1 mm walls,
    25 percent infill, supports generated past 50 deg, no brim, and a 0.3 mm
    first layer (that reading UNVERIFIED). Recorded in
    [production runs](production-runs.md) section 7; the 50 deg threshold is
    not adopted over FDM-OVH-1.
23. **Production-farm videos: caption quality and the unread remainder.** The
    234 videos read were taken from auto-captions, which drop leading decimals
    ("2 mm" spoken for 0.2) and garble some numbers; every value reconstructed
    from context is status `unverified` and must be checked against the video
    or a coupon. Several numbers were shown on screen in CAD and never spoken,
    so they are "not stated" (fin slot clearance, sprue neck size, cone angle
    reference). Not read: 294 of the channel's 528 non-podcast videos (most of
    them business, news or product promotion, plus 10 design videos, of which
    two were already sources and two are segments of compilations that were
    read) and all 121 podcast episodes. The list worth a later pass is in
    `docs/specs/dfm-research/10-slant-3d-videos.md` section 7.
24. **Production-farm test data:** single specimens, settings often unstated,
    and in one video newton values that do not match the pound values
    ([FDM rules](fdm-rules.md) section 9.1). Trends only.

### Unreachable sources, and why

So nobody repeats these attempts blindly:

| Source | Why it was not read | Read instead |
| --- | --- | --- |
| Xometry FDM, SLS and SLA design-guide pages (https://www.xometry.com/resources/design-guides/design-guide-fused-deposition-modeling-fdm-3d-printing/ and its SLS and SLA siblings) | an inline lead form asking for name, work email, phone and company must be submitted (SLA adds a reCAPTCHA); not a closable pop-up | the older public PDFs on cdn2.hubspot.net |
| Markforged Composites Design Guide white paper | lead form; not submitted | Markforged's public blog and design-tips pages |
| HP MJF handbook at https://reinvent.hp.com/us-en-3dprint-mjfhandbook | registration form; not submitted | the Protolabs-hosted HP handbook (to page 40) and the HP-authored deck and white paper |
| EOS design courses on store.eos.info | paid content | EOS design-rule PDFs hosted by resellers |
| Desktop Metal Binder Jet Design Guide at its original desktopmetal.com URL | redirects to another company's home page (the site has moved) | the public web.archive.org copy |
| Protolabs design aids (Design Cube, material cards) | ordering is a request form; not filled | the public descriptions |
| Made with Layers' self-forming thread geometry | exists only in a linked CAD document, not as text | the video transcript |
| Slant 3D print-service settings table | published as an image | the search excerpt; now closed by the service video (gap 22) |
| Bambu /en/p1/tech-specs and /en/x1/tech-specs | return 404 | the official spec PDFs |
| Xometry's HubSpot CNC guide PDF | returns 404 | not needed for printing |
