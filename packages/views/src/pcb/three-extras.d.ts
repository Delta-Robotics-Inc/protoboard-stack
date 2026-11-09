// three ships no types (see ../parts/three.d.ts); the renderer also uses its earcut port.
declare module "three/src/extras/Earcut.js" {
  export const Earcut: { triangulate(data: number[], holeIndices?: number[], dim?: number): number[] };
}
