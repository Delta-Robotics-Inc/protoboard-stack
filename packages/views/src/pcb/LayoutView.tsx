/**
 * The `layout` view (tabs.ts): the layout screen on one of the project's board folders, inside a shell. The shell's
 * host adapter brings the boards (`host.boards`, a `BoardHost`: the dev server's event stream in `protoboard dev`,
 * the extension host's postMessage relay in VS Code). `params.board` names a board by key; with several and none
 * named, the view lists them. Read only: the screen never writes to the board.
 */
import { useEffect, useState } from "react";
import type { ViewProps } from "../types.js";
import { LayoutScreen } from "./LayoutScreen.js";
import { knownBoards, setKnownBoards } from "./known-boards.js";
import { openBoardSource, type RemoteBoardSource } from "./remote.js";
import type { BoardDerived, BoardEntry, DepthView } from "./types.js";

const box: React.CSSProperties = { display: "grid", placeItems: "center", height: "100%", font: "13px/1.5 ui-monospace, monospace", color: "#a3a3a3", background: "#0b0b0b", padding: 24, textAlign: "center" };

export function LayoutView({ host, params, module }: ViewProps) {
  const boards = host.boards;
  const [list, setList] = useState<readonly BoardEntry[] | undefined>(() => (knownBoards().length ? knownBoards() : undefined));
  const [chosen, setChosen] = useState<string | undefined>(params?.board);
  const [open, setOpen] = useState<{ key: string; source: RemoteBoardSource; recheck?: () => void } | undefined>(undefined);
  const [derived, setDerived] = useState<BoardDerived | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => setChosen(params?.board), [params?.board]);
  useEffect(() => {
    if (!boards) return;
    let live = true;
    Promise.resolve(boards.list()).then(
      (l) => {
        if (!live) return;
        setKnownBoards(l);
        setList(l);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [boards]);

  const key = chosen ?? (list?.length === 1 ? list[0].key : undefined);
  useEffect(() => {
    if (!boards || !key) return;
    let live = true;
    let close: (() => void) | undefined;
    let undo: (() => void) | undefined;
    setOpen(undefined);
    setDerived(undefined);
    setError(undefined);
    openBoardSource(key, boards.open(key)).then(
      (o) => {
        close = o.close;
        if (!live) return o.close();
        undo = o.source.onDerived((d, err) => {
          setDerived(d);
          if (err) setError(err);
        });
        setOpen({ key, source: o.source, ...(o.recheck ? { recheck: o.recheck } : {}) });
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
      undo?.();
      close?.();
    };
  }, [boards, key]);

  if (!boards) return <div style={box}>This host has no board feed: the layout screen opens in `protoboard dev` and in the VS Code extension.</div>;
  if (error && !open) return <div style={box}>The board did not open: {error}</div>;
  if (!list) return <div style={box}>Looking for board folders…</div>;
  if (!list.length) return <div style={box}>This project has no board folder (a folder holding board.jsonl). `protoboard board import` makes one from a KiCad or Circuit JSON board.</div>;
  if (!key)
    return (
      <div style={box}>
        <div>
          <div style={{ marginBottom: 12 }}>Boards of {module.name}</div>
          {list.map((b) => (
            <button key={b.key} type="button" onClick={() => setChosen(b.key)} style={{ display: "block", width: "100%", margin: "4px 0", padding: "8px 12px", background: "#1d1d1d", color: "#e5e5e5", border: "1px solid #3a3a3a", borderRadius: 6, cursor: "pointer", font: "inherit", textAlign: "left" }}>
              {b.name} <span style={{ color: "#737373" }}>{b.dir}</span>
            </button>
          ))}
        </div>
      </div>
    );
  if (!open) return <div style={box}>Opening the board…</div>;
  const entry = list.find((b) => b.key === key);
  const navigate = (v: DepthView) => {
    const to = v === "system" ? "diagram" : v === "3d" ? "3d" : v === "schematic" ? "schematic" : undefined;
    if (to) host.openView?.(to, "");
  };
  return (
    // below a shell's floating header (`--uhd-inset-top`), which would cover the screen's own top bar
    <div style={{ position: "relative", height: "100%", boxSizing: "border-box", paddingTop: "var(--uhd-inset-top, 0px)" }} data-board={key} data-board-mode={open.source.mode}>
      <LayoutScreen
        key={open.key}
        source={open.source}
        {...(derived ? { derived } : {})}
        crumbs={[module.name, entry?.name ?? key]}
        {...(open.recheck ? { onCheck: open.recheck } : {})}
        {...(host.openView ? { onNavigate: navigate } : {})}
      />
    </div>
  );
}
