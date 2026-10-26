/**
 * The assembly guide of one Manufacturing Package unit (`package:assembly`):
 * before you begin (sub-units, tools, materials), the kit with thumbnails,
 * then one illustrated step per planned step (./plan.ts): the parts strip,
 * an exploded line-art figure lettered like the strip (or, for connections,
 * the routed cables drawn in the accent colour), actions, connections,
 * torque, tools and notes, and a coverage table of every link the unit makes.
 * Figures are rendered by the release (SectionContext.figure).
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { applyMat4 } from "@deltarobotics/uhd";
import type { Block, Callout, KitItem, SectionContext, SectionFn, Step } from "@protoboardai/ext-release";
import { unitBom } from "@protoboardai/ext-release/helpers";
import type { BuiltContext } from "../context.ts";
import { centerOf, shortName } from "../docs/assembly.ts";
import { explode, ISO, renderBody, withOffset } from "../figures.ts";
import { matTranslation, type SceneBody } from "../model.ts";
import type { RenderBody } from "../render/renderer.ts";
import { bodyGlb, noImage, slug, thumbnail, type UnitScope } from "./common.ts";
import { unitPlan, type PlannedStep } from "./plan.ts";

export const assembly: SectionFn = async (s) => {
  const { project: p, unit: u, release } = s;
  if (!p.rootDef) return undefined;
  const { ctx, scope, steps, builds: buildList, variants } = await unitPlan(p, u);
  const blocks: Block[] = [];
  const builds = u.perProduct * release.build;
  const subs = [...new Set(u.members.filter((m) => m.unit).map((m) => m.unit!))];
  blocks.push({
    kind: "paragraph",
    text: `${u.kind === "root" ? `Final assembly of ${u.name}` : `One build of ${u.name}`}, in ${steps.length} step${steps.length === 1 ? "" : "s"}. Build ${builds} (${u.perProduct} per product × ${release.build}). Steps, parts, hardware and torques come from the model: mates and fastener stacks from assemble(), connections from the wiring checklist.${steps.some((x) => x.split) ? " A step marked as split is the part of a longer step that this unit does; the rest is in the unit named in it." : ""}`,
  });

  if (variants.length)
    blocks.push({
      kind: "note",
      level: "caution",
      text: `The ${buildList.length} builds are not all the same: ${variants.map((x) => `${x.field} ${x.values.map((y) => `${y.value} for ${y.build}`).join(", ")}`).join("; ")}. ${variants.every((x) => x.handled) ? "The steps that depend on it list each build." : "Not every step says which build gets what: check each build against the position it goes to."}`,
    });
  const later = steps.filter((x) => x.afterTest).map((x) => String(x.n));
  if (later.length)
    blocks.push({ kind: "paragraph", text: `${later.length === 1 ? `Step ${later[0]} comes` : `Steps ${later.slice(0, -1).join(", ")} and ${later[later.length - 1]} come`} after the bench test and configuration in the work order; the steps before ${later.length === 1 ? "it" : "them"} are done first.` });

  // ---- before you begin
  const rank = (t: string) => [/hex key/, /nut driver/, /spanner/].findIndex((r) => r.test(t)) >>> 0;
  const tools = [...new Set(steps.flatMap((x) => x.tools))].sort((a, b) => rank(a) - rank(b) || parseFloat(a) - parseFloat(b) || (a < b ? -1 : a > b ? 1 : 0));
  const materials = [...new Set(steps.flatMap((x) => x.materials))];
  const before: string[] = [];
  if (subs.length) before.push(`Bring the finished sub-units, each built and tested in its own folder: ${subs.map((id) => `${id} (units/${id}/)`).join(", ")}.`);
  before.push(`Tools: ${tools.length ? tools.join(", ") : "none beyond hands"}${tools.length ? " (hex keys from each screw's socket, drivers and spanners from each nut's and standoff's across-flats)" : ""}.`);
  if (materials.length) before.push(`Materials: ${materials.join(", ")}.`);
  before.push("Figures: parts already assembled are drawn light; parts fitted in the step dark, exploded along each joint's axis in stacking order; hardware in the accent colour. Letters match the parts strip.");
  blocks.push({ kind: "heading", text: "Before you begin" }, { kind: "list", items: before });

  // ---- kit
  blocks.push({ kind: "heading", text: "Kit" }, { kind: "kit", items: await kit(ctx, s), note: "Quantities per build, from the unit's bill of materials (bom.csv). Drawings are the parts' CAD, not to scale." });

  // ---- steps
  const out: Step[] = [];
  const state = initialState(ctx, scope, steps);
  for (const step of steps) out.push(await illustrated(ctx, s, scope, step, state));
  if (out.length) blocks.push({ kind: "heading", text: "Steps" }, { kind: "steps", steps: out });
  else blocks.push({ kind: "paragraph", text: "This unit makes no joints or connections: its parts arrive assembled." });

  // ---- coverage
  const rows = steps.flatMap((x) => [
    ...x.plan.mates.map((m) => ({ link: m.linkId, what: "mate", by: m.harness ?? "", step: `${x.n} · ${x.title}` })),
    ...x.plan.wiring.map((w) => ({ link: w.linkId, what: "connection", by: w.harness ?? "", step: `${x.n} · ${x.title}` })),
  ]);
  if (rows.length) {
    blocks.push({ kind: "heading", text: "Coverage" });
    blocks.push({ kind: "table", columns: [{ key: "link", label: "Link" }, { key: "what", label: "Kind" }, { key: "by", label: "Harness" }, { key: "step", label: "Step" }], rows, note: "Every mate and connection this unit makes, and the step that makes it. Links of sub-units are in their own guides." });
  }
  return { blocks };
};

/** Items laid out at the bench: what one build consumes directly (assemblies and kits opened, sub-units and boards whole). */
async function kit(ctx: BuiltContext, s: SectionContext): Promise<KitItem[]> {
  const rows = unitBom(s.project, s.unit);
  const whole: string[] = [];
  const by = new Map<string, { def: ModuleDef; qty: number; refs: string[]; unit?: string }>();
  for (const r of rows) {
    if (whole.some((w) => r.path.startsWith(w + "/"))) continue;
    if (r.action === "build" && r.kind !== "unit") continue;
    whole.push(r.path);
    const def = s.project.lookup(r.definition);
    if (!def) continue;
    const x = by.get(def.id) ?? { def, qty: 0, refs: [], unit: r.kind === "unit" ? r.note : undefined };
    x.qty += r.qty_per_unit;
    x.refs.push(r.path);
    by.set(def.id, x);
  }
  const items: KitItem[] = [];
  for (const { def, qty, unit, refs } of by.values()) {
    const th = unit ? await unitThumbnail(ctx, s, refs[0]) : await thumbnail(ctx, s, def);
    items.push({ name: shortName(def), quantity: qty, ref: unit ?? def.id, ...(th ? { image: th.file } : { placeholder: noImage(ctx, def) }) });
  }
  return items;
}

