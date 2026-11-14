# 08: Skipped sources, addendum

Follow-up to research lanes 01 to 04 and 06. An earlier pass skipped or only partly
read several sources, some because a contact or sign-up form appeared over the
page. This pass went back and read them, then compared each finding with what
the playbook in `packages/ext-dfm` already adopted (`profiles/fdm.json`,
`profiles/printers-bambu-lab.json` and the `skills/dfm-3d-printing/references/`
files). No playbook file was edited. Accessed 2026-11-12.

How the pages were read: as extracted page text (markdown, raw HTML, PDF text,
or a targeted extract), as transcripts for videos, and in a browser for the two
pages that did not render as extracted text. No form was filled or submitted,
no account was created, and no terms or cookie banners were accepted. In
practice the text extraction received the
server-rendered text, so the "pop-ups" never blocked a read. Where a page was
blocked, it was by an **inline lead form that must be submitted** (not a
closable overlay). Each such case is listed below with the public copy that was
read instead.

Tags: **MEASURED** a physical test with numbers; **VENDOR** a printer maker's,
material maker's or service bureau's own guidance; **PRACTITIONER** an
experienced designer's advice without published test data; **UNVERIFIED** not
confirmed at a primary source, or an inference. Every value is paraphrased. A
clearance is labeled **PS** (per side, one mating face) or **DIA** (diametral,
total). "Not stated" means the source does not say which.

---

## 1. Sources: what was read

### 1.1 Made with Layers (Thomas Sanladerer)

| URL | Read | Method, pop-up | Blocker |
| --- | --- | --- | --- |
| https://www.youtube.com/watch?v=HgEEtk85rAY (better ways to add threads, 2025) | full | transcript | none |
| https://toms3d.org/2025/01/14/a-better-way-to-add-threads-to-your-3d-prints/ | full | scrape | The self-forming thread geometry exists only in a linked Onshape document, not captured |
| https://www.youtube.com/watch?v=lYXTiJo_FQQ (M5 inserts not made for prints, torque tests) | full | transcript | none |
| https://www.youtube.com/watch?v=eNMAFTeowFs (do you need threaded inserts, M3 to M8) | full | transcript | none |
| https://www.youtube.com/watch?v=nV3GbN6hLjg (rethink infill, equal-mass tests) | full | transcript | none |
| https://www.youtube.com/watch?v=WgXM2zPusXo (0.4 mm nozzles obsolete) | full | transcript | none |
| https://www.youtube.com/watch?v=YJdkE7A8stM (right print temperature) | full | transcript | Strength values were on charts, so only trends were captured |
| https://www.youtube.com/watch?v=a6m_GnN5j4c (resin vs PETG vs PLA strength) | full | transcript | none |
| https://www.youtube.com/watch?v=8_adY2K-YIc (things to know about PETG) | full | transcript | none |
| https://www.youtube.com/watch?v=Fgbxgz5S2dc (upgrade your car, design process) | full | transcript | none |
| https://toms3d.org/2026/02/10/the-prusa-core-one-l-is-so-hot-right-now-does-it-handle-engineering-filaments-better-than-the-h2c/ | full | scrape | none |
| https://toms3d.org/ | full (index) | scrape | none |

Nine videos and two articles were read in full. Made with Layers publishes no
clearance or print-in-place values in anything found. Two videos a search
attributed to the channel were by other creators and were excluded.

### 1.2 Xometry

| URL | Read | Method, pop-up | Blocker |
| --- | --- | --- | --- |
| https://www.xometry.com/resources/design-guides/design-guide-fused-deposition-modeling-fdm-3d-printing/ | could not read the guide on this page | browser: the page shows only a table of contents beside an inline lead form | Form asks for name, work email, phone and company; the guide requires submitting it. Read instead the public PDF below |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_FDM.pdf (FDM guide v2.1, 13 pages) | full | PDF, opens directly | Older version than the gated one |
| https://www.xometry.com/resources/3d-printing/mini-guide-fdm-3d-printing/ | full | scrape; a contact form at the bottom was ignored | none |
| https://community.xometry.com/kb/articles/745-fdm-3d-printing | full | browser (text extraction timed out; page needed about 5 s to render) | none |
| https://www.xometry.com/manufacturing-standards/ (S21) | full | scrape | none |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_SLS.pdf | full | PDF | gated page version not read |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_SLA.pdf | full | PDF | gated page has newer sections |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_DMLS.pdf | full | PDF | none |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_PolyJet.pdf | full | PDF | none |
| https://cdn2.hubspot.net/hubfs/340051/Design_Guides/Xometry_DesignGuide_InjectionMolding.pdf | full | PDF | none |
| https://xometry.pro/wp-content/uploads/2024/05/EN-EU-MJF-Design-Guide.pdf (S22, 29 pages) | full | PDF | none |
| https://xometry.pro/en-eu/3d-printing-design-guide/quick-guide/ (eight-process table) | full | scrape; a login modal in the markup was ignored | none |
| https://xometry.pro/en/articles/fdm-design-tips/ | full | scrape | none |
| https://www.xometry.com/capabilities/vapor-smoothing/ | full | scrape | none |
| https://www.xometry.com/finishes/ | partly | scrape | summary page, no design numbers |
| https://www.xometry.com/resources/design-guides/design-guide-selective-laser-sintering-sls-3d-printing/ and the SLA guide page | could not read | scrape | Same inline lead form (SLA also has reCAPTCHA). Public PDFs read instead |
| MJF, binder jet, Carbon DLS, color, CNC, sheet metal, laser cutting guide pages; /technical-resources/; /materials/ | not read | | Budget; their headline tolerances are on /manufacturing-standards/. The HubSpot CNC PDF returned 404 |

### 1.3 Markforged

| URL | Read | Method | Blocker |
| --- | --- | --- | --- |
| https://markforged.com/resources/blog/design-for-additive-manufacturing-dfam | full | scrape | none; confirms it has no numeric FFF rules |
| https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips | full | scrape; fit-table wording re-checked by a second targeted extract | none |
| https://markforged.com/resources/blog/embedding-nuts-3d-printing | full | scrape | none (was SNIPPET) |
| https://markforged.com/resources/blog/embedding-components-in-3d-printed-parts | full | scrape | none |
| https://markforged.com/resources/blog/joinery-onyx | full | scrape | none |
| https://markforged.com/resources/blog/3d-printed-unit-tests | full | scrape | none |
| https://markforged.com/resources/blog/heat-set-inserts | full | scrape | none |
| https://markforged.com/resources/blog/threading-the-needle-with-ease | full | scrape | none (about fiber width, not threads) |
| .../fiber-reinforcement-strategies, .../3d-printing-settings-impacting-part-strength, .../blog/designing-a-3d-printed-tesla-turbine-part-2 | partly | targeted extract | none |
| Composites Design Guide white paper | could not read | | Lead form; not submitted |

A plain HTTP fetch returned 403 on markforged.com; a rendering scrape worked. A chat widget's
text appeared in the scrapes and was ignored.

### 1.4 Slant 3D

| URL | Read | Method | Blocker |
| --- | --- | --- | --- |
| https://www.slant3d.com/blog (JavaScript app) | full | scrape with a 6 s render wait | none; only one design-tagged written article exists |
| https://www.slant3d.com/blog/51fe073a-45f4-45ca-951b-84397418730a (print service settings, 2026-07-16) | partly | search excerpt | The settings table is an image; not read |
| https://www.slant3d.com/tangled | full | scrape | filament sales only |
| https://create.slant3d.com and /tools/enclosure | full (public landing) | scrape | interactive generators only; no sign-in attempted |
| https://www.youtube.com/watch?v=XKrDUnZCmQQ (perfect tolerance every time) | full | transcript | none |
| https://www.youtube.com/watch?v=vsHpiHhB3RU (connecting printed parts, compilation) | full | transcript | none |
| https://www.youtube.com/watch?v=YG_8wYoxVfs (compliant hinges) | full | transcript | none |
| https://www.youtube.com/watch?v=Lq-SoGgKOcQ (microfeatures) | full | transcript | none |

Slant 3D still has no written design-for-mass-production guide; its design
guidance is in videos and interactive tools.

### 1.5 3D Printing Nerd, Teaching Tech, Zack Freedman

