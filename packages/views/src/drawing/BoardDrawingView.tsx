/**
 * The schematic and PCB views (PB-898): a board's own drawings, as its
 * circuit tool exported them (schematic.svg, pcb-top.svg, pcb-bottom.svg),
 * themed by role so they follow the shell's theme, high contrast included,
 * with the system's knowledge on top: a component names its module, a net
 * lights up end to end, a click selects the module (the host's inspector
 * follows) and its source is a button away. Viewing only: the design is
 * edited in the circuit tool.
 *
 * Pan and zoom are the canvas's (usePanZoom). A board KiCad lays out (a
 * locked board) is drawn from KiCad's export, its layout of record; the
 * circuit provider's routed build it was locked from is a switch away. KiCad
 * writes no nets or parts into its drawings: they are read from the
 * schematic's geometry (kicadSchematic.ts), and the parts are UHD instances
 * through the board's reference map (refdes.json) when it carries one.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { ModuleDef } from "@deltarobotics/uhd";
import { EmptyState, Icon, IconButton, Legend, LegendItem, ToggleGroup, Toolbar, ToolbarSeparator, cx } from "@deltarobotics/uhd-viewer/components";
import { SCHEMATIC_ICON, ViewIcon } from "../icons.js";
import { Select } from "../ui/Select.js";
import { definition } from "../applies.js";
import type { ViewProps } from "../types.js";
import { PCB_FILES, ROUTED_FILE, SCHEMATIC_FILES, artifactHref, artifactNamed, boardsWith, circuitSource, instanceAt, kicadLayout, type BoardAt } from "./boards.js";
import { CircuitPcbView } from "./CircuitPcbView.js";
import { DrawingTools, DrawingViewButtons, SelectionBox, toolCursor } from "./DrawingControls.js";
import { indexKicadSchematic, partAt, type SchematicIndex, type SchematicPart } from "./kicadSchematic.js";
import { DRAWING_CSS, PCB_PALETTE, SCHEMATIC_PALETTE } from "./palettes.js";
import { scopedRules, themeSvg, type ThemedSvg } from "./svg.js";
import { usePanZoom, type Box } from "./usePanZoom.js";

type Kind = "schematic" | "pcb";
type Side = "top" | "bottom";
/** Where a PCB view draws the board from: the exported drawings, or the provider's routed build. */
type Source = "export" | "routed";

/** What the pointer is over or what is selected: a component (by its instance id on the board or its reference), a net, a pad. */
interface Hot {
  part?: string;
  /** A schematic net (the tool's connectivity key, or a KiCad net's name) or a PCB pad's net name. */
  net?: string;
  pad?: string;
  /** A KiCad part's value (`523k`). */
  value?: string;
  x: number;
  y: number;
}

/** KiCad wrote it (its schematic or board export): it says so in the file's description. */
const fromKicad = (text: string) => /Eeschema|Pcbnew|PCBNEW|KiCad/.test(text.slice(0, 4000));

function useDrawing(url: string | undefined, kind: Kind, prefix: string, mirror = false) {
  const [state, setState] = useState<{ svg?: ThemedSvg; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    if (!url) {
      setState({ loading: false, error: "This board has no such drawing yet. Build the project to export it." });
      return;
    }
    let cancelled = false;
    setState({ loading: true });
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((text) => {
        if (cancelled) return;
        // KiCad exports the bottom side already mirrored (seen from below): mirrored again it would read as the top
        const svg = themeSvg(text, { palette: kind === "schematic" ? SCHEMATIC_PALETTE : PCB_PALETTE, idPrefix: `${prefix}-`, mirror: mirror && !fromKicad(text) });
        setState({ loading: false, svg });
      })
      .catch((e: Error) => !cancelled && setState({ loading: false, error: `The drawing could not be read (${e.message}).` }));
    return () => {
      cancelled = true;
    };
  }, [url, kind, prefix, mirror]);
  return state;
}