/** A sub-unit as it arrives: its placed bodies, line art, in their assembled positions. */
async function unitThumbnail(ctx: BuiltContext, s: SectionContext, path: string) {
  const at = s.unit.kind === "root" ? path : `${s.unit.representative}/${path}`;
  const bodies = [...ctx.scene.bodies, ...ctx.scene.hardware].filter((b) => b.glb && (b.path.join("/") === at || b.path.join("/").startsWith(at + "/")));
  if (!bodies.length) return undefined;
  return s.figure(`unit-thumb-${slug(at)}`, { width: 360, height: 360, mode: "lineart", lineScale: 1.25, bodies: bodies.map((b) => renderBody(b, "normal")), camera: { dir: ISO, margin: 0.08 } });
}

interface FigState {
  /** Body keys drawn as already assembled. */
  before: Set<string>;
  hwBefore: Set<string>;
  /** Sub-unit instance → its bodies and hardware keys (they arrive built and move as one). */
  subBodies: Map<string, SceneBody[]>;
}

/**
 * Before the first step: the unit's bodies that no step of this unit moves,
 * except those of a sub-unit that a step mounts (they arrive with it).
 */
function initialState(ctx: BuiltContext, scope: UnitScope, steps: PlannedStep[]): FigState {
  const scene = ctx.scene;
  const moved = new Set(steps.flatMap((x) => [...x.plan.moving, ...x.plan.placed].map((b) => b.key)));
  const hwMoved = new Set(steps.flatMap((x) => x.plan.hardware.map((h) => h.key)));
  const subBodies = new Map<string, SceneBody[]>();
  for (const b of [...scene.bodies, ...scene.hardware]) {
    const sub = scope.subOf(b.path.join("/"));
    if (sub) subBodies.set(sub, [...(subBodies.get(sub) ?? []), b]);
  }
  const mountedSubs = new Set([...subBodies.entries()].filter(([, bs]) => bs.some((b) => moved.has(b.key) || hwMoved.has(b.key))).map(([k]) => k));
  const later = (b: SceneBody) => {
    const sub = scope.subOf(b.path.join("/"));
    return !!sub && mountedSubs.has(sub);
  };
  const inUnit = (b: SceneBody) => scope.inBuild(b.path.join("/")) && !b.via?.startsWith("hint:");
  return {
    before: new Set(scene.bodies.filter((b) => inUnit(b) && !moved.has(b.key) && !later(b)).map((b) => b.key)),
    hwBefore: new Set(scene.hardware.filter((h) => scope.inBuild(h.path.join("/")) && !hwMoved.has(h.key) && !later(h)).map((h) => h.key)),
    subBodies,
  };
}