| URL | Read | Method | Blocker |
| --- | --- | --- | --- |
| https://www.youtube.com/watch?v=QF5aZz2k0bg (3D Printing Nerd: printed nuts and bolts) | full | transcript | none |
| https://the3dprintingnerd.com | full | scrape | video index, no design articles |
| https://www.youtube.com/watch?v=noYuQlQN8pw (Teaching Tech design series part 4) | full | transcript | none |
| https://www.youtube.com/watch?v=yP7_qZ_Mi78 (Teaching Tech design series part 5, strong parts) | full | transcript | none |
| https://www.youtube.com/watch?v=xV36ITRjP_4 (Teaching Tech compliant mechanisms) | full | transcript | none |
| https://teachingtechyt.github.io/calibration.html | partly | targeted extract | calibration only |
| https://www.youtube.com/watch?v=ct-n2lI0I9g (Zack Freedman: 30 hacks and facts) | full | transcript | none |
| https://www.youtube.com/watch?v=MqirgLJnmZM (Zack Freedman: five printing mistakes) | full | transcript | none |

No dedicated Zack Freedman tolerance or hole video was found; several search
hits were other channels. Teaching Tech design series parts 1 to 3, 6 and 7
were not read.

### 1.6 Protolabs

| URL | Read | Method, pop-up | Blocker |
| --- | --- | --- | --- |
| https://www.protolabs.com/resources/design-tips/how-to-solve-for-size-constraints-small-gaps-and-thin-walls-in-3d-printed-parts/ | full | scrape; inline newsletter form ignored | none |
| https://www.protolabs.com/resources/design-tips/ and the design-tips library | full (list) | scrape | The library's 3D printing filter is JavaScript, so the full list was read and filtered by hand |
| 22 design tips: 3d-printing-tolerances, how-to-design-3d-printed-hinges, designing-for-selective-laser-sintering, designing-for-stereolithography, how-to-design-for-nylon-3d-printing, how-to-use-multi-jet-fusion-for-functional-3d-printed-parts, prototyping-with-polyjet-3d-printing, create-production-parts-with-carbon-3d-printing, 7-mistakes (S1), how-to-design-and-manufacture-metal-3d-printed-parts (S18), how-to-3d-print-flexible-parts, using-lattice-structures, 7-ways-to-enhance (secondary ops), powder-bed-fusion, designing-for-jigs-and-fixtures, mechanical-fastening, how-to-design-stl-files, post-processing-for-metal-3d-printing, adding-text-into-part-design, polyjet-overmolding, resin-3d-printing, vapor smoothing | full | scrape | none |
| https://www.protolabs.com/resources/blog/threading-and-inserts-for-3d-printing/ | full | scrape | none |
| https://www.protolabs.com/resources/design-for-3d-printing-toolkit/ (S2), all tabs | full | scrape | none |
| https://www.protolabs.com/resources/guides-and-trend-reports/ ; what-is-design-for-additive-manufacturing; metal-3d-printing-materials-guide (S19) | full | scrape | none |
| /media/1020535/protolabs_dmls_design_guide.pdf; /media/qjznvqcv/the-definitive-guide-to-3d-printing.pdf | full | PDF via the page's "if your guide does not download" link, no form | none |
| /media/sq1l5it2/hp_mjf_handbook.pdf (HP-authored, Protolabs-hosted, 105 pages) | partly (pages 1 to 40) | PDF | timeout on the full file |
| Service pages: 3D printing hub, fused-deposition-modeling, stereolithography, selective-laser-sintering, multi-jet-fusion, direct-metal-laser-sintering, polyjet, advanced-photopolymers (Carbon DLS now redirects here) | full | scrape | none |
| https://www.protolabs.com/resources/design-aids/ (US and en-gb), get.protolabs.com/design-cube/, explore.protolabs.com/3dp-selector/ | full (descriptions) | scrape | Ordering any aid is a request form; not filled |
| /media/g0qn4mgq/3dp-surface-finishes-guide.pdf; material and cost tips | not read | | Budget; judged low value |

### 1.7 Formlabs, Simple Machining, Unionfab (confirm full read)

| URL | Read | Note |
| --- | --- | --- |
| https://formlabs.com/blog/design-for-manufacturing-with-3d-printing/ | full | No numeric printing rules (only "CNC suits low volumes, under about 1,000"). The playbook does not cite it and misses nothing |
| https://simplemachining.com/blogs/dfm-for-3d-printing-a-practical-design-guide | full | Mostly captured already; misses listed in section 2.9 |
| https://www.unionfab.com/blog/2026/03/design-for-manufacturing-3d-printing | full | Mostly captured; one attribution error (section 3) |

### 1.8 Other skipped items

| URL | Read | Method | Blocker |
| --- | --- | --- | --- |
| EOS "Basic Design Rules for Additive Manufacturing" (polymer), https://www.3dpx.com/wp-content/uploads/2019/04/EOS-Basic-Design-Rules_Additive-Manufacturing_EN.pdf | full | PDF, EOS-authored, reseller-hosted | Some OCR noise; older machines (P 396, P 760, Formiga) |
| EOS "Design Rules for DMLS", https://3dimpuls.com/sites/default/files/download/dmls_design-rules_en.pdf | full | PDF, EOS-authored, reseller-hosted | Legacy tooling-insert note |
| https://www.eos.info/content/blog/know-how/how-to-make-a-3d-print-file | full | scrape | none |
| EOS design courses on store.eos.info | not read | | Paid courses |
| Shapeways /materials/pa12 | full | scrape; cookie banner text ignored | none |
| Shapeways MJF PA12, PA11, TPE, aluminum, steel, Somos WaterShed (SLA) material pages | partly | targeted extract of the design-guidelines section | none |
| Sculpteo plastics design-guidelines PDF, https://www.sculpteo.com/wp-content/uploads/2026/07/3D20printing20Plastics20Design20Guidelines-pdf.pdf | full | PDF | none |
| https://www.sculpteo.com/en/3d-learning-hub/design-guidelines/hollow-3d-printed-parts/ | full | scrape; a sign-up form in the text was ignored | none |
| Sculpteo SLS, MJF material pages; 3d-printing-tolerances page | partly | targeted extract | none |
| Desktop Metal Binder Jet Design Guide, https://www.desktopmetal.com/uploads/81-00239_Rev01_EN_Binder-Jet-Design-Guide.pdf | could not read at this URL | | Now redirects to another company's home page (Desktop Metal's site has moved) |
| Same PDF, public archived copy: https://web.archive.org/web/20250523083616id_/https://www.desktopmetal.com/uploads/81-00239_Rev01_EN_Binder-Jet-Design-Guide.pdf | full (22 pages, Rev01, December 2022) | PDF | Its notice calls the content proprietary; paraphrased and cited only |
| HP learning center, https://www.hp.com/us-en/printers/3d-printers/learning-center/how-to-design-3d-print-model.html | full | scrape | none |
| HP white paper 4AA7-2952ENW, https://h20195.www2.hp.com/v2/GetDocument.aspx?docname=4AA7-2952ENW | full | PDF | none |
| HP "Design for MJF parts" deck (copyright 2018 HP), https://www.ajatec.fi/wp-content/uploads/2024/02/Design_for_MJF.pdf | full | PDF, HP-authored, reseller-hosted | none |
| HP MJF Design Handbook (Special Edition), https://endeavor3d.com/wp-content/uploads/2025/06/HP-MJF-Design-Handbook_Special-Edition.pdf | partly | targeted extract | none |
| https://reinvent.hp.com/us-en-3dprint-mjfhandbook | could not read | | Registration form; not submitted |
| ruthex RX-series datasheet (ruthex GmbH, dated 2022-08-15), https://www.igo3d.com/mediafiles/Sonstiges/Ruthex/ruthex_Datenblatt_RX-Serie.pdf | full; table re-checked by a second extract | PDF, reseller-hosted | none |
| https://www.ruthex.de/en/collections/gewindeeinsatze and the M2 product page; ruthex table image on ruthex.de; ruthex drill-set page | full | scrape; an EU withdrawal modal appeared only as text | none |
| https://www.ruthex.de/pages/dokumente-downloads | full | scrape | only soldering-iron manuals |
| https://www.cnckitchen.com/tools | full | scrape | no insert tool |
| https://www.cnckitchen.com/store (redirects to https://cnckitchenus.store/), M3 x 5.7 product page, metric table images | full | scrape | none |
| https://bambulab.com/en/h2c/specs, /en/a2l/specs, /en/p2s/specs, /en/x2d/specs | full | scrape with 5 s render wait; cookie banner text ignored. H2C bed value re-checked | none |
| Bambu P1S spec PDF, https://store.bblcdn.com/s7/default/9e9c1948dd61491199a52c3f1497b9c7/bambu-lab-P1S-tech-specs.pdf | full | PDF | /en/p1/tech-specs returns 404 |
| Bambu X1 Carbon spec PDF, https://public-cdn.bambulab.com/store/X1-Carbon%20tech%20specs.pdf | full | PDF | /en/x1/tech-specs returns 404 |
| https://wiki.bambulab.com/en/software/bambu-studio/parameter/line-width | full | scrape | gives no number |
| Bambu Studio official process profile, https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/process/fdm_process_common.json and fdm_process_single_0.20.json | full | raw file | none |
| https://bambulab.com/en-us/h2d-pro/tech-specs; https://bambulab.com/en-us/r1; A1 mini pages | partly | targeted extract | none |

