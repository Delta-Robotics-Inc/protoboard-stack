#!/usr/bin/env node
/**
 * Templates and part revisions (PB-944): which parts of the init templates
 * are pinned behind what a library recommends.
 *
 *   node scripts/templates-parts.mjs [--url <library>] [--all] [--format json] [--timeout <seconds>]
 *   npm run templates:parts -- --url http://localhost:8787
 *
 * A template (packages/core/templates/<id>/template.json) pins the catalog
 * parts of its starting system as `<id>@<revision>`. A template MAY pin older
 * revisions than the library recommends: a project started from it then shows
 * "update available" on those parts, which is correct. Templates are brought
 * up to date regularly (CONTRIBUTING.md § Templates and part revisions; before a
 * release), and this script is the note the release process shows.
 *
 *   --url      the library to ask (default: PROTOBOARD_CLOUD_URL, then the
 *              hosted Protoboard library, HOSTED_CLOUD_URL of
 *              packages/core/src/web-urls.ts)
 *   --all      list every pinned part, not only those that are behind
 *   --format   `json` for a machine-readable result
 *   --timeout  seconds to wait for each answer (default 20)
 *
 * It only reads, and only what the library answers to anyone
 * (`GET /v1/parts/<id>`): no sign-in, no token. So it sees the parts a
 * template names, not the dependencies their revisions bring with them (a
 * revision's own pins, which need a sign-in to read): `protoboard parts list
 * --check` in a project started from the template shows those.
 *
 * It never fails a release: the exit code is 0 whatever it finds, and a
 * library that cannot be reached is one line saying the check was skipped.
 * (Exit 2 is for a mistake in its own arguments only.)
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATES = join(REPO, "packages", "core", "templates");

/** The hosted library's URL, from the one place that defines it. */
export function hostedLibraryUrl(repo = REPO) {
  const m = /export const HOSTED_CLOUD_URL = "([^"]+)"/.exec(readFileSync(join(repo, "packages", "core", "src", "web-urls.ts"), "utf8"));
  if (!m) throw new Error("packages/core/src/web-urls.ts no longer defines HOSTED_CLOUD_URL");
  return m[1];
}

/** Each template's pins: `[{ template, derivedFrom, pins: [{ partId, revision }] }]`. */
export function templatePins(dir = TEMPLATES) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, "template.json")))
    .sort()
    .map((d) => {
      const t = JSON.parse(readFileSync(join(dir, d, "template.json"), "utf8"));
      const pins = (t.catalogParts ?? []).map((ref) => {
        const m = /^([a-z0-9-]+)@(\d+)$/.exec(ref);
        if (!m) throw new Error(`template ${d}: catalogParts entry ${JSON.stringify(ref)} is not <id>@<revision>`);
        return { partId: m[1], revision: Number(m[2]) };
      });
      return { template: d, derivedFrom: t.derivedFrom, pins };
    });
}

/**
 * One pin against the library's answer for its part (`GET /v1/parts/<id>`:
 * `{ part: { recommendedRevision?, latestRevision }, revisions: [{ revision, definitionDigest, deprecated? }] }`,
 * or `undefined` when the library has no such part).
 *
 *   current     pinned at the recommended revision
 *   behind      an older revision than the recommended one; `definition` says whether the
 *               part's definition differs ("changed") or is byte-identical ("same": the newer
 *               revision changes files, terms or evidence only, or just renumbers)
 *   ahead       a newer revision than the recommended one (the library recommends an older one)
 *   deprecated  the library recommends no revision of the part
 *   missing     the library has no such part, or not the pinned revision
 */
export function comparePin(pin, answer) {
  if (!answer) return { ...pin, status: "missing", note: "the library has no such part" };
  const { part, revisions = [] } = answer;
  const recommended = part.recommendedRevision;
  const base = { ...pin, ...(recommended !== undefined ? { recommended } : {}), latest: part.latestRevision };
  const row = (n) => revisions.find((r) => r.revision === n);
  const pinned = row(pin.revision);
  if (!pinned) return { ...base, status: "missing", note: `the library has no revision ${pin.revision} of it` };
  const retired = pinned.deprecated ? `v${pin.revision} is deprecated${pinned.deprecated.reason ? `: ${pinned.deprecated.reason}` : ""}` : "";
  if (recommended === undefined) return { ...base, status: "deprecated", note: "every revision is deprecated" };
  if (pin.revision === recommended) return { ...base, status: "current", ...(retired ? { note: retired } : {}) };
  if (pin.revision > recommended) return { ...base, status: "ahead", note: `the library recommends the older v${recommended}` };
  const target = row(recommended);
  const definition = target && pinned.definitionDigest && target.definitionDigest ? (pinned.definitionDigest === target.definitionDigest ? "same" : "changed") : "unknown";
  const what = { same: "same definition (files, terms or numbering only)", changed: "the definition changed", unknown: "" }[definition];
  return { ...base, status: "behind", definition, note: [what, retired].filter(Boolean).join("; ") };
}

