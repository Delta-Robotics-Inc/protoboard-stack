/**
 * The PCB view from the circuit provider's routed board (`circuit.json`): the
 * board as `circuit:generate` built and routed it, drawn here, never routed
 * again. What a person needs instead of the tool's own viewer:
 *
 * - every copper layer on and off by itself (top, the inner ones, bottom),
 *   and silkscreen, courtyard and fabrication on each side, drills, the edge
 *   and keep-outs;
 * - zoom and pan as on the canvas (usePanZoom: the Select and Pan tools, a
 *   middle-button or Space drag, the wheel about the pointer, F, +, -, 0,
 *   Fit), a box drawn with Select picks the components in it, and the board
 *   seen from below;
 * - a net lit across the board, by its name, under the pointer or held by a
 *   click;
 * - a component picked: its reference, part and footprint here, and the
 *   host's Inspector follows the selection;
 * - the board check's findings at their place, listed and found by a click.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ModuleDef } from "@deltarobotics/uhd";
import { EmptyState, Icon, IconButton, ScrollArea, ToggleGroup, Toolbar, ToolbarSeparator, cx } from "@deltarobotics/uhd-viewer/components";
import { definition } from "../applies.js";
import type { ViewProps } from "../types.js";
import { artifactHref, artifactNamed, circuitSource, type BoardAt } from "./boards.js";
import { drawOrder, findingsLabel, locate, readCircuit, type CircuitElement, type Layer, type LayerId, type PcbModel, type Piece, type Shape } from "./circuit.js";
import { DrawingTools, DrawingViewButtons, SelectionBox, toolCursor } from "./DrawingControls.js";
import { DRAWING_CSS } from "./palettes.js";
import { usePanZoom, type Box } from "./usePanZoom.js";

/** What the provider's name map says of a component (build.json `map.components`): its UHD instance, part and footprint. */
interface MapEntry {
  instance?: string;
  part?: string;
  footprint?: string;
}

interface Finding {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  at?: [number, number];
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

/** Below this width the board check's card starts folded (B11): open, it lies over the board's right half. */
const FINDINGS_OPEN_MIN_WIDTH = 1280;

/** The board's files: its routed result and the provider's name map, fetched once per board. */
function useBoard(url: string | undefined, mapUrl: string | undefined) {
  const [state, setState] = useState<{ cj?: CircuitElement[]; map?: Record<string, MapEntry>; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    if (!url) return setState({ loading: false, error: "This board has no routed result yet. Run circuit:generate to build and route it." });
    let cancelled = false;
    setState({ loading: true });
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))));
    Promise.all([get(url), mapUrl ? get(mapUrl).catch(() => undefined) : Promise.resolve(undefined)])
      .then(([cj, build]) => {
        if (cancelled) return;
        if (!Array.isArray(cj)) throw new Error("not Circuit JSON");
        setState({ loading: false, cj: cj as CircuitElement[], map: (build as { map?: { components?: Record<string, MapEntry> } } | undefined)?.map?.components });
      })
      .catch((e: Error) => !cancelled && setState({ loading: false, error: `The routed board could not be read (${e.message}).` }));
    return () => {
      cancelled = true;
    };
  }, [url, mapUrl]);
  return state;
}