async function illustrated(ctx: BuiltContext, s: SectionContext, scope: UnitScope, x: PlannedStep, st: FigState): Promise<Step> {
  const parts: NonNullable<Step["parts"]> = [];
  for (const part of x.parts) {
    const th = await thumbnail(ctx, s, part.def);
    parts.push({ name: shortName(part.def), quantity: part.count, ref: part.def.id, letter: part.letter, accent: part.accent, ...(th ? { image: th.file } : {}) });
  }
  const figure = await stepFigure(ctx, s, scope, x, st);
  const notes = [...x.notes];
  if (x.split) notes.unshift({ level: "tip", text: `Split step: the doc spec's "${x.title}" also covers links made in another unit; this unit does the part listed here.` });
  if (x.afterTest && !notes.some((n) => /after (the )?(bench )?test|after configuration/i.test(n.text))) notes.unshift({ level: "caution", text: `This step follows the bench test and configuration in the work order (${x.afterTest}).` });
  return {
    title: x.title,
    actions: x.actions,
    parts,
    ...(figure ? { figure } : {}),
    ...(x.connections.length
      ? {
          table: {
            columns: [{ key: "name", label: "Link" }, { key: "from", label: "From" }, { key: "to", label: "To" }, { key: "x", label: "" }, { key: "term", label: "Termination" }],
            rows: x.connections.map((c) => ({ name: c.name, from: c.from, to: c.to, x: c.crossover ? "× crossover" : "", term: c.termination })),
          },
        }
      : {}),
    ...(x.torque ? { torque: x.torque } : {}),
    ...(x.tools.length ? { tools: x.tools } : {}),
    ...(x.materials.length ? { materials: x.materials } : {}),
    notes,
    trace: x.trace,
  };
}

