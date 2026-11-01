/**
 * Reading mates (PB-1185): the `protoboard.mate` trait, the
 * `<model>.mates.json` sidecar, and the merge rule.
 *
 * The trait (zero UHD schema change: `TraitDef.params` is open). UHD puts
 * traits on definitions and interfaces, not on a `ChildModuleRef` or an
 * `InterfaceLink` (uhd `src/types/module.ts`), so a mate between two
 * instances, or one that qualifies a link, is a trait on the definition that
 * declares them and names them:
 *
 *   { type: "protoboard.mate", params: {
 *       id: "lid_hinge", kind: "revolute",
 *       a: { instance: "base", interface: "hinge" },          // frame from the interface's geometry frame
 *       b: { instance: "lid", frame: { origin: [0, 40, 12], zAxis: [1, 0, 0] } },   // or a frame, mm, Z up
 *       limits: [{ dof: "rotate", min: 0, max: 110, rest: 0, unit: "deg", source: "hinge datasheet p. 2" }] } }
 *   { type: "protoboard.mate", params: { link: "arm_fl/prop_on_shaft", kind: "revolute" } }   // a link's mate
 *
 * Instance paths are relative to the declaring definition ("." is that
 * instance itself); the reader prefixes them with every instance path of the
 * definition, as assemble() prefixes link ids. On an interface the trait is
 * the part's own hint for any link that mates it: `{ kind, limits?, frame? }`.
 *
 * The sidecar sits next to the model it describes (`X.step` or `X.glb` ->
 * `X.mates.json`) and is bound to one of them by sha256: a sidecar whose
 * hash does not match the file on disk is reported stale and ignored.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Assembly, GeometryFrame, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { fileDigest, readJsonCapped } from "../part-files.js";
import { finite3, gltfFrameToUhd } from "./frames.js";
import { MATES_SCHEMA, MATE_KINDS, MATE_TRAIT, type InterfaceMateHint, type Mate, type MateEnd, type MateFrame, type MateKind, type MateLimit, type MateProblem, type MateProvenance, type MateSet, type MateSource, type MatesSidecar } from "./types.js";

/** DEFAULT: the largest mates sidecar read (a few hundred mates fit in far less). */
export const MAX_SIDECAR_BYTES = 1024 * 1024;

export interface MateContext {
  /** Every instance: path and definition id. */
  instances: readonly { path: string; definition: string }[];
  lookup: (id: string) => ModuleDef | undefined;
  /** assemble()'s output: links and interface hints need it (mate frames and which end moves). */
  asm?: Assembly;
}

const joinPath = (prefix: string, rel: string) => (rel === "." || rel === "" ? prefix : prefix ? `${prefix}/${rel}` : rel);
const SOURCE_RANK: Record<MateSource, number> = { trait: 3, sidecar: 2, inferred: 1 };

/** A UHD geometry frame as a mate frame (same units and axes: mm, Z up; normal becomes z). */
export const frameOfGeometry = (f: GeometryFrame): MateFrame => ({ origin: [...f.origin] as MateFrame["origin"], zAxis: [...f.normal] as MateFrame["zAxis"], ...(f.xAxis ? { xAxis: [...f.xAxis] as MateFrame["xAxis"] } : {}) });

function asFrame(x: unknown): MateFrame | undefined {
  const f = x as Partial<MateFrame> | undefined;
  if (!f || !finite3(f.origin) || !finite3(f.zAxis)) return undefined;
  if (f.xAxis !== undefined && !finite3(f.xAxis)) return undefined;
  return { origin: f.origin, zAxis: f.zAxis, ...(f.xAxis ? { xAxis: f.xAxis } : {}) };
}

const asKind = (x: unknown): MateKind | undefined => (MATE_KINDS as readonly string[]).includes(x as string) ? (x as MateKind) : undefined;
const asLimits = (x: unknown): MateLimit[] | undefined => (Array.isArray(x) ? (x as MateLimit[]) : undefined);

/** The mover of a link (the end assemble() placed through it) and the other end. */
function linkEnds(asm: Assembly, linkId: string): { a: MateEnd; b: MateEnd } | undefined {
  const m = asm.mates.find((x) => x.linkId === linkId);
  if (!m) return undefined;
  const key = (e: typeof m.a) => e.path.join("/") + (e.frame.artifact ? `#${e.frame.artifact}` : "");
  const moverIsA = asm.placements.some((p) => p.via === linkId && p.key === key(m.a));
  const [fixed, mover] = moverIsA ? [m.b, m.a] : [m.a, m.b];
  const end = (e: typeof m.a): MateEnd => ({ instance: e.path.join("/"), ...(e.frame.artifact ? { body: e.frame.artifact } : {}), interface: e.iface.id, frame: frameOfGeometry(e.frame) });
  return { a: end(fixed), b: end(mover) };
}

