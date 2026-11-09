/**
 * The schematic screen's dev page (browser side). It reads a schematic through the path the app uses: the dev
 * server is the schematic service's client (@protoboardai/views/schematic/host) and passes its feed on over an event
 * stream; the page writes through requests, which the server applies as a person. The switcher's Layout entry opens
 * the layout screen on the paired board (the board routes), and the cross-probe channel carries the selection
 * between the two screens.
 *
 * URL options: schematic=<key> (airnode, airnode-fault, local-<label>), view=layout, readonly=1.
 * window.__dev exposes the source, the screen's handles and the layout's view for the session script.
 */
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useState } from "react";
import { LayoutScreen } from "../../src/pcb/LayoutScreen.js";
import type { BoardView } from "../../src/pcb/boardview.js";
import { createEventStreamBoardHost, openBoardSource, type RemoteBoardSource } from "../../src/pcb/remote.js";
import type { BoardDerived, BoardReplyMessage, BoardRequest } from "../../src/pcb/types.js";
import { layoutProbe, lastProbe, type Depth } from "../../src/shell/index.js";
import { SchematicScreen, type SchematicScreenApi } from "../../src/schematic/SchematicScreen.js";
import { createEventStreamSchematicHost, openSchematicSource, type SchematicSource } from "../../src/schematic/remote.js";
import type { SchematicEntry, SchematicReply, SchematicRequest } from "../../src/schematic/types.js";

const params = new URLSearchParams(location.search);

declare global {
  interface Window {
    __dev: { ready: boolean; view: "schematic" | "layout"; source?: SchematicSource; api?: SchematicScreenApi; layout?: BoardView; layoutSource?: RemoteBoardSource; layoutReady?: boolean; error?: string; firstPaintMs?: number; go?: (v: "schematic" | "layout") => void; probe?: () => unknown };
  }
}
window.__dev = { ready: false, view: params.get("view") === "layout" ? "layout" : "schematic" };
window.__dev.probe = () => lastProbe();
const t0 = performance.now();
const schematics = createEventStreamSchematicHost({ base: "/" });
const boards = createEventStreamBoardHost({ base: "/" });

function Layout({ boardKey, name, onBack }: { boardKey: string; name: string; onBack: () => void }) {
  const [state, setState] = useState<{ source: RemoteBoardSource; request?: (r: BoardRequest) => Promise<BoardReplyMessage> } | undefined>(undefined);
  const [derived, setDerived] = useState<BoardDerived | undefined>(undefined);
  useEffect(() => {
    let close: (() => void) | undefined;
    void openBoardSource(boardKey, boards.open(boardKey)).then((o) => {
      close = o.close;
      window.__dev.layoutSource = o.source;
      o.source.onDerived((d) => setDerived(d));
      setState({ source: o.source, ...(o.request ? { request: o.request } : {}) });
    });
    return () => close?.();
  }, [boardKey]);
  const probe = useMemo(() => (state ? layoutProbe(() => state.source.snapshot().doc.records.values() as never, undefined) : undefined), [state]);
  useEffect(() => () => probe?.close(), [probe]);
  if (!state) return null;
  return (
    <LayoutScreen
      source={state.source}
      {...(derived ? { derived } : {})}
      crumbs={[name, "boards", "main"]}
      {...(state.request ? { request: state.request } : {})}
      onNavigate={(v) => v === "schematic" && onBack()}
      onSelectionChange={(ids) => probe?.selected(ids)}
      onView={(v) => {
        window.__dev.layout = v;
        probe?.attach(v);
        window.__dev.layoutReady = true;
      }}
    />
  );
}

function App() {
  const [view, setView] = useState<"schematic" | "layout">(window.__dev.view);
  const [state, setState] = useState<{ source: SchematicSource; entry: SchematicEntry; request?: (r: SchematicRequest) => Promise<SchematicReply> } | { error: string } | undefined>(undefined);
  window.__dev.go = (v) => {
    window.__dev.view = v;
    setView(v);
  };
  useEffect(() => {
    const key = params.get("schematic") ?? "airnode";
    void Promise.resolve(schematics.list())
      .then(async (list) => {
        const entry = list.find((s) => s.key === key);
        if (!entry) throw new Error(`no schematic ${key}; there are ${list.map((s) => s.key).join(", ")}`);
        const o = await openSchematicSource(key, schematics.open(key));
        window.__dev.source = o.source;
        setState({ source: o.source, entry, ...(o.request && params.get("readonly") !== "1" ? { request: o.request } : {}) });
      })
      .catch((e) => {
        window.__dev.error = String(e);
        setState({ error: String(e) });
      });
  }, []);
  if (!state) return null;
  if ("error" in state) return <pre style={{ color: "#ef4444", padding: 20 }}>{state.error}</pre>;
  document.title = `${state.entry.name} · ${view}`;
  if (view === "layout" && state.entry.layoutKey) return <Layout boardKey={state.entry.layoutKey} name={state.entry.name} onBack={() => window.__dev.go?.("schematic")} />;
  return (
    <SchematicScreen
      source={state.source}
      {...(state.request ? { request: state.request } : {})}
      crumbs={[state.entry.name, "boards", "main"]}
      entry={state.entry}
      onNavigate={(d: Depth) => d === "layout" && window.__dev.go?.("layout")}
      navEnabled={(d: Depth) => d === "layout" && !!state.entry.layoutKey}
      onApi={(api) => {
        window.__dev.api = api;
        requestAnimationFrame(() => {
          window.__dev.firstPaintMs = performance.now() - t0;
          window.__dev.ready = true;
        });
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
