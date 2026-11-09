/**
 * STEP AP214 (AUTOMOTIVE_DESIGN) writer for the board scene, written from ISO 10303-21 and the AP214 schema. One
 * assembly product for the board, one child product per body (the board, each component, each keep-out slab, each
 * render layer), placed with an item-defined transformation. Each component is one manifold solid (MANIFOLD_SOLID_BREP)
 * with exact planes, cylinders, lines and circles, named by its reference designator and value, colored on the solid
 * and, where a part has a second color (terminations, a pin 1 mark), on those faces.
 *
 * `instances: "shared"` writes one product per distinct body and places it once per component (smaller files, as KiCad
 * does); the default `unique` writes a product per component so every CAD tool shows the reference designator as the
 * part's name.
 */
import { createHash } from "node:crypto";
import type { Brep, Solid } from "../brep.js";
import type { Affine, Vec3 } from "../math.js";
import { sceneSolids, type Board3d, type NamedSolid } from "../scene.js";

export interface StepOptions {
  /** `unique` (default): a product per component; `shared`: identical bodies share one product. */
  instances?: "unique" | "shared";
  /** FILE_NAME time stamp (ISO 8601); default now. */
  timestamp?: string;
  /** File name written into the header. */
  fileName?: string;
}

export interface StepResult {
  text: string;
  /** Solid instances in the assembly (what a CAD tool shows as bodies). */
  solids: number;
  /** MANIFOLD_SOLID_BREP entities written (fewer than `solids` with shared instances). */
  solidEntities: number;
  products: number;
  entities: number;
}

/** A STEP REAL: always with a decimal point, rounded to 1e-9 mm. */
export function stepNum(v: number): string {
  const r = Math.round((Number.isFinite(v) ? v : 0) * 1e9) / 1e9;
  if (r === 0) return "0.";
  const s = String(r);
  if (s.includes("e")) {
    const [m, e] = s.split("e");
    return `${m.includes(".") ? m : `${m}.`}E${e}`;
  }
  return s.includes(".") ? s : `${s}.`;
}

/** A STEP string literal: quotes doubled, backslash doubled, non-ASCII as \X2\ hex \X0\. */
export function stepStr(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (c >= 32 && c < 127) out += ch;
    else if (c < 0x10000) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    else out += "?";
  }
  return `'${out}'`;
}

class Writer {
  lines: string[] = [];
  n = 0;
  add(body: string): number {
    this.n++;
    this.lines.push(`#${this.n}=${body};`);
    return this.n;
  }
}

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const v = m ? parseInt(m[1], 16) : 0x808080;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

function brepKey(s: Solid): string {
  const h = createHash("sha1");
  const b = s.brep;
  h.update(`${b.vertices.length}/${b.edges.length}/${b.faces.length}/${s.palette.join(",")}|`);
  for (const v of b.vertices) h.update(`${v[0].toFixed(6)},${v[1].toFixed(6)},${v[2].toFixed(6)};`);
  for (const f of b.faces) h.update(`${f.color}:${f.loops.map((l) => l.edges.map((e) => `${e.e}${e.fwd ? "+" : "-"}`).join(",")).join("|")};`);
  return h.digest("hex");
}