/** An interface's geometry frame on an instance's definition. */
function interfaceFrame(ctx: MateContext, instance: string, iface: string): MateFrame | undefined {
  const inst = ctx.instances.find((i) => i.path === instance);
  const def = inst && ctx.lookup(inst.definition);
  const f = def?.interfaces.find((i) => i.id === iface)?.geometry?.frame;
  return f ? frameOfGeometry(f) : undefined;
}

/** Mates the project's UHD declares through `protoboard.mate` traits (module traits first, then interface hints). */
export function traitMates(ctx: MateContext): { mates: Mate[]; problems: MateProblem[] } {
  const mates: Mate[] = [];
  const problems: MateProblem[] = [];
  const ids = new Set<string>();
  for (const inst of ctx.instances) {
    const def = ctx.lookup(inst.definition);
    (def?.traits ?? []).forEach((t: TraitDef, k) => {
      if (t.type !== MATE_TRAIT) return;
      const p = (t.params ?? {}) as Record<string, unknown>;
      const origin = `${def!.id}#traits[${k}]`;
      const kind = asKind(p.kind);
      const where = inst.path ? ` (on instance "${inst.path}")` : "";
      if (!kind) {
        problems.push({ code: "MATE_KIND_UNKNOWN", severity: "error", message: `${origin}${where}: kind "${String(p.kind)}" is not one of ${MATE_KINDS.join(", ")}`, file: origin });
        return;
      }
      const link = typeof p.link === "string" ? joinPath(inst.path, p.link) : undefined;
      let ends: { a: MateEnd; b: MateEnd } | undefined;
      const endOf = (x: unknown, side: "a" | "b"): MateEnd | undefined => {
        const e = x as { instance?: string; interface?: string; body?: string; frame?: unknown } | undefined;
        if (!e || typeof e.instance !== "string") return undefined;
        const instance = joinPath(inst.path, e.instance);
        const frame = e.frame !== undefined ? asFrame(e.frame) : e.interface ? interfaceFrame(ctx, instance, e.interface) : undefined;
        if (!frame) {
          problems.push({ code: "MATE_FRAME_MISSING", severity: "error", message: `${origin}${where}: end ${side} (${instance}) has no usable frame: give \`frame\` {origin, zAxis, xAxis?} in mm, Z up, or an \`interface\` with a geometry frame`, file: origin });
          return undefined;
        }
        return { instance, ...(e.body ? { body: e.body } : {}), ...(e.interface ? { interface: e.interface } : {}), frame };
      };
      if (p.a !== undefined || p.b !== undefined) {
        const a = endOf(p.a, "a");
        const b = endOf(p.b, "b");
        if (!a || !b) {
          if (!(p.a && p.b)) problems.push({ code: "MATE_END_MISSING", severity: "error", message: `${origin}${where}: a mate names two ends, \`a\` and \`b\` (or only a \`link\`)`, file: origin });
          return;
        }
        ends = { a, b };
      } else if (link) {
        ends = ctx.asm ? linkEnds(ctx.asm, link) : undefined;
        if (!ends) {
          problems.push({ code: "MATE_LINK_UNKNOWN", severity: "warning", message: `${origin}${where}: no mated link "${link}" in the assembly (a link both of whose interfaces have geometry frames)`, file: origin });
          return;
        }
      } else {
        problems.push({ code: "MATE_END_MISSING", severity: "error", message: `${origin}${where}: a mate names two ends, \`a\` and \`b\`, or a \`link\``, file: origin });
        return;
      }
      const id = typeof p.id === "string" ? joinPath(inst.path, p.id) : link ? `link:${link}` : joinPath(inst.path, `mate${k}`);
      if (ids.has(id)) problems.push({ code: "MATE_DUPLICATE_ID", severity: "warning", message: `${origin}${where}: a second mate "${id}"; the first is kept`, mate: id, file: origin });
      if (ids.has(id)) return;
      ids.add(id);
      mates.push({
        id,
        kind,
        ...ends,
        ...(link ? { link } : {}),
        ...(asLimits(p.limits) ? { limits: asLimits(p.limits) } : {}),
        provenance: (p.provenance as MateProvenance) ?? "declared",
        ...(typeof p.confidence === "number" ? { confidence: p.confidence } : {}),
        ...(Array.isArray(p.evidence) ? { evidence: p.evidence as Mate["evidence"] } : {}),
        ...(p.suppressed === true ? { suppressed: true } : {}),
        ...(typeof p.note === "string" ? { note: p.note } : {}),
        from: "trait",
        origin,
      });
    });
  }
  // interface hints: a part's own joint hint for every link that mates the interface
  for (const m of ctx.asm?.mates ?? []) {
    const id = `link:${m.linkId}`;
    if (ids.has(id)) continue;
    for (const end of [m.a, m.b]) {
      const t = end.iface.traits?.find((x) => x.type === MATE_TRAIT);
      if (!t) continue;
      const hint = (t.params ?? {}) as unknown as InterfaceMateHint;
      const origin = `${end.def.id}#interfaces.${end.iface.id}`;
      const kind = asKind(hint.kind);
      if (!kind) {
        problems.push({ code: "MATE_KIND_UNKNOWN", severity: "error", message: `${origin}: kind "${String(hint.kind)}" is not one of ${MATE_KINDS.join(", ")}`, file: origin });
        break;
      }
      const ends = linkEnds(ctx.asm!, m.linkId)!;
      const hinted = hint.frame ? asFrame(hint.frame) : undefined;
      if (hinted) {
        if (ends.a.instance === end.path.join("/") && ends.a.interface === end.iface.id) ends.a.frame = hinted;
        else ends.b.frame = hinted;
      }
      ids.add(id);
      mates.push({ id, kind, ...ends, link: m.linkId, ...(asLimits(hint.limits) ? { limits: asLimits(hint.limits) } : {}), provenance: hint.provenance ?? "declared", ...(hint.evidence ? { evidence: hint.evidence } : {}), ...(hint.note ? { note: hint.note } : {}), from: "trait", origin });
      break;
    }
  }
  return { mates, problems };
}

