# Symbol pack style

The rule book for every symbol in this pack, drawn or code-built. Each rule is decided once and applies everywhere.
The checker (`src/check.ts`) enforces every rule marked **[checked]**; the rest are judged on the contact sheet.

## 1. Frame and grid

- **Frame:** Lucide's 24 × 24 px box. A glyph that needs seven lattice points (RGB LED, optocoupler, relay, rotary
  encoder, Darlington, stepper) uses a 34 × 34 frame. No other sizes for drawn glyphs. **[checked]**
- **Lattice:** pins sit on the lines 2, 7, 12, 17, 22 (… 27, 32 in a 34 frame). One grid unit is 5 frame px.
  **[checked]**
- **Scale:** one grid unit renders as 16 screen px on the canvas at zoom 1, and as 2.54 mm in a KiCad export.
- **Coordinates:** every number in a drawn glyph is a multiple of 0.5 (the half-pixel grid), at most 3 decimals.
  Code-built symbols may use any value with at most 3 decimals. **[checked]**
- **Safe zone:** everything except leads stays inside 3 … 21 (3 … 31), so only leads reach the lattice edge. A form
  with no pins (an icon-only drawing) may use Lucide's whole 2 … 22. **[checked]**

## 2. Stroke

- **One weight per rendering, never mixed.**
  - Schematic: 0.5 frame px = 0.1 grid unit (0.254 mm in KiCad, its default line; 1.6 screen px at zoom 1).
  - Icon: 2 px at 24 px (Lucide). A 34 frame is scaled into 24 with the stroke scaled to stay 2 px.
- **Caps and joins:** round, in both renderings.
- **Color:** none in the file. Every stroke is `currentColor`; the host sets it from its theme (dark canvas, paper
  print), so one file serves both themes. No `fill`, `stroke`, `style`, `class` or `transform`. **[checked]**
- **Filled shapes:** none, except the junction dot (role `dot`), which the renderer fills. Diode triangles,
  arrowheads and contacts are open. **[checked]**

## 3. Shapes and corners

- Elements: Lucide's set only (`path`, `line`, `polyline`, `polygon`, `circle`, `ellipse`, `rect`). **[checked]**
- Rectangles: corner radius 1 px (0.2 unit) everywhere, in drawn glyphs and code-built boxes alike. (Lucide uses 2;
  1 keeps an IC box crisp on the sheet and still soft at 24 px.) Pills (the net label) use half their height.
- Polygons and triangles get their rounding from the round join, never from drawn arcs.
- **Two-terminal envelope:** a horizontal two-terminal body spans y 7 … 17 (10 px, 2 units) on row 12, about
  x 4.5 … 19.5. Resistor zigzag, capacitor plates, diode triangle and bar, fuse, crystal plates all fill it.
- **Optical parts** (LED, photodiode, photoresistor) sit on **row 17** at the compact size (8 px tall) so their
  light arrows keep 2 px clear above them. Same rule for all of them.
- **Round bodies** (sources, motor): circle r 7 on the center, leads 3 px.
- **Humps** (inductor, transformer, solenoid, stepper coils): 5 px pitch, 4 px tall.
- **Arrowheads:** open 90° chevrons. On an axis-aligned shaft the legs are 2.5 px along each axis
  (`m-2.5-2.5 2.5 2.5-2.5 2.5`); on a 45° shaft the legs are axis-aligned, 2.5 px (`h2.5v2.5`). Light arrows come
  in parallel pairs at 45°, 8 px apart.

## 4. Leads and pins

- **Every pin is on the lattice**, on a frame edge, never on a corner. Its direction is that edge's outward normal
  (left, right, up, down). Only net markers (no-connect, junction) sit inside, with direction `none`. **[checked]**
- **One lead per pin**, made of straight segments only, **starting exactly on the anchor** and leaving it straight
  inward along the pin's axis for at least 2 px. **[checked]**