export function writeStep(scene: Board3d, options: StepOptions = {}): StepResult {
  const w = new Writer();
  const ts = options.timestamp ?? new Date().toISOString().slice(0, 19);
  const fileName = options.fileName ?? `${scene.name}.step`;
  // contexts and units
  const appCtx = w.add(`APPLICATION_CONTEXT('automotive design')`);
  w.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appCtx})`);
  const prodCtx = w.add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const pdCtx = w.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);
  const lenU = w.add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
  const angU = w.add(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`);
  const solU = w.add(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
  const unc = w.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${lenU},'distance_accuracy_value','confusion accuracy')`);
  const ctx = w.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenU},#${angU},#${solU}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);

  const pt = (p: Vec3) => w.add(`CARTESIAN_POINT('',(${stepNum(p[0])},${stepNum(p[1])},${stepNum(p[2])}))`);
  const dir = (d: Vec3) => w.add(`DIRECTION('',(${stepNum(d[0])},${stepNum(d[1])},${stepNum(d[2])}))`);
  const axis = (o: Vec3, z: Vec3, x: Vec3) => w.add(`AXIS2_PLACEMENT_3D('',#${pt(o)},#${dir(z)},#${dir(x)})`);

  // styles, one presentation style per color
  const styleOf = new Map<string, number>();
  const style = (color: string): number => {
    let s = styleOf.get(color);
    if (s === undefined) {
      const [r, g, b] = hex(color);
      const c = w.add(`COLOUR_RGB('',${stepNum(Math.round(r * 1e4) / 1e4)},${stepNum(Math.round(g * 1e4) / 1e4)},${stepNum(Math.round(b * 1e4) / 1e4)})`);
      const fc = w.add(`FILL_AREA_STYLE_COLOUR('',#${c})`);
      const fs = w.add(`FILL_AREA_STYLE('',(#${fc}))`);
      const sf = w.add(`SURFACE_STYLE_FILL_AREA(#${fs})`);
      const ss = w.add(`SURFACE_SIDE_STYLE('',(#${sf}))`);
      const su = w.add(`SURFACE_STYLE_USAGE(.BOTH.,#${ss})`);
      s = w.add(`PRESENTATION_STYLE_ASSIGNMENT((#${su}))`);
      styleOf.set(color, s);
    }
    return s;
  };
  const styled: number[] = [];

  /** Write a solid's B-rep; returns the MANIFOLD_SOLID_BREP id. */
  const writeBrep = (b: Brep, name: string, palette: string[]): number => {
    const vp = b.vertices.map((v) => w.add(`VERTEX_POINT('',#${pt(v)})`));
    const ec = b.edges.map((e) => {
      let curve: number;
      if (e.curve.kind === "line") {
        const a = b.vertices[e.a];
        const c = b.vertices[e.b];
        const d: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        const vec = w.add(`VECTOR('',#${dir([d[0] / l, d[1] / l, d[2] / l])},${stepNum(l)})`);
        curve = w.add(`LINE('',#${pt(a)},#${vec})`);
      } else {
        curve = w.add(`CIRCLE('',#${axis(e.curve.center, e.curve.axis, e.curve.ref)},${stepNum(e.curve.radius)})`);
      }
      return w.add(`EDGE_CURVE('',#${vp[e.a]},#${vp[e.b]},#${curve},${e.sense ? ".T." : ".F."})`);
    });
    const faces: number[] = [];
    const faceColors: [number, number][] = [];
    for (const f of b.faces) {
      const bounds = f.loops.map((l) => {
        const oes = l.edges.map((u) => w.add(`ORIENTED_EDGE('',*,*,#${ec[u.e]},${u.fwd ? ".T." : ".F."})`));
        const loop = w.add(`EDGE_LOOP('',(${oes.map((o) => `#${o}`).join(",")}))`);
        return w.add(`${l.outer ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',#${loop},.T.)`);
      });
      const s = f.surface;
      const surf = s.kind === "plane" ? w.add(`PLANE('',#${axis(s.origin, s.normal, s.ref)})`) : w.add(`CYLINDRICAL_SURFACE('',#${axis(s.origin, s.axis, s.ref)},${stepNum(s.radius)})`);
      const face = w.add(`ADVANCED_FACE('',(${bounds.map((x) => `#${x}`).join(",")}),#${surf},${f.sense ? ".T." : ".F."})`);
      faces.push(face);
      if (f.color !== 0) faceColors.push([face, f.color]);
    }
    const shell = w.add(`CLOSED_SHELL('',(${faces.map((x) => `#${x}`).join(",")}))`);
    const solid = w.add(`MANIFOLD_SOLID_BREP(${stepStr(name)},#${shell})`);
    styled.push(w.add(`STYLED_ITEM('color',(#${style(palette[0])}),#${solid})`));
    for (const [face, c] of faceColors) styled.push(w.add(`STYLED_ITEM('color',(#${style(palette[c] ?? palette[0])}),#${face})`));
    return solid;
  };

  const products: number[] = [];
  const product = (id: string, name: string, description: string) => {
    const p = w.add(`PRODUCT(${stepStr(id)},${stepStr(name)},${stepStr(description)},(#${prodCtx}))`);
    products.push(p);
    const pdf = w.add(`PRODUCT_DEFINITION_FORMATION('','',#${p})`);
    const pd = w.add(`PRODUCT_DEFINITION('design','',#${pdf},#${pdCtx})`);
    const pds = w.add(`PRODUCT_DEFINITION_SHAPE('','',#${pd})`);
    return { pd, pds };
  };

  // the assembly root
  const root = product(scene.name, scene.name, `board assembly, ${scene.tier} tier`);
  const rootOrigin = axis([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const rootItems: number[] = [rootOrigin];
  const links: { child: { pd: number; rep: number; origin: number }; occId: string; occName: string; placement: Affine }[] = [];

  const shared = options.instances === "shared";
  const protoByKey = new Map<string, { pd: number; rep: number; origin: number }>();
  const all = sceneSolids(scene);
  // render layers: one product per layer with all its solids
  const groups: { key: string; name: string; id: string; description: string; members: NamedSolid[]; placement: Affine; protoName: string }[] = [];
  const layerGroups = new Map<string, NamedSolid[]>();
  for (const s of all) {
    if (s.group === "layer") {
      const list = layerGroups.get(s.name) ?? [];
      list.push(s);
      layerGroups.set(s.name, list);
      continue;
    }
    const c = s.component;
    const description = c ? `${c.footprint}; body: ${c.body.source} (${c.body.detail})` : s.group === "board" ? `board ${scene.board.thicknessMm} mm` : "keep-out envelope";
    groups.push({ key: s.id, name: s.name, id: c?.ref ?? s.id, description, members: [s], placement: s.transform, protoName: c ? `${c.footprint}${c.value ? ` ${c.value}` : ""}` : s.name });
  }
  for (const [name, members] of layerGroups) groups.push({ key: `layer:${name}`, name, id: name, description: "render layer (thin bodies)", members, placement: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], protoName: name });

  let solidInstances = 0;
  let solidEntities = 0;
  for (const g of groups) {
    const solidsHere = g.members.length;
    solidInstances += solidsHere;
    const k = shared && g.members.length === 1 && g.members[0].group === "component" ? brepKey(g.members[0].solid) : undefined;
    let proto = k ? protoByKey.get(k) : undefined;
    if (!proto) {
      const p = product(shared && k ? g.protoName : g.id, shared && k ? g.protoName : g.name, g.description);
      const origin = axis([0, 0, 0], [0, 0, 1], [1, 0, 0]);
      const items = g.members.map((m) => writeBrep(m.solid.brep, g.members.length === 1 ? g.name : `${g.name} ${m.id.split(":").pop()}`, m.solid.palette));
      solidEntities += items.length;
      const rep = w.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${[...items, origin].map((x) => `#${x}`).join(",")}),#${ctx})`);
      w.add(`SHAPE_DEFINITION_REPRESENTATION(#${p.pds},#${rep})`);
      proto = { pd: p.pd, rep, origin };
      if (k) protoByKey.set(k, proto);
    }
    links.push({ child: proto, occId: g.id, occName: g.name, placement: g.placement });
  }
  const placed = links.map((l) => {
    const m = l.placement;
    const place = axis([m[3], m[7], m[11]], [m[2], m[6], m[10]], [m[0], m[4], m[8]]);
    rootItems.push(place);
    const nauo = w.add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE(${stepStr(l.occId)},${stepStr(l.occName)},'',#${root.pd},#${l.child.pd},$)`);
    const pdsN = w.add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
    const idt = w.add(`ITEM_DEFINED_TRANSFORMATION('','',#${l.child.origin},#${place})`);
    return { rep: l.child.rep, idt, pdsN };
  });
  const rootRep = w.add(`SHAPE_REPRESENTATION('',(${rootItems.map((x) => `#${x}`).join(",")}),#${ctx})`);
  w.add(`SHAPE_DEFINITION_REPRESENTATION(#${root.pds},#${rootRep})`);
  for (const l of placed) {
    const rr = w.add(`(REPRESENTATION_RELATIONSHIP('','',#${l.rep},#${rootRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${l.idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
    w.add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${rr},#${l.pdsN})`);
  }
  w.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${products.map((p) => `#${p}`).join(",")}))`);
  if (styled.length) w.add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.map((s) => `#${s}`).join(",")}),#${ctx})`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION((${stepStr(`${scene.name} board model, ${scene.tier} tier`)}),'2;1');`,
    `FILE_NAME(${stepStr(fileName)},${stepStr(ts)},(''),(''),'Protoboard board-3d','Protoboard board-3d','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
  ];
  const text = `${header.join("\n")}\n${w.lines.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
  return { text, solids: solidInstances, solidEntities, products: products.length, entities: w.n };
}