---

## 2. New rules and numbers not already in the playbook

Grouped by topic. "Value" includes units; "Condition" is when it applies.

### 2.1 Threads, screws and inserts in FDM

| Rule | Value | Condition | Reason | Source | Tag |
| --- | --- | --- | --- | --- | --- |
| Heat-set insert joints fail where the perimeter ring around the insert separates from the infill, not at the insert | every sample failed this way | PLA, M3 to M8 | Joint strength is set by the infill-to-perimeter bond; add perimeters or a solid modifier around the boss, or raise infill/perimeter overlap | https://www.youtube.com/watch?v=eNMAFTeowFs | MEASURED |
| Full-strength wall for an M5 heat-set insert | about 3.6 mm of solid perimeter (4 shells at 0.9 mm) with at least 20 percent infill; no gain above 40 percent infill | PLA, short M5 inserts, flat or on edge | Below this the part cracks before the insert pulls out; 30 percent infill and 4 shells is plenty | https://www.youtube.com/watch?v=lYXTiJo_FQQ | MEASURED |
| M5 torque to failure in PLA by insert type | heat-set 2.26 Nm; zinc furniture insert 2.03; rivnut melted in 1.6; rivnut riveted 1.2; helicoil in a modeled thread 2.4; self-tapping insert over 3.3 | PLA, average of samples | Self-tapping inserts must tear through the plastic; heat-set inserts slip out by stretching it | https://www.youtube.com/watch?v=lYXTiJo_FQQ | MEASURED |
| In PETG, PC and ABS, prefer self-tapping (threaded) inserts or deeper engagement over heat-set | heat-set weaker in PETG and PC blend than in PLA; self-tapping much stronger in PC blend | soft or tough materials | Engagement depth governs pull-out in softer plastics | https://www.youtube.com/watch?v=lYXTiJo_FQQ | MEASURED |
| Printed threads are weaker than an insert one size smaller | an M5 printed thread was often weaker than an M4 heat-set insert | PLA | Go 1 to 2 sizes up, or use an insert | https://www.youtube.com/watch?v=eNMAFTeowFs | MEASURED |
| Steel screws in printed threads are far over-specified | every option failed at about one fifth of grade 8.8 nominal torque or less (nominal M3 1.3, M4 3.0, M5 6.0 Nm) | PLA, M3 to M5 | Never torque a screw in a print to the metal table value | https://www.youtube.com/watch?v=eNMAFTeowFs | MEASURED |
| Cheap injection-molding inserts (no guide sleeve) perform close to print-specific heat-set inserts | similar torque | PLA | Displaced plastic flows into the bore below | https://www.youtube.com/watch?v=eNMAFTeowFs | MEASURED |
| Avoid wood screws and coarse plastic-thread screws in FDM | | FDM parts with hollow infill | The deep thread cuts through the perimeter shell into mostly empty infill | https://www.youtube.com/watch?v=HgEEtk85rAY | PRACTITIONER |
| Self-forming (tapless) hole: a hole slightly larger than the screw with three internal ridges | up to M5, for joints tightened once; for a horizontal hole point one ridge straight down | FDM | Displaced plastic has room to flow, so the perimeter is not stretched; ridge dimensions not published in text | https://www.youtube.com/watch?v=HgEEtk85rAY | PRACTITIONER |
| Tapping printed holes removes most of the perimeter; PLA melts on the tap | about a third of power-tapped M3 PETG threads ruined | PLA, PETG | Prefer inserts | https://www.youtube.com/watch?v=eNMAFTeowFs | MEASURED |
| Self-tapping hole: tap drill + 0.4 mm | M3 2.9 mm; M4 3.9 mm (DIA) | PLA | Easier driving than a tight pilot; matches the 96 percent of major diameter rule | https://www.youtube.com/watch?v=yP7_qZ_Mi78 | PRACTITIONER |
| Long tapped thread in ABS/PC | about 20 mm engagement at M5 with 8 solid top and bottom layers and one extra perimeter, nearly screw strength | ABS/PC | Solid material around the thread | https://www.youtube.com/watch?v=Fgbxgz5S2dc | PRACTITIONER |
| Printed thread fit by scaling | shrink the male part 2 to 6 percent in XY (Z unchanged); about M12 turned freely at 375 vs 400 percent scale | FDM, coarse threads | Bead spread and hole shrink | https://www.youtube.com/watch?v=QF5aZz2k0bg | PRACTITIONER |
| Printed screw heads: Phillips or slotted, not hex socket | | FDM | A printed hex socket strips | https://www.youtube.com/watch?v=QF5aZz2k0bg | PRACTITIONER |
| Heat-set insert iron temperature for engineering composites | 343 to 399 C (650 to 750 F) | Onyx/nylon composite | Higher-melting polymer | https://markforged.com/resources/blog/heat-set-inserts | VENDOR |
| Tapered insert hole, CAD method | counterbore at the top diameter, then a distance-distance chamfer of (top - bottom)/2 over the full depth; Markforged's M3 example 5.31 top, 5.10 bottom, 3.8 deep | tapered inserts only | Matches the insert taper | https://markforged.com/resources/blog/heat-set-inserts | VENDOR |
| ruthex inserts: rows not in the playbook | M4 short 4.0 L, hole 5.6, wall 2.1; M5 short 5.8 L, hole 6.4, wall 2.6; M6 short 6.8 L, hole 8.0, wall 3.3; M10 12.7 L, OD 12.6, hole 12.0, wall 6.0; #2-56 4.0 L, hole 3.2, wall 1.3; #10-24 9.5 L, hole 6.4, wall 2.6; 3/8"-16 12.7 L, hole 11.9, wall 6.0 (all DIA, finished hole) | ruthex RX series | Depth L + 1 mm minimum, blind or through | ruthex datasheet (igo3d-hosted) and ruthex.de table image | VENDOR |
| CNC Kitchen inserts: rows not in the playbook | M4 x 4 and M5 x 5.8 (holes 5.7, 6.5); M10 x 12.7 (OD 12.6, hole 12.0, wall 6.0); #10-24 and #10-32 (9.5 L, hole 6.5); 5/16"-18 (as M8); 3/8"-16; G1/8"-28 (OD 12.5, hole 12.0) | CNC Kitchen inserts | Store table matches the poster exactly | https://cnckitchenus.store/ and the poster PDF | VENDOR |

### 2.2 Nuts and embedded parts

| Rule | Value | Condition | Reason | Source | Tag |
| --- | --- | --- | --- | --- | --- |
| Size a nut cavity from the measured nut, not the datasheet | example M5 nut measured 7.85 AF x 3.85 vs nominal 8 x 4 | any | Nominal can be about 0.15 mm large | https://markforged.com/resources/blog/embedding-nuts-3d-printing | VENDOR |
| Embedded nut cavity offset | 0.05 to 0.08 mm PS on all faces (0.10 to 0.16 DIA) | Markforged machines, pause-embedded nut | Tight so the nut cannot spin | same | VENDOR |
| Embedded component cavity offset | about 0.08 mm PS on every face | Markforged machines | Boolean-subtract the part, then offset | https://markforged.com/resources/blog/embedding-components-in-3d-printed-parts | VENDOR |
| No fillet or chamfer inside an embed cavity, especially the ceiling; ceiling flat | | pause and embed | The roof must bridge flat over the part | Markforged embedding-nuts and embedding-components pages | VENDOR |
| A part whose top is not flat (or a hex nut with its axis in XY) needs a printed filler piece | | pause and embed | Gives the nozzle a flat surface | same | VENDOR |
| Square nuts preferred over hex in slots and embeds | | side slots, embeds | Hex tilts while pushed in and can spin or strip the cavity | https://www.youtube.com/watch?v=HgEEtk85rAY ; Markforged embedding-nuts | PRACTITIONER, VENDOR |
| Side nut slots are crack starters | | any | Tom has seen many parts crack at the slot | https://www.youtube.com/watch?v=HgEEtk85rAY | PRACTITIONER |
| Slip-in trapped M6 nut | 9.8 AF modeled at 10.5 (+0.7 DIA across flats, 0.35 per flat) | PLA, Teaching Tech's printers | Slides in by hand and cannot rotate | https://www.youtube.com/watch?v=yP7_qZ_Mi78 | PRACTITIONER |
| Loose drop-in objects (trays, holders) | about 1 mm PS | any | Odd-shaped items | https://www.youtube.com/watch?v=yP7_qZ_Mi78 | PRACTITIONER |

