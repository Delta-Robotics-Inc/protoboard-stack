---
name: harness-author
description: Author the physical carriers of a UHD system's links — wire harnesses (connector ends, conductors, lengths, gauges; soldered ends as link-scoped compositions) and mechanical joints as fastener stacks (stack-up arithmetic, hardware selection, nut-engagement check, tightening torque, supplier-cited hardware). Use after system-compose has the links, whenever a link has no carrier, a joint has no hardware, or UHD_ASSEMBLY / UHD_HARNESS_CONNECTOR / UHD_FASTENER_TORQUE fire; follow with harness-verify.
---

# Harness author

In UHD a harness is a module (`kind: "harness"`) that physically carries
connections: a cable carries conductors between its connector ends, a set of
screws, spacers and nuts carries a mechanical joint. The BOM, the assembly
guide and the checks all see the physical parts.

Worked examples: `examples/quadcopter-5in/src/harnesses/harnesses.uhd.ts`
(the cables and six fastener stacks) and `hardware.uhd.ts` (the hardware
parts, each with a fetched supplier listing); how every cable was worked out,
modelled, routed and drawn: `examples/quadcopter-5in/docs/harnesses-and-cad.md`.
Model reference: `@deltarobotics/uhd` `docs/connectors-and-harnesses.md`.

## Purpose

Give every link a physical carrier, so the BOM, the assembly guide, the work
order and the checks see the cables, screws, spacers and nuts that are
actually bought and fitted. Use it after **system-compose** has the links,
whenever a link has no carrier or a joint has no hardware, and when
`UHD_ASSEMBLY`, `UHD_HARNESS_CONNECTOR` or `UHD_FASTENER_TORQUE` fire. In
**build-a-project** it is part of stage 4; **harness-cad** (stage 7) then
gives each cable its routed geometry.

## Inputs

| Input | Where | From |
| --- | --- | --- |
| The system's links and mates | the root system and sub-assemblies in `src/` | **system-compose** |
| Parts' sockets, pads and frames | the parts' connector composites and geometry (`npx protoboard inspect <instance>`) | **uhd-part-author**, catalog parts |
| Manuals' wiring orders, pinouts | `parts/evidence/<id>/`, catalog files in `parts/catalog/<id>/` | **uhd-part-research** |
| Peak currents | `npx protoboard check --format json` (`UHD_PROPULSION_CURRENT` details, supply budgets) | the checks |
| Supplier listings for hardware | fetched pages, dated | this skill, step 2 (item 3) |
| Structure thicknesses | plate modules' mechanical metadata | **frame-cad**, **enclosure-cad** |

## Steps

### 1. Wire harnesses (physical)

A cable is one physical thing, so it is modelled physically:

- each **end is a connector composite** (`Connector()`), positions in the
  printed order;
- the **conductors are an internal link** between the ends (`self` ↔ `self`),
  straight through unless `childLinks` state a crossover;
- the system **links each end** to the part's socket (a connector composite
  on the part), or, for a **soldered end**, to a **link-scoped composition**
  of the pads it lands on (`compose`).

UHD then derives the functional links (power, UART, I2C, S.Bus…) by tracing
the conductors, and every system check runs on them. Do not also store those
functional links.

```ts
export const DJI_O4_3IN1_CABLE: ModuleDef = {
  id: "dji-o4-3in1-cable", name: "DJI O4 3-in-1 cable", kind: "harness", topology: "wire",
  manufacturer: "DJI",
  interfaces: [
    Connector({ id: "end_fc", connector: "dji_6pin", gender: "plug", pins: ["10V", "G", "T5", "R5", "G", "Sbus"] }),
    Connector({ id: "end_o4", connector: "dji_3in1_cable_6pin", pins: ["VCC", "GND", "RX", "TX", "GND", "S.Bus"] }),
  ],
  links: [{ id: "wires", a: { self: true, interfaceId: "end_fc" }, b: { self: true, interfaceId: "end_o4" } }],
  traits: [{ type: "usage_note", params: { note: "Wire order VCC, GND, RX, TX, GND, S.Bus (O4 user manual).", included_with: "dji-o4-air-unit" } }],
};

// in the system
link("dji_fc", "DJI socket", ["stack", "dji_socket"], ["dji_cable", "end_fc"]),
link("dji_o4", "O4 cable socket", ["dji_cable", "end_o4"], ["video", "fc_cable_socket"]),
// a soldered end: the FC has no connector there, so the link composes the pads
{ id: "gnss_pads", a: { child: "gnss_lead", interfaceId: "end_fc" },
  b: { child: "stack", interfaceId: "gnss_pads",
       compose: { p1: "rail_4v5", p2: "fc:uart1_tx", p3: "fc:uart1_rx", p4: "fc:i2c1_scl", p5: "fc:i2c1_sda", p6: "gnd" } } },
```

