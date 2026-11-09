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
.pcb-block { flex: none; height: 18px; max-width: 170px; padding: 0 7px; border: 1px solid var(--pcb-rule2); border-radius: 3px; font-family: var(--pcb-mono); font-size: 8.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--pcb-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 16px; text-align: left; }
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
`;
