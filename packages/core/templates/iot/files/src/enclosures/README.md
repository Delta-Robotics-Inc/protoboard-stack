# src/enclosures: housings designed here

A housing is a module designed here: `<housing>/<housing>.uhd.ts` states the
features it must provide (the board's mounting bosses, the USB-C port and its
seal, windows, button plungers, the joint between its bodies) and what sits
inside it, and `<housing>/cad.config.ts` names its `cad` provider,
@protoboardai/ext-enclosure-cad, which generates the printed bodies (build123d)
with fit, wall, seal and alignment checks: `protoboard run cad:generate
--module <housing>`, then `cad:export`.

The smart-bottle reference project's `src/enclosures/bottle-cap/` is the
worked example (a PETG cap on a bottle's thread, sealed with O-rings, a
bayonet lid, heat-set inserts for the board). The **enclosure-cad** skill
(`protoboard skills`) is the procedure.
