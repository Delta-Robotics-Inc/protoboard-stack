/**
 * The layout screen's dev page (browser side). It reads a board through the same path the app uses: the dev
 * server is the board service's client (@protoboardai/views/pcb/host) and passes its feed to this page over an
 * event stream (createEventStreamBoardHost, RemoteBoardSource); the page never opens a service of its own. Its
 * writes go to the dev server as requests, which applies them as a person. The checks, the ratsnest, the zone fill
 * and KiCad's cross-check come with the feed.
 *
 * URL options:
 *   board=<folder>     a board folder (in the core's on-disk format) instead of the Airnode C3 fixture, which the
 *                      server serves as a live board service on a temporary copy
 *   fixture=files      a copy of the fixture with no service (the host opens it on the first write)
 *   readonly=1         no request channel: the screen is read only
 *
 * window.__dev exposes the board source, the board view and a move helper (a commit by a person, through the dev
 * server's service) for the screenshot script.
 */
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { BoardView } from "../../src/pcb/boardview.js";
import { LayoutScreen } from "../../src/pcb/LayoutScreen.js";
import type { EditSession } from "../../src/pcb/edit/session.js";
import type { BoardReplyMessage, BoardRequest } from "../../src/pcb/types.js";
import { createEventStreamBoardHost, openBoardSource, type RemoteBoardSource } from "../../src/pcb/remote.js";
import type { BoardDerived } from "../../src/pcb/types.js";

const params = new URLSearchParams(location.search);

declare global {
  interface Window {
    __dev: { ready: boolean; source?: RemoteBoardSource; view?: BoardView; session?: EditSession; derived?: BoardDerived; error?: string; move?: (id: string, dxMm: number, dyMm: number) => Promise<unknown>; agent?: (q: Record<string, string>) => Promise<unknown>; firstPaintMs?: number };
  }
}
window.__dev = { ready: false };
const t0 = performance.now();

const host = createEventStreamBoardHost({ base: "/" });

async function boardKey(): Promise<{ key: string; name: string }> {
  const path = params.get("board");
  const r = await fetch(path ? `/api/open?path=${encodeURIComponent(path)}` : params.get("fixture") === "files" ? "/api/open?fixture=files" : "/api/open");
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()) as { key: string; name: string };
}

function App() {
  const [state, setState] = useState<{ source: RemoteBoardSource; name: string; recheck?: () => void; request?: (req: BoardRequest) => Promise<BoardReplyMessage> } | { error: string } | undefined>(undefined);
  const [derived, setDerived] = useState<BoardDerived | undefined>(undefined);
  useEffect(() => {
    boardKey()
      .then(async ({ key, name }) => {
        const o = await openBoardSource(key, host.open(key));
        window.__dev.source = o.source;
        window.__dev.move = (id, dx, dy) => fetch(`/api/move?${new URLSearchParams({ board: key, id, dx: String(dx), dy: String(dy) })}`, { method: "POST" }).then((r) => r.json());
        window.__dev.agent = (q) => fetch(`/api/agent?${new URLSearchParams(q)}`, { method: "POST" }).then((r) => r.json());
        o.source.onDerived((d) => {
          window.__dev.derived = d;
          setDerived(d);
        });
        setState({ source: o.source, name, ...(o.recheck ? { recheck: o.recheck } : {}), ...(o.request && params.get("readonly") !== "1" ? { request: o.request } : {}) });
      })
      .catch((e) => {
        window.__dev.error = String(e);
        setState({ error: String(e) });
      });
  }, []);
  if (!state) return null;
  if ("error" in state) return <pre style={{ color: "#ef4444", padding: 20 }}>{state.error}</pre>;
  document.title = `${state.name} · layout`;
  return (
    <LayoutScreen
      source={state.source}
      {...(derived ? { derived } : {})}
      crumbs={[state.name, "boards", "main"]}
      {...(state.recheck ? { onCheck: state.recheck } : {})}
      {...(state.request ? { request: state.request } : {})}
      onSide={(l) => state.source.onSide(l)}
      onSession={(s) => (window.__dev.session = s)}
      onNavigate={(v) => console.log(`navigate to ${v}`)}
      onView={(v) => {
        window.__dev.view = v;
        window.__dev.firstPaintMs = performance.now() - t0;
        window.__dev.ready = true;
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
