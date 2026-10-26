# bike-computer

A Protoboard hardware project. The system is described in UHD
(`@deltarobotics/uhd`): modules, interfaces, links, harnesses, artifacts.

- `npx protoboard inspect [instance]`, `npx protoboard check`, `npx protoboard build`
- `npx protoboard skills` lists the installed SOPs; start with **build-a-project**.
- The top-level module lives under `src/` (`src/bike-computer.uhd.ts`, export `BIKE_COMPUTER`).
- The diagram's layout is saved in `.protoboard/display.json`, the one file under `.protoboard/` you may write.
