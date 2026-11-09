/**
 * Test helper: the 3D model references a KiCad board's footprints carry (`(model "<path>" (offset (xyz ..)) (scale
 * (xyz ..)) (rotate (xyz ..)))`), by reference designator, read from the published file format. The board document
 * does not keep them (the importer reports them as dropped), so the local real-board test reads them here to try
 * supplied models. Path variables: KIPRJMOD is the board's folder; KICAD<n>_3DMODEL_DIR is KiCad's own library.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelRef } from "../src/index.js";

export interface KicadModel {
  ref: string;
  path: string;
  offset: [number, number, number];
  scale: [number, number, number];
  rotate: [number, number, number];
  hidden: boolean;
}

/** Find the matching close paren of the list opening at `i`. */
function close(text: string, i: number): number {
  let depth = 0;
  let inStr = false;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (c === "\\") k++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return k;
  }
  return text.length - 1;
}

const xyz = (block: string, key: string): [number, number, number] => {
  const m = new RegExp(`\\(${key}\\s*\\(xyz\\s+([^\\s)]+)\\s+([^\\s)]+)\\s+([^\\s)]+)\\s*\\)`).exec(block);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : key === "scale" ? [1, 1, 1] : [0, 0, 0];
};

export function kicadModels(pcbPath: string): KicadModel[] {
  const text = readFileSync(pcbPath, "utf8");
  const out: KicadModel[] = [];
  for (const m of text.matchAll(/\(footprint\s+"/g)) {
    const start = m.index!;
    const block = text.slice(start, close(text, start) + 1);
    const ref = /\(property\s+"Reference"\s+"([^"]*)"/.exec(block)?.[1] ?? /\(fp_text\s+reference\s+"?([^"\s)]+)/.exec(block)?.[1];
    if (!ref) continue;
    for (const mm of block.matchAll(/\(model\s+"([^"]+)"/g)) {
      const mb = block.slice(mm.index!, close(block, mm.index!) + 1);
      out.push({ ref, path: mm[1], offset: xyz(mb, "offset"), scale: xyz(mb, "scale"), rotate: xyz(mb, "rotate"), hidden: /\(hide\s+yes\)|\(hide\)/.test(mb) });
    }
  }
  return out;
}

/** KiCad's own model library folder, when installed. */
export function kicadModelDir(): string | undefined {
  for (const v of ["10.0", "9.0"]) {
    const d = join(process.env.ProgramFiles ?? "C:\\Program Files", "KiCad", v, "share", "kicad", "3dmodels");
    if (existsSync(d)) return d;
  }
  for (const d of ["/usr/share/kicad/3dmodels", "/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels"]) if (existsSync(d)) return d;
  return undefined;
}

/**
 * A resolver for board-3d: STEP models only (a `.wrl` reference is tried as `.step` beside it, as KiCad's library ships
 * both). KiCad states rotations in degrees about X, Y, Z of the model; the placement convention is checked, not
 * assumed, by the seating check on the result.
 */
export function kicadResolver(pcbPath: string, refs: KicadModel[]): (fp: { ref: string }) => ModelRef | undefined {
  const lib = kicadModelDir();
  const byRef = new Map<string, KicadModel>();
  for (const r of refs) if (!r.hidden && !byRef.has(r.ref)) byRef.set(r.ref, r);
  return (fp) => {
    const r = byRef.get(fp.ref);
    if (!r) return undefined;
    let p = r.path.replace(/\$\{KIPRJMOD\}/g, dirname(pcbPath));
    if (lib) p = p.replace(/\$\{KICAD\d*_3DMODEL_DIR\}/g, lib);
    if (/\.wrl$/i.test(p)) p = p.replace(/\.wrl$/i, ".step");
    if (!/\.(step|stp)$/i.test(p) || /\$\{/.test(p) || !existsSync(p)) return undefined;
    return { path: p, offset: r.offset, rotate: r.rotate, scale: r.scale, source: "KiCad footprint model", terms: "unknown" };
  };
}