/** A board's reference map (`refdes.json`, ext-tscircuit: UHD instance → KiCad reference), when it carries one: reference → instance. */
function useReferenceMap(url: string | undefined) {
  const [map, setMap] = useState<Map<string, string> | undefined>(undefined);
  useEffect(() => {
    if (!url) return setMap(undefined);
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((j: { assigned?: Record<string, string> } | undefined) => !cancelled && setMap(j?.assigned ? new Map(Object.entries(j.assigned).map(([inst, ref]) => [ref, inst])) : undefined))
      .catch(() => !cancelled && setMap(undefined));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return map;
}

/** The instance a schematic component group draws: the text in it that names a child of the board (tscircuit's schematic). */
function schematicParts(root: Element, children: Set<string>): Map<Element, string> {
  const out = new Map<Element, string>();
  for (const g of root.querySelectorAll("[data-schematic-component-id]")) {
    for (const t of g.querySelectorAll("text")) {
      const id = t.textContent?.trim() ?? "";
      if (children.has(id)) {
        out.set(g, id);
        g.setAttribute("data-pb-hot", "part");
        g.setAttribute("data-pb-part", id);
        break;
      }
    }
  }
  return out;
}

/** The box of what is drawn: everything but the page behind it (the tool's sheet or background), with a little room. */
function drawnBox(root: SVGSVGElement): Box | undefined {
  const hidden = [...root.querySelectorAll<SVGElement>("[data-pb-page], .boundary, [data-type='pcb_background']")];
  const before = hidden.map((e) => e.style.display);
  for (const e of hidden) e.style.display = "none";
  let b: DOMRect | undefined;
  try {
    b = root.getBBox();
  } catch {
    b = undefined;
  }
  hidden.forEach((e, i) => (e.style.display = before[i]));
  if (!b || (!b.width && !b.height)) return undefined;
  const m = Math.max(b.width, b.height) * 0.02;
  return [b.x - m, b.y - m, b.width + 2 * m, b.height + 2 * m];
}

/** A PCB pad's component and pin: `u1.GND` → ["u1", "GND"]. */
const padParts = (name: string | null): [string, string] | undefined => {
  if (!name) return undefined;
  const dot = name.indexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : undefined;
};

const PART_CLASSES = ["pb-net-on", "pb-pad-on", "pb-part-hover", "pb-part-on", "pb-pad-part", "pb-kicad-net", "pb-kicad-part", "pb-kicad-part-hover"];

export function BoardDrawingView(props: ViewProps & { kind: Kind }) {
  const { module, bundle, path, host, kind, params } = props;
  const files = kind === "schematic" ? SCHEMATIC_FILES : [PCB_FILES.top, PCB_FILES.bottom, ROUTED_FILE];
  const boards = useMemo(() => boardsWith(module, bundle, path, files), [module, bundle, path, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const [boardPath, setBoardPath] = useState<string | undefined>(params?.board);
  const board: BoardAt | undefined = boards.find((b) => b.path === boardPath) ?? boards[0];
  const sides: Side[] = kind === "pcb" && board ? (["top", "bottom"] as const).filter((s) => artifactNamed(board.def, PCB_FILES[s])) : [];
  const [side, setSide] = useState<Side>((params?.side as Side) ?? "top");
  const shownSide: Side | undefined = kind === "pcb" ? (sides.includes(side) ? side : sides[0]) : undefined;
  const file = board ? artifactNamed(board.def, kind === "schematic" ? "schematic.svg" : PCB_FILES[shownSide ?? "top"]) : undefined;
  // KiCad is the layout of record of a locked board: its export is drawn, the routed build is the other choice
  const kicad = board ? kicadLayout(board.def) : undefined;
  const hasRouted = kind === "pcb" && !!board && !!artifactNamed(board.def, ROUTED_FILE);
  const hasExport = kind === "pcb" && sides.length > 0;
  const [sourceChoice, setSource] = useState<Source | undefined>(params?.source === "routed" || params?.source === "export" ? (params.source as Source) : undefined);
  const source: Source = !hasRouted ? "export" : !hasExport ? "routed" : (sourceChoice ?? (kicad ? "export" : "routed"));
  const routed = kind === "pcb" && source === "routed";
  const url = board && !routed ? artifactHref(host, board.def, file) : undefined;
  const prefix = `pbd${useId().replace(/[^\w]/g, "")}`;
  const drawing = useDrawing(url, kind, prefix, shownSide === "bottom");
  const kicadDrawn = drawing.svg?.generator === "kicad";
  const refMap = useReferenceMap(board && kind === "schematic" ? artifactHref(host, board.def, artifactNamed(board.def, "refdes.json")) : undefined);

  const canvas = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const svgEl = () => canvas.current?.querySelector("svg") ?? null;
  const [contentBox, setContentBox] = useState<Box | undefined>(undefined);
  const [hover, setHover] = useState<Hot | null>(null);
  const [heldNet, setHeldNet] = useState<string | undefined>(undefined);
  /** Picked parts: instance ids (a tscircuit schematic) or references (KiCad's drawings); the first is the one the card shows. */
  const [picked, setPicked] = useState<string[]>(params?.select ? [params.select] : []);
  const selected = picked[0];
  const children = useMemo(() => new Set((board?.def.children ?? []).map((c) => c.id)), [board]);
  const parts = useRef(new Map<Element, string>());
  const index = useRef<SchematicIndex | undefined>(undefined);

  const pz = usePanZoom(svgEl, {
    box: contentBox ?? drawing.svg?.viewBox,
    insets: () => ({ top: 60, bottom: 64 }),
    onBox: (b, additive) => {
      const inBox = (x: number, y: number) => x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3];
      let refs: string[] = [];
      if (index.current) refs = index.current.parts.filter((p) => inBox(p.at[0], p.at[1])).map((p) => p.ref);
      else {
        const root = svgEl();
        if (root && kind === "schematic") {
          const toBox = (g: Element) => {
            try {
              const r = (g as SVGGraphicsElement).getBBox();
              return inBox(r.x + r.width / 2, r.y + r.height / 2);
            } catch {
              return false;
            }
          };
          refs = [...parts.current].filter(([g]) => toBox(g)).map(([, id]) => id);
        }
      }
      pick(additive ? [...new Set([...picked, ...refs])] : refs);
    },
    onEscape: () => {
      setHeldNet(undefined);
      pick([]);
    },
  });

  // the themed markup in place (never through React: it is a large static tree), and its parts and nets found once
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.innerHTML = drawing.svg?.markup ?? "";
    const root = el.querySelector("svg");
    index.current = undefined;
    parts.current = new Map();
    if (root) {
      root.removeAttribute("style");
      root.setAttribute("data-pb-viewport", "");
      if (kind === "schematic") {
        if (drawing.svg?.generator === "kicad") index.current = indexKicadSchematic(root);
        else parts.current = schematicParts(root, children);
      }
      for (const p of root.querySelectorAll("[data-pad-name]")) p.setAttribute("data-pb-hot", "pad");
    }
    setContentBox(root ? drawnBox(root) : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing.svg, children, kind]);

  // a selection made elsewhere (the Inspector, the hierarchy): an instance, or its reference in KiCad's drawings
  useEffect(() => {
    const want = params?.select;
    if (!want) return;
    if (kicadDrawn && refMap) {
      const ref = [...refMap].find(([, inst]) => inst === want || inst.endsWith(`/${want}`))?.[0];
      if (ref) setPicked([ref]);
    } else setPicked([want]);
  }, [params?.select, kicadDrawn, refMap]);

  // what is lit: the hovered (or held) net, the hovered and the picked parts
  const litNet = hover?.net ?? heldNet;
  useEffect(() => {
    const root = canvas.current?.querySelector("svg");
    if (!root) return;
    for (const c of PART_CLASSES) for (const e of root.querySelectorAll(`.${c}`)) e.classList.remove(c);
    const ix = index.current;
    if (ix) {
      if (litNet) for (const e of ix.nets.get(litNet) ?? []) e.classList.add("pb-kicad-net");
      const byRef = new Map(ix.parts.map((p) => [p.ref, p]));
      if (hover?.part) for (const e of byRef.get(hover.part)?.els ?? []) e.classList.add("pb-kicad-part-hover");
      for (const r of picked) for (const e of byRef.get(r)?.els ?? []) e.classList.add("pb-kicad-part");
      return;
    }
    if (litNet) {
      if (kind === "schematic") for (const e of root.querySelectorAll(`[data-subcircuit-connectivity-map-key="${CSS.escape(litNet)}"]`)) e.classList.add("pb-net-on");
      else for (const e of root.querySelectorAll(`[data-pad-net-name="${CSS.escape(litNet)}"]`)) e.classList.add("pb-pad-on");
    }
    if (hover?.part && kind === "schematic") root.querySelector(`[data-pb-part="${CSS.escape(hover.part)}"]`)?.classList.add("pb-part-hover");
    for (const s of picked) {
      if (kind === "schematic") root.querySelector(`[data-pb-part="${CSS.escape(s)}"]`)?.classList.add("pb-part-on");
      else for (const e of root.querySelectorAll(`[data-pad-name^="${CSS.escape(s)}."]`)) e.classList.add("pb-pad-part");
    }
  }, [hover, litNet, picked, kind, drawing.svg]);

  const hotAt = (target: EventTarget | null, x: number, y: number): Hot | null => {
    const el = target instanceof Element ? target : null;
    if (!el) return null;
    const ix = index.current;
    if (ix) {
      const netEl = [el, el.closest("g.stroked-text")].find((e): e is Element => !!e && ix.netOf.has(e));
      const at = pz.toDrawing(x, y);
      // a wire or a label within a few pixels of the pointer (its strokes are a fraction of a pixel when zoomed out)
      const px = pz.view ? 1 / pz.view.s : 0;
      const net = netEl ? ix.netOf.get(netEl) : at && px ? ix.netAt(at, 5 * px) : undefined;
      // over a wire or a label the net is what the pointer means; elsewhere the part under it
      const part: SchematicPart | undefined = !net && at ? partAt(ix.parts, at) : undefined;
      return net || part ? { net, part: part?.ref, value: part?.value, x, y } : null;
    }
    if (kind === "schematic") {
      const part = el.closest("[data-pb-part]")?.getAttribute("data-pb-part") ?? undefined;
      const net = el.closest("[data-subcircuit-connectivity-map-key]")?.getAttribute("data-subcircuit-connectivity-map-key") ?? undefined;
      return part || net ? { part, net, x, y } : null;
    }
    const pad = el.closest("[data-pad-name]");
    const pp = padParts(pad?.getAttribute("data-pad-name") ?? null);
    if (!pad || !pp) return null;
    return { part: pp[0], pad: pp[1], net: pad.getAttribute("data-pad-net-name") ?? undefined, x, y };
  };

  /** The UHD instance a picked part is (a KiCad reference through the board's map), relative to the board. */
  const instanceOf = (part: string | undefined): string | undefined => {
    if (!part) return undefined;
    if (index.current) return refMap?.get(part);
    return part;
  };
  function pick(next: string[]) {
    setPicked(next);
    if (!board) return;
    const inst = instanceOf(next[0]);
    const ref = inst ? instanceAt(bundle, board.def, inst) : undefined;
    host.selectionChanged?.(inst && ref ? { kind: "node", id: board.path ? `${board.path}/${inst}` : inst, defId: ref.moduleDefId } : null);
  }

  if (!boards.length || !board) {
    return (
      <div className="grid size-full place-items-center bg-canvas">
        <EmptyState icon={<ViewIcon name={props.view.icon} size={28} strokeWidth={1.25} />} title={props.view.title}>
          {module.name} has no {kind === "schematic" ? "schematic" : "board layout"} drawing. A board built by a circuit tool exports one.
        </EmptyState>
      </div>
    );
  }

  const partDef = (inst?: string): ModuleDef | undefined => {
    const r = inst ? instanceAt(bundle, board.def, inst) : undefined;
    return r ? definition(bundle, r.moduleDefId) : undefined;
  };
  const selInst = instanceOf(selected);
  const sel = selInst ? instanceAt(bundle, board.def, selInst) : undefined;
  const selDef = partDef(selInst);
  const selPart = selected && index.current ? index.current.parts.find((p) => p.ref === selected) : undefined;
  const hoverInst = instanceOf(hover?.part);
  const hoverRef = hoverInst ? instanceAt(bundle, board.def, hoverInst) : undefined;
  const circuit = circuitSource(board.def);
  const sourceFile = kind === "pcb" && source === "export" && kicad ? kicad : (kicadDrawn && kicad ? kicad : circuit);
  const netName = (n?: string) => (n && !n.startsWith("~") ? n : undefined);

  // which board the drawing is of (when the level holds several), and what it is drawn from
  const header = (extra?: ReactNode) => (
    <div className="absolute top-[calc(var(--uhd-inset-top,0px)+12px)] left-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-panel border border-line bg-surface py-1.5 pr-1.5 pl-3 shadow-panel outline outline-1 -outline-offset-1 outline-contrast">
      <ViewIcon name={kind === "schematic" ? SCHEMATIC_ICON : "circuit-board"} size={15} className="shrink-0 text-accent" aria-hidden />
      <div className="min-w-0">
        <div className="truncate font-label text-[12px] tracking-[0.06em] uppercase">{kind === "schematic" ? "Schematic" : routed ? "PCB" : `PCB · ${shownSide === "bottom" ? "bottom, seen from below" : "top"}`}</div>
        <div className="truncate text-[11px] text-fg-muted">
          {board.label}
          {board.label !== board.def.name ? ` · ${board.def.name}` : ""}
        </div>
      </div>
      {/* (the routed view's badge says what the switch says, when there is a switch) */}
      {!(kind === "pcb" && hasRouted && hasExport) && extra}
      {kind === "pcb" && hasRouted && hasExport && (
        <Select
          label="Drawn from"
          tooltip={kicad ? "KiCad is this board's layout of record (it is locked): its export is the board as it is; the routed build is what it was locked from" : "Drawn from the exported drawings or from the routed build"}
          value={source}
          onChange={(v) => (setSource(v as Source), pick([]))}
          options={[
            { value: "export", label: kicad ? "KiCad · layout of record" : "Exported drawing" },
            { value: "routed", label: kicad ? "tscircuit build · before lock" : "Routed build" },
          ]}
          className="ml-1 max-w-56 shrink-0"
        />
      )}
      {kind === "schematic" && kicadDrawn && (
        <span className="ml-1 shrink-0 rounded-sm bg-raised px-1.5 py-0.5 font-code text-[10px] text-fg-muted" data-tooltip="KiCad's schematic export: the layout of record of a locked board">
          KiCad
        </span>
      )}
      {boards.length > 1 && (
        <Select label="Board" tooltip="Board" value={board.path} onChange={(v) => (setBoardPath(v), pick([]))} options={boards.map((b) => ({ value: b.path, label: b.label }))} className="ml-1 max-w-48 shrink-0" />
      )}
    </div>
  );

  if (routed) return <CircuitPcbView {...props} board={board} boards={boards} onBoard={(v) => (setBoardPath(v), pick([]))} header={header} />;

  const lit = netName(litNet);
  return (
    <div ref={rootRef} className={cx("pb-board-drawing relative size-full min-h-[240px] min-w-[300px] overflow-hidden bg-canvas text-fg", kicadDrawn && (kind === "schematic" ? "pb-kicad" : "pb-kicad-pcb"))}>
      <style>{DRAWING_CSS}</style>
      {drawing.svg && <style>{scopedRules(drawing.svg.rules, `[data-pb-drawing="${prefix}"]`)}</style>}
      <div
        ref={pz.ref}
        data-pb-drawing={prefix}
        data-pb-tool={pz.panning ? "pan" : "select"}
        className={cx("pb-drawing absolute inset-0 touch-none select-none", toolCursor(pz))}
        onPointerMove={(e) => {
          if (e.buttons) return;
          setHover(hotAt(e.target, e.clientX, e.clientY));
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          if (pz.dragged()) return;
          const hot = hotAt(e.target, e.clientX, e.clientY);
          setHeldNet(hot?.net);
          const part = hot?.part && (index.current || children.has(hot.part)) ? hot.part : undefined;
          if (part && (e.shiftKey || e.ctrlKey || e.metaKey)) pick(picked.includes(part) ? picked.filter((p) => p !== part) : [...picked, part]);
          else pick(part ? [part] : []);
        }}
        onDoubleClick={() => pz.fit()}
      >
        <div ref={canvas} className="size-full" />
        <SelectionBox pz={pz} />
      </div>

      {header()}

      {/* the picked component: what it is, and where to go from here */}
      {selected && (sel || selPart) && (
        <div ref={cardRef} className="absolute top-[calc(var(--uhd-inset-top,0px)+12px)] right-3 w-[min(300px,calc(100%-24px))] rounded-panel border border-line bg-surface shadow-panel outline outline-1 -outline-offset-1 outline-contrast" data-pb-component={selected}>
          <div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3">
            <span className="font-code text-[12px] text-accent">{selected.toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate font-label text-[12px] tracking-[0.04em] uppercase">{sel?.name ?? selDef?.name ?? selPart?.value ?? sel?.id}</span>
            {host.openSource && sel && selInst && (
              <IconButton icon="file-code" size="sm" label="Open the module's source" onClick={() => host.openSource!({ defId: board.def.id, instancePath: board.path ? `${board.path}/${selInst}` : selInst })} />
            )}
            {host.openView && sel && selInst && !selInst.includes("/") && <IconButton icon="workflow" size="sm" label="Show the board's diagram" onClick={() => host.openView!("diagram", board.path, { select: selInst })} />}
            <IconButton icon="x" size="sm" label="Clear the selection" onClick={() => pick([])} />
          </div>
          <div className="px-3 py-2 text-[11px]">
            {selPart && <Row k="Reference" v={selPart.ref} mono />}
            {selPart?.value && <Row k="Value" v={selPart.value} mono />}
            {selInst && index.current && <Row k="Instance" v={selInst} mono />}
            {selDef && <Row k="Part" v={selDef.name} />}
            <Row k="Definition" v={sel?.moduleDefId} mono />
            {selDef && <Row k="Interfaces" v={String(selDef.interfaces.length)} />}
            {selDef?.categories?.[0] && <Row k="Category" v={selDef.categories[0]} mono />}
            {selPart && !sel && <div className="pt-1 text-fg-muted">The board carries no reference map (refdes.json), so this reference is not tied to its UHD instance here.</div>}
          </div>
          {picked.length > 1 && (
            <div className="flex flex-wrap gap-1 border-t border-line px-3 py-2 text-[11px]" data-pb-picked={picked.length}>
              <span className="mr-1 text-fg-muted">{picked.length} picked</span>
              {picked.map((r) => (
                <button key={r} type="button" className={cx("rounded-sm px-1 font-code hover:bg-hover", r === selected ? "text-accent" : "text-fg")} onClick={() => pick([r, ...picked.filter((x) => x !== r)])}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the lit net, by name */}
      {lit && (
        <div className="absolute bottom-[64px] left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-panel border border-line bg-surface py-1 pr-1 pl-3 text-[12px] shadow-panel outline outline-1 -outline-offset-1 outline-contrast" data-pb-net={lit}>
          <Icon name="waypoints" size={13} className="text-accent" />
          <span className="font-code">{lit}</span>
          {heldNet && <IconButton icon="x" size="sm" label="Let the net go" onClick={() => setHeldNet(undefined)} />}
        </div>
      )}

      {/* under the pointer */}
      {hover && (hover.part || hover.net) && (
        <div className="pointer-events-none fixed z-50 max-w-[280px] rounded-md border border-line bg-raised px-2 py-1 font-code text-[11px] text-fg shadow-float" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.part && (
            <div className="truncate">
              <span className="text-accent">{hover.part.toUpperCase()}</span>
              {hover.pad && <span className="text-fg-muted"> · {hover.pad}</span>}
              {hover.value && <span className="text-fg-muted"> · {hover.value}</span>}
              {hoverRef && <span className="text-fg-muted"> · {hoverRef.name ?? partDef(hoverInst)?.name ?? hoverInst}</span>}
            </div>
          )}
          {hover.net && <div className="truncate text-fg-muted">{netName(hover.net) ? `net ${hover.net}` : kind === "pcb" ? `net ${hover.net}` : "an unnamed net"}</div>}
        </div>
      )}

      {drawing.loading || drawing.error ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <EmptyState icon={<Icon name={drawing.error ? "file-x" : "loader"} size={24} strokeWidth={1.25} />} title={drawing.error ? "No drawing" : "Loading the drawing"}>
            {drawing.error}
          </EmptyState>
        </div>
      ) : null}

      {kind === "pcb" && (
        <Legend title="Layers" className="absolute bottom-[68px] left-3 max-[520px]:hidden">
          <LegendItem color={shownSide === "bottom" ? "var(--pb-d-copper-bottom)" : "var(--pb-d-copper-top)"} label={`Copper · ${shownSide ?? "top"}`} />
          {kicadDrawn && <LegendItem color="var(--pb-d-pad)" label="Pads (mask open)" />}
          <LegendItem color="var(--pb-d-silk)" label="Silkscreen" />
          {!kicadDrawn && <LegendItem color="var(--pb-d-drill)" label="Drill" shape="dot" />}
          <LegendItem color="var(--pb-d-edge)" label="Board edge" />
          {!kicadDrawn && <LegendItem color="var(--pb-d-hover)" label="Net under the pointer" shape="dot" />}
        </Legend>
      )}

      <div className="absolute right-0 bottom-3 left-0 flex justify-center px-3">
        <Toolbar label={`${props.view.title} tools`} className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <DrawingTools pz={pz} />
          <ToolbarSeparator />
          <DrawingViewButtons pz={pz} />
          {sides.length > 1 && (
            <>
              <ToolbarSeparator />
              <ToggleGroup
                label="Side"
                tooltipSide="top"
                options={[
                  { id: "top", icon: "panel-top", label: "Top side" },
                  { id: "bottom", icon: "panel-bottom", label: "Bottom side, seen from below" },
                ]}
                value={shownSide ?? "top"}
                onChange={(s) => setSide(s)}
              />
            </>
          )}
          {(host.openArtifact || host.openSource) && <ToolbarSeparator />}
          {host.openArtifact && file && (
            <IconButton icon="file-image" label={`Open ${file.filePath?.split("/").pop() ?? "the drawing"}`} tooltipSide="top" onClick={() => host.openArtifact!({ defId: board.def.id, artifactId: file.id })} />
          )}
          {host.openArtifact && sourceFile && (
            <IconButton icon="code-xml" label={sourceFile === kicad ? "Open the KiCad project" : "Open the circuit source"} tooltipSide="top" onClick={() => host.openArtifact!({ defId: board.def.id, artifactId: sourceFile.id })} />
          )}
          {host.openSource && <IconButton icon="braces" label="Open the board's UHD source" tooltipSide="top" onClick={() => host.openSource!({ defId: board.def.id, instancePath: board.path || undefined })} />}
        </Toolbar>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  if (!v) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-fg-muted">{k}</span>
      <span className={cx("min-w-0 truncate text-right", mono && "font-code")}>{v}</span>
    </div>
  );
}

export const SchematicView = (props: ViewProps) => <BoardDrawingView {...props} kind="schematic" />;
export const PcbView = (props: ViewProps) => <BoardDrawingView {...props} kind="pcb" />;