### 2.3 Fits and fit-tolerant features

| Rule | Value | Condition | Reason | Source | Tag |
| --- | --- | --- | --- | --- | --- |
| Markforged fit table, explicitly DIA ("listed dimensions are diametral") | press 0.00 to 0.05 DIA (0 to 0.025 PS); close 0.05 to 0.10 DIA (0.025 to 0.05 PS); free 0.10 to 0.20 DIA (0.05 to 0.10 PS) | printed-to-printed, Markforged composite printers; a starting point to verify with a unit test | Calibrated industrial machine | https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips | VENDOR |
| Sliding joinery | 0.08 mm PS (0.16 DIA) | Mark Two, Onyx dovetails and sliders | | https://markforged.com/resources/blog/joinery-onyx | VENDOR |
| A mating face printed on support gets more clearance | about 0.15 PS instead of 0.08 (add about 0.07 PS) | any face resting on support | Support-side faces are rough and inaccurate | same | VENDOR |
| Dovetail offset ladder result | -0.05 mm per face snug and sliding; 0.00 too tight; -0.20 too loose | one Mark Two | Example of the unit-test method; print the test in the final orientation | https://markforged.com/resources/blog/3d-printed-unit-tests | MEASURED |
| Compliant-feature undercut gap (grip fins, flexing walls) | 0.3 mm minimum, 0.5 mm maximum (single slot) | FDM, 0.4 nozzle | Under 0.3 some CAD or STL tools close it; over 0.5 the feature deforms | https://www.youtube.com/watch?v=XKrDUnZCmQQ (about 5:20) | PRACTITIONER |
| Lid and base fit features | round all vertical corners of mating parts; slight taper or draft on the lip; thin-wall lip, not solid; relief pockets in the base's inside corners; corner split slits at 90 deg to each other with no more than about 0.5 mm splay | lids, snap-in covers | Flat sides print true; corners and infill-dependent shrink do not | https://www.youtube.com/watch?v=XKrDUnZCmQQ | PRACTITIONER |
| Diamond peg and hole (square rotated 45 deg) | | horizontal pegs | No flat roof; peg prints lying down | https://www.youtube.com/watch?v=vsHpiHhB3RU | PRACTITIONER |
| Angled (V or dovetail) slots instead of T-slots or tongue-and-groove | | joints | First layer stays simple; no overhang on the bottom face | https://www.youtube.com/watch?v=vsHpiHhB3RU ; https://markforged.com/resources/blog/joinery-onyx | PRACTITIONER, VENDOR |
| Glue joints: small undercut pockets plus relief channels | | glued joints | Glue keys in and does not jack the parts apart | https://www.youtube.com/watch?v=vsHpiHhB3RU | PRACTITIONER |
| Print a 1 mm thick 2D fit template before the full part | under 10 minutes, about 2 g | fitting odd-shaped objects | Cheap fit check | https://www.youtube.com/watch?v=noYuQlQN8pw | PRACTITIONER |

### 2.4 Strength, infill, orientation, temperature

| Rule | Value | Condition | Reason | Source | Tag |
| --- | --- | --- | --- | --- | --- |
| At equal mass a thicker shell always beat more infill | infill 15 to 20 percent, rarely over 30; exceptions large flat parts and corrugated walls | PETG, bending | Independent confirmation of perimeters-before-infill | https://www.youtube.com/watch?v=nV3GbN6hLjg | MEASURED |
| Infill pattern at equal mass | cubic strongest by a clear margin; gyroid third; lightning, Hilbert, Archimedean chords, octagram unsuitable for load; honeycomb, gyroid and similar print about a third slower | PETG, one geometry | Default to cubic or adaptive cubic | same | MEASURED |
| Across-layer impact strength | about 0.25 of in-layer (PLA 0.23 to 0.26, PETG 0.23 to 0.31, Izod) | stock profiles, Prusa MK3, single samples | Impact loads must never cross layers | https://www.youtube.com/watch?v=a6m_GnN5j4c | MEASURED |
| Untuned Z tensile fraction | PLA 0.40 (pull ring), 0.48 (bend); PETG 0.35 (pull ring) | stock profiles | Lower than tuned-printer data | same | MEASURED |
| Hotter is not stronger | PLA best at its default (about 215 C), Z strength drops at 195 C and above about 255 C; PETG lost layer adhesion at 230 vs 250 C | Prusament, MK3, 0.6 nozzle | Print at the filament's default temperature | https://www.youtube.com/watch?v=YJdkE7A8stM | MEASURED |
| Small, thin or detailed parts may use 100 percent infill | | small parts | Crisper, faster and tougher than many perimeters there | https://www.youtube.com/watch?v=ct-n2lI0I9g | PRACTITIONER |
| Microfeatures: cut slots, holes or ribs about 0.2 mm wide into the model to force fused extra perimeters | 0.2 mm; if wide enough to print as two walls they make a weak sleeve | FDM, 0.4 nozzle | Designs strength in independent of slicer settings; ribs tested best | https://www.youtube.com/watch?v=Lq-SoGgKOcQ | PRACTITIONER |
| Tilt blocky parts 45 deg with ribs or a brim | | support-heavy parts | Removes supports and stair-steps; narrow contact needs a brim | https://www.youtube.com/watch?v=ct-n2lI0I9g | PRACTITIONER |
| Snap fits, gear and ratchet teeth print lying on their side | | FDM | No layer boundary crosses the flexing section | https://markforged.com/resources/blog/joinery-onyx | VENDOR |
| Chopped-fiber filaments are stiffer, not stronger | usually weaker than the base polymer; tighter tolerances | CF/GF filled | | https://www.youtube.com/watch?v=ct-n2lI0I9g | PRACTITIONER |
| Carbon-fiber filament enclosures attenuate RF | slightly conductive; glass-filled insulates | enclosures with internal antennas | Weak Faraday cage | same | PRACTITIONER |
| Put critical dimensions in the XY plane; use metal pins, shoulder bolts or bushings for wear, alignment and concentricity | | FDM | | Markforged design-tips page | VENDOR |

### 2.5 Compliant mechanisms and flexures (the playbook says no numeric source)

| Rule | Value | Condition | Reason | Source | Tag |
| --- | --- | --- | --- | --- | --- |
| Compliant leaf thickness | about 0.5 mm minimum (2 lines), 1.0 mm for stiffer leaves; thicker in PETG | 0.4 nozzle | | https://www.youtube.com/watch?v=YG_8wYoxVfs | PRACTITIONER |
| Taper the leaf | about 1.0 mm at the roots to 0.5 mm at the center | | Fixes where it bends and fails | same | PRACTITIONER |
| Size flex sections to line-width multiples | 0.84 mm (one perimeter per side at a 0.42 line), 1.68 (two per side) | | Arachne can starve a thin joint; check with Classic perimeters | https://www.youtube.com/watch?v=xV36ITRjP_4 | PRACTITIONER |
| Long leaves, arcs or coils outlast notch hinges | a notch hinge fatigued in a few cycles in PLA | PLA | Spread the bend over length; 40 deg over about 2 mm is a torture case | https://www.youtube.com/watch?v=YG_8wYoxVfs ; https://www.youtube.com/watch?v=xV36ITRjP_4 | PRACTITIONER |
| Fillet every root; symmetric double leaf for equal spring-back | | | | same | PRACTITIONER |
| Material ranking for printed flexures | nylon best; PETG best practical; ASA works but whitens; PLA snapped after a few cycles; TPU too soft and takes a set | | | https://www.youtube.com/watch?v=xV36ITRjP_4 | PRACTITIONER |
| Single-use fold creases | about 0.2 mm | | Origami-style flat-printed folds | same | PRACTITIONER |
| Keep seams off flex junctions; let the part cool fully before flexing | | | | same | PRACTITIONER |

No source gives fatigue data for these values.

### 2.6 Printer, nozzle, warping and service context

