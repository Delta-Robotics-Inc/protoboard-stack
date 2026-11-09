/**
 * The shared shell of the PCB editor's screens (layout, schematic): the neutral pieces both use. Re-exports of the
 * layout screen's stylesheet, icons and clock (so the frames cannot drift), a depth switcher whose active entry is
 * given (the layout screen's own top bar always marks Layout), and the cross-probe channel.
 */
export { SCREEN_CSS, BRAND, SELECT } from "../pcb/ui/styles.js";
export { Icon } from "../pcb/ui/icons.js";
export { clock } from "../pcb/ui/shell.js";
export { DepthSwitcher, DEPTHS, type Depth } from "./switcher.js";
export { publishProbe, onProbe, lastProbe, probeFromLayout, probeToLayout, layoutProbe, type Probe, type ProbePart, type LayoutProbeView } from "./probe.js";
