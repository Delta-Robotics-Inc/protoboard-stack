/**
 * Free-text lint for part verification (PB-862): the prose a part carries
 * (descriptions, trait notes, discrepancies, gaps, CAD manifest notes) must
 * describe this part. Two mistakes the PB-865 pilot audits found:
 *
 *   - vendor-CAD wording on a part whose geometry the library generated and
 *     for which no manufacturer model exists ("mounting holes from the
 *     Adafruit STEP" when Adafruit publishes no STEP for it);
 *   - generator references that belong to another part: a CAD generator's
 *     default reference (a resistor data sheet on a diode body), or a
 *     reference borrowed from another library part with no assumption trait
 *     saying so.
 *
 * Both are warnings: the auditor reads each one and either fixes the text or
 * accepts it.
 */
import type { ArtifactDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";

export interface LintFinding {
  level: "warning";
  message: string;
}

interface Manifestish {
  generator?: { function?: string; references?: unknown[] };
  assumptions?: unknown[];
}

/** Every string in a value, with where it is. */
function strings(v: unknown, at: string, out: { at: string; text: string }[] = []): { at: string; text: string }[] {
  if (typeof v === "string") out.push({ at, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${at}[${i}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) strings(x, `${at}.${k}`, out);
  return out;
}

/** The part's prose: description, trait params (data gaps excepted: they describe what is missing), interface names, artifact descriptions. */
export function freeText(def: ModuleDef): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  if (def.description) out.push({ at: "description", text: def.description });
  const traits = (where: string, ts?: TraitDef[]) =>
    (ts ?? []).forEach((t, i) => {
      if (t.type !== "data_gap") strings(t.params, `${where}.traits[${i}](${t.type})`, out);
    });
  traits("module", def.traits);
  for (const i of def.interfaces) {
    if (i.name) out.push({ at: `interface ${i.id}.name`, text: i.name });
    traits(`interface ${i.id}`, i.traits);
  }
  for (const a of def.artifacts ?? []) if (a.description) out.push({ at: `artifact ${a.id}.description`, text: a.description });
  return out;
}

const NEGATION = /\b(no|not|none|without|n\/a|never|absent|missing|lacks?|unavailable|isn't|doesn't|does not|did not|instead of|rather than|kept internal|is not bound)\b/i;
const STANDARD = /^\s*(JEDEC|ISO|DIN|ASME|IEC|ANSI|EIA|IPC|SAE|JIS|EN|BS|NEMA|MIL)\b/;
const HOST_NOISE = new Set(["www", "cdn", "com", "org", "net", "io", "co", "uk", "de", "tw", "cn", "jp", "docs", "content", "files", "file", "shop", "store", "media", "assets", "static", "github", "raw", "githubusercontent", "s3", "amazonaws", "learn", "wiki", "api", "en", "us", "download", "downloads"]);

const sentences = (t: string) => t.split(/(?<=[.;!?])\s+|\n+/).filter((s) => s.trim());
const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? []);

/** Whether the part carries a manufacturer model (a vendor source, or a cad row in sources.json). */
export function hasVendorCad(def: ModuleDef, sourceRows: Array<Record<string, unknown>>): boolean {
  const arts = def.artifacts ?? [];
  return (
    sourceRows.some((r) => r.type === "cad") ||
    arts.some((a: ArtifactDef) => (a.type === "3d_model" && a.role === "source") || a.provenance?.tool === "manufacturer")
  );
}

/** Words that name this part or its publishers: id parts, manufacturer, part number, source hosts and titles. */
export function identityTokens(def: ModuleDef, sourceRows: Array<Record<string, unknown>>): Set<string> {
  const tokens = new Set<string>();
  const add = (w: string) => {
    const x = w.toLowerCase();
    if (x.length >= 2 && !HOST_NOISE.has(x)) tokens.add(x);
  };
  def.id.split("-").forEach(add);
  for (const w of words(def.manufacturer ?? "")) add(w);
  for (const w of words(def.part_number ?? "")) add(w);
  // the components the part carries (a JST SH socket's catalogue is this part's reference too)
  for (const x of [def, ...def.interfaces]) for (const t of x.traits ?? []) if (t.type === "connector") for (const { text } of strings(t.params, "")) for (const w of words(text)) add(w);
  for (const r of sourceRows) {
    try {
      new URL(String(r.url)).hostname.split(".").forEach(add);
    } catch {
      // not a URL
    }
    const first = String(r.title ?? "").match(/[A-Za-z0-9]+/)?.[0];
    if (first) add(first);
  }
  return tokens;
}

export function lintFreeText(
  def: ModuleDef,
  sourceRows: Array<Record<string, unknown>>,
  manifests: { artifact: string; manifest: Manifestish }[],
): LintFinding[] {
  const out: LintFinding[] = [];
  const warn = (message: string) => out.push({ level: "warning", message });
  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 137)}…` : s);

  // 1. vendor-CAD wording where the library generated the geometry and no manufacturer model exists
  if (!hasVendorCad(def, sourceRows)) {
    const maker = (def.manufacturer ?? "").match(/[A-Za-z][A-Za-z0-9]+/)?.[0];
    const who = ["vendor", "manufacturer", ...(maker && maker.length > 2 ? [maker] : [])].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const claim = new RegExp(`\\b(${who})(?:'s)?\\s+(STEP|CAD|3D model|CAD model|GLB|STL|model file)\\b`, "i");
    const texts = [...freeText(def), ...manifests.flatMap((m) => strings(m.manifest.assumptions, `${m.artifact} manifest assumptions`))];
    for (const { at, text } of texts) {
      for (const s of sentences(text)) {
        const m = claim.exec(s);
        if (m && !NEGATION.test(s)) warn(`${at}: says "${m[0]}", but the part has no manufacturer CAD (its geometry is generated): "${clip(s.trim())}"`);
      }
    }
  }

  // 2. generator references that are not this part's
  const tokens = identityTokens(def, sourceRows);
  const assumptionText = JSON.stringify([def, ...def.interfaces].flatMap((x) => (x.traits ?? []).filter((t) => t.type === "assumption")));
  for (const { artifact, manifest } of manifests) {
    for (const ref of manifest.generator?.references ?? []) {
      if (typeof ref !== "string") continue;
      const borrowed = /\(library part ([a-z0-9-]+)\)/.exec(ref)?.[1];
      if (borrowed && borrowed !== def.id) {
        if (!assumptionText.includes(borrowed)) warn(`${artifact} manifest: generator reference comes from library part ${borrowed} ("${clip(ref)}"); pass this part's own reference to the generator, or add an assumption trait that names ${borrowed} and says why its drawing applies`);
        continue;
      }
      if (STANDARD.test(ref)) continue;
      const refWords = words(ref);
      const pn = (def.part_number ?? "").toLowerCase();
      if (![...tokens].some((t) => refWords.has(t)) && !(pn.length >= 4 && ref.toLowerCase().includes(pn))) {
        warn(`${artifact} manifest: generator reference names nothing of this part (${def.manufacturer ?? "?"} ${def.part_number ?? ""}) or its sources: "${clip(ref)}" (a generator default? pass references= with this part's drawing)`);
      }
    }
  }
  return out;
}