/** One piece as SVG. Pads and pours are filled; drawings (silkscreen, courtyard, fabrication) are stroked. */
export function shapeEl(p: Piece, key: number, flip: boolean, extra: Record<string, string | undefined>): ReactNode {
  const s: Shape = p.shape;
  const outline = p.stroke !== undefined;
  const paint = outline ? { fill: "none", stroke: "currentColor", strokeWidth: p.stroke } : { fill: "currentColor" };
  switch (s.kind) {
    case "rect":
      return <rect key={key} x={s.x - s.w / 2} y={s.y - s.h / 2} width={s.w} height={s.h} rx={s.r || undefined} transform={s.rotate ? `rotate(${s.rotate} ${s.x} ${s.y})` : undefined} {...paint} {...extra} />;
    case "circle":
      return <circle key={key} cx={s.x} cy={s.y} r={s.r} {...paint} {...extra} />;
    case "line":
      return <polyline key={key} points={s.points.map((q) => q.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" {...extra} />;
    case "area":
      return <path key={key} d={s.rings.map((r) => `M${r.map((q) => q.join(",")).join("L")}Z`).join("")} fillRule="evenodd" {...paint} {...extra} />;
    case "text":
      // text reads left to right whichever side the board is seen from. It is set at 100 times its size and scaled
      // down: Chrome draws a font of a millimetre or less badly once the drawing is zoomed (doubled glyphs, R2 as "R2R")
      return (
        <text key={key} transform={`translate(${s.x} ${s.y})${flip ? " scale(-1 1)" : ""}${s.rotate ? ` rotate(${flip ? -s.rotate : s.rotate})` : ""} scale(${TEXT_SCALE})`} fontSize={s.size / TEXT_SCALE} textAnchor={s.anchor ?? "middle"} dominantBaseline="central" fill="currentColor" {...extra}>
          {s.text}
        </text>
      );
  }
}

/** Text is drawn at 1/TEXT_SCALE of its font size (see Piece's text case). */
const TEXT_SCALE = 0.01;

/** A layer's pieces, drawn once per model and side (the highlight is a style rule, not a redraw; a pan is the viewBox). */
const LayerGroup = memo(function LayerGroup({ layer, flip }: { layer: Layer; flip: boolean }) {
  const pour = layer.id.startsWith("copper:");
  return (
    <g className={cx("pb-pcb-layer", pour && "pb-pcb-copper")} data-layer={layer.id} style={{ color: `var(--pb-d-${layer.role})` }}>
      {layer.pieces.map((p, i) =>
        shapeEl(p, i, flip, {
          "data-net": p.net,
          "data-ref": p.ref,
          "data-pin": p.pin,
          className: p.shape.kind === "area" && pour ? "pb-pour" : undefined,
        }),
      )}
    </g>
  );
});

/** Layers on by default: everything but the far side's drawings (for the side the board is seen from) and the courtyards. */
const defaultHidden = (m: PcbModel, flip = false): Set<LayerId> =>
  new Set<LayerId>(["courtyard:top", "courtyard:bottom", flip ? "fab:top" : "fab:bottom", flip ? "silk:top" : "silk:bottom", "keepout", ...m.layers.filter((l) => !l.pieces.length).map((l) => l.id)]);

export function CircuitPcbView(props: ViewProps & { board: BoardAt; boards: BoardAt[]; onBoard: (path: string) => void; header: (extra?: ReactNode) => ReactNode }) {
  const { bundle, host, board } = props;
  const circuit = artifactNamed(board.def, "circuit.json");
  const build = artifactNamed(board.def, "build.json");
  const data = useBoard(artifactHref(host, board.def, circuit), artifactHref(host, board.def, build));
  const model = useMemo(() => (data.cj ? readCircuit(data.cj) : undefined), [data.cj]);
  // what the user turned off, per board; until they touch a layer, the defaults (known in the same render as the model,
  // so the drawing's host is there when the view first fits it)
  const [chosen, setHidden] = useState<{ model: PcbModel; hidden: Set<LayerId> } | undefined>(undefined);
  const [flip, setFlip] = useState(props.params?.side === "bottom");
  const hidden = model ? (chosen?.model === model ? chosen.hidden : defaultHidden(model, flip)) : undefined;
  const [hover, setHover] = useState<{ net?: string; ref?: string; pin?: string; x: number; y: number } | null>(null);
  const [heldNet, setHeldNet] = useState<string | undefined>(undefined);
  /** The picked components, by reference: a click picks one, a box several (the first is the one the card and the host get). */
  const [picked, setPicked] = useState<string[]>([]);
  const selected = picked[0];
  const [layersOpen, setLayersOpen] = useState(true);
  // the board check's card starts folded where it would lie over the board (B11: a laptop-sized viewer); its marks are on the board
  const [findingsOpen, setFindingsOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= FINDINGS_OPEN_MIN_WIDTH);
  const [findingsShown, setFindingsShown] = useState(true);

  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const findingsRef = useRef<HTMLDivElement>(null);
  const box = useMemo<Box | undefined>(() => {
    if (!model) return undefined;
    const [x, y, w, h] = model.box;
    const m = Math.max(w, h) * 0.02;
    return [(flip ? -x - w : x) - m, y - m, w + 2 * m, h + 2 * m];
  }, [model, flip]);
  const pz = usePanZoom(() => svgRef.current, {
    box,
    // the board fits between the floating panels (the layers on the left, the findings on the right)
    insets: () => {
      const root = rootRef.current?.getBoundingClientRect();
      if (!root) return {};
      const l = layersRef.current?.getBoundingClientRect();
      const f = findingsRef.current?.getBoundingClientRect();
      return { left: l && l.width ? l.right - root.left + 8 : 0, right: f && f.width ? root.right - f.left + 8 : 0, top: 64, bottom: 64 };
    },
    onBox: (b, additive) => {
      if (!model) return;
      // the components whose centre is in the box (the drawing is mirrored when seen from below)
      const inside = [...model.components.values()].filter((c) => {
        const x = flip ? -c.x : c.x;
        return x >= b[0] && x <= b[0] + b[2] && c.y >= b[1] && c.y <= b[1] + b[3];
      });
      const refs = inside.map((c) => c.ref);
      pick(additive ? [...new Set([...picked, ...refs])] : refs);
    },
    onEscape: () => {
      setHeldNet(undefined);
      pick([]);
    },
  });

  // a reference → the UHD instance it is (the provider's name map; else the reference is the instance's id)
  const instanceOf = (ref: string) => data.map?.[ref]?.instance ?? ref;
  const children = useMemo(() => new Map((board.def.children ?? []).map((c) => [c.id, c])), [board]);
  const refOfInstance = useMemo(() => new Map(Object.entries(data.map ?? {}).map(([ref, m]) => [m.instance ?? ref, ref])), [data.map]);
  // a selection made elsewhere (the Inspector, the hierarchy) by `params.select`
  useEffect(() => {
    const want = props.params?.select;
    const ref = want && model ? (refOfInstance.get(want) ?? (model.components.has(want) ? want : undefined)) : undefined;
    if (ref) setPicked([ref]);
  }, [props.params?.select, model, refOfInstance]);

  const findings = useMemo<Finding[]>(() => {
    if (!model) return [];
    const out: Finding[] = [];
    const seen = new Set<string>();
    for (const d of bundle.diagnostics ?? []) {
      if (d.entity?.id !== board.def.id || !d.code.startsWith("CIRCUIT_") || d.code === "CIRCUIT_NOT_BUILT") continue;
      seen.add(d.message);
      const at = locate(d.message, model, data.cj);
      out.push({ severity: d.severity, code: d.code, message: d.message, ...(at ? { at } : {}) });
    }
    // what the provider recorded and the check did not report (a warning, or a build the check has not read yet)
    for (const r of model.recorded) {
      const message = `${r.type}: ${r.message}`;
      if (seen.has(message)) continue;
      seen.add(message);
      out.push({ severity: /_error$/.test(r.type) ? "error" : "warning", code: r.type, message: r.message, ...(r.at ? { at: r.at } : {}) });
    }
    return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.at ? 0 : 1) - (b.at ? 0 : 1));
  }, [model, bundle, board, data.cj]);

  const select = (ref: string | undefined) => pick(ref ? [ref] : []);
  function pick(refs: string[]) {
    setPicked(refs);
    const ref = refs[0];
    const inst = ref ? instanceOf(ref) : undefined;
    const child = inst ? children.get(inst) : undefined;
    host.selectionChanged?.(inst && child ? { kind: "node", id: board.path ? `${board.path}/${inst}` : inst, defId: child.moduleDefId } : null);
  };

  const hit = (t: EventTarget | null) => {
    const el = t instanceof Element ? t.closest("[data-net],[data-ref]") : null;
    return el ? { net: el.getAttribute("data-net") ?? undefined, ref: el.getAttribute("data-ref") ?? undefined, pin: el.getAttribute("data-pin") ?? undefined } : undefined;
  };

  if (data.loading || data.error || !model || !hidden) {
    return (
      <div className="pb-board-drawing relative grid size-full min-h-[240px] place-items-center bg-canvas text-fg">
        <style>{DRAWING_CSS}</style>
        {props.header()}
        <EmptyState icon={<Icon name={data.error ? "file-x" : "loader"} size={24} strokeWidth={1.25} />} title={data.error ? "No routed board" : "Loading the routed board"}>
          {data.error}
        </EmptyState>
      </div>
    );
  }

  const litNet = hover?.net ?? heldNet;
  const net = litNet ? model.nets.get(litNet) : undefined;
  const comp = selected ? model.components.get(selected) : undefined;
  const entry = selected ? data.map?.[selected] : undefined;
  const inst = selected ? instanceOf(selected) : undefined;
  const ref = inst ? children.get(inst) : undefined;
  const partDef: ModuleDef | undefined = ref ? definition(bundle, ref.moduleDefId) : undefined;
  // drawn bottom-most first for the side it is seen from; listed nearest first
  const layers = drawOrder(model, flip ? "bottom" : "top");
  const shown = layers.filter((l) => !hidden.has(l.id));
  const toggle = (id: LayerId) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden({ model, hidden: next });
  };
  const source = circuitSource(board.def);
  const esc = (v: string) => v.replace(/["\\]/g, "\\$&");
  const located = findings.filter((f) => f.at).length;

  return (
    <div ref={rootRef} className="pb-board-drawing pb-pcb relative size-full min-h-[240px] min-w-[300px] overflow-hidden bg-canvas text-fg" data-pb-pcb={board.def.id}>
      <style>{DRAWING_CSS}</style>
      {/* the net that is lit and the components that are picked: rules, not a redraw of the board */}
      <style>
        {[
          litNet ? `.pb-pcb [data-net="${esc(litNet)}"] { color: var(--pb-d-hover) !important; } .pb-pcb .pb-pcb-copper [data-net="${esc(litNet)}"] { opacity: 1; }` : "",
          litNet ? `.pb-pcb .pb-pcb-copper > :not([data-net="${esc(litNet)}"]) { opacity: 0.35; }` : "",
          // a lit pour stays a wash: the pads and traces of the net are what stands out
          litNet ? `.pb-pcb .pb-pcb-copper > .pb-pour[data-net="${esc(litNet)}"] { opacity: 0.3; }` : "",
          picked.length ? `${picked.map((r) => `.pb-pcb [data-ref="${esc(r)}"]`).join(", ")} { color: var(--pb-d-select) !important; }` : "",
        ].join("\n")}
      </style>
      <div
        ref={pz.ref}
        data-pb-tool={pz.panning ? "pan" : "select"}
        className={cx("pb-drawing absolute inset-0 touch-none select-none", toolCursor(pz))}
        onPointerMove={(e) => {
          if (e.buttons) return;
          const h = hit(e.target);
          setHover(h && (h.net || h.ref) ? { ...h, x: e.clientX, y: e.clientY } : null);
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          if (pz.dragged()) return;
          const h = hit(e.target);
          setHeldNet(h?.net);
          const ref = h?.ref && model.components.has(h.ref) ? h.ref : undefined;
          // Shift (or Ctrl, Cmd) adds a component to the picked ones, or takes it out
          if (ref && (e.shiftKey || e.ctrlKey || e.metaKey)) pick(picked.includes(ref) ? picked.filter((r) => r !== ref) : [...picked, ref]);
          else select(ref);
        }}
        onDoubleClick={() => pz.fit()}
      >
        <svg ref={svgRef} className="size-full" role="img" aria-label={`Routed board ${board.label}`}>
          <g data-pb-viewport transform={flip ? "scale(-1 1)" : undefined}>
            {shown.map((l) => (
              <LayerGroup key={`${l.id}:${flip}`} layer={l} flip={flip} />
            ))}
            {/* findings at their place: marks of a fixed size on screen, whatever the zoom */}
            {findingsShown && (
              <g className="pb-pcb-findings">
                {findings.map((f, i) =>
                  f.at ? (
                    <g key={i} data-finding={i} data-severity={f.severity} style={{ color: `var(--uhd-severity-${f.severity})` }}>
                      <circle cx={f.at[0]} cy={f.at[1]} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="pb-finding-ring" />
                      <circle cx={f.at[0]} cy={f.at[1]} fill="currentColor" className="pb-finding-dot" />
                    </g>
                  ) : null,
                )}
              </g>
            )}
          </g>
        </svg>
        <SelectionBox pz={pz} />
      </div>

      {props.header(
        <span className="ml-1 shrink-0 rounded-sm bg-raised px-1.5 py-0.5 font-code text-[10px] text-fg-muted" data-tooltip="Drawn from circuit.json, the routed result of circuit:generate">
          routed
        </span>,
      )}

      {/* the layers, each on and off by itself */}
      <div ref={layersRef} className="absolute top-[calc(var(--uhd-inset-top,0px)+64px)] left-3 flex max-h-[calc(100%-150px)] w-[188px] flex-col rounded-panel border border-line bg-surface shadow-panel outline outline-1 -outline-offset-1 outline-contrast max-[520px]:hidden">
        <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-left font-label text-[10px] tracking-[0.8px] text-fg-muted uppercase hover:text-fg" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)} data-tooltip={layersOpen ? "Hide the layer list" : "Show the layer list"}>
          <Icon name="layers" size={13} />
          <span className="flex-1">Layers</span>
          <Icon name={layersOpen ? "chevron-up" : "chevron-down"} size={13} />
        </button>
        {layersOpen && (
          <ScrollArea className="min-h-0 border-t border-line" contentClassName="flex flex-col gap-0.5 px-1.5 py-1.5">
            {layers
              .slice()
              .reverse()
              .map((l) => {
                const on = !hidden.has(l.id);
                const empty = !l.pieces.length;
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    disabled={empty}
                    data-layer-toggle={l.id}
                    data-tooltip={empty ? `${l.label}: nothing on this layer` : `${on ? "Hide" : "Show"} ${l.label.toLowerCase()}`}
                    data-tooltip-side="right"
                    onClick={() => toggle(l.id)}
                    className={cx("flex min-h-[20px] items-center gap-2 rounded-sm px-1.5 py-0.5 text-left text-[11px]", empty ? "cursor-default opacity-40" : "cursor-pointer hover:bg-hover", on ? "text-fg" : "text-fg-muted")}
                  >
                    <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-[2px]", !on && "opacity-40")} style={{ background: `var(--pb-d-${l.role})` }} />
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                    <Icon name={on ? "eye" : "eye-off"} size={12} className="shrink-0 opacity-70" />
                  </button>
                );
              })}
            {located > 0 && (
              <button
                type="button"
                aria-pressed={findingsShown}
                data-layer-toggle="findings"
                data-tooltip={`${findingsShown ? "Hide" : "Show"} the board check's marks${located < findings.length ? `: ${located} of its ${findings.length} findings have a place on the board` : ""}`}
                data-tooltip-side="right"
                onClick={() => setFindingsShown((v) => !v)}
                className={cx("mt-1 flex min-h-[20px] cursor-pointer items-center gap-2 rounded-sm border-t border-line px-1.5 pt-1.5 pb-0.5 text-left text-[11px] hover:bg-hover", findingsShown ? "text-fg" : "text-fg-muted")}
              >
                <span aria-hidden className={cx("h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-[var(--uhd-severity-error)]", !findingsShown && "opacity-40")} />
                <span className="min-w-0 flex-1 truncate">{findingsLabel(located, findings.length)}</span>
                <Icon name={findingsShown ? "eye" : "eye-off"} size={12} className="shrink-0 opacity-70" />
              </button>
            )}
          </ScrollArea>
        )}
      </div>

      {/* the lit net, by name */}
      {net && (
        <div className="absolute bottom-[64px] left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-panel border border-line bg-surface py-1 pr-1 pl-3 text-[12px] shadow-panel outline outline-1 -outline-offset-1 outline-contrast" data-pb-net={net.key}>
          <Icon name="waypoints" size={13} className="text-accent" />
          <span className="font-code">{net.name}</span>
          <span className="text-fg-muted">
            {net.pads.length} pad{net.pads.length === 1 ? "" : "s"}
          </span>
          {heldNet && <IconButton icon="x" size="sm" label="Let the net go" onClick={() => setHeldNet(undefined)} />}
        </div>
      )}

      {/* the picked component: reference, part, footprint */}
      {selected && comp && (
        <div className="absolute top-[calc(var(--uhd-inset-top,0px)+64px)] right-3 w-[min(300px,calc(100%-24px))] rounded-panel border border-line bg-surface shadow-panel outline outline-1 -outline-offset-1 outline-contrast" data-pb-component={selected}>
          <div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3">
            <span className="font-code text-[12px] text-accent">{selected.toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate font-label text-[12px] tracking-[0.04em] uppercase">{ref?.name ?? partDef?.name ?? comp.mpn ?? selected}</span>
            {host.openSource && ref && <IconButton icon="file-code" size="sm" label="Open the module's source" onClick={() => host.openSource!({ defId: board.def.id, instancePath: board.path ? `${board.path}/${ref.id}` : ref.id })} />}
            {host.openView && ref && <IconButton icon="workflow" size="sm" label="Show the board's diagram" onClick={() => host.openView!("diagram", board.path, { select: ref.id })} />}
            <IconButton icon="x" size="sm" label="Clear the selection" onClick={() => select(undefined)} />
          </div>
          <div className="px-3 py-2 text-[11px]">
            <Row k="Reference" v={selected.toUpperCase()} mono />
            <Row k="Part" v={partDef?.name ?? entry?.part} />
            <Row k="Definition" v={ref?.moduleDefId ?? entry?.part} mono />
            <Row k="Footprint" v={entry?.footprint} mono />
            <Row k="Part number" v={comp.mpn} mono />
            <Row k="Side" v={comp.side} />
            <Row k="Position" v={`${comp.x.toFixed(2)}, ${(-comp.y).toFixed(2)} mm · ${(-comp.rotate + 360) % 360}°`} mono />
          </div>
          {picked.length > 1 && (
            <div className="flex flex-wrap gap-1 border-t border-line px-3 py-2 text-[11px]" data-pb-picked={picked.length}>
              <span className="mr-1 text-fg-muted">{picked.length} picked</span>
              {picked.map((r) => (
                <button key={r} type="button" className={cx("rounded-sm px-1 font-code hover:bg-hover", r === selected ? "text-accent" : "text-fg")} onClick={() => pick([r, ...picked.filter((x) => x !== r)])} data-tooltip={`Show ${r.toUpperCase()} here and in the Inspector`}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the board check's findings */}
      {findings.length > 0 && (
        <div ref={findingsRef} className="absolute right-3 bottom-[64px] flex max-h-[40%] w-[min(340px,calc(100%-24px))] flex-col rounded-panel border border-line bg-surface shadow-panel outline outline-1 -outline-offset-1 outline-contrast" data-pb-findings={findings.length}>
          <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-left font-label text-[10px] tracking-[0.8px] text-fg-muted uppercase hover:text-fg" aria-expanded={findingsOpen} onClick={() => setFindingsOpen((o) => !o)} data-tooltip={findingsOpen ? "Hide the findings" : "Show the findings"}>
            <Icon name="shield-alert" size={13} />
            <span className="flex-1" data-tooltip={located < findings.length ? `${located} of them have a place on the board` : undefined}>
              Board check · {findings.length}
            </span>
            <Icon name={findingsOpen ? "chevron-down" : "chevron-up"} size={13} />
          </button>
          {findingsOpen && (
            <ScrollArea className="min-h-0 border-t border-line" contentClassName="flex flex-col py-1">
              {findings.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!f.at}
                  data-tooltip={f.at ? "Show it on the board" : "This finding names no place on the board"}
                  data-tooltip-side="left"
                  onClick={() => f.at && pz.centerOn(flip ? -f.at[0] : f.at[0], f.at[1])}
                  className={cx("flex items-start gap-2 px-3 py-1 text-left text-[11px]", f.at ? "cursor-pointer hover:bg-hover" : "cursor-default")}
                >
                  <span aria-hidden className="mt-1 size-2 shrink-0 rounded-full" style={{ background: `var(--uhd-severity-${f.severity})` }} />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="font-code text-fg-muted">{f.code}</span> {f.message}
                  </span>
                  {f.at && <Icon name="crosshair" size={12} className="mt-0.5 shrink-0 text-fg-muted" />}
                </button>
              ))}
            </ScrollArea>
          )}
        </div>
      )}

      {/* under the pointer */}
      {hover && (hover.ref || hover.net) && (
        <div className="pointer-events-none fixed z-50 max-w-[280px] rounded-md border border-line bg-raised px-2 py-1 font-code text-[11px] text-fg shadow-float" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.ref && (
            <div className="truncate">
              <span className="text-accent">{hover.ref.toUpperCase()}</span>
              {hover.pin && <span className="text-fg-muted"> · {hover.pin}</span>}
            </div>
          )}
          {hover.net && <div className="truncate text-fg-muted">net {model.nets.get(hover.net)?.name ?? hover.net}</div>}
        </div>
      )}

      <div className="absolute right-0 bottom-3 left-0 flex justify-center px-3">
        <Toolbar label={`${props.view.title} tools`} className="max-w-full overflow-x-auto [scrollbar-width:none]">
          <DrawingTools pz={pz} />
          <ToolbarSeparator />
          <DrawingViewButtons pz={pz} />
          <ToolbarSeparator />
          <ToggleGroup
            label="Side"
            tooltipSide="top"
            options={[
              { id: "top", icon: "panel-top", label: "Seen from the top" },
              { id: "bottom", icon: "panel-bottom", label: "Seen from below" },
            ]}
            value={flip ? "bottom" : "top"}
            onChange={(s) => setFlip(s === "bottom")}
          />
          {(host.openArtifact || host.openSource) && <ToolbarSeparator />}
          {host.openArtifact && circuit && <IconButton icon="file-json" label="Open circuit.json" tooltipSide="top" onClick={() => host.openArtifact!({ defId: board.def.id, artifactId: circuit.id })} />}
          {host.openArtifact && source && <IconButton icon="code-xml" label="Open the circuit source" tooltipSide="top" onClick={() => host.openArtifact!({ defId: board.def.id, artifactId: source.id })} />}
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
