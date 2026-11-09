/**
 * The layout screen's stylesheet, scoped under `.pcb-screen`. Colors come from the shell's theme tokens
 * (`--uhd-*`, set by @deltarobotics/uhd-viewer's theme provider in both hosts) with the layout concept's dark
 * values as fallbacks, so the screen matches the app and also stands alone (the dev page, headless captures).
 *
 * Color rules: blue (`--pcb-select`) is selected or active and nothing else; orange (`--pcb-brand`, the brand
 * primary of theme.ts) is the brand mark and the one main action; severity colors only for check results.
 */

/** The brand orange: BRAND_TOKENS.dark.primary in ../../theme.ts (a test keeps them equal). */
export const BRAND = "oklch(0.6837 0.212 40.5923)";
/** Selected or active: the concept's selection token. */
export const SELECT = "#5aa9ff";

export const SCREEN_CSS = /* css */ `
.pcb-screen {
  --pcb-ground: var(--uhd-scene-background, #131313);
  --pcb-page: #0b0b0b;
  --pcb-panel: #161616;
  --pcb-card: #1b1b1b;
  --pcb-rule: var(--uhd-border-subtle, #262626);
  --pcb-rule2: #2e2e2e;
  --pcb-strong: #e6e6e6;
  --pcb-body: var(--uhd-text-muted, #a3a3a3);
  --pcb-mute: #6e6e6e;
  --pcb-select: ${SELECT};
  --pcb-select-wash: rgba(90, 169, 255, 0.11);
  --pcb-select-line: rgba(90, 169, 255, 0.38);
  --pcb-brand: ${BRAND};
  --pcb-fail: var(--uhd-severity-error, #ef4444);
  --pcb-warn: var(--uhd-severity-warning, #eed202);
  --pcb-risk: #ff7a1a;
  --pcb-pass: var(--uhd-severity-ok, #22c55e);
  --pcb-shadow: 0 0 0 1px #ffffff14, 0 10px 24px -8px #000000cc;
  --pcb-mono: "Kode Mono", var(--vscode-editor-font-family, ui-monospace), ui-monospace, "Cascadia Mono", Consolas, monospace;
  --pcb-sans: Inter, var(--vscode-font-family, system-ui), system-ui, "Segoe UI", sans-serif;
  position: relative;
  display: grid;
  grid-template-rows: 40px minmax(0, 1fr) 26px;
  grid-template-columns: 44px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow: hidden;
  background: var(--pcb-page);
  color: var(--pcb-body);
  font-family: var(--pcb-sans);
  font-size: 12px;
  user-select: none;
  outline: none;
}
.pcb-screen * { box-sizing: border-box; }
.pcb-screen button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.pcb-screen button:disabled { cursor: default; }
.pcb-screen .mono { font-family: var(--pcb-mono); letter-spacing: 0.06em; }
.pcb-screen .caps { font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
.pcb-screen .strong { color: var(--pcb-strong); }
.pcb-screen .mute { color: var(--pcb-mute); }

/* top bar */
.pcb-top { grid-column: 1 / 3; display: flex; align-items: center; gap: 14px; padding: 0 12px 0 14px; border-bottom: 1px solid var(--pcb-rule); background: var(--pcb-page); min-width: 0; }
.pcb-brand { display: flex; align-items: center; gap: 8px; color: var(--pcb-brand); font-family: var(--pcb-mono); font-weight: 700; letter-spacing: 0.12em; font-size: 11px; }
.pcb-brand .mark { width: 16px; height: 16px; border: 1.5px solid var(--pcb-brand); border-radius: 4px; display: grid; place-items: center; font-size: 9px; }
.pcb-crumbs { display: flex; gap: 8px; color: var(--pcb-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pcb-crumbs b { color: var(--pcb-strong); font-weight: 400; }
.pcb-switch { margin: 0 auto; display: flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid var(--pcb-rule); border-radius: 7px; }
.pcb-switch button { display: flex; align-items: center; gap: 7px; padding: 4px 9px; border-radius: 5px; color: var(--pcb-mute); border: 1px solid transparent; }
.pcb-switch button:hover:not(:disabled) { color: var(--pcb-body); }
.pcb-switch button.on { color: var(--pcb-select); background: var(--pcb-select-wash); border-color: var(--pcb-select-line); }
.pcb-switch .key { display: inline-grid; place-items: center; width: 14px; height: 14px; border: 1px solid currentColor; border-radius: 3px; font-size: 8px; opacity: 0.8; }
.pcb-switch .dash { width: 12px; height: 1px; background: var(--pcb-rule2); }
.pcb-topright { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.pcb-btn { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--pcb-rule2) !important; border-radius: 5px; color: var(--pcb-body) !important; font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; }
.pcb-btn:hover:not(:disabled) { color: var(--pcb-strong) !important; border-color: #444 !important; }
.pcb-btn:disabled { opacity: 0.45; }
.pcb-btn.main { background: var(--pcb-brand) !important; border-color: var(--pcb-brand) !important; color: #140700 !important; font-weight: 700; }
.pcb-btn.ghost { border-color: transparent !important; }
.pcb-chip { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 7px; border: 1px solid var(--pcb-rule2); border-radius: 4px; font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 9.5px; color: var(--pcb-body); white-space: nowrap; }
.pcb-chip.dashed { border-style: dashed; }
.pcb-chip.on { color: var(--pcb-select); border-color: var(--pcb-select-line); background: var(--pcb-select-wash); }
.pcb-chip.pass { color: var(--pcb-pass); border-color: color-mix(in oklab, var(--pcb-pass) 45%, transparent); }
.pcb-chip.warn { color: var(--pcb-warn); border-color: color-mix(in oklab, var(--pcb-warn) 45%, transparent); }
.pcb-chip.fail { color: var(--pcb-fail); border-color: color-mix(in oklab, var(--pcb-fail) 45%, transparent); }
.pcb-chip.solid { color: var(--pcb-strong); border-color: #555; }

/* gutter */
.pcb-gutter { grid-row: 2 / 3; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0; border-right: 1px solid var(--pcb-rule); background: var(--pcb-page); }
.pcb-gutter button { position: relative; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 6px; color: var(--pcb-mute); }
.pcb-gutter button.on { color: var(--pcb-select); background: var(--pcb-select-wash); }
.pcb-gutter button:hover:not(.on) { color: var(--pcb-body); }
.pcb-gutter .dot { position: absolute; right: 4px; top: 4px; width: 6px; height: 6px; border-radius: 50%; background: var(--pcb-fail); }
.pcb-gutter .spacer { flex: 1; }

/* main */
.pcb-main { position: relative; grid-row: 2 / 3; grid-column: 2 / 3; overflow: hidden; background: var(--pcb-ground); }
.pcb-canvas { position: absolute; inset: 0; outline: none; }
.pcb-canvas canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pcb-canvas svg.overlay { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.pcb-canvas svg.overlay .marker { pointer-events: auto; cursor: pointer; }
.pcb-float { position: absolute; background: var(--pcb-panel); border-radius: 8px; box-shadow: var(--pcb-shadow); }

/* tool rail */
.pcb-rail { left: 12px; top: 50%; transform: translateY(-50%); width: 40px; padding: 4px; display: flex; flex-direction: column; gap: 2px; }
.pcb-rail button { position: relative; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; color: var(--pcb-body); }
.pcb-rail button.on { color: var(--pcb-select); background: var(--pcb-select-wash); box-shadow: inset 0 0 0 1px var(--pcb-select-line); }
.pcb-rail button:hover:not(:disabled):not(.on) { background: #ffffff0a; color: var(--pcb-strong); }
.pcb-rail button:disabled { color: #4a4a4a; }
.pcb-rail .k { position: absolute; right: 2px; bottom: 1px; font-family: var(--pcb-mono); font-size: 7px; color: var(--pcb-mute); }
.pcb-rail button.on .k { color: var(--pcb-select); }
.pcb-rail .sep { height: 1px; margin: 4px 4px; background: var(--pcb-rule); }
.pcb-rail .badge { position: absolute; right: 1px; top: 1px; width: 12px; height: 12px; border-radius: 50%; background: var(--pcb-fail); color: #131313; font-size: 8px; font-weight: 700; display: grid; place-items: center; }

/* agent bar */
.pcb-agent { left: 60px; top: 12px; width: min(535px, calc(100% - 460px)); min-width: 300px; height: 46px; display: flex; align-items: center; gap: 12px; padding: 0 10px 0 14px; }
.pcb-agent .who { display: flex; align-items: center; gap: 8px; color: var(--pcb-strong); font-family: var(--pcb-mono); font-size: 11px; }
.pcb-agent .what { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pcb-agent .what b { color: var(--pcb-strong); font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcb-agent .what span { color: var(--pcb-mute); font-family: var(--pcb-mono); font-size: 9.5px; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcb-agent.working { box-shadow: 0 0 0 1px var(--pcb-select-line), 0 10px 24px -8px #000000aa; }
.pcb-ctx { position: absolute; left: 60px; top: 66px; display: flex; gap: 6px; }
.pcb-ctx .pcb-chip { background: var(--pcb-panel); }
.pcb-ctx .sw { width: 8px; height: 8px; border-radius: 2px; }
.pcb-live { position: absolute; top: 16px; display: flex; gap: 6px; }
.pcb-live .pcb-chip { background: var(--pcb-panel); }
.pcb-live .led { width: 6px; height: 6px; border-radius: 50%; background: var(--pcb-mute); }
.pcb-live .led.pass { background: var(--pcb-pass); }

/* right panel */
.pcb-panel { top: 8px; right: 8px; bottom: 8px; width: 356px; display: flex; flex-direction: column; overflow: hidden; }
.pcb-tabs { display: flex; gap: 18px; padding: 0 16px; height: 38px; align-items: stretch; border-bottom: 1px solid var(--pcb-rule); flex: none; }
.pcb-tabs button { position: relative; font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; color: var(--pcb-mute); }
.pcb-tabs button.on { color: var(--pcb-select); }
.pcb-tabs button.on::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--pcb-select); }
.pcb-tabs .n { margin-left: 5px; color: var(--pcb-mute); }
.pcb-body { flex: 1; overflow: auto; scrollbar-width: thin; scrollbar-color: #333 transparent; }
.pcb-sec { padding: 12px 16px; border-bottom: 1px solid var(--pcb-rule); }
.pcb-sec:last-child { border-bottom: 0; }
.pcb-sec h4 { margin: 0 0 9px; display: flex; justify-content: space-between; align-items: baseline; font-family: var(--pcb-mono); font-weight: 400; text-transform: uppercase; letter-spacing: 0.08em; font-size: 9.5px; color: var(--pcb-mute); }
.pcb-sec h4 i { font-style: normal; text-transform: none; letter-spacing: 0.02em; }
.pcb-row { position: relative; display: flex; align-items: center; gap: 9px; height: 24px; padding: 0 6px; margin: 0 -6px; border-radius: 4px; font-family: var(--pcb-mono); font-size: 10.5px; color: var(--pcb-body); cursor: default; }
.pcb-row:hover { background: #ffffff08; }
.pcb-row.on { background: var(--pcb-select-wash); color: var(--pcb-select); }
.pcb-row.on::before { content: ""; position: absolute; left: 0; top: 3px; bottom: 3px; width: 2px; border-radius: 1px; background: var(--pcb-select); }
.pcb-row.off { color: #555; }
.pcb-row .sw { width: 9px; height: 9px; border-radius: 2px; flex: none; }
.pcb-row .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.pcb-row .short { color: var(--pcb-mute); }
.pcb-row.on .short { color: var(--pcb-select); }
.pcb-row .eye { width: 18px; height: 18px; display: grid; place-items: center; color: var(--pcb-mute); }
.pcb-row .tag { font-size: 8.5px; padding: 1px 4px; border: 1px solid var(--pcb-select-line); border-radius: 3px; color: var(--pcb-select); letter-spacing: 0.08em; }
.pcb-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.pcb-presets button { height: 22px; padding: 0 8px; border: 1px solid var(--pcb-rule2); border-radius: 4px; font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 9.5px; color: var(--pcb-body); }
.pcb-presets button.on { color: var(--pcb-select); border-color: var(--pcb-select-line); background: var(--pcb-select-wash); }
.pcb-kv { display: grid; grid-template-columns: 112px 1fr; row-gap: 6px; column-gap: 10px; font-family: var(--pcb-mono); font-size: 10.5px; }
.pcb-kv dt { color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 9.5px; padding-top: 1px; }
.pcb-kv dd { margin: 0; color: var(--pcb-strong); word-break: break-word; }
.pcb-kv dd .u { color: var(--pcb-mute); margin-left: 3px; }
.pcb-search { width: 100%; height: 28px; padding: 0 9px; border-radius: 5px; border: 1px solid var(--pcb-rule2); background: #0f0f0f; color: var(--pcb-strong); font-family: var(--pcb-mono); font-size: 11px; outline: none; }
.pcb-search:focus { border-color: var(--pcb-select-line); }
.pcb-toggle { display: flex; align-items: center; gap: 8px; font-family: var(--pcb-mono); font-size: 10.5px; color: var(--pcb-body); cursor: pointer; }
.pcb-toggle .knob { width: 24px; height: 14px; border-radius: 7px; background: #333; position: relative; flex: none; }
.pcb-toggle .knob::after { content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px; border-radius: 50%; background: #9a9a9a; transition: left 0.12s; }
.pcb-toggle.on .knob { background: var(--pcb-select); }
.pcb-toggle.on .knob::after { left: 12px; background: #fff; }
.pcb-legend { display: flex; align-items: center; gap: 10px; height: 24px; font-family: var(--pcb-mono); font-size: 10.5px; }
.pcb-legend .line { width: 28px; height: 4px; border-radius: 2px; flex: none; }
.pcb-legend .name { flex: 1; }
.pcb-empty { padding: 18px 16px; color: var(--pcb-body); font-size: 12.5px; line-height: 1.5; }
.pcb-finding { display: flex; gap: 10px; padding: 9px 6px; margin: 0 -6px; border-radius: 5px; cursor: pointer; }
.pcb-finding:hover { background: #ffffff08; }
.pcb-finding.on { background: var(--pcb-select-wash); box-shadow: inset 2px 0 0 var(--pcb-select); }
.pcb-finding .msg { color: var(--pcb-strong); font-size: 12px; line-height: 1.4; }
.pcb-finding .meta { font-family: var(--pcb-mono); font-size: 9.5px; color: var(--pcb-mute); letter-spacing: 0.04em; margin-top: 3px; }

/* timeline */
.pcb-timeline { left: 60px; right: 380px; bottom: 8px; height: 136px; padding: 10px 14px 10px 12px; display: grid; grid-template-columns: 96px 1fr; grid-template-rows: 34px 1fr; column-gap: 10px; }
.pcb-timeline .head { grid-column: 1 / 3; display: flex; align-items: center; gap: 10px; min-width: 0; }
.pcb-timeline .play { width: 28px; height: 28px; border-radius: 50%; background: #e6e6e6; color: #131313; display: grid; place-items: center; flex: none; }
.pcb-timeline .play:disabled { background: #3a3a3a; color: #777; }
.pcb-timeline .title { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pcb-timeline .title b { font-family: var(--pcb-mono); color: var(--pcb-strong); font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcb-timeline .title span { font-family: var(--pcb-mono); color: var(--pcb-mute); font-size: 9.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcb-timeline .lanes { display: grid; grid-template-rows: repeat(3, 24px); align-content: start; padding-top: 6px; }
.pcb-timeline .lane-names { display: grid; grid-template-rows: repeat(3, 24px); align-content: start; padding-top: 6px; }
.pcb-timeline .lane-names span { font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 9px; color: var(--pcb-mute); line-height: 24px; }
.pcb-timeline .lane { position: relative; height: 24px; display: flex; align-items: center; gap: 4px; overflow: hidden; }
.pcb-block { flex: none; height: 18px; max-width: 170px; padding: 0 7px; border: 1px solid #3c3c3c; border-radius: 3px; font-family: var(--pcb-mono); font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--pcb-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 16px; text-align: left; }
.pcb-block.human { color: var(--pcb-strong); border-color: #4a4a4a; font-weight: 700; }
.pcb-block.agent { border-style: dashed; color: var(--pcb-body); }
.pcb-block.router { border-style: dotted; }
.pcb-block.on { color: var(--pcb-select); border-color: var(--pcb-select); background: var(--pcb-select-wash); }
.pcb-diamond { width: 8px; height: 8px; border: 1.5px solid var(--pcb-strong); transform: rotate(45deg); flex: none; margin: 0 6px 0 4px; }

/* status line */
.pcb-status { grid-column: 1 / 3; display: flex; align-items: center; gap: 16px; padding: 0 12px; border-top: 1px solid var(--pcb-rule); background: var(--pcb-page); font-family: var(--pcb-mono); font-size: 10px; color: var(--pcb-mute); white-space: nowrap; overflow: hidden; }
.pcb-status .item { display: inline-flex; align-items: center; gap: 6px; }
.pcb-status b { color: var(--pcb-strong); font-weight: 400; }
.pcb-status .right { margin-left: auto; display: flex; gap: 16px; }

/* callouts on the canvas */
.pcb-callout { position: absolute; width: 196px; padding: 10px 12px; background: var(--pcb-card); border-radius: 7px; box-shadow: var(--pcb-shadow); pointer-events: auto; }
.pcb-callout .shelf { position: absolute; left: 0; bottom: 100%; padding-bottom: 6px; font-family: var(--pcb-mono); font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pcb-select); white-space: nowrap; }
.pcb-callout .pcb-kv { grid-template-columns: 52px 1fr; row-gap: 4px; font-size: 10px; }
.pcb-callout .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.pcb-callout .acts { display: flex; gap: 6px; margin-top: 10px; }
.pcb-callout .acts .pcb-btn { height: 22px; padding: 0 7px; font-size: 9px; }
.pcb-callout.finding { width: 236px; }
.pcb-callout.finding .shelf { position: static; padding: 0 0 6px; color: var(--pcb-fail); }
.pcb-callout.finding p { margin: 0; color: var(--pcb-strong); font-size: 12px; line-height: 1.45; }
.pcb-measure { position: absolute; padding: 4px 8px; background: var(--pcb-card); border-radius: 5px; box-shadow: var(--pcb-shadow); font-family: var(--pcb-mono); font-size: 10px; color: var(--pcb-strong); white-space: nowrap; pointer-events: none; }
/* editing, review, autoroute, diagnosis (Phase 2) */
.pcb-btn.sel { color: var(--pcb-select) !important; border-color: var(--pcb-select-line) !important; background: var(--pcb-select-wash) !important; }
.pcb-btn .kbd, .pcb-agent .kbd { margin-left: 4px; padding: 0 4px; height: 14px; line-height: 13px; border: 1px solid currentColor; border-radius: 3px; font-size: 8px; opacity: 0.8; }
.pcb-btn.main .kbd { border-color: #140700aa; }
.pcb-chip:disabled { opacity: 0.6; }
button.pcb-chip { cursor: pointer; }
.pcb-finish { display: inline-flex; align-items: center; gap: 10px; height: 26px; padding: 0 10px; border: 1px solid var(--pcb-rule2); border-radius: 5px; color: var(--pcb-strong); }
.pcb-finish > i { display: block; width: 60px; height: 3px; border-radius: 2px; background: #333; overflow: hidden; }
.pcb-finish > i > i { display: block; height: 100%; background: var(--pcb-strong); }
.pcb-agent .bar { display: block; height: 3px; margin-top: 4px; border-radius: 2px; background: #2a2a2a; overflow: hidden; }
.pcb-agent .bar > i { display: block; height: 100%; background: var(--pcb-strong); }
.pcb-agent .pct { font-size: 10px; color: var(--pcb-strong); }
.pcb-agent .pcb-btn { height: 24px; padding: 0 8px; font-size: 9.5px; }
.pcb-timeline.four { height: 160px; grid-template-rows: 34px 1fr; }
.pcb-timeline.four .lanes, .pcb-timeline.four .lane-names { grid-template-rows: repeat(4, 24px); }
.pcb-timeline .lanes { position: relative; cursor: pointer; }
.pcb-timeline .lane .pcb-block { top: 3px; }
.pcb-timeline .lane .empty { font-size: 9.5px; }
.pcb-timeline .lane .flow { position: absolute; inset: 3px 0; display: flex; gap: 4px; overflow: hidden; }
.pcb-timeline .lane .flow .pcb-block { position: static; }
.pcb-timeline .errline { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.pcb-timeline .errcount { position: absolute; top: 4px; transform: translateX(6px); font-size: 8.5px; color: var(--pcb-fail); white-space: nowrap; }
.pcb-timeline .tick { position: absolute; top: 7px; width: 2px; height: 10px; background: #555; }
.pcb-timeline .cp { position: absolute; top: 4px; display: inline-flex; align-items: center; transform: translateX(-9px); font-family: var(--pcb-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
.pcb-timeline .cursor { position: absolute; top: 0; bottom: 0; width: 1.5px; background: var(--pcb-select); pointer-events: none; }
.pcb-timeline .cursor::before { content: ""; position: absolute; top: -5px; left: -4px; width: 9px; height: 9px; border-radius: 50%; background: var(--pcb-select); }
.pcb-timeline.replaying { box-shadow: 0 0 0 1px var(--pcb-select-line), 0 10px 24px -8px #000000cc; }
.pcb-timeline .replay-note { position: absolute; right: 16px; bottom: 6px; font-size: 9px; color: var(--pcb-mute); }
.pcb-block.undo { font-style: italic; }
.pcb-block.lane-draft { border: 1px dashed var(--pcb-select); color: var(--pcb-select); background: var(--pcb-select-wash); }
.pcb-block.lane-queue { color: var(--pcb-body); }
.pcb-block.lane-queue-on { color: var(--pcb-select); border-color: var(--pcb-select); background: var(--pcb-select-wash); }
.pcb-block.lane-router { border-style: dotted; color: var(--pcb-body); }
.pcb-block.lane-router-fail, .pcb-block.lane-fail { color: var(--pcb-fail); border-color: color-mix(in oklab, var(--pcb-fail) 45%, transparent); }
.pcb-block.lane-fallback { color: var(--pcb-warn); border-color: color-mix(in oklab, var(--pcb-warn) 45%, transparent); }
.pcb-block.lane-probe { color: var(--pcb-pass); border-color: color-mix(in oklab, var(--pcb-pass) 45%, transparent); }
.pcb-screen .small { font-size: 9.5px; }
.pcb-screen .pass { color: var(--pcb-pass); }
.pcb-screen .fail { color: var(--pcb-fail); }
.pcb-screen .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
.pcb-screen .acts .pcb-btn { height: 24px; padding: 0 8px; font-size: 9.5px; }
.pcb-p { margin: 8px 0 0; color: var(--pcb-body); font-size: 12px; line-height: 1.45; }
.pcb-note { margin-top: 8px; padding: 8px 10px; border-radius: 5px; border: 1px solid var(--pcb-rule2); font-size: 11.5px; line-height: 1.4; color: var(--pcb-body); }
.pcb-note.pass { border-color: color-mix(in oklab, var(--pcb-pass) 45%, transparent); color: var(--pcb-strong); }
.pcb-note.fail { border-color: color-mix(in oklab, var(--pcb-fail) 55%, transparent); color: var(--pcb-strong); }
.pcb-note.warn { border-color: color-mix(in oklab, var(--pcb-warn) 45%, transparent); }
.pcb-left { display: flex; align-items: baseline; gap: 10px; }
.pcb-left b { font-family: var(--pcb-mono); font-size: 20px; font-weight: 400; color: var(--pcb-strong); }
.pcb-progress { display: block; height: 3px; margin-top: 8px; border-radius: 2px; background: #2a2a2a; overflow: hidden; }
.pcb-progress > i { display: block; height: 100%; background: var(--pcb-strong); }
.pcb-card { padding: 10px 12px; border-radius: 7px; background: var(--pcb-card); border: 1px solid var(--pcb-rule2); }
.pcb-card.on { border-color: var(--pcb-select-line); box-shadow: inset 0 0 0 1px var(--pcb-select-line); }
.pcb-card .row1, .pcb-proposal .row1, .pcb-option .row1, .pcb-dialog .row1 { display: flex; align-items: center; gap: 8px; }
.pcb-card .grow { margin-left: auto; font-size: 9.5px; }
.pcb-screen .num { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--pcb-rule2); font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-strong); flex: none; }
.pcb-card .num { background: var(--pcb-select); border-color: var(--pcb-select); color: #0b0b0b; }
.pcb-card .sentence { margin: 8px 0; color: var(--pcb-strong); font-size: 13px; line-height: 1.4; }
.pcb-card .meta { font-size: 9.5px; margin-top: 6px; }
.pcb-screen .crop { display: block; border-radius: 5px; overflow: hidden; border: 1px solid var(--pcb-rule); flex: none; }
.pcb-screen .crop svg { display: block; }
.pcb-screen .waive textarea { height: 56px; padding: 6px 8px; resize: none; margin-top: 8px; font-size: 11px; }
.pcb-qrow { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 0 !important; border-bottom: 1px solid var(--pcb-rule) !important; text-align: left; }
.pcb-qrow:last-child { border-bottom: 0 !important; }
.pcb-qrow:hover { background: #ffffff06 !important; }
.pcb-qrow .txt { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.pcb-qrow .txt b { color: var(--pcb-strong); font-weight: 500; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcb-qrow .txt span { font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pcb-waived { padding: 6px 0; border-bottom: 1px solid var(--pcb-rule); font-size: 11px; color: var(--pcb-body); }
.pcb-waived b { color: var(--pcb-strong); font-weight: 500; }
.pcb-waived .why { margin: 3px 0; color: var(--pcb-strong); }
.pcb-seg { display: flex; align-items: center; gap: 0; }
.pcb-seg .lbl { font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 9px; color: var(--pcb-mute); width: 60px; }
.pcb-seg button { height: 22px; padding: 0 9px !important; border: 1px solid var(--pcb-rule2) !important; margin-left: -1px; font-family: var(--pcb-mono); text-transform: uppercase; letter-spacing: 0.08em; font-size: 9px; color: var(--pcb-body); }
.pcb-seg button:first-of-type { border-radius: 4px 0 0 4px; }
.pcb-seg button:last-child { border-radius: 0 4px 4px 0; }
.pcb-seg button.on { color: var(--pcb-select); border-color: var(--pcb-select-line) !important; background: var(--pcb-select-wash); position: relative; }
.pcb-seg button:disabled { color: #4a4a4a; }
.pcb-step { display: flex; align-items: flex-start; gap: 10px; padding: 7px 0; }
.pcb-step .dot { width: 14px; height: 14px; border-radius: 50%; flex: none; margin-top: 2px; border: 2px solid #555; }
.pcb-step .dot.pass { background: var(--pcb-pass); border-color: var(--pcb-pass); }
.pcb-step .dot.fail { background: var(--pcb-fail); border-color: var(--pcb-fail); }
.pcb-step .dot.warn { background: var(--pcb-warn); border-color: var(--pcb-warn); }
.pcb-step .dot.run { border-color: var(--pcb-strong); border-right-color: transparent; animation: pcb-spin 0.9s linear infinite; }
@keyframes pcb-spin { to { transform: rotate(360deg); } }
.pcb-step .txt { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.pcb-step .txt b { font-family: var(--pcb-mono); font-weight: 400; color: var(--pcb-strong); font-size: 10.5px; display: flex; align-items: center; gap: 6px; }
.pcb-step .txt span { font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-mute); line-height: 1.4; }
.pcb-table { width: 100%; border-collapse: collapse; font-family: var(--pcb-mono); font-size: 10px; }
.pcb-table th { text-align: left; font-weight: 400; color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; font-size: 8.5px; padding: 4px 4px; }
.pcb-table td { padding: 4px 4px; color: var(--pcb-strong); border-top: 1px solid var(--pcb-rule); }
.pcb-table td:first-child { color: var(--pcb-body); }
.pcb-table td.better { color: var(--pcb-pass); }
.pcb-table td.worse { color: var(--pcb-fail); }
.pcb-table.wide td:first-child { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcb-proposal { width: 220px; padding: 10px 12px; border-radius: 7px; background: var(--pcb-card); box-shadow: 0 0 0 1px var(--pcb-select-line), 0 10px 24px -8px #000000cc; pointer-events: auto; }
.pcb-proposal .row1 { justify-content: space-between; margin-bottom: 6px; }
.pcb-proposal b.caps { color: var(--pcb-strong); font-weight: 400; }
.pcb-verdict { margin-top: 4px; padding: 10px 12px; border-radius: 6px; border: 1px solid color-mix(in oklab, var(--pcb-warn) 55%, transparent); }
.pcb-verdict .caps { color: var(--pcb-mute); font-size: 9px; }
.pcb-verdict b { display: block; margin: 4px 0; font-family: var(--pcb-mono); font-size: 15px; color: var(--pcb-warn); font-weight: 700; }
.pcb-verdict p { margin: 0; color: var(--pcb-strong); font-size: 12px; line-height: 1.45; }
.pcb-option { padding: 8px 0; border-bottom: 1px solid var(--pcb-rule); }
.pcb-option:last-of-type { border-bottom: 0; }
.pcb-option .row1 b { flex: 1; color: var(--pcb-strong); font-weight: 500; font-size: 12px; }
.pcb-option .row1 .pcb-btn { height: 22px; padding: 0 8px; font-size: 9px; }
.pcb-option .small { margin: 3px 0 0 26px; }
.pcb-nums { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.pcb-num { display: flex; flex-direction: column; gap: 3px; font-family: var(--pcb-mono); font-size: 9px; color: var(--pcb-mute); text-transform: uppercase; letter-spacing: 0.06em; position: relative; }
.pcb-num input { height: 26px; padding-right: 22px; }
.pcb-num input:disabled { color: var(--pcb-mute); }
.pcb-num .u { position: absolute; right: 7px; bottom: 7px; text-transform: none; }
.pcb-dialog { left: calc(50% - 220px); bottom: 180px; width: 440px; padding: 12px 14px; z-index: 5; }
.pcb-dialog .row1 { justify-content: space-between; margin-bottom: 8px; }
.pcb-dialog b.caps { color: var(--pcb-strong); font-weight: 400; }
.pcb-msg { margin: 8px 0 0; padding: 8px 10px; max-height: 200px; overflow: auto; border-radius: 5px; background: #0f0f0f; border: 1px solid var(--pcb-rule2); font-family: var(--pcb-mono); font-size: 10.5px; color: var(--pcb-strong); white-space: pre-wrap; }
.pcb-toastwrap { position: absolute; left: 60px; right: 380px; bottom: 182px; display: flex; justify-content: center; pointer-events: none; z-index: 4; }
.pcb-toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; max-width: 640px; padding: 7px 8px 7px 12px; border-radius: 6px; background: var(--pcb-card); box-shadow: var(--pcb-shadow); font-size: 12px; color: var(--pcb-strong); }
.pcb-toast.fail { box-shadow: 0 0 0 1px color-mix(in oklab, var(--pcb-fail) 60%, transparent), 0 10px 24px -8px #000000cc; }
.pcb-toast.fail b { color: var(--pcb-fail); }
.pcb-toast.pass b { color: var(--pcb-pass); }
.pcb-toast b { font-weight: 400; white-space: nowrap; }
.pcb-toast .pcb-btn { height: 20px; padding: 0 4px; }
.pcb-placer { position: absolute; width: 240px; z-index: 5; }
.pcb-placer input { box-shadow: var(--pcb-shadow); }
`;