/** `X.step` / `X.glb` -> `X.mates.json` beside it. */
export const matesSidecarPath = (model: string) => join(dirname(model), `${basename(model).replace(/\.[^.]+$/, "")}.mates.json`);

const bareHex = (s: string) => s.replace(/^sha256:/i, "").toLowerCase();

/**
 * One sidecar, checked: schema, the target is a file in the same folder (no
 * path: containment), its sha256 matches the bytes on disk (else STALE and
 * nothing is used), and its size is under the cap. Mates come back with
 * instance paths relative to the owner (expanded by `sidecarMates`).
 */
export function readMatesSidecar(file: string, root?: string): { sidecar?: MatesSidecar; target?: string; problems: MateProblem[] } {
  const problems: MateProblem[] = [];
  const rel = root && file.startsWith(root) ? file.slice(root.length + 1).replace(/\\/g, "/") : file;
  let size = 0;
  try {
    size = statSync(file).size;
  } catch {
    return { problems };
  }
  if (size > MAX_SIDECAR_BYTES) return { problems: [{ code: "MATES_SIDECAR_INVALID", severity: "error", message: `${rel} is ${size} bytes, over the ${MAX_SIDECAR_BYTES}-byte limit (DEFAULT) for a mates sidecar; not read`, file: rel }] };
  let s: MatesSidecar | undefined;
  try {
    s = readJsonCapped<MatesSidecar>(file, MAX_SIDECAR_BYTES);
  } catch (e) {
    return { problems: [{ code: "MATES_SIDECAR_INVALID", severity: "error", message: `${rel}: ${(e as Error).message.split("\n")[0]}`, file: rel }] };
  }
  if (!s || s.schema !== MATES_SCHEMA || !s.target || typeof s.target.file !== "string" || typeof s.target.sha256 !== "string") {
    return { problems: [{ code: "MATES_SIDECAR_INVALID", severity: "error", message: `${rel}: not a ${MATES_SCHEMA} file with \`target.file\` and \`target.sha256\``, file: rel }] };
  }
  // containment: the target is a sibling by name only, never a path out of the folder
  const name = s.target.file;
  if (!name || name !== basename(name) || /[\\/]/.test(name) || name === "." || name === ".." || /[<>:"|?*]/.test(name)) {
    return { problems: [{ code: "MATES_SIDECAR_TARGET", severity: "error", message: `${rel}: target.file must be the model's file name in the same folder, not "${name}"`, file: rel }] };
  }
  const target = join(dirname(file), name);
  if (!existsSync(target)) return { problems: [{ code: "MATES_SIDECAR_TARGET", severity: "error", message: `${rel}: target "${name}" is not in its folder`, file: rel }] };
  try {
    if (dirname(realpathSync(target)) !== dirname(realpathSync(file))) return { problems: [{ code: "MATES_SIDECAR_TARGET", severity: "error", message: `${rel}: target "${name}" resolves outside its folder (a link)`, file: rel }] };
  } catch {
    // realpath failed: treated as missing above
  }
  const digest = fileDigest(target, root);
  if (!digest || bareHex(digest.sha256) !== bareHex(s.target.sha256)) {
    problems.push({ code: "MATES_SIDECAR_STALE", severity: "warning", message: `${rel} is bound to ${name} sha256 ${bareHex(s.target.sha256).slice(0, 12)}…, but the file on disk is ${digest ? bareHex(digest.sha256).slice(0, 12) + "…" : "unreadable"}: the model changed since its mates were measured; the sidecar is ignored until it is re-measured`, file: rel });
    return { problems, target };
  }
  return { sidecar: s, target, problems };
}

/** A sidecar's mates and hints for one owner instance (frames to mm, Z up at the boundary when the sidecar says glTF space). */
export function sidecarMates(s: MatesSidecar, owner: string, origin: string, asm?: Assembly): { mates: Mate[]; problems: MateProblem[] } {
  const problems: MateProblem[] = [];
  const gltf = s.target.units === "m" || s.target.upAxis === "+Y";
  // the boundary: frames measured in glTF space (m, Y up) become UHD (mm, Z up) here and nowhere else
  const conv = (f: MateFrame) => (gltf ? gltfFrameToUhd(f) : f);
  const mates: Mate[] = [];
  for (const [k, m] of (s.mates ?? []).entries()) {
    const fa = asFrame(m?.a?.frame);
    const fb = asFrame(m?.b?.frame);
    if (!m || typeof m.id !== "string" || !asKind(m.kind) || typeof m.a?.instance !== "string" || typeof m.b?.instance !== "string" || !fa || !fb) {
      problems.push({ code: "MATES_SIDECAR_INVALID", severity: "error", message: `${origin}: mates[${k}] needs id, a kind (${MATE_KINDS.join(", ")}) and two ends with an instance and a frame`, file: origin });
      continue;
    }
    mates.push({
      ...m,
      id: joinPath(owner, m.id),
      a: { ...m.a, instance: joinPath(owner, m.a.instance), frame: conv(fa) },
      b: { ...m.b, instance: joinPath(owner, m.b.instance), frame: conv(fb) },
      provenance: m.provenance ?? "measured",
      from: "sidecar",
      origin,
    });
  }
  for (const [iface, hint] of Object.entries(s.interfaces ?? {})) {
    if (!asKind(hint?.kind)) {
      problems.push({ code: "MATES_SIDECAR_INVALID", severity: "error", message: `${origin}: interfaces.${iface} kind "${String(hint?.kind)}" is not one of ${MATE_KINDS.join(", ")}`, file: origin });
      continue;
    }
    for (const e of asm?.mates ?? []) {
      const end = [e.a, e.b].find((x) => x.path.join("/") === owner && x.iface.id === iface);
      if (!end) continue;
      const ends = linkEnds(asm!, e.linkId)!;
      const hinted = hint.frame ? asFrame(hint.frame) : undefined;
      if (hinted) {
        if (ends.a.instance === owner && ends.a.interface === iface) ends.a.frame = conv(hinted);
        else ends.b.frame = conv(hinted);
      }
      mates.push({ id: `link:${e.linkId}`, kind: hint.kind, ...ends, link: e.linkId, ...(hint.limits ? { limits: hint.limits } : {}), provenance: hint.provenance ?? "measured", ...(hint.evidence ? { evidence: hint.evidence } : {}), from: "sidecar", origin });
    }
  }
  return { mates, problems };
}

/**
 * The merge rule: trait beats sidecar beats inferred. For one mate id the
 * highest source wins; an inferred mate between two instances that a trait
 * or sidecar mate already joins is dropped. What lost is listed in `shadowed`.
 */
export function mergeMates(...lists: readonly Mate[][]): MateSet {
  const all = lists.flat();
  const rank = (m: Mate) => SOURCE_RANK[m.from ?? (m.provenance === "inferred" ? "inferred" : "trait")];
  const byId = new Map<string, Mate>();
  const shadowed: MateSet["shadowed"] = [];
  for (const m of [...all].sort((x, y) => rank(y) - rank(x))) {
    const have = byId.get(m.id);
    if (have) {
      shadowed.push({ id: m.id, from: m.from ?? "trait", by: have.id, byFrom: have.from ?? "trait" });
      continue;
    }
    byId.set(m.id, m);
  }
  const pair = (m: Mate) => [m.a.instance, m.b.instance].sort().join("~");
  const declaredPairs = new Map<string, Mate>();
  for (const m of byId.values()) {
    if (rank(m) <= 1) continue;
    const have = declaredPairs.get(pair(m));
    if (!have || rank(m) > rank(have)) declaredPairs.set(pair(m), m);
  }
  const mates: Mate[] = [];
  for (const m of byId.values()) {
    const over = rank(m) === 1 ? declaredPairs.get(pair(m)) : undefined;
    if (over) shadowed.push({ id: m.id, from: m.from ?? "inferred", by: over.id, byFrom: over.from ?? "trait" });
    else mates.push(m);
  }
  return { mates, shadowed, problems: [] };
}

/** Is this mate allowed to move or place anything? Inferred ones never are until a person promotes them (DEFAULT). */
export const drives = (m: Mate) => !m.suppressed && m.provenance !== "inferred";