/** Ask the library about every part the templates pin. Throws when it cannot be reached at all. */
export async function compareTemplates(url, templates, options = {}) {
  const fetcher = options.fetch ?? fetch;
  const base = url.replace(/\/+$/, "");
  const answers = new Map();
  const ask = async (partId) => {
    const res = await fetcher(`${base}/v1/parts/${encodeURIComponent(partId)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(options.timeoutMs ?? 20000) });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`${base} answered ${res.status} for ${partId}`);
    const body = await res.json();
    if (!body?.part) throw new Error(`${base} did not answer as a parts library for ${partId}`);
    return body;
  };
  // one part first: a library that is down is found before a burst of requests
  const ids = [...new Set(templates.flatMap((t) => t.pins.map((p) => p.partId)))];
  if (ids.length) answers.set(ids[0], await ask(ids[0]));
  await Promise.all(ids.slice(1).map(async (id) => answers.set(id, await ask(id))));
  // a web server that is not a parts library answers 404 to everything
  if (ids.length && ids.every((id) => !answers.get(id))) throw new Error(`${base} has none of the templates' parts: is it a Protoboard parts library?`);
  return templates.map((t) => ({ template: t.template, derivedFrom: t.derivedFrom, parts: t.pins.map((p) => comparePin(p, answers.get(p.partId))) }));
}

function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows.map((r) => `  ${r.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd()}`).join("\n");
}

/** The note as text: a table of what is behind (or of everything, with `all`). */
export function report(url, result, options = {}) {
  const v = (n) => (n === undefined ? "none" : `v${n}`);
  const lines = [];
  const all = result.flatMap((t) => t.parts.map((p) => ({ ...p, template: t.template })));
  const attention = all.filter((p) => p.status !== "current");
  const behind = all.filter((p) => p.status === "behind");
  const shown = options.all ? all : attention;
  lines.push(`templates:parts: ${result.length} template(s), ${all.length} pinned part(s), against ${url}`);
  if (shown.length) {
    lines.push(table([["TEMPLATE", "PART", "PINNED", "RECOMMENDED", "STATUS", "NOTE"], ...shown.map((p) => [p.template, p.partId, v(p.revision), v(p.recommended), p.status, p.note ?? ""])]));
  }
  if (!attention.length) lines.push("  every template pins the revisions the library recommends");
  else {
    const per = result.map((t) => [t.template, t.parts.filter((p) => p.status === "behind").length, t.parts.length]).filter(([, n]) => n);
    if (behind.length) lines.push(`  behind: ${per.map(([id, n, of]) => `${id} ${n} of ${of}`).join(", ")}. A template may pin older revisions; a new project then shows these as updates.`);
    const other = attention.length - behind.length;
    if (other) lines.push(`  ${other} pin(s) need a look for another reason (the STATUS column).`);
    lines.push("  To bring a template up to date: CONTRIBUTING.md, \"Templates and part revisions\".");
  }
  return lines.join("\n");
}

async function main() {
  let values;
  try {
    ({ values } = parseArgs({ options: { url: { type: "string" }, all: { type: "boolean" }, format: { type: "string" }, timeout: { type: "string" }, help: { type: "boolean", short: "h" } } }));
  } catch (e) {
    console.error(`templates:parts: ${e.message}`);
    process.exit(2);
  }
  if (values.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return;
  }
  if (values.format && values.format !== "json" && values.format !== "text") {
    console.error(`templates:parts: --format is text or json, not ${values.format}`);
    process.exit(2);
  }
  const json = values.format === "json";
  const timeoutMs = Math.max(1, Number(values.timeout) || 20) * 1000;
  // from here on nothing fails the caller: this is a note, not a gate
  let url = "";
  try {
    url = (values.url || process.env.PROTOBOARD_CLOUD_URL || hostedLibraryUrl()).replace(/\/+$/, "");
    const templates = templatePins();
    let result;
    try {
      result = await compareTemplates(url, templates, { timeoutMs });
    } catch (e) {
      const why = String(e?.cause?.code ?? e?.cause?.message ?? (e?.name === "TimeoutError" ? `no answer in ${timeoutMs / 1000} s` : e?.message) ?? e);
      if (json) console.log(JSON.stringify({ library: url, skipped: true, reason: why }, null, 2));
      else console.log(`templates:parts: skipped, the library at ${url} could not be asked (${why}). Nothing was compared; run it again later: npm run templates:parts`);
      return;
    }
    if (json) console.log(JSON.stringify({ library: url, skipped: false, templates: result }, null, 2));
    else console.log(report(url, result, { all: values.all }));
  } catch (e) {
    if (json) console.log(JSON.stringify({ library: url, skipped: true, reason: e?.message ?? String(e) }, null, 2));
    else console.log(`templates:parts: skipped (${e?.message ?? e})`);
  }
}

// run as a script, not imported. The path is compared resolved: import.meta.url is the real file, argv[1] is the
// path as typed, and a checkout reached through a symlink (a repos folder linked to another volume, /tmp on
// macOS) would otherwise run nothing and print nothing.
const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if (process.argv[1] && real(fileURLToPath(import.meta.url)) === real(process.argv[1])) await main();
