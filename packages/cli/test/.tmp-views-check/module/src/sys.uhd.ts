const A = { id: "part-a", name: "part-a", interfaces: [{ id: "p", name: "P", domain: "electrical", exposed: true, pin: 1, protocols: [{ type: "gpio", roles: ["bidirectional"] }] }] };
const B = { id: "part-b", name: "part-b", interfaces: [{ id: "p", name: "P", domain: "electrical", exposed: true, pin: 1, protocols: [{ type: "gpio", roles: ["bidirectional"] }] }] };
export const BOARD = {
  id: "fixture-board",
  name: "Fixture board",
  interfaces: [],
  children: [{ id: "u1", moduleDefId: "part-a" }, { id: "u2", moduleDefId: "part-b" }],
  links: [{ id: "l1", a: { child: "u1", interfaceId: "p" }, b: { child: "u2", interfaceId: "p" } }],
  artifacts: [
    { id: "sch", name: "Schematic", type: "schematic", format: "svg", filePath: "board/out/schematic.svg" },
    { id: "top", name: "PCB top", type: "pcb", format: "svg", filePath: "board/out/pcb-top.svg" },
  ],
};
export const SYS = { id: "fixture-sys", name: "Fixture system", interfaces: [], children: [{ id: "board", moduleDefId: "fixture-board" }, { id: "loose", moduleDefId: "part-a" }] };
export const DEFS = [A, B];
