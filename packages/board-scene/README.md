# @protoboardai/board-scene

An agent's eyes on a board. Board geometry has only ever existed for human eyes; this package
gives an agent two views of the same board that share their labels:

- a **scene**: compact JSON sized for a model's context, with the relations an agent needs
  (what is next to what, how far, what crosses what, where there is room), and
- an **image**: an SVG (and PNG) of the same view, where every numbered marker is the item
  with the same number in the JSON and every part carries the reference the JSON uses.

It runs in plain Node: no GPU, no window, no browser. It reads a board snapshot from
[`@protoboardai/board`](../board) and never writes to it. Same snapshot in, same bytes out.

```ts
import { describeBoard, diffScene } from "@protoboardai/board-scene";

const { json, svg, png, stats } = describeBoard(snapshot, { net: "I2C_SDA", image: "both" });
const change = diffScene(before, after, { image: "png" });
```

Units in everything this package emits: millimeters and degrees, +X right, **+Y up**, origin
at the board center. Boxes are `[minX, minY, maxX, maxY]`. Ids are the board core's ids
(`fp:sensor/ic`, `pad:sensor/ic:1`, `trk:...`, `via:...`, `zone:...`, `kpo:...`, `net:<name>`);
ratsnest lines get scene-only ids `rat:<net>:<n>`.

## How to look at a board

1. **Overview first** (`describeBoard(snap)`). Read `counts` and `nets`: every net has a
   `status` (`complete`, `partial`, `unrouted`, `single`, `empty`) and `missing` links. Read
   `footprints` for where parts are and their nearest neighbor in each direction (`near`).
   `congestion` shows copper density and free channels per cell and layer. Look at the image
   to see the shape of the board.
2. **Pick the work.** Incomplete nets, a part that must move, a finding from the checks.
3. **Zoom in**: a net (`{ net }`), a region (`{ region: [x0, y0, x1, y1] }`), an object
   (`{ object: id }`) or a finding (`{ finding: id, findings }`). Region and object views add
   pads with nets, track polylines, vias, ratsnest lines with what they cross, and copper of
   other nets under or beside each part.
4. **Ask before you route**: `corridors: [{ from, to, layer }]` searches for a free path for a
   track of the board's target width and clearance and reports its length and the widest track
   that fits, or where it got stuck and what blocks it.
5. **Change through the board service**, then **check the change** with
   `diffScene(before, after)`: what moved and how far, which nets were rerouted, how lengths
   and completion changed, and an image with the old state dashed in gray and the new in cyan.
6. **Verify connectivity from the data, never from the picture.** The image is for spatial
   sense and cross-checking; the JSON is the record.

For a whole-board pass, `describeWalkthrough(snap, { cols: 3, rows: 2 })` gives one region
description per tile (`A1` top left; letters are columns, numbers rows).

## What it costs

Measured with `scripts/samples.ts` on the Airnode C3 fixture (40 x 30 mm, 2 layers, 19 parts,
10 tracks) and on the synthetic six-layer board in `src/fixtures/synthetic.ts` (100 x 80 mm,
122 parts, 1,019 track segments, 403 vias, 140 nets). Characters are of the compact JSON;
tokens are estimated as characters / 3 (no tokenizer is installed here; numeric JSON runs about
2.5 to 3.5 characters per token, so treat these as plus or minus 20 percent). Image tokens use
the published rule of thumb width x height / 750.

| View | Budget (chars) | Airnode C3 | Synthetic six-layer | Image (px, ~tokens) |
|---|---|---|---|---|
| overview | 24,000 | 11,586 (~3.9k tok) | 19,480 (~6.5k tok), compacted | 1260x964 (~1.6k) |
| region | 40,000 | 9,118 (~3.0k tok), 18 x 10 mm | 39,836 (~13.3k tok), 20 x 20 mm, tails cut | 1260x723 to 1260x1256 (~1.2k to 2.1k) |
| object (a part) | 16,000 | 7,973 (~2.7k tok), U3 | 15,587 (~5.2k tok), 33-pad U2, compacted | 572x552 (~0.4k) to 1052x1048 (~1.5k) |
| net | region budget | 4,922 (~1.6k tok), I2C_SCL | 7,133 (~2.4k tok) | ~0.8k to 1.5k |
| finding | object budget | 6,118 (~2.0k tok) | | 380x376 (~0.2k) |
| diff | none | 804 (a move and a new track) | | |