- **Leads end on the body**: the lead's inner end touches the body (or another lead at a junction). **[checked]**
- A lead never runs through another pin's anchor. **[checked]**
- Leads are as long as the body leaves room for; the body is centered on the frame.
- **Pin ids** are short and conventional (`1` `2`, `A` `K`, `G` `D` `S`, `B` `C` `E`, `+` `-`, `OUT`). Standard numbers
  are recorded where they exist: two-terminal passives 1 and 2; diodes K = 1, A = 2; oscillator 1 EN, 2 GND, 3 OUT,
  4 VDD. Package-dependent numbers (transistors, op amps) are left to the part's pin binding.

## 5. Text and marks

- **Drawn glyphs carry no text.** Letters the convention needs are drawn as strokes (the motor's M). **[checked]**
- **Polarity and qualifier marks** (+, −, the comparator's step, the Schmitt hysteresis loop) have role `mark`. They
  are always on the schematic. An icon omits them when they cannot keep 2 px clear at 24 px (op amp, Schmitt,
  polarized capacitor); the US DC source's icon is its IEC form instead. Plus and minus marks are 3 px.
- **Code-built symbols** carry text: pin names inside the body at 2.5 px (0.5 unit, KiCad's 1.27 mm), pad numbers on
  the leads at 2 px, a title or IEC qualifier at 3 to 4 px. Font: the host's monospace.

## 6. Spacing (legibility at 16 px)

- **Icon:** separate shapes keep **2 px clear** at 24 px (Lucide's rule), measured after the roles the icon omits.
  Shapes that touch (a lead meeting a bar) are one shape. **[checked]**
- **Schematic:** separate shapes keep at least 1 px clear. **[checked]**
- When a glyph cannot meet the icon rule at all, its icon is another drawing, named in `icon.from`: a variant
  (`iec`), an icon-only variant (`icon`: bridge rectifier, rotary encoder) or another pack symbol (`pack:led` for the
  RGB LED, `pack:phototransistor` for the optocoupler, `pack:transistor-npn` for the Darlington, `pack:motor-dc`
  for the stepper). **[checked]** that the source exists.

## 7. Conventions and variants

- **US (IEEE 315) forms are the default** where US and IEC differ: zigzag resistors and their kin (potentiometer,
  trimmer, thermistor, varistor, photoresistor), the S-curve fuse and PTC fuse, the curved-plate polarized
  capacitor, the +/− DC source, the arrow current source, distinctive-shape logic gates.
- **The IEC (60617) form is the variant named `iec`**: box resistors, the boxed fuse with its line, straight plates
  with + for the polarized capacitor, line-through and line-across sources, rectangular gates with `&`, `≥1`, `=1`,
  `1` (code-built, with pins exactly where the US gate has them, so switching convention never moves a wire).
- Where both standards draw a part alike (capacitor, inductor, diode, transistors, ground), it has one form and
  `convention: common`.
- **Other variants are named for what they change**, kebab-case: `body-diode`, `depletion`, `power-pins`,
  `bidirectional`, `common-cathode`, `inverted-f`, `output`, `pad`, `icon`. A variant may change pins and frame;
  mirroring and rotation are never drawn, the renderer computes them.

## 8. Electrical conventions (checked by the tests)

- MOSFETs default to **enhancement** (broken channel); `depletion` is the solid channel. The body ties to the
  source; N-channel's arrow points into the channel, P-channel's out. `body-diode` adds the diode from source to
  drain (N) or drain to source (P), cathode toward the higher-potential terminal.
- Diodes: anode left, cathode (the bar) right. Zener: square bar ends; TVS: 45° bar ends; Schottky: S hooks.
- Ground points down (pin on top); positive supplies point up (pin at the bottom); negative supplies point down with
  one bar (ground has three; chassis is a rake; protective earth is circled).
- The relay is drawn de-energized, common resting on NC.

## 9. Format

One file per symbol, `pack/<id>.symbol.json`, schema `protoboard.symbol/v0` (`src/types.ts`): id, name, category,
refdes prefix, convention, origin, frame, pins, body (each element with a role), variants, fields, icon, tags,
match keywords, license, provenance, notes. Files are in one canonical text form (`src/format.ts`): fixed key order,
one pin and one body element per line. **[checked]**

Changes from the lane 23 proposal: `frame` is `{w, h}` (code-built symbols are any 4 + 5k size) instead of a fixed
size plus lattice list; pin `at` stays in lattice units; roles are a closed set (`lead`, `body`, `arrow`, `mark`,
`link`, `dot`, and text roles for code-built symbols); `icon.from` can name a variant, an icon-only variant or
another pack symbol; variants can be generated (`generator`); `origin` tells drawn from code-built; provenance has a
`review` state (`draft` until approved).

## 10. The September set (2026-09-30), and what changed

Kept as the baseline: the 24 px Lucide frame, the 2 px round stroke, open shapes, the US forms.

| Icon | Status | Change and why |
|---|---|---|
| battery-cell | redrawn | plates fit the 10 px envelope; long plate 10 px, short 5 px |
| capacitor | complies | unchanged geometry; split into lead and plate elements with roles |
| capacitor-polarized | redrawn | curved plate within the envelope; + mark moved off the plates (schematic only in the icon) |
| crystal | redrawn | box 4 × 12 at rx 1; plates 4 px from the box (was 4 px, kept) |
| diode | redrawn | triangle 8 × 10 to match the envelope (was 10 × 12, taller than every other body) |
| diode-zener | redrawn | square bar ends (KiCad-style); the old 45° ends now mean TVS |
| diode-led | redrawn | leads were at y 15 (off the lattice); now row 17 with the compact diode, arrows 2 px clear |
| fuse | redrawn | two arcs (a clean S) in the envelope, 3 px leads |
| gate-and, gate-or | redrawn | inputs were at y 9 and 15 (off the lattice); now 7 and 17; all gates share back at x 5, front at x 16 |
| gate-not | redrawn | same triangle as the buffer and every gate; bubble r 2 |
| ground | redrawn | top was at y 3 (off the lattice); now a lead from the anchor at y 2 to bars at 10, 14, 18 (4 px apart) |
| inductor | redrawn | humps 4 px tall instead of 3.5 ("reads light" in the review) |
| mosfet | redrawn | **solid channel meant depletion**; now enhancement (broken channel) by default with the body tie and arrow, D and S on the lattice (were x 19) |
| op-amp | redrawn | inputs were at y 8 and 16; now 7 and 17, with + and − marks (omitted in the icon) |
| potentiometer | redrawn | wiper arrow lands on the zigzag's peak; the old arrowhead blobbed at 16 px |
| resistor | complies | the zigzag kept exactly; leads split out as lead elements |
| source-ac | redrawn | circle r 7 (was 8) so its leads are 3 px and the sine keeps 2 px clear |
| source-dc | redrawn | the marks sat 1 px from the circle; the US form keeps + and − on the schematic, the icon uses the IEC form |
| switch-open | redrawn | lever steepened so it keeps 2 px clear of the far contact; now `switch-spst` |
| transistor-npn, -pnp | redrawn | collector and emitter ended on diagonals with no lead; now vertical leads from the lattice at x 17; arrows as 2.5 px chevrons |

## 11. Licensing

The pack is drawn from scratch to these rules (Apache-2.0, like the stack). KiCad's library (CC-BY-SA 4.0) and
tscircuit's `schematic-symbols` (MIT) served only as checklists of what a library needs; no geometry was converted,
traced or copied from either. The frame, stroke and spacing rules follow Lucide's published conventions; Lucide's
ISC notice is in `licenses/LUCIDE-ISC.txt` (see NOTICE). No Lucide glyph is reused.