/** The step's figure: exploded mates, or the routed cables of its connections; advances the state. */
async function stepFigure(ctx: BuiltContext, s: SectionContext, scope: UnitScope, x: PlannedStep, st: FigState): Promise<Step["figure"] | undefined> {
  const scene = ctx.scene;
  const p = x.plan;
  const spec = p.spec;
  const cfg = ctx.sys.config;
  const iso = cfg.camera?.dir ?? ISO;
  const E = spec.explode ?? cfg.assembly?.explode ?? 16;
  const name = `ag-${slug(s.unit.id)}-${String(x.n).padStart(2, "0")}-${slug(spec.id)}`;
  const context = (exclude: Set<string>): RenderBody[] => [
    ...scene.bodies.filter((b) => st.before.has(b.key) && !exclude.has(b.key)).map((b) => renderBody(b, "context")),
    ...scene.hardware.filter((h) => st.hwBefore.has(h.key) && !exclude.has(h.key)).map((h) => renderBody(h, "context")),
  ];
  const advance = (keys: string[], hw: string[]) => {
    for (const k of keys) st.before.add(k);
    for (const k of hw) st.hwBefore.add(k);
  };
  const callouts = (anchors: Record<string, { x: number; y: number }>): Callout[] =>
    x.parts.filter((pt) => pt.anchor && anchors[pt.anchor]).map((pt) => ({ ...anchors[pt.anchor!], label: pt.letter, accent: pt.accent }));

  if (spec.figure !== "wiring" && spec.figure !== "none" && (p.mates.length || p.placed.length)) {
    const ex = explode(scene, p.mates.map((m) => m.linkId), E);
    // a sub-unit mounted here moves as one: its other bodies take the offset of the body the mate placed
    const follow: SceneBody[] = [];
    for (const [sub, bs] of st.subBodies) {
      const off = bs.map((b) => ex.offsets.get(b.key)).find(Boolean);
      if (!off) continue;
      for (const b of bs) if (!ex.offsets.has(b.key) && !st.before.has(b.key) && !st.hwBefore.has(b.key) && !p.moving.includes(b) && !p.hardware.includes(b)) {
        ex.offsets.set(b.key, off);
        follow.push(b);
      }
      void sub;
    }
    const followKeys = new Set(follow.map((b) => b.key));
    const bodies: RenderBody[] = context(followKeys);
    const anchors: { id: string; p: number[] }[] = [];
    for (const b of [...p.moving, ...follow.filter((f) => !f.harness)]) {
      const off = ex.offsets.get(b.key);
      bodies.push(withOffset(renderBody(b, "normal"), off));
      anchors.push({ id: `body:${b.key}`, p: centerOf(b, off) });
    }
    for (const b of p.placed) {
      const off = [0, 0, E * 1.6];
      bodies.push(withOffset(renderBody(b, "normal"), off));
      anchors.push({ id: `body:${b.key}`, p: centerOf(b, off) });
    }
    for (const h of [...p.hardware, ...follow.filter((f) => f.harness)]) {
      const off = ex.offsets.get(h.key);
      bodies.push(withOffset(renderBody(h, p.hardware.includes(h) ? "accent" : "normal"), off));
      anchors.push({ id: `hw:${h.key}`, p: centerOf(h, off) });
    }
    const guides = [...ex.guides];
    for (const b of p.placed) {
      const c = matTranslation(b.matrix);
      guides.push({ from: c, to: [c[0], c[1], c[2] + E * 1.6] });
    }
    advance([...p.moving, ...p.placed, ...follow.filter((f) => !f.harness)].map((b) => b.key), [...p.hardware, ...follow.filter((f) => f.harness)].map((h) => h.key));
    if (!bodies.some((b) => b.glb)) return undefined;
    const r = await s.figure(name, { width: 1900, height: 1000, mode: "lineart", bodies, guides, anchors, camera: { dir: spec.camera?.dir ?? iso, up: spec.camera?.up, margin: spec.camera?.margin ?? 0.1 } });
    return { file: r.file, width: r.width, height: r.height, callouts: callouts(r.anchors), caption: p.mates.length ? `${x.title}: parts exploded along each joint's axis in stacking order; lettered as in the parts strip.` : `${x.title}: shown lifted above its seat.` };
  }

  if (spec.figure === "none" || !p.wiring.length) {
    advance([...p.moving, ...p.placed].map((b) => b.key), p.hardware.map((h) => h.key));
    return undefined;
  }
  // connections: the modules at the ends drawn dark (those already in place), the routed cables in the accent colour
  const ends = new Set(x.ends);
  const endBodies = scene.bodies.filter((b) => ends.has(b.path.join("/")) && st.before.has(b.key));
  const shown = new Set(endBodies.map((b) => b.key));
  // the camera fits the cables and the parts they join; the rest is context around them
  const bodies: RenderBody[] = [...context(shown).map((b) => ({ ...b, fit: false })), ...endBodies.map((b) => renderBody(b, "normal"))];
  const anchors: { id: string; p: number[] }[] = [];
  let cables = 0;
  for (const h of x.cables) {
    const hp = scene.assembly.harnesses.find((x2) => x2.key === h);
    const glb = hp ? bodyGlb(ctx, hp.def) : undefined;
    if (!hp || !glb || !scope.inBuild(h)) continue;
    cables++;
    bodies.push({ key: `harness:${h}`, glb, matrix: hp.matrix, style: "accent", category: "generic" });
    const frames = hp.def.interfaces.map((i) => i.geometry?.frame?.origin).filter((o): o is [number, number, number] => Array.isArray(o));
    const mid: [number, number, number] = [0, 1, 2].map((k) => (frames.length ? frames.reduce((t, o) => t + o[k], 0) / frames.length : 0)) as [number, number, number];
    anchors.push({ id: `harness:${h}`, p: applyMat4(hp.matrix, mid) });
  }
  advance(endBodies.map((b) => b.key), []);
  if (!cables && !endBodies.some((b) => b.glb)) return undefined;
  const r = await s.figure(name, { width: 1900, height: 1000, mode: "lineart", bodies, anchors, camera: { dir: spec.camera?.dir ?? [0.35, -0.5, 1.4], up: spec.camera?.up, margin: spec.camera?.margin ?? 0.08 } });
  return {
    file: r.file,
    width: r.width,
    height: r.height,
    callouts: callouts(r.anchors),
    caption: cables ? `${x.title}: the ${cables === 1 ? "cable" : `${cables} cables`} in the accent colour, routed as the model's harness CAD lays ${cables === 1 ? "it" : "them"}; the parts they join drawn dark.` : `${x.title}: the parts the connections join; pads and pins in the table.`,
  };
}
