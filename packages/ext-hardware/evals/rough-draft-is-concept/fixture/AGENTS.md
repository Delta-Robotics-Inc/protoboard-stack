# trail-light

A Protoboard hardware project. The system is described in UHD
(`@deltarobotics/uhd`): modules, interfaces, links, harnesses, artifacts.

- `npx protoboard inspect [instance]`, `npx protoboard check`, `npx protoboard build`
- `npx protoboard skills` lists the installed SOPs; start with **build-a-project**.
- The top-level module lives under `src/` (`src/trail-light.uhd.ts`, export `TRAIL_LIGHT`).
- Decisions go in `docs/decisions.md`; the idea is in `docs/brief.md`.
