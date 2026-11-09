/** Deterministic ids for generated and imported objects (contract section 3). */
import { canonical, sha1Hex } from "./canonical.js";

/**
 * `<prefix>:g.<hash>`: the first 12 hex digits of SHA-1 over the canonical JSON of the identity fields (net, layer,
 * geometry). Regenerating identical copper gives identical ids.
 */
export function deterministicKey(prefix: string, fields: Record<string, unknown>, tag = "g"): string {
  if (!/^[a-z]+$/.test(prefix)) throw new Error(`id prefix ${prefix} is not lowercase letters`);
  if (!/^[a-z0-9]+$/.test(tag)) throw new Error(`key tag ${tag} is not lowercase letters and digits`);
  return `${prefix}:${tag}.${sha1Hex(canonical(fields)).slice(0, 12)}`;
}
