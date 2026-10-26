/**
 * Contributions to the Manufacturing Package (@protoboardai/ext-release section
 * contract): each unit's spec sheet gets what is made for it (boards, parts,
 * cables, from the providers' standard outputs, with figures), and its
 * assembly guide the illustrated steps of the links the unit makes.
 * `protoboard release` calls these once per unit.
 */
export { spec } from "../lib/package/spec.ts";
export { assembly } from "../lib/package/assembly.ts";