| Rule | Value | Condition | Reason | Source | Tag |
| --- | --- | --- | --- | --- | --- |
| Bambu Studio default line widths for a 0.4 mm nozzle | 0.42 mm default, outer wall, top surface, solid infill, support; 0.45 inner wall and sparse infill; 0.5 first layer. XY hole compensation 0. Elephant-foot compensation 0 in the common profile, 0.15 in the 0.20 mm single-nozzle profile | Bambu Studio official profiles | Confirms the 0.42 figure; the wiki recommends 0.75 to 1.5 x nozzle | fdm_process_common.json and fdm_process_single_0.20.json on GitHub | VENDOR |
| Usable layer height | about 1/4 to 3/4 of the nozzle (quality, not strength); a 0.6 nozzle is happiest at 0.2 mm | | | https://www.youtube.com/watch?v=WgXM2zPusXo | PRACTITIONER |
| Chamber temperatures | unheated enclosure about 40 to 45 C; actively heated about 60 C; bed surface vs display off by up to about 14 C | | Large ABS or PC parts need a heated chamber | toms3d Core One L article | MEASURED |
| Severe-warp mouse ears | 10 to 20 mm diameter, 3 to 5 layers thick | strong curl | Thin brims tear off | https://www.youtube.com/watch?v=ct-n2lI0I9g | PRACTITIONER |
| Slant 3D print service envelope | 0.4 mm nozzle, 220 x 220 x 220 mm, textured bed, orientation kept as uploaded, required supports must be flagged | sending parts to Slant 3D | | Slant 3D service-settings article | VENDOR |
| Xometry industrial FDM context | layers 0.254 mm (0.33 mm on parts over 16 in), PLA 0.2 mm; build up to 24 x 36 x 36 in; surface 6 to 23 um Ra | Xometry FDM orders | | community.xometry.com KB 745 ; manufacturing-standards | VENDOR |
| FDM minimum feature including text (industrial FDM) | 0.89 mm (0.035 in); 1.14 mm (0.045 in) safest | Xometry | Bead width | KB 745 ; Xometry FDM guide PDF | VENDOR |
| FDM rib minimum | 1.5 mm | Xometry | | Xometry FDM guide PDF | VENDOR |
| FDM unsupported overhang length | 2 mm maximum length; over 5 mm long needs support even if narrower | Xometry Europe | | xometry.pro quick-guide | VENDOR |
| FDM gap between walls | 0.5 mm capability, 1.0 mm recommended | Xometry Europe | | same | VENDOR |
| Protolabs FDM (Network) | wall 0.8 mm; hole 2.0 mm; prototyping FDM plus or minus 0.5 percent with a 0.5 mm floor; industrial FDM plus or minus 0.3 percent, 0.3 mm floor | Protolabs orders | | https://www.protolabs.com/services/3d-printing/fused-deposition-modeling/ | VENDOR |
| Design to 1.5 x the process minimum | FDM about 1.5 to 1.8 mm walls | service orders, load-bearing | Safety margin | Simple Machining FAQ | VENDOR |

### 2.7 Other processes (other-processes.md additions)

| Process | Rule | Value | Source | Tag |
| --- | --- | --- | --- | --- |
| All (Protolabs) | Small-gap minimum by material (high / normal resolution, mm) | DMLS 0.508 / 0.635; SLA ABS- and PC-like 0.508 / 0.635; SLA MicroFine 0.381; SLS 0.762; MJF PA12 Black 0.508; MJF PA12 GF 0.762; PolyJet 0.762; Carbon 0.762 | Protolabs toolkit (S2) | VENDOR |
| SLA | Gaps, channels, slots | channels 0.635, slots 0.381; holes under 0.127 never clear | Protolabs S1, designing-for-stereolithography | VENDOR |
| SLA | Inserts | screw-to-expand inserts in epoxy; never heat-stake resin | Protolabs threads and inserts blog | VENDOR |
| SLA | Drain holes | Shapeways 5.0 mm single, 4.0 mm if several; Unionfab adds vent holes as well as drains | Shapeways WaterShed page; Unionfab | VENDOR |
| SLA | Lattice | self-supporting bridge 7.62 mm at 45 deg; unsupported channel 25.4 mm | Protolabs lattice tip | VENDOR |
| SLS | Surface offset for gaps, small holes and pins | 0.15 to 0.20 mm PS (0.30 to 0.40 DIA) | Xometry SLS guide PDF | VENDOR |
| SLS | Uniform wall for low warp | 1.5 to 3.8 mm; Protolabs tilts parts 10 to 15 deg | Protolabs designing-for-SLS | VENDOR |
| SLS | Maximum wall before hollowing | 9 mm (Sculpteo), 7 mm (Xometry Europe) | Sculpteo PDF; xometry.pro | VENDOR |
| SLS | Escape holes at a US bureau | two or more, about 12.7 mm | Xometry SLS guide PDF | VENDOR |
| SLS | Pins and fits (EOS) | pin 0.8 mm min, 1.8 mm reproducible; loose fit for parts not built together 0.1 mm PS; hinges built together 0.3 to 0.5 mm XY, 0.5 to 0.6 mm Z (PS); walls 1.5 mm for reproducible properties | EOS polymer design rules PDF | VENDOR |
| SLS/MJF | Heat-stake insert keep-out | 6.35 mm of free space around the insert | Protolabs threads and inserts blog | VENDOR |
| MJF | Snap fits | base at least 1 mm, hook depth at least 1 mm, root radius half the base, assembly angle 35 to 40 deg | Xometry Europe MJF guide (S22) | VENDOR |
| MJF | Warp | risk above 10:1 length-to-width | S22; HP learning center | VENDOR |
| MJF | Hollowing | shell 2 mm min, 2.5 mm on big parts; over about 15 mm consider a lattice (8 mm cell, 1.2 mm beam); lattice gaps at least 5 mm | HP white paper 4AA7-2952ENW; HP deck | VENDOR |
| MJF | Custom threads | 0.2 to 0.4 mm gap between threads (PS/DIA not stated), 0.1 mm root radius; or design to ISO 965-2 lower limit | HP deck | VENDOR |
| MJF | Glue joints | add 0.1 to 0.2 mm on top of the 0.4 mm interface gap | HP deck | VENDOR |
| MJF | Living hinges | thickness 0.5 mm (MJF) or 0.76 (SLS); length L = (bend deg / 180) x pi x R; annealed MJF hinges down to R about 0.4 mm; split wide hinges into several narrow ones | Protolabs hinges tip | VENDOR |
| MJF | Ideal wall | 2.5 to 12.7 mm | Protolabs MJF tip | VENDOR |
| Metal PBF | Bridges | at most 2.0 mm unsupported | Protolabs DMLS PDF; S18 | VENDOR |
| Metal PBF | 316L self-supporting angle | at least 55 deg from the plate | Protolabs DMLS PDF | VENDOR |
| Metal PBF | Thin walls | under 1 mm wall: height-to-thickness under 40:1 | Protolabs DMLS PDF | VENDOR |
| Metal PBF | Wall-to-height table | under 1 mm wall to 0.6 mm tall; 1 mm to 1; 2 to 2; 3 to 5; 5 to 10.5; over 5 mm to 15 mm | Xometry DMLS guide PDF | VENDOR |
| Metal PBF | Holes print small | 0.10 to 0.15 mm undersize under 50 mm (PS/DIA not stated) | Xometry DMLS PDF | VENDOR |
| Metal PBF | Text | inset 0.38 mm deep, 10 pt or larger, bold | Protolabs DMLS PDF | VENDOR |
| Metal PBF | Post-machined tolerance and finish | plus or minus 0.025 mm; 1.6 um (63 uin) Ra | Protolabs DMLS PDF; post-processing tip | VENDOR |
| Metal PBF | Pressure-tight walls | about 0.5 to 0.7 mm in nickel alloys, more in aluminum | EOS blog | VENDOR |
| Binder jet (sintered fine powder) | Overhangs, bridges, angles | overhang over 7.5 mm, bridge over 20 mm, or face over 30 deg from vertical needs a sintering support; general guidance avoid over 10 to 15 mm | Desktop Metal guide (archived copy) | VENDOR |
| Binder jet | Walls | 0.75 mm minimum (0.75 to 2 fragile in depowdering); 25 mm maximum, not over 25 in more than two axes; aspect 4:1 under 1 mm wide, 8:1 over | same | VENDOR |
| Binder jet | Holes and slots | holes 0.75 mm min, depth up to 8 x dia (4 x at 2 mm or less); slots 0.5 mm min; horizontal holes over 15 mm need special sintering | same | VENDOR |
| Binder jet | Edges and text | no edges under 70 deg (0.5 mm flat or radius); internal fillet over 1 mm and about the wall; recessed text 2 mm high, 0.5 deep; raised 4 mm high, at most 1 mm proud | same | VENDOR |
| Binder jet | Shrink | 0.8 to 2.5 percent, internal holes and slots up to 5 percent (Xometry service) | Xometry manufacturing-standards | VENDOR |
| PolyJet | Overmold and gasket interfaces | line-on-line: zero gap up to 0.05 mm interference | Protolabs PolyJet and overmold tips | VENDOR |
| PolyJet | Small holes | under 0.75 mm may not clear, worse at depth:width 2:1 or more | Protolabs PolyJet tip | VENDOR |
| Carbon DLS / HPS (resin family) | Tough Black | structural wall 2.5, supported wall 1.0, positive feature 0.5, hole 0.6 mm; self-supporting 45 deg; plus or minus 0.25 mm + 0.1 percent | Protolabs advanced-photopolymers page | VENDOR |
| Finishing | Vapor smoothing | removes no material; walls and features at least 1.0 mm | Xometry vapor-smoothing page | VENDOR |
| Finishing | SLS nickel plating | adds 0.05 to 0.15 mm | Xometry SLS PDF | VENDOR |
| Finishing | Walls under about 1 mm warp in hot dye baths and blasting | | Protolabs secondary-ops tip | VENDOR |
| Cut and bond (SLA, SLS, MJF) | Wall at the cut | at least 2.54 to 3 mm | Protolabs definitive guide | VENDOR |