If a part has a socket but no connector composite for it, fix the part
(**uhd-part-author** rule), do not compose around it.

For every harness decide and record, each from a source or as an assumption:

| Fact | Where | Rule |
| --- | --- | --- |
| Topology | `topology: "wire" \| "bus" \| "split" \| "or"` | wire = point to point; bus = shared (all boards on the same bolts); split = one source, several drops. |
| Ends and connectors | one `Connector()` per end: type, gender, positions in printed order | The type must match the part's socket (`connector_mismatch`), genders must differ (`connector_gender`), counts must agree (`connector_positions`). A soldered end is `solder_leads` and links to a composition. |
| Conductors | the internal `self` link; `childLinks` only for a non 1:1 cable | Copy the order from the manual; straight-through (1:1) is a claim too. A wrong conductor inside a UART/I2C shows as `harness_wiring` on the derived link. |
| Length | `performance` trait `{ kind: "cable", length_mm }` | Measure along the route between the placed ends (assembly positions) plus a service loop; a bought cable's length is its listing's. **harness-cad** reports the shortest clear route. |
| Gauge | `performance` trait `wire_gauge_awg` | From the peak current the links carry (the system checks give it: `UHD_PROPULSION_CURRENT` details, supply budgets). Cite the ampacity table used; short silicone leads carrying bursts are an assumption to state, not a table value. |
| Supplied with a part | `usage_note` `included_with: "<part id>"` | Included cables need no separate sources; the part's evidence covers them. |

The harness is a child of the module that declares the links to its ends.
Power and its ground travel in the same harness.

Check the derived links:

```bash
npx protoboard check --format json         # UHD_LINK_STATE on derived links names the cable links they run through
```

Every functional connection you expect through the cable must be there, in
state `configured` (`deriveLinks(system, lookup)` from `@deltarobotics/uhd`
lists them).

Give every cable its routed 3D geometry with **harness-cad**
(`@protoboardai/ext-harness-cad`): add a `cable_build` trait (colours, twisted
or flat, diameter when the gauge is unknown), a `cad.config.ts` in
`src/harnesses/<harness id>/`, run `npx protoboard run harness-cad`, and set
a cut-to-length cable's `length_mm` from the shortest route it reports.

See [wire harnesses](references/wire-harnesses.md) for the checklist and the quad's cables.

### 2. Fastener stacks (mechanical joints)

A mechanical harness lists the hardware as children with quantities, one
`bolt_pattern` interface (role `component`) matching the joint, and a
`fastenerStack`: where each part sits along the normal of the joint's
**structure-side frame**, measured from the structure face (mm), repeated at
every hole of its bolt pattern.

```ts
fastenerStack: [
  { child: "screws",  atMm: -5 },            // head under the 5 mm plate, shank up (+normal)
  { child: "spacers", atMm: 0 },             // 6 mm nylon spacer 0–6
  { child: "spacers", atMm: 10 },            // after the 4 mm ESC grommet (6–10): 10–16
  { child: "nuts",    atMm: 20, torque },    // after the FC grommet (16–20): 20–24
],
```

`atMm` is where the part's own origin sits (a screw's origin is under its
head, a nut's and spacer's at one face); `direction: -1` flips the part (a
screw inserted from above). `positions` overrides the hole list (the O4
camera: two holes per side plate).

