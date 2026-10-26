# src/enclosures: cases designed here

A case is a module designed here: `<case>/<case>.uhd.ts` states the features
it must provide (windows, button plungers, lugs, the board's mounting, the
seal or joint between its bodies) and what sits inside it, and
`<case>/cad.config.ts` names its `cad` provider, @protoboardai/ext-enclosure-cad,
which generates the printed bodies (build123d) with fit, wall and alignment
checks: `protoboard run cad:generate --module <case>`, then `cad:export`.

The wearable-watch reference project's `src/enclosures/watch-case/` is the
worked example (PETG case, lens and heart-rate window, side-button plungers,
spring-bar lugs, back cover on M2 heat-set inserts). The **enclosure-cad**
skill (`protoboard skills`) is the procedure.
