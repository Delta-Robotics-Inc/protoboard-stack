/**
 * The schematic screen's own styles, on top of the layout screen's (`SCREEN_CSS`, the shared frame): the sheet,
 * its overlays, the depth stops, status chips on facts, numbered defects and the part card. Blue (`--pcb-select`)
 * is selection, probes and proposals only; orange is the one main action.
 */
export const SCHEMATIC_CSS = /* css */ `
.sch-main { position: relative; grid-row: 2 / 3; grid-column: 2 / 3; overflow: hidden; background: var(--pcb-ground); }
.sch-canvas { position: absolute; inset: 0; outline: none; touch-action: none; }
.sch-canvas.pan { cursor: grabbing; }
.sch-canvas.wire { cursor: crosshair; }
.sch-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; overflow: hidden; }
.sch-svg .layer.blocks text { font-family: var(--pcb-mono); text-anchor: middle; dominant-baseline: middle; }
.sch-svg .blk { fill: none; }
.sch-svg .blk-t { fill: var(--pcb-strong); letter-spacing: 0.08em; text-transform: uppercase; }
.sch-svg .blk-s { fill: var(--pcb-body); }
.sch-svg .layer.blocks .blk-n { fill: var(--pcb-mute); text-anchor: end; dominant-baseline: auto; }
.sch-svg.lod1 .layer.wires, .sch-svg.lod1 .layer.symbols, .sch-svg.lod1 .layer.power, .sch-svg.lod1 .layer.labels, .sch-svg.lod1 .layer.junctions, .sch-svg.lod1 .layer.nc { opacity: 0.22; }
.sch-svg.lod1 .pt, .sch-svg.lod2 .pt, .sch-svg.lod1 .fld, .sch-svg.lod1 .layer.marks { display: none; }
.sch-svg.lit [data-net]:not(.on) { opacity: 0.22; }
.sch-svg .layer.over rect.sel, .sch-svg .layer.over rect.sel-pin { fill: rgba(90, 169, 255, 0.10); stroke: var(--pcb-select); stroke-width: 1.4; vector-effect: non-scaling-stroke; }
.sch-svg .layer.over rect.sel.card { fill: none; stroke-dasharray: 6 4; }
.sch-svg .layer.over rect.hov { fill: none; stroke: var(--pcb-select); stroke-opacity: 0.55; stroke-width: 1; vector-effect: non-scaling-stroke; }
.sch-svg .layer.over rect.probe { fill: rgba(90, 169, 255, 0.08); stroke: var(--pcb-select); stroke-width: 1.4; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
.sch-svg .layer.over rect.fld-box { fill: none; stroke: var(--pcb-select); stroke-opacity: 0.6; stroke-dasharray: 2 2; stroke-width: 1; vector-effect: non-scaling-stroke; }
.sch-svg .layer.over polyline.sel-w { fill: none; stroke: var(--pcb-select); stroke-width: 3; stroke-opacity: 0.55; vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
.sch-svg .layer.over polyline.hov-w { fill: none; stroke: var(--pcb-select); stroke-width: 2; stroke-opacity: 0.35; vector-effect: non-scaling-stroke; }
.sch-svg .layer.over rect.sel-v { fill: var(--pcb-select); }
.sch-svg .layer.over polyline.pv-w { fill: none; stroke-width: 0.12; stroke-dasharray: 0.4 0.25; stroke-linecap: round; stroke-linejoin: round; }
.sch-svg .layer.over polyline.draft { fill: none; stroke: var(--pcb-select); stroke-width: 0.14; stroke-dasharray: 0.5 0.3; stroke-linecap: round; }
.sch-svg .layer.over rect.band { fill: rgba(90, 169, 255, 0.06); stroke: var(--pcb-select); stroke-width: 1; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
.sch-svg .layer.over .pin-tag { fill: var(--pcb-mute); font-family: var(--pcb-mono); letter-spacing: 0.08em; }
.sch-svg .layer.marks text { font-family: var(--pcb-mono); text-anchor: middle; dominant-baseline: central; fill: #131313; font-weight: 700; }
.sch-svg .layer.marks .mk { cursor: pointer; }
.sch-legend { position: absolute; left: 66px; bottom: 182px; display: grid; grid-template-columns: repeat(3, auto); gap: 4px 16px; font-family: var(--pcb-mono); font-size: 9px; letter-spacing: 0.06em; text-transform: lowercase; color: var(--pcb-mute); pointer-events: none; }
.sch-legend .h { grid-column: 1 / 4; text-transform: uppercase; letter-spacing: 0.08em; }
.sch-legend i { display: inline-block; width: 18px; height: 2px; border-radius: 1px; margin-right: 6px; vertical-align: middle; }
.sch-depth { display: grid; grid-template-columns: repeat(4, 1fr); position: relative; margin: 2px 0 2px; }
.sch-depth::before { content: ""; position: absolute; left: 12%; right: 12%; top: 6px; height: 2px; background: #333; }
.sch-depth button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; font-family: var(--pcb-mono); font-size: 9px; letter-spacing: 0.06em; color: var(--pcb-mute); }
.sch-depth button i { width: 10px; height: 10px; border-radius: 50%; background: #3a3a3a; border: 2px solid var(--pcb-panel); }
.sch-depth button.on { color: var(--pcb-select); }
.sch-depth button.on i { background: var(--pcb-select); }
.sch-depth button:disabled { color: #4a4a4a; }
.sch-chip { display: inline-flex; align-items: center; height: 17px; padding: 0 6px; border: 1px solid; border-radius: 3px; font-family: var(--pcb-mono); font-size: 8.5px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; flex: none; justify-self: start; }
.sch-chip.confirmed { color: var(--pcb-pass); border-color: color-mix(in oklab, var(--pcb-pass) 50%, transparent); }
.sch-chip.authored { color: var(--pcb-strong); border-color: #666; }
.sch-chip.inferred { color: var(--pcb-body); border-color: #555; border-style: dashed; }
.sch-chip.proposed { color: var(--pcb-select); border-color: var(--pcb-select-line); border-style: dashed; }
.sch-chip.stale { color: var(--pcb-warn); border-color: color-mix(in oklab, var(--pcb-warn) 50%, transparent); }
.sch-chip.conflict { color: var(--pcb-fail); border-color: color-mix(in oklab, var(--pcb-fail) 55%, transparent); }
.sch-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.sch-facts { display: grid; grid-template-columns: 86px 1fr auto; row-gap: 7px; column-gap: 8px; align-items: center; font-family: var(--pcb-mono); font-size: 10.5px; }
.sch-facts dt { color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 9px; }
.sch-facts dd { margin: 0; color: var(--pcb-strong); word-break: break-word; }
.sch-facts .why { grid-column: 2 / 4; margin-top: -4px; color: var(--pcb-mute); font-size: 9px; }
.sch-path { margin: 6px 0 0; padding: 0; list-style: none; font-family: var(--pcb-mono); font-size: 10px; color: var(--pcb-strong); }
.sch-path li { position: relative; padding: 3px 0 3px 16px; }
.sch-path li::before { content: ""; position: absolute; left: 4px; top: 0; bottom: 0; width: 1px; background: color-mix(in oklab, var(--pcb-fail) 60%, transparent); }
.sch-path li::after { content: ""; position: absolute; left: 1px; top: 8px; width: 7px; height: 7px; border-radius: 50%; background: var(--pcb-fail); }
.sch-defect { display: flex; gap: 10px; align-items: flex-start; padding: 8px 6px; margin: 0 -6px; border-radius: 5px; border-bottom: 1px solid var(--pcb-rule); cursor: pointer; }
.sch-defect:hover { background: #ffffff08; }
.sch-defect.on { background: var(--pcb-select-wash); box-shadow: inset 2px 0 0 var(--pcb-select); }
.sch-defect .nb { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: #e8e6df; color: #131313; font-family: var(--pcb-mono); font-size: 9px; font-weight: 700; border: 1.5px solid var(--sev, #888); }
.sch-defect .txt { flex: 1; min-width: 0; }
.sch-defect .txt b { display: block; color: var(--pcb-strong); font-weight: 500; font-size: 12px; line-height: 1.35; }
.sch-defect .txt span { display: block; font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-mute); margin-top: 2px; }
.sch-fix { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 28px; font-size: 11.5px; color: var(--pcb-strong); border-radius: 4px; }
.sch-fix .t { flex: 1; min-width: 0; }
.sch-fix .t span { display: block; font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-mute); }
.sch-fix .gain { font-family: var(--pcb-mono); font-size: 10px; color: var(--pcb-select); }
.sch-fix.on { background: var(--pcb-select-wash); }
.sch-sq { width: 24px; height: 22px; display: grid; place-items: center; border: 1px solid var(--pcb-rule2) !important; border-radius: 4px; color: var(--pcb-body); }
.sch-sq.ok { color: var(--pcb-pass); }
.sch-sq:hover:not(:disabled) { color: var(--pcb-strong); border-color: #444 !important; }
.sch-score { display: flex; align-items: flex-end; gap: 14px; }
.sch-score .big { font-family: var(--pcb-mono); font-size: 30px; line-height: 1; color: var(--pcb-strong); }
.sch-score .big.good { color: var(--pcb-pass); }
.sch-score .arrow { color: var(--pcb-mute); padding-bottom: 6px; }
.sch-score .cap { font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
.sch-gates { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
.sch-gate { display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 7px; border: 1px solid var(--pcb-rule2); border-radius: 4px; font-family: var(--pcb-mono); font-size: 9.5px; color: var(--pcb-body); }
.sch-gate b { font-weight: 400; color: var(--pcb-strong); margin-left: auto; }
.sch-gate.open { border-color: color-mix(in oklab, var(--pcb-fail) 55%, transparent); color: var(--pcb-fail); }
.sch-gate.open b { color: var(--pcb-fail); }
.sch-partsvg { display: block; width: 100%; height: 150px; border-radius: 6px; background: var(--pcb-ground); border: 1px solid var(--pcb-rule); }
.sch-pins { width: 100%; border-collapse: collapse; font-family: var(--pcb-mono); font-size: 10px; }
.sch-pins td, .sch-pins th { padding: 3px 4px; text-align: left; border-top: 1px solid var(--pcb-rule); color: var(--pcb-strong); }
.sch-pins th { color: var(--pcb-mute); font-weight: 400; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; border-top: 0; }
.sch-pins tr.on td { color: var(--pcb-select); background: var(--pcb-select-wash); }
.sch-pins tbody tr { cursor: pointer; }
.sch-pins td.mute { color: var(--pcb-mute); }
.sch-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.sch-actions .pcb-btn { height: 24px; padding: 0 8px; font-size: 9.5px; }
.sch-select { height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--pcb-rule2); background: #0f0f0f; color: var(--pcb-strong); font-family: var(--pcb-mono); font-size: 10px; }
.sch-first { position: absolute; left: 60px; top: 66px; display: flex; gap: 6px; }
.sch-first .pcb-chip { background: var(--pcb-panel); }
.sch-scoreline { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
`;