### 2.8 Design aids (Protolabs)

Protolabs offers no physical 3D printing design aid. Its aids are the
injection molding Design Cube (thin and thick walls, good and bad bosses and
ribs), a demo mold, a CNC "design for speed versus function" cube (EU), and
printed material-selector reference cards (including a 3D printing selector
listing resolution, tensile strength and hardness per material). All are
ordered through request forms. Nothing in
`skills/dfm/references/design-aids.md` is contradicted; the absence of a
vendor printing aid supports building the house test print.

### 2.9 Formlabs, Simple Machining, Unionfab: what the playbook missed

- Simple Machining: design to 1.5 x the process minimum; SLS/MJF holes under
  2 mm may need powder cleaning; SLA horizontal holes vary slightly from resin
  pooling; tolerance ranges SLA plus or minus 0.1 to 0.2 mm, SLS/MJF plus or
  minus 0.2 to 0.3 mm (VENDOR).
- Unionfab: a mating-gap range of 0.2 to 0.5 mm in its checklist; SLA needs
  vent holes as well as drains; "holes print undersize in all processes, add
  0.1 to 0.2 mm or ream" (PS/DIA not stated) (VENDOR).
- Formlabs DFM blog: nothing numeric to add.

---

## 3. Conflicts and confirmations

| Playbook value (path or rule id) | What the newly read source says | Recommendation |
| --- | --- | --- |
| `hole.min.diameter` 2.0 mm (FDM-HOLE-5); note says Xometry 1.0 is UNVERIFIED | Xometry guide PDF, mini guide and standards: design holes over 1.0 mm DIA so they stay round, best printed vertical, on industrial FDM; Protolabs FDM page: 2.0 mm | **Keep 2.0.** Relabel the 1.0 note as confirmed VENDOR (Xometry, industrial roundness floor, not a functional minimum). Add Protolabs 2.0 as corroboration |
| `wall.unknown.printer` 1.2 (FDM-WALL-5) | Xometry 1.2 to 1.5 supporting walls, 1.5 recommended; Protolabs FDM 0.8; Simple Machining FAQ 1.5 x minimum | **Keep 1.2.** Add 1.5 as the service-bureau, load-bearing alternative |
| `wall.min` 0.45 | Protolabs bureau wall 0.8; Xometry floor about 0.5 | **Keep.** Consistent; bureau values belong to the unknown-printer tier |
| `feature.min.size` 1.8 | Xometry 0.89 resolvable, 1.14 safest, 1.2 to 1.5 recommended; Protolabs FDM service page 2.0 but its hub table and guides say 0.2 (one is a decimal slip) | **Keep 1.8.** Note the Protolabs inconsistency as UNVERIFIED |
| `feature.min.gap` 0.5; note cites Protolabs 0.75 for an unknown printer (FDM-FEAT-3) | Protolabs' 0.75 mm advisory never names FDM (its example is an SLA gear) and equals its SLS/MJF channel gap 0.762; Xometry Europe FDM gap 0.5 capability, 1.0 recommended | **Keep 0.5 and the 0.75 unknown-printer value**, but relabel the 0.75 source as a multi-process advisory. A single gap, not a fit (no PS/DIA) |
| `overhang.max.angle` 45 (FDM-OVH-1) | Xometry 45 from vertical; confirmed | **Keep;** add Xometry as a source. Add the 2 mm overhang-length rule as new |
| `bridge.max.span` 10, `bridge.conservative.span` 5 (FDM-BRG-1, -2) | Xometry Europe 10; xometry.pro 5; Unionfab 5 | **Keep;** add sources |
| `text.min.height` 5 (FDM-TXT-3) | Xometry Europe 5 recommended, 3.5 capability | **Keep;** add source |
| `text.emboss.height` 0.6, `text.engrave.depth` 0.8 | Xometry 0.5 minimum (1.0 at industrial 0.254 mm layers); Protolabs 0.3048 all processes | **Keep.** Add 1.0 as the industrial-FDM order floor |
| `accuracy.unknown` 0.5 mm or 0.5 percent | Protolabs prototyping FDM plus or minus 0.5 percent, 0.5 mm floor; Xometry Europe 0.5 percent | **Keep;** now VENDOR-confirmed (was SNIPPET) |
| `accuracy.tuned` 0.2 | Xometry desktop standard: plus or minus one layer (0.2 mm) for the first inch plus 0.05 mm per further inch | **Keep;** add the Xometry formula as an alternative for long parts |
| `clearance.press.side` 0.05 PS, `.snug.side` 0.10 PS, `.sliding.side` 0.20 PS, `.free.side` 0.30 PS | Markforged, stated DIA: press 0 to 0.025 PS, close 0.025 to 0.05 PS, free 0.05 to 0.10 PS; joinery 0.08 PS. Xometry sliding 0.2 to 0.3 (PS/DIA not stated) | **Keep the house values.** Markforged's are 2 to 4 times tighter because they describe calibrated industrial composite printers; add them as an alternative row labeled DIA with the PS conversion |
| (new) mating face printed on support | Markforged raises 0.08 to 0.15 PS | **Add** about +0.07 PS for any mating face resting on support |
| `clearance.printinplace.side` 0.35 PS | Xometry Europe moving parts 0.5 (PS/DIA not stated) | **Keep;** add 0.5 as a service-bureau alternative, UNVERIFIED as PS |
| fits-and-clearances.md section 2, sliding row: "at least 0.3 per side (Prusa, Simple Machining, Unionfab)" | Simple Machining says 0.3 PS explicitly; Unionfab writes only "plus or minus 0.3 mm" | **Change** the attribution: Unionfab does not state per side |
| sources.md Gap 12: Markforged fit table per side or total unstated | Markforged states its listed fit dimensions are diametral | **Close for Markforged;** update fits-and-clearances.md |
| `nut.pocket.clearance.af` 0.3 DIA across flats; hardware.md section 3 cites Markforged "0.05 per side (SNIPPET)" | Markforged: 0.05 to 0.08 PS on all faces over the measured nut (embedded, pause). Teaching Tech: +0.7 DIA across flats for a slip-in M6 | **Keep 0.3.** Upgrade the Markforged entry to VENDOR, read in full; add "measure the real nut"; add the larger slip-in allowance for M6 and up as PRACTITIONER |
| `magnet.pocket.press.diametral` 0.15 DIA | Markforged component-embed offset 0.08 PS (0.16 DIA) | **Keep;** consistent |
| `hole.compensation.diametral` 0.2 DIA (FDM-HOLE-2) | Teaching Tech: +0.4 DIA on small holes (or drill, or slicer compensation, but one method only); Simple Machining: +0.2 to 0.4 DIA under 5 mm | **Keep 0.2** for a tuned printer (the house default). Add 0.4 DIA as the unknown-printer or small-hole alternative |
| `screw.selftap.m3.pilot` 2.7 | Teaching Tech: 2.9 (tap drill + 0.4); M4 3.9 | **Keep 2.7** (CNC Kitchen measured pull-out). Add 2.9 and M4 3.9 as easier-driving alternatives |
| `thread.min.modeled` M5; note "never in horizontal holes" | Made with Layers 2023: M5 and up threaded cleanly printed flat, M4 marginal, M3 failed; holes standing in Z needed tap chasing even at M8. Made with Layers 2025: printed threads only at M6 and up. HP MJF: M8 and up (2018 deck) or over M6 (handbook) | **Keep M5 as the floor;** add "prefer M6 or larger, go 1 to 2 sizes up for strength or use an insert". **Flag for review:** Tom's result suggests a vertical-axis printed thread is the worse case, which contradicts "never in horizontal holes"; the video does not make the axis unambiguous, so do not change the rule until a coupon decides |
| `strength.z.fraction` 0.5 (PLA); materials.md PETG 0.45 | Untuned stock profiles: PLA 0.40 to 0.48, PETG 0.35 (pull ring) | **Keep;** add PETG 0.35 as the unknown-printer value; add the new impact fraction 0.25 |
| FDM-STR-1, -2 and `perimeters.structural` 3 | Equal-mass tests: thicker shell always won; infill 15 to 20 percent (Made with Layers). Zack Freedman: small thin parts may go to 100 percent | **Keep;** add the citation and the small-part exception |
| FDM-STR-3 (triangular strongest at 30 percent, CNC Kitchen) | Cubic strongest at equal mass (Made with Layers) | **Add as an alternative;** the ranking depends on equal percentage vs equal mass. Suggest cubic or adaptive cubic as the default |
| materials.md PETG about 30 percent less stiff than PLA | Spring test: about 22 percent less stiff (one sample) | **Keep 30 percent** (conservative) |
| materials.md PETG service 60 to 65 C | Made with Layers: usable to about 70 to 80 C | **Keep** (creep and inserts under load) |
| FDM-HOLE-9 grip fins "0.3 mm gap at the bottom" vs hardware.md section 7 "0.2 mm gap top and bottom" | Slant 3D: compliant undercut gap 0.3 min, 0.5 max | **Change** both to 0.3 minimum, 0.5 maximum, and make them agree |
| hardware.md section 9 and section 12: "flexures: no numeric FDM design source" | Slant 3D and Teaching Tech give leaf thickness, taper, line-width sizing, root fillets, material ranking (section 2.5) | **Change** to the PRACTITIONER values in 2.5, still to be proven with a coupon |
| FDM-BED-7 mouse ears 1 layer | Zack Freedman: 3 to 5 layers, 10 to 20 mm for severe curl | **Keep 1 layer** for snap-off; add the severe-warp alternative |
| FDM-OVH-4 chamfer not fillet; FDM-OVH-6 teardrop | Slant 3D applies the chamfer rule to pin tips; diamond holes as an alternative | **Keep;** add the diamond hole alternative |
| `line.width` note: Bambu default 0.42 "not confirmed on a Bambu page" | Bambu Studio official profile: 0.42 default and outer wall, 0.45 inner wall and sparse infill | **Keep 0.45** for design (inner walls are 0.45 on Bambu too); mark the 0.42 figure VENDOR-confirmed |
| `insert.m2.*` (L 3.0, depth 4.0) and `insert.m2p5.*` (L 4.0, depth 5.0) | ruthex standard M2 is 4.0 long (depth 5.0); M2.5 is 5.7 long (depth 6.7); holes and walls identical (3.2 / 1.3, 4.0 / 1.6) | **Keep** the CNC Kitchen values; add a note that the depth follows the insert actually chosen |
| `insert.m3.nominal` 4.0 | ruthex datasheet 4.0, confirmed | **Keep;** cite the ruthex datasheet directly |
| `insert.m4.nominal` 5.7, `insert.m5.nominal` 6.5, `insert.m6.nominal` 8.1 (notes say ruthex 5.6 / 6.4 / 8.0 SNIPPET) | ruthex datasheet: 5.6, 6.4, 8.0, matching ruthex's own drill set | **Keep** the CNC Kitchen defaults; relabel the ruthex values VENDOR with the datasheet URL |
| hardware.md M8 row (OD 10.2, hole 9.7, wall 4.5) | ruthex OD 10.1, hole 9.6, wall 4.5 | **Keep** CNC Kitchen; add ruthex as an alternative; optionally add `insert.m8.*` to fdm.json |
| hardware.md Voron M3 x 5 x 4 wall 1.6 | ruthex 1.3 | **Keep 1.6** (conservative) |
| `insert.*.depth` L + 1 | ruthex and CNC Kitchen drawings both say L + 1 minimum, blind or through | **Keep;** now confirmed at both vendors |
| `insert.*.wall` (M5 2.6) | Made with Layers: 3.6 mm of perimeter needed for the part to outlast an M5 insert | **Keep 2.6** as the minimum; add 3.6 as the full-strength M5 value |
| printers-bambu-lab.json `h2c` bed max: unconfirmed | 120 C (H2C spec page); nozzle 350 C; chamber 65 C | **Change** to 120, confirmed |
| `p1s`: nozzle options unconfirmed | P1S spec PDF: 256 cube, 300 C stainless nozzle, 0.2 / 0.4 / 0.6 / 0.8, bed 100 C, enclosed, not actively heated; CF and GF filled not recommended | **Change** nozzle sizes to 0.2 to 0.8 and mark confirmed |
| `x1c`: unconfirmed (third party) | X1C spec PDF: 256 cube, 300 C hardened nozzle, 0.2 to 0.8, bed 110 C at 220 V and 120 C at 110 V, enclosed with no active heater | **Keep bed 110** (the 220 V figure); mark confirmed |
| `a2l`: enclosure "open (unconfirmed wording)" | Spec page: 330 x 320 x 325, 300 C stainless, 0.2 to 0.8, bed 80 C; overview calls it a bed slinger | **Change** to open (bed slinger), confirmed. The "household power" reason for 80 C stays unconfirmed |
| `p2s`, `x2d` specs marked SNIPPET | Spec pages confirm the build volumes, 300 C, beds 110 (P2S) and 120 (X2D), 0.2 to 0.8 nozzles, X2D 65 C chamber. P2S's 50 C chamber is on the overview page only | **Mark confirmed** except the P2S chamber value |
| bambu-lab.md "also named: H2D Pro, R1" | H2D Pro: 325 x 320 x 325 single, 300 x 320 x 320 dual, 350 C tungsten-carbide nozzle, bed 120 C, 65 C chamber; R1 is a CO2 laser cutter | **Add** an H2D Pro row; **remove** R1 from the printer lineup |
| other-processes.md section 4 (MJF), tolerance "plus or minus 0.3 mm or 0.5 percent (S9, S21, S29)" | S21 actually gives prototype MJF plus or minus 0.70 mm under 30, 0.85 at 30 to 50, 1.40 at 50 to 80 mm, 1.75 percent above (TPU looser); reviewed production XY 0.25 / 0.30 / 0.39 mm then 0.5 percent, Z 0.42 / 0.50 / 0.60 then 0.75 percent. HP: plus or minus 0.2 mm to 100 mm then 0.2 percent after blasting. Protolabs: 0.30 mm + 0.1 percent per inch | **Change the citation:** S21 does not support the row. Keep 0.3 / 0.5 percent as the typical default from S9 and S29, and add Xometry's prototype table as the worst case for an unreviewed bureau order |
| MJF clearance, separate parts 0.3 mm PS ("0.4 total, 0.2 per part") | HP: at least 0.4 mm gap at the interface, with plus or minus 0.2 mm being each part's tolerance (the reason, not a split of the gap); Xometry Europe 0.4 | **Change to 0.4 mm PS (0.8 DIA for a shaft in a bore).** The PS reading is an inference (face-to-face gap), UNVERIFIED |
| MJF print in place 0.7 | HP learning center 0.7 (0.3 possible under 3 mm walls with testing; more over 30 mm walls); HP 2018 deck 0.5; Shapeways 0.6; Sculpteo 0.5; Xometry 0.7 | **Keep 0.7** |
| MJF escape holes "two or more, 5 mm, opposite faces (S22 UNVERIFIED excerpt)" | HP deck: 5 mm minimum, at least two, two aligned holes recommended; Xometry Europe guide (read in full): two or more on opposite faces, 5 mm, plus exit holes every 12.7 mm in blind holes; Sculpteo 5 mm, two, opposite sides; Shapeways 4 mm single, 2 mm if several | **Keep;** drop UNVERIFIED. Confirmed at an HP-authored deck (reseller-hosted), not on an hp.com page |
| MJF threads "only at M6 and up" | HP 2018 deck M8 and up; handbook over M6 | **Change** the conservative default to M8, with M6 as the handbook alternative |
| other-processes.md section 3 (SLS) print in place 0.6 | Xometry Europe 0.7; EOS 0.3 to 0.5 XY, 0.5 to 0.6 Z; Shapeways and Sculpteo 0.5 | **Keep 0.6** |
| SLS escape holes 4 to 5 mm | Xometry US about 12.7 mm, two or more; Sculpteo 5 mm, two; Shapeways 4 single, 2 if several | **Keep;** add Xometry's 12.7 mm as the bureau value for US orders |
| SLS warping "tilt wide flats about 20 deg" | Protolabs tilts 10 to 15 deg; EOS: surfaces at 0 or over 20 deg to XY avoid stair-steps | **Change** to 10 to 20 deg |
| SLS tolerance | Xometry PA12 plus or minus 0.38 mm or 0.2 percent; TPU and PA11 0.51 mm or 0.3 percent | **Keep;** add the TPU/PA11 value |
| SLA self-supporting angle 19 deg (text-to-cad, UNVERIFIED) | Xometry Europe: 19 deg, measured from vertical | **Confirm** as VENDOR (from vertical) |
| SLA tolerance plus or minus 0.2 or 0.3 percent | Xometry XY 0.127 mm first inch + 0.05 per inch, Z 0.254 + 0.05; Protolabs XY 0.05 + 0.1 percent, Z 0.127 + 0.1 percent | **Keep;** note Z is looser |
| SLA minimum hole 1.0 | Xometry 0.75 minimum, 1.0 recommended; Protolabs 0.635 normal resolution | **Keep** |
| SLA drain holes 3.5 mm | Shapeways 5.0 mm single, 4.0 mm if several | **Keep;** consider 4 mm when two are used |
| other-processes.md section 7 (PolyJet), minimum feature 1.0 | Xometry: under 1.0 at risk, 1.27 recommended; Xometry Europe 1.2 rigid, 2.0 rubber-like; Protolabs 0.3 | **Change to 1.2 mm** (2.0 for rubber-like) |
| PolyJet tolerance plus or minus 0.2 (cites S21) | S21: plus or minus 0.10 mm first inch + 0.05 per inch | **Keep 0.2** as conservative; fix the citation |
| PolyJet assembled clearance 0.3 | Xometry Europe 0.5 for moving parts | **Keep;** add 0.5 as the bureau value |
| PolyJet hollows "avoid closed hollows (UNVERIFIED)" | Protolabs: leave land-locked cavities closed; trapped gel is usually unnoticed; weep holes optional | **Change** to "closed hollows keep their gel; add weep holes only if weight matters" |
| Metal PBF moving clearance 1.0 | Xometry Europe 0.6 | **Keep;** add as alternative |
| Metal PBF overhang 45 / 50 deg | Protolabs: 45 minimum, 316L 55; Xometry: 30 deg rough, over 45 smooth; EOS legacy 25 deg (ambiguous convention) | **Keep;** add 316L 55 deg. Do not adopt the EOS legacy figure |
| Metal PBF hole compensation 0.1 to 0.2 | Xometry: holes print 0.10 to 0.15 undersize; EOS legacy: model 0.6 undersize and rebore | **Keep;** confirmed |
| Binder jet overhangs "none over 10 to 15 mm (S23, UNVERIFIED excerpt)" | Desktop Metal (full guide): overhang over 7.5 mm, bridge over 20 mm, faces over 30 deg from vertical need sintering supports | **Change** to the stricter vendor values for sintered fine-powder systems |
| Binder jet shrink and scale | Desktop Metal: up to about 20 percent shrink, scale up to 25 percent | **Confirm;** drop UNVERIFIED and point S23 at the archived copy |
| design-aids.md | Protolabs offers no printing aid | **No change** |

