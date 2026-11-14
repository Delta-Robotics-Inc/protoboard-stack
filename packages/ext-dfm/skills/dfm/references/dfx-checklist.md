# DfX checklist

Design for Excellence (DfX) is the family of methods that bring later
lifecycle goals (making, assembling, costing, testing, servicing, recycling)
into the earliest design decisions
(https://www.sciencedirect.com/topics/engineering/design-for-x, excerpt;
https://xometry.pro/en/articles/design-for-x/). DFM is one member; this
checklist keeps the others in view so a part that prints well is not hard to
assemble, test or repair.

Use the **short list** for a prototype, a jig or a one-off. Use the **full
list** for an end-use part, anything sold, anything load-bearing near people,
or anything with a stated life. Each item is a question an agent can answer
from the CAD, the BOM and the brief; answer it, and report only the items
that change the design. The notes under each discipline say what changes for
a small run of 3D printed parts (roughly 1 to 500 units: an assumption for
the scope of these notes).

Main sources: Xometry's DfX article (https://xometry.pro/en/articles/design-for-x/),
Boothroyd Dewhurst on assembly (https://www.dfma.com/design-for-assembly.asp),
Wevolver on DFMA (https://www.wevolver.com/article/dfma-design-for-manufacturing-and-assembly-explained, excerpt),
and the process sources in [the process ladder](process-ladder.md). Accessed
2026-11-12.

## Short list (prototype depth)

1. **Manufacturing.** Is the process stated, and is every feature inside the
   resolved profile's limits (or covered by a recorded waiver)?
2. **Assembly.** Does it go together along one axis without flipping, with
   parts that locate themselves and can only go in one way?
3. **Reliability.** Is the print oriented so the main load does not pull
   layers apart, and is the material good for the heat and sunlight it will
   see?
4. **Testability.** Can the board's connectors, buttons, test points and
   programming header be reached with the case closed or one cover off?
5. **Serviceability.** Does every screw a user will remove go into a metal
   insert or a nut rather than printed plastic?
6. **Cost.** Is there a cheaper rung, fewer supports, or a smaller part that
   answers the same question?

## Full list (end-use depth)

### Design for Manufacturing

Shape the design to the chosen process's real capability (Xometry DfX).

- Is the process chosen for the quantity and the requirements ([process ladder](process-ladder.md)), and is every feature inside that process's limits?
- Are tight tolerances only on functional interfaces?
- Are standard sizes used: drills, sheet gauges, threads, inserts?
- Are walls even and transitions blended?
- Does every hollow have escape or drain holes where the process needs them, and every support region access for removal?
- Printing: orientation, support side and print time are the tooling. Can one orientation serve every critical face? Does each part fit one build volume, or is it split with alignment features?

### Design for Assembly

Cut assembly time and errors, mostly by cutting part count (Boothroyd Dewhurst).

- For each part: must it move relative to its neighbors, must it be a different material, must it be separate for assembly or service? A part that fails all three is a candidate to merge or delete; fasteners usually fail all three (Boothroyd Dewhurst; Wevolver).
- Can it assemble top-down along one axis?
- Do parts locate themselves (tabs, slots, pins)?
- Is every part either symmetric or plainly asymmetric, so it cannot go in wrong?
- Can screws become snaps, integral hinges or press fits, and are fastener types few?
- Printing: merging parts is nearly free, but keep a split that lets the product be serviced; key the board, battery and lid so each goes in one way only.

### Design for Reliability

Perform the function under the stated conditions for the stated time (Xometry DfX).

- Is a safety factor applied to the worst-case load, with the weak direction between printed layers considered?
- Will the material survive the environment: heat, UV, moisture, chemicals, creep?
- Are stress raisers filleted, especially snap-fit roots and boss bases?
- Is there a short failure modes and effects list for the top risks?
- Has a printed sample been cycled or aged (heat, drop, fatigue)?
- Printing: orientation is a reliability decision; resin parts can drift and creep, so prefer nylon powder prints or tougher filaments for long-life loaded parts.

### Design for Cost

Meet a target cost and keep the function (Xometry DfX).

- Is there a target unit cost, and is each part quoted?
- Is part count low and are standard components used?
- Is the process matched to the volume: no tooling for 20 units, no per-part printing for 20,000 ([process ladder](process-ladder.md))?
- Is the material the cheapest that meets the requirements (https://www.hubs.com/guides/cnc-machining/)?
- Are finishes and tight tolerances only where needed?
- Printing: cost follows print time, supports and post-processing labor (and bounding volume for powder processes); fewer supports pay at once.

### Design for Sustainability

Lower the impact across materials, use and end of life (Xometry DfX).

- Are materials recyclable or bio-based, and are different materials separable?
- Is mass reduced (hollowing, ribs, lattices) where strength allows?
- Can it be repaired, so one failed part does not scrap the whole?
- Is power use low, for electronic products?
- Printing: print only what is needed, avoid support-heavy orientations, and mark the polymer type on each part.

### Design for Testability

Make the product and its subsystems practical to test (Xometry DfX).

- Can each subsystem be tested on its own before integration?
- Are test points, debug ports and programming headers reachable with the enclosure closed or one cover removed?
- Are there clear reference surfaces and pass or fail criteria?
- Is there a self-test or a status indicator?
- Printing: a removable test hatch or a pogo-pin access hole costs little; a printed test fixture can be designed alongside the product.

### Design for Serviceability

Make diagnosis and repair fast (Xometry DfX).

- Can wear items (batteries, filters, belts) be replaced without full disassembly?
- Are fasteners reachable, standard and few in type?
- Is there a service note or an exploded view in the deliverables?
- Printing: printed threads wear out under repeated service, so use metal inserts wherever a user will open the part; emboss a version label so a spare can be reprinted.

### Design for Inspection

Make critical features easy to measure (Xometry DfX).

- Can every critical dimension be measured directly with calipers or a gauge?
- Are datum features physically present?
- Is there a go/no-go gauge or a printed check fixture for the key fits?
- Printing: a small witness coupon on each build plate catches shrink and calibration drift ([design aids](design-aids.md)).

### Design for Safety

Remove hazards for users and service people (Xometry DfX).

- Are sharp edges and pinch points removed or guarded?
- Are moving parts, heat and electrical hazards covered, with fail-safes?
- Are warnings and labels where they are needed?
- Printing: printed plastics may burn; check the flammability rating a mains-powered product needs; resin parts must be fully cured before skin contact; battery bays need venting and strain relief.

### Design for Supply Chain and Compliance

- Is every bought part available from more than one source, in stock and not end of life? Record supplier part numbers at selection time.
- Is fastener variety limited?
- Can each printed part be made on more than one machine or bureau, with an approved alternate material?
- Which standards apply (electrical safety, EMC, RoHS and REACH, food contact), and do the enclosure materials carry the ratings they need? A printed enclosure may not carry a molded resin's rating; check before selling.

### Design for Quality

- Do the mechanisms work across the process's full tolerance band (a stack-up done with the profile's values)?
- Are proven materials and processes used?
- Printing: fits with compliant features (crush ribs, flexures) keep normal print variation from rejecting parts.
