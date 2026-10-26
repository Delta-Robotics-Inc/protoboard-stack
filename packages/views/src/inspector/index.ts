/**
 * The Inspector's selection and the DRC panel as components (PB-940, PB-901):
 * data in (model.ts), actions out. The VS Code shell draws them in native
 * views; the selection is built on the viewer's own details
 * (@deltarobotics/uhd-viewer `SelectionDetails`).
 */
export type * from "./model.js";
export { SelectionInspector, type SelectionInspectorProps } from "./SelectionInspector.js";
export { DrcPanel, type DrcPanelProps } from "./DrcPanel.js";