---

## 4. Gaps section (sources.md): what is now closed

| Gap | Status | Confirmed value |
| --- | --- | --- |
| 12. Per side vs total unstated | **Partly closed** | Markforged's fit table is diametral (press 0 to 0.05, close 0.05 to 0.10, free 0.10 to 0.20 DIA). Hubs, Fictiv, the Orca test and Bambu's cut tolerance remain unstated |
| 13. Bambu H2C bed temperature | **Closed** | 120 C |
| 13. P1S and X1C details | **Closed** | P1S: 256 mm cube, 300 C stainless nozzle, 0.2 to 0.8, bed 100 C, passive enclosure. X1C: 256 mm cube, 300 C hardened nozzle, 0.2 to 0.8, bed 110 C (220 V) / 120 C (110 V), passive enclosure |
| 13. A2L enclosure status | **Closed** | Open bed slinger; bed 80 C |
| 13. Bambu default line width | **Closed** | 0.42 mm default and outer wall, 0.45 mm inner wall and sparse infill, 0.5 mm first layer (Bambu Studio profile) |
| 13. H2D Pro and R1 specs | **Closed** | H2D Pro as in section 3; R1 is a laser cutter, not a printer |
| 13. Nozzle behavior during a pause | Still open | Only "pauses before the chosen layer; manual resume" is confirmed |
| 14. Flexure design numbers | **Partly closed** | PRACTITIONER values: leaf 0.5 mm min, 1.0 stiffer, taper 1.0 to 0.5, line-width multiples, root fillets (section 2.5). Still no fatigue data. Heat staking, zip-tie slots, O-rings, threaded lids, D-shafts, RFID, springs, bond gap, screw reuse count, magnet loss: still open |
| 14. Square nuts | **Partly closed** | Preferred over hex in slots and embeds (Made with Layers, Markforged); no print-specific clearance number |
| 15. ruthex official datasheet | **Closed** | M2 hole 3.2 (L 4.0), M2.5 hole 4.0 (L 5.7), M3 4.0, M4 5.6, M5 6.4, M6 8.0, M8 9.6 (OD 10.1); walls as CNC Kitchen except Voron M3 1.3; depth L + 1. Source is the official datasheet hosted by a reseller, agreeing with ruthex.de's own table |
| 17. Desktop Metal binder jet from an excerpt | **Closed** | Full guide read (archived copy): shrink to about 20 percent, scale to 25 percent, overhang 7.5 mm, bridge 20 mm, 30 deg, walls 0.75 to 25 mm |
| 17. MJF escape hole from an excerpt | **Closed** (HP-authored source, reseller-hosted) | At least two, 5 mm minimum, aligned on opposite faces |
| 17. Metal PBF overhang 50 deg; continuous-fiber tolerances | Still open | Protolabs gives 45 deg minimum (316L 55); no source addresses the Hubs 50 deg reading. No fiber tolerance found |
| 18. Unread: Xometry FDM guide | **Closed** | Read via the public PDF (v2.1); the current page version requires a lead form |
| 18. Markforged DfAM page | **Closed** | Confirmed: no numeric FFF rules; the fit and embedding rules are on other Markforged pages |
| 18. Made with Layers, Teaching Tech, creator videos | **Closed** (nine Made with Layers videos, three Teaching Tech, two Zack Freedman, one 3D Printing Nerd) | See section 2 |
| 18. Slant 3D written blog | **Closed** | Confirmed: one service-settings article (table is an image), no design guide; design content is video-only |

