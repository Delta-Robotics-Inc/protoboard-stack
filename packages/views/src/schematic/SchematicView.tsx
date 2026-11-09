/**
 * The `schematic` view (tabs.ts): the schematic editor on one of the project's UHD boards when the shell's host
 * offers schematics (`host.schematics`: the dev server's event stream in `protoboard dev`), else the board's native
 * drawing from its circuit tool, as before. `params.schematic` names a schematic by key, `params.layout` by the
 * layout board it pairs with; with several and none named, the view lists them.
 *
 * First open: a board with no schematic folder yet is laid out once by the host, in memory; nothing is written
 * until the person saves.
 */
import { useEffect, useMemo, useState } from "react";
import type { ViewProps } from "../types.js";
import { SchematicView as NativeSchematicView } from "../drawing/BoardDrawingView.js";
import type { Depth } from "../shell/index.js";
import { knownSchematics, setKnownSchematics } from "./known.js";
import { openSchematicSource, type SchematicSource } from "./remote.js";
import { SchematicScreen } from "./SchematicScreen.js";
import type { SchematicEntry, SchematicReply, SchematicRequest } from "./types.js";

const box: React.CSSProperties = { display: "grid", placeItems: "center", height: "100%", font: "13px/1.5 ui-monospace, monospace", color: "#a3a3a3", background: "#0b0b0b", padding: 24, textAlign: "center" };

export function SchematicEditorView(props: ViewProps) {
  const { host, params, module } = props;
  const hostSchematics = host.schematics;
  const [list, setList] = useState<readonly SchematicEntry[] | undefined>(() => (knownSchematics().length ? knownSchematics() : undefined));
  const [chosen, setChosen] = useState<string | undefined>(params?.schematic);
  const [open, setOpen] = useState<{ key: string; source: SchematicSource; request?: (r: SchematicRequest) => Promise<SchematicReply> } | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => setChosen(params?.schematic), [params?.schematic]);
  useEffect(() => {
    if (!hostSchematics) return;
    let live = true;
    Promise.resolve(hostSchematics.list()).then(
      (l) => {
        if (!live) return;
        setKnownSchematics(l);
        setList(l);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [hostSchematics]);

  const key = useMemo(() => {
    if (chosen) return chosen;
    if (!list) return undefined;
    const byLayout = params?.layout ? list.find((s) => s.layoutKey === params.layout) : undefined;
    const byModule = list.find((s) => s.board === module.id);
    return byLayout?.key ?? byModule?.key ?? (list.length === 1 ? list[0].key : undefined);
  }, [chosen, list, params?.layout, module.id]);

  useEffect(() => {
    if (!hostSchematics || !key) return;
    let live = true;
    let close: (() => void) | undefined;
    setOpen(undefined);
    setError(undefined);
    openSchematicSource(key, hostSchematics.open(key)).then(
      (o) => {
        close = o.close;
        if (!live) return o.close();
        setOpen({ key, source: o.source, ...(o.request ? { request: o.request } : {}) });
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
      close?.();
    };
  }, [hostSchematics, key]);

  if (!hostSchematics) return <NativeSchematicView {...props} />;
  if (error && !open) return <div style={box}>The schematic did not open: {error}</div>;
  if (!list) return <div style={box}>Looking for the project's boards…</div>;
  if (!list.length) return <NativeSchematicView {...props} />;
  if (!key)
    return (
      <div style={box}>
        <div>
          <div style={{ marginBottom: 12 }}>Schematics of {module.name}</div>
          {list.map((s) => (
            <button key={s.key} type="button" onClick={() => setChosen(s.key)} style={{ display: "block", width: "100%", margin: "4px 0", padding: "8px 12px", background: "#1d1d1d", color: "#e5e5e5", border: "1px solid #3a3a3a", borderRadius: 6, cursor: "pointer", font: "inherit", textAlign: "left" }}>
              {s.name} <span style={{ color: "#737373" }}>{s.dir}</span>
            </button>
          ))}
        </div>
      </div>
    );
  if (!open) return <div style={box}>Opening the schematic (a first open lays it out)…</div>;
  const entry = list.find((s) => s.key === key);
  const navigate = (d: Depth) => {
    if (d === "system") host.openView?.("diagram", "");
    else if (d === "3d") host.openView?.("3d", "");
    else if (d === "layout") host.openView?.("layout", "", entry?.layoutKey ? { board: entry.layoutKey } : {});
  };
  return (
    <div style={{ position: "relative", height: "100%", boxSizing: "border-box", paddingTop: "var(--uhd-inset-top, 0px)" }} data-schematic={key}>
      <SchematicScreen
        key={open.key}
        source={open.source}
        {...(open.request ? { request: open.request } : {})}
        crumbs={[module.name, entry?.name ?? key]}
        {...(entry ? { entry } : {})}
        {...(host.openView ? { onNavigate: navigate, navEnabled: (d: Depth) => d !== "layout" || !!entry?.layoutKey } : {})}
      />
    </div>
  );
}