1. **Draw the stack-up** from the structure face outward: plate thickness,
   each spacer/standoff, each board or grommet (the clamped thickness, not the
   board's), the nut. Every thickness is a cited value or an `assumption`.
2. **Choose lengths.** Screw length ≥ grip (everything between the head and
   the nut's far face) + about 1–2 thread pitches beyond the nut; for a blind
   thread (motor base, standoff, tapped hole, heat-set insert) ≤ the available
   thread depth and ≥ ~1.5 × diameter engagement where the material allows
   (derate for aluminium or plastic; honour a maker's maximum, e.g. DJI's
   3.10 mm for the O4 camera).
3. **Select real hardware** with a supplier listing you fetched: standard,
   size, length, material, part number, pack quantity. Put the listing on the
   part as a `usage_note` with `source` (and packaging as a `performance`
   trait). Dimensions the listing does not give (M2 nyloc height) are
   nominal-standard assumptions, stated as such. A local hardware module also
   needs the sizes the hardware CAD generator reads (**frame-cad** step 6):
   `npx protoboard run hardware-cad --input module=<id>`.
4. **Tightening torque** on the item you turn: `torque: { torqueNm, source }`
   when a maker states it, else `{ torqueNm, assumption, reference: [...] }`
   with the supplier table rows it was derated from (soft clamps, aluminium
   threads and PCBs need far less than a steel-nut table value).
   `UHD_FASTENER_TORQUE` warns on joints without one.
5. **Check** with the stack-up script and `protoboard check`:

```bash
npx tsx node_modules/@protoboardai/ext-hardware/skills/harness-author/scripts/stackup.ts   # [harness-id ...] [--json]
npx protoboard check
```

The script prints every item's span, the thread each screw leaves beyond each
nut's far face (negative: the screw stops inside the nut), and harness
quantities that differ from the positions the stack places. `assemble` makes
the same nut check (`UHD_ASSEMBLY: … ends 0.4 mm short of the far face of nuts`).

The quad's six stacks, worked through line by line: [stack-up worked examples](references/stack-up.md).

### 3. After a structure change

A change in plate thickness, standoff height or pattern (e.g. via
**frame-cad** or **enclosure-cad**) invalidates every stack that references
that face: the checks catch a screw that no longer reaches its nut, but not a
screw head that now sits inside a thicker plate or a blind thread that is now
too short. Re-derive each affected stack and re-run the script.

## Decision points

| Decision | Rule |
| --- | --- |
| Connector end or soldered end | A connector composite when the part has a socket; `solder_leads` and a link-scoped `compose` only when the part has bare pads. Never compose around a socket the part model lacks: fix the part. |
| Topology | `wire` point to point; `bus` when several boards share it; `split` when one source drops to several. |
| Bought or cut cable | A cable included with a part (`included_with`) or bought at a listed length keeps that length; a cut cable takes the routed length plus a service loop. |
| Gauge | From the peak current of the derived links and a cited ampacity table; otherwise an assumption. |
| Screw length | The shortest standard length that leaves 1–2 pitches beyond the nut, or that stays within a blind thread's depth and any maker maximum. |
| Torque | The maker's value when stated; otherwise derated from a supplier table, as an assumption with the rows it came from. |

## Outputs

| Output | Where |
| --- | --- |
| Harness modules (cables, fastener stacks) | `src/harnesses/` (the quad: `harnesses.uhd.ts`) |
| Hardware parts with supplier listings | `src/harnesses/hardware.uhd.ts`, nominal CAD in `src/harnesses/cad/` |
| Per-cable provider directories | `src/harnesses/<harness id>/cad.config.ts` (routes by **harness-cad**) |

## Verification

```bash
npx protoboard check --format json         # no UHD_ASSEMBLY, UHD_HARNESS_CONNECTOR, UHD_FASTENER_TORQUE, PB_UNKNOWN_HARNESS
npx tsx node_modules/@protoboardai/ext-hardware/skills/harness-author/scripts/stackup.ts --json   # exit 0
```

Every expected derived link is present and `configured`. Then
**harness-verify**, by a fresh agent.

## Failure handling

| Code or symptom | Means | Do |
| --- | --- | --- |
| `UHD_LINK_STATE` `connector_mismatch` / `connector_gender` / `connector_positions` | The plug does not fit the socket | Fix the cable end's connector type, gender or position count from the manual |
| `UHD_LINK_STATE` `compose_unknown_slot` | A composition names a position the cable end lacks | Fix the composition |
| `UHD_LINK_STATE` `harness_wiring` | A conductor lands on the wrong pad inside a UART/I2C | Fix the conductor order or the composition |
| `UHD_HARNESS_CONNECTOR` | A harness end does not match the interface it mates | Fix the end or the connector choice |
| `UHD_ASSEMBLY` "… short of the far face of nuts" | The screw stops inside the nut | Choose a longer screw; never shorten the model's stack |
| `UHD_ASSEMBLY` harness quantity ≠ stack positions | Quantities and holes disagree | Fix the quantities |
| `UHD_FASTENER_TORQUE` | No torque, or one without source or assumption | Add it on the turned item |
| `PB_UNKNOWN_HARNESS` | A link names a harness that is not a child | Add the harness child, or fix the name |
| `HARDWARE_CAD_PARAMS` | A fastener module lacks a size | Add it from the listing |
| `stackup.ts` exits 1 | A screw stops inside a nut or none passes through one | As for `UHD_ASSEMBLY` |

Every other code: **system-compose** [diagnostic codes](../system-compose/references/diagnostic-codes.md).

## Hard rules

1. Every length and thickness in a stack is cited or an `assumption`.
2. Never shorten the model's stack to make the nut check pass; change the
   hardware.
3. One harness per physical carrier; do not hide a cable inside a module.
4. Hardware you buy is a part with a supplier listing; hardware included with
   a part says `included_with`.
