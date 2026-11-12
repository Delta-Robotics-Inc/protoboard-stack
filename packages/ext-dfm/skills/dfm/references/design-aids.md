# Design aids

A **design aid** is a small physical object made on the user's own machine
to answer one manufacturing question before the real part is made: a fit-test
coupon, a printed slice of the real part, a calibration print. It turns a
`typical` value from a datasheet or a guide into a `proven` value for this
printer, this nozzle and this material. Agents prepare design aids and say
what to measure; a person makes them and reports the result.

Status of this page's kit: **the calibration kit's models are not built yet.**
The coupon list (what each coupon tests, its steps and its basis) lives in
the printing playbook: [test coupons](../../dfm-3d-printing/references/test-coupons.md).
Until the models exist, the agent models a coupon for the project from that
list, as described below.

## Print a slice first

Before a long print, print the part of it that can fail. Markforged calls
this a "unit test": isolate the critical feature as its own body, make
variations, print and test them, then update the full model, keeping each
test short
(https://markforged.com/resources/learn/design-for-additive-manufacturing-plastics-composites/3d-printing-strategies-for-composites/composites-3d-printing-design-tips,
accessed 2026-11-12). Bambu Studio's cut tool can make the slice straight from
the full model (https://wiki.bambulab.com/en/bambu-studio/manual/3d-print-large-files,
accessed 2026-11-12).

How to choose the slice (a procedure synthesized from the sources above;
the sizes are assumptions to adjust per part):

1. List every interface that mates with something else: bores, lids and
   rims, snaps, insert bosses, nut and magnet pockets, rails, the board's
   standoffs and connector openings.
2. Cut a section that holds the whole mating perimeter but little height: a
   ring a few millimeters tall for a round lid or bore, a short length of a
   rail or dovetail, one boss with a few millimeters of the wall around it.
3. Keep the slice at the same height class as in the real part. A fit at the
   first layers must start on the bed (it sees the elephant's foot); a fit in
   the middle of the part gets a short sacrificial base so it is not squashed
   by the first layer.
4. Keep the orientation, slicer profile, filament, walls and infill the same
   as the final print.
5. Test with the real hardware: the actual bearing, magnet, insert, board or
   mating part. Adjust the model per side, and print the slice again when the
   change is larger than about 0.1 mm (an assumption: below that, the next
   full print is the cheaper test).

## The modular calibration kit (planned)

A kit of small, independent coupons, each testing one parameter:

- **One parameter per coupon**, so a result maps to one profile path.
- **Printable alone in minutes**, or tiled on one plate with the others for
  a full calibration session.
- **Printed like the real part**: same material, walls and infill, and the
  orientations that matter (vertical, horizontal and angled holes behave
  differently; https://www.cnckitchen.com/blog/tips-and-tricks-for-heat-set-inserts,
  accessed 2026-11-12).
- **Labeled**: each step embossed with its value and its kind, per side or
  diametral, so a coupon read a month later is still unambiguous.
- **A template**: each coupon is a parametric model the agent copies and
  sets to the project's real hardware (the actual magnet size, insert, pin or
  lid), which makes it a project-specific coupon.
- **Kits per process**: printing first; laser cutting later (kerf, tab and
  slot press fit, living hinge pitch), then CNC and others as their playbooks
  land.

The coupon list, with steps and sources, is in
[test coupons](../../dfm-3d-printing/references/test-coupons.md).

## Recording a result

A coupon result goes into a layer as an entry object
([profile format](profile-format.md)):

- the printer's behavior (hole compensation, a clearance that holds across
  materials) in the user layer, `<config>/dfm/profile.json`;
- a result tied to one material or one project's hardware in the project
  layer, `dfm/profile.json`;
- `status`: `proven` when the step chosen worked, `failed` for a value that
  was tried and did not (record it too, so nobody tries it again);
- `source`: the coupon's name;
- `note`: the coupon, the step chosen, the material, the layer height and the
  date, and per side or diametral.

Example (the values are an example, not a recommendation):

```json
"clearance.sliding.side": { "value": 0.15, "unit": "mm", "status": "proven", "source": "lid and slot fit coupon", "note": "PETG, 0.2 mm layers, step 0.15 per side slid freely, 0.10 bound; 2026-11-12" }
```

Re-run a coupon when the printer, nozzle, material or slicer profile changes.

## What building the kit involves

1. A parametric model per coupon in the stack's CAD runtime (build123d), with
   embossed labels and the step list as parameters.
2. A plate layout that tiles every coupon for one session.
3. A short procedure per coupon: what to insert or slide, what counts as a
   pass, which profile path the result sets.
4. A writer that records a result into the right layer with status and note.
5. The same pattern for laser cutting once its playbook exists.

A branded test print (one object that shows the house style and exercises
the common limits at once) is also planned; see the stack's
`docs/reference/design-aids.md`.