---

## 5. Still unverified

- Nozzle and bed behavior during a Bambu pause; the A1 mini's maximum AMS unit
  count; the reason for the A2L's 80 C bed; the P2S's 50 C chamber on a spec
  page.
- Made with Layers' self-forming thread geometry (only in an Onshape document)
  and which print axis his "printed flat" thread result means; until a coupon
  decides, the "never in horizontal holes" rule stands but is disputed.
- Per side vs diametral for: Xometry's FDM clearances (0.5 moving, 0.2 to 0.3
  sliding), HP's 0.4 mm assembly gap (read here as per side), Slant 3D's
  "about 0.25 larger" vertical pin hole, Shapeways and Sculpteo clearances,
  Unionfab's 0.3, Hubs, Fictiv, the Orca test, Bambu cut connectors.
- Protolabs internal conflicts: FDM minimum feature 0.2 vs 2.0 mm; industrial
  FDM accuracy 0.25 vs 0.3 percent; SLA wall 0.254 to 1.0 mm; MJF gap 0.508 vs
  0.762 mm; unit-conversion errors in the tolerance tip; the HPS Medical White
  wall typo.
- Xometry's current gated guides (FDM, SLS, SLA) may differ from the public
  PDFs read here, which are older versions.
- HP's MJF handbook on an hp.com host (the reinvent.hp.com copy is form-gated);
  the Protolabs-hosted copy was read only to page 40.
- Metal PBF 50 deg overhang reading; continuous-fiber tolerances.
- All flexure values (section 2.5) are practitioner advice without fatigue
  data.
- Made with Layers' Z fractions and stiffness comparison are single samples on
  stock profiles; the temperature-test strength values were on charts, not
  spoken.
- Not read: Teaching Tech design series parts 1 to 3, 6 and 7; Slant 3D videos
  xog9YlMt9UU and 3AZWuVRUh2c; Made with Layers' PLA and ABS material videos
  (unmvWkfpmRE, YCdvL87bv0w) and the 30-filament review (fjhW2NiILZc);
  Markforged's gated Composites Design Guide; Protolabs' surface-finish PDF and
  its material and cost tips; Xometry's MJF, binder jet, Carbon DLS, CNC, sheet
  and laser guide pages, /technical-resources/ and /materials/; Sculpteo resin
  and FDM material pages; EOS paid courses.
