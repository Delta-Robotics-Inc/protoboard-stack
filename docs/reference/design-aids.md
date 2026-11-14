# Design aids

A **design aid** is a small physical object made on the user's own machine to
answer one manufacturing question before the real part is made: a fit-test
coupon, a printed slice of the real part, a calibration print. It turns a
`typical` value in the DFM profile into a `proven` one for this printer,
nozzle and material. This page is the stack's standing pointer for design
aids; the procedures live in `@protoboardai/ext-dfm`.

## Status: not built yet

| Item | Status |
| --- | --- |
| The print-a-slice practice | Documented; the agent applies it today (**dfm** step 6) |
| The coupon list (what each coupon tests, steps, basis) | Documented in the printing playbook |
| The modular calibration kit (coupon models) | **Not built yet** |
| The branded test print | **Not built yet** |
| Recording a coupon result into a profile layer | Documented; done by hand today |

## Where things are

| What | Where |
| --- | --- |
| What a design aid is, the slice practice, the kit concept, recording a result | `packages/ext-dfm/skills/dfm/references/design-aids.md` |
| The coupon list | `packages/ext-dfm/skills/dfm-3d-printing/references/test-coupons.md` |
| The profile layers a result goes into, and the status vocabulary | `packages/ext-dfm/skills/dfm/references/profile-format.md` |
| The design of the DFM system | `docs/specs/dfm-system.md` |
| Physical references the stack measures against (calibration cubes, scan rulers) | [reference tools](reference-tools.md) |

## Print a slice first

Before a long print, print the part of it that can fail: the full mating
perimeter of each fit (a lid rim, a bore, a rail, an insert boss) with as
little height as possible, at the same height class as in the real part,
with the same orientation, filament and slicer profile, tested against the
real hardware. The procedure and its sources are in the skill reference
above.

## The planned modular calibration kit

Small, independent coupons, one parameter each (a hole and pin clearance
ladder, a lid and slot fit, insert, nut and magnet pocket ladders, a wall
ladder, an overhang fan, a bridge ladder, text size and depth, bed edge
treatment, snap fit, threads, living hinge). Each prints alone in minutes or
tiles with the others on one plate, is labeled with its values and whether
they are per side or diametral, and is a parametric template an agent sets
to the project's real hardware. Kits per process: printing first, laser
cutting next (kerf, tab and slot, living hinge pitch).

## The planned branded test print

One object that carries the house style and exercises the common limits at
once (a fit, a pocket, an overhang, a bridge, text), for a quick check of a
new printer, nozzle or filament.

## What building them involves

1. A parametric build123d model per coupon, with embossed labels and the
   steps as parameters, in a stack package with a test that the models
   generate.
2. A plate layout that tiles the kit for one session.
3. A short procedure per coupon: what to insert or slide, what counts as a
   pass, which profile path the result sets.
4. A writer that records the result into the user or project layer with
   status `proven` or `failed` and a note naming the coupon and the date.
5. The branded test print, designed with the style package.
6. The same pattern for laser cutting once its playbook exists.

Printing a coupon is a physical action: a person performs or authorizes it.