Time: an overview of the six-layer board takes about 0.6 s (congestion rasterizes every
layer); region, object and net views take 0.02 to 0.3 s.

**When a view does not fit its budget** it gets smaller in a fixed order and says so in
`budget.truncated`: first compact forms (footprints and nets become rows described in
`legend`; congestion keeps density only), then whole sections (neighbor lists, copper
relations, the under-part list, rats at overview, congestion), then list tails (incomplete nets
are kept before complete ones). The focus of an object view is cut last. Pass `budget` to raise
the limit, or narrow the view with `region`, `net`, `layers` or `kinds`.

## The scene

Top-level keys, in order: `schema` (`protoboard.board-scene/v1`), `detail`, `legend` (the
compact forms explained), `board` (name, box, size, thickness, copper layers, the target track
width, clearance and edge clearance it plans with, and the snapshot's epoch and seq), `view`
(box, layers, filters), `counts`, `markers`, `connectivity` (where completion came from),
then `focus` (object views), `findings`, `footprints`, `nets`, `rats`, `copper` or `tracks`,
`vias`, `zones`, `keepouts`, `under`, `locks`, `corridors`, `congestion`, `budget`.

| Item | Overview | Region and object |
|---|---|---|
| footprint | id, ref, value, side, `at`, rot, box, pad count, `near`, lock, provenance (`by`) | plus `footprint`, `pads` rows `[number, x, y, net, pin]`, `copper` (other nets' tracks `under`, `through` or `beside` it, with gaps) |
| net | name, class, pads, routed length per layer, vias, status, missing, zones | plus island and floating-copper counts |
| rat | `[id, from id, to id, length, crossed track ids]` | object with ends, length and `crosses: [[track, net, layer]]` |
| tracks | per-layer totals (`copper`) | polylines per net, layer and width: `pts`, `len`, segment `ids`, arcs, locks, provenance; `tracks: "segments"` gives every segment |
| zone, keep-out | id, name, net, layers, priority, box, area, fill and pad connection (zone); layers, what it `blocks`, tier, owner (keep-out) | same |

The object view's `focus` holds the full record of one thing: for a footprint every pad
(shape, size, layers, drill, the copper touching it), the nearest part in each direction with
center offsets, the six nearest parts, its nets' status, ratsnest lines at its pads, keep-outs
over it and findings naming it; for a track its chain, the pads it touches and the nearest
copper of other nets with gaps; for a net every pad, segment, via, island and ratsnest line.

### Relations, defined

- **Neighbors.** The direction of B from A is by the offset between box centers in 90 degree
  cones (left is -X, up is +Y; a diagonal tie goes left or right). The gap is edge to edge
  between footprint boxes, where a box covers courtyard, pads and graphics. `near` names the
  nearest part per direction.
- **Copper at a part.** A track of a net the part does not use is `under` it when it crosses
  the part's box on a layer the part has no pads on, `through` it when on a pad layer, and
  `beside` it within 1 mm.
- **Ratsnest crossings.** Where a missing link's straight line crosses a routed track of another
  net, seen from the top on any layer.
- **Congestion.** The view is cut into square cells (a round size, about 8 across). Per copper
  layer, rows top (max Y) to bottom, columns left to right: `copper` is the percent of the
  cell's board area covered by copper; `hFree` and `vFree` count the tracks of the board's
  target width and clearance that could cross the cell left to right and bottom to top.
- **Corridors.** An A* search on a raster of the layer (0.05 mm pixels on small views, coarser
  on big ones; the result says `res`) through pixels at least `width / 2 + clearance` from any
  copper of another net, the board edge and keep-outs that block tracks. The route's own net is
  not an obstacle. `maxWidth` is the widest track that fits along the whole path at that
  clearance. `shift` says how far an end had to move to reach free space. When nothing is
  found, `stuckAt` is the reachable point nearest the goal and `blockedBy` lists what is
  around it.

### Connectivity

The board checks package is the authority on completion. Pass its result as `connectivity`:

```ts
interface ConnectivityInput {
  source?: string;
  nets: { net: string; islands: string[][]; missing: number }[];  // pad and object ids
  ratsnest: { net: string; from: { id: string; x: number; y: number; layer?: string }; to: { ... } }[];  // nanometers
}
```

Without it the scene estimates completion from geometry and says so in `connectivity`: copper
of one net joins when it overlaps on a shared layer (pads by their shapes, tracks by width,
vias by diameter). Zone fill is not computed, so an item inside a zone of its net, on a zone
layer, counts as joined to the pour. Ratsnest lines are a minimum spanning tree over the
islands, between pad centers, track ends and via centers.

## The image

`renderSvg(model, options)` draws on the dark canvas with the board palette of
`@protoboardai/views` (copper per layer, pads in the finish color, silkscreen, courtyards
dashed, keep-outs hatched red, zones as light fills with dashed outlines). Overlays:

- **labels**: footprint references always (the shared key for parts); in region and object
  views also pad numbers and net names along tracks;
- **markers**: numbered circles with a leader to what they name, for findings, ratsnest lines
  (when at most 20 are in view), corridors, keep-outs and zones; the scene's `markers` lists
  `[n, id]` and each item carries `m`;
- a **millimeter grid** with axis ticks in board coordinates, the origin (board center) marked
  with a cross, and a **scale bar**;
- **highlight**: the focus net or object in cyan, everything else veiled;
- **ghosting** (`diffScene`): the old state dashed gray, the new in cyan.

All text is drawn with the package's own stroke font as paths, so the SVG needs no fonts and the
PNG is the same on every machine. `svgToPng(svg, { width })` uses `@resvg/resvg-js` (already in
the stack); `pngAvailable()` says whether it loads here.

## Worked examples (Airnode C3)

**Which part is nearest to U3 on its left, and how far?**
`describeBoard(snap)` gives U3 `"near":{"left":["R3",1.5],"right":["U1",6],"up":["C4",0.95],"down":["U2",9.63]}`.
R3, 1.5 mm edge to edge. The object view (`{ object: "fp:sensor/ic" }`) adds that R4 is also
1.5 mm away on the left (`nearest`) and that C4 above is closer still (0.95 mm).

**Which nets are unrouted?**
In the overview's `nets`: BOOT, CC1, CC2, EN, LED1, LED1_A, LED2 and LED2_A have no copper
(`unrouted`). Seven more are `partial`. I2C_SCL is one: its track runs on the bottom layer
between two top-side pads with no vias, so `{ net: "I2C_SCL" }` shows three islands and two
ratsnest lines, one of them along the track.

**Is there a free channel on the top layer from R3 pad 2 to U3 pad 1?**
```ts
describeBoard(snap, { region: [-18, 4, 0, 14], corridors: [{ from: "pad:sensor/r_sda:2", to: "pad:sensor/ic:1", layer: "top" }] })
```
returns `"found":true,"len":2.33,"maxWidth":0.8` on net I2C_SDA (taken from the pads): a
0.25 mm track at 0.2 mm clearance fits, and the narrowest point (next to U3 pad 2) leaves room
for 0.8 mm. The image draws the path in green with its marker number.

**What did my edit do?** Moving U3 by (1, -0.5) mm with its tracks left in place and adding a
segment from R3 pad 2: `diffScene` reports U3 `moved` 1.118 mm, I2C_SDA `added` one segment
(top length 17.61 to 19.13 mm) and its missing links going from 1 to 2, because the old SDA
track no longer reaches U3's pad.

## Limits

- Connectivity without the checks package is an estimate (above); pour fill is not computed.
- Raster answers (congestion, corridors) are good to about one pixel; `res` is reported. Edge
  clearance is treated as the copper clearance in both.
- Polylines show an arc by its midpoint; ask for `tracks: "segments"` for exact arcs.
- Footprint text placeholders are replaced by the reference and value; text sizes in the image
  are approximate.
- Token counts are estimates (above).

## Files

| Path | Contents |
|---|---|
| `src/describe.ts` | `describeBoard`, `describeWalkthrough`, `createSceneExporter` (a core `Renderer`) |
| `src/scene.ts` | levels, filters, budgets, markers, polylines |
| `src/relations.ts` | neighbors, copper at parts, ratsnest crossings, congestion, corridors |
| `src/connectivity.ts` | the input shape and the geometric estimate |
| `src/raster.ts` | per-layer occupancy raster and distance transform |
| `src/svg.ts`, `src/font.ts`, `src/png.ts` | the image |
| `src/diff.ts` | `diffScene` |
| `src/crops.ts` | crop boxes and walkthrough tiles |
| `src/fixtures/synthetic.ts` | the synthetic six-layer board |
| `scripts/samples.ts` | sample outputs and the measurements above |

Apache 2.0. Protoboard is a trademark of Delta Robotics, Inc.
