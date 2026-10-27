/**
 * Deterministic provenance check for a datasheet extraction: no model, no
 * network. Every stated field's quote must be in the document's text on the
 * page it cites, and the field's numbers must be in that quote.
 *
 *   npx tsx <this file> --extraction <extraction.json> (--text <parsed.txt> | --pdf <source.pdf>) [--out <file>] [--json]
 *
 * --text is `pdftotext -layout` output (pages separated by form feeds).
 * --pdf runs pdftotext once and caches the text next to the PDF as
 * parsed-<sha256 prefix>.txt; the PDF's sha256 must equal the extraction's
 * source.sha256. Format and verdicts: ../references/extraction.md.
 *
 * Exit 0 all fields grounded/visual/absent/derived, 1 usage or invalid input,
 * 3 pdftotext missing (JSON payload to relay), 5 any field ungrounded or invalid.
 * Weak fields exit 0 but are listed: each needs a human read of the page.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Evidence = { kind?: "text" | "figure"; quote?: string; page?: number; image?: string; image_sha256?: string; reading?: string };
type Reading = { reader: string; value: number | string; unit?: string };
type Field = {
  path: string;
  label?: string;
  value?: unknown;
  unit?: string | null;
  min?: number | string | null;
  typ?: number | string | null;
  max?: number | string | null;
  evidence?: Evidence[];
  readings?: Reading[];
  status: "stated" | "derived" | "absent";
  derived_from?: string[];
  working?: string;
};
type Verdict = "grounded" | "visual" | "weak" | "ungrounded" | "absent" | "derived" | "invalid";

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const fail: (msg: string) => never = (msg) => {
  process.stderr.write(`quote-check: ${msg}\n`);
  process.exit(1);
};

const extractionFile = opt("extraction") ?? fail("--extraction <file> is required");
const extraction = JSON.parse(readFileSync(extractionFile, "utf8"));
if (extraction.schema !== "protoboard.extraction/v0" || !Array.isArray(extraction.fields)) fail(`${extractionFile} is not a protoboard.extraction/v0 file with fields[]`);

let text: string;
const pdf = opt("pdf");
if (opt("text")) text = readFileSync(opt("text")!, "utf8");
else if (pdf) {
  const sha = createHash("sha256").update(readFileSync(pdf)).digest("hex");
  if (extraction.source?.sha256 && extraction.source.sha256 !== sha) fail(`${pdf} has sha256 ${sha}; the extraction was made from ${extraction.source.sha256}`);
  const cache = join(dirname(pdf), `parsed-${sha.slice(0, 12)}.txt`);
  if (existsSync(cache)) text = readFileSync(cache, "utf8");
  else {
    try {
      text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") fail(`pdftotext failed on ${pdf}: ${(e as Error).message.split("\n")[0]}`);
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error: "not-configured",
          missing: ["pdftotext"],
          degraded: "Without pdftotext there is no text layer to check quotes against, so no extracted value can be grounded.",
          fallback: "Install poppler-utils (pdftotext), or export the PDF's text yourself and pass it with --text; until then every value stays SIGN-OFF.",
        }) + "\n",
      );
      process.exit(3);
    }
    writeFileSync(cache, text);
  }
} else fail("--text <parsed.txt> or --pdf <source.pdf> is required");

// ---- normalisation: what pdftotext and a careful copy can legitimately differ in
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‐-―−﹣－]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/µ/g, "μ")
    .replace(/\s+/g, " ")
    .trim();
// pdftotext ends every page, the last included, with a form feed: the empty tail is not a page
const pages = text.split("\f").map(norm);
if (pages.length > 1 && !pages[pages.length - 1]) pages.pop();

/**
 * Numbers as they appear in a quote: not glued to a preceding word (AD1000 is a part number), except a dimension
 * chain (2.5x3.0). A thousands-grouped figure ("10,000 h") counts as the whole number and as its groups, since a
 * comma list ("10,100,1000 Hz") looks the same; either reading may match the field's value.
 */
function numbersIn(q: string): number[] {
  const out: number[] = [];
  const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d)|\d+(?:\.\d+)?|\.\d+/g;
  for (let m; (m = re.exec(q)); ) {
    const before = q.slice(0, m.index);
    const prev = before.slice(-1);
    if (/[A-Za-z_]/.test(prev) && !(/[x×X]/.test(prev) && /\d$/.test(before.slice(0, -1)))) continue;
    if (/[\d.]/.test(prev)) continue;
    // after a hyphen: part of a name when a letter precedes it ("SOT-23"), the end of a range
    // when a digit does ("4.5-5.5"), otherwise a minus sign ("VIN -0.3", "=-4.5")
    if (prev === "-" && /[A-Za-z]$/.test(before.slice(0, -1))) continue;
    const negative = prev === "-" && !/\d$/.test(before.slice(0, -1));
    const sign = negative ? -1 : 1;
    out.push(sign * Number(m[0].replace(/,/g, "")));
    if (m[0].includes(",")) m[0].split(",").forEach((g, i) => out.push((i ? 1 : sign) * Number(g)));
  }
  return out;
}
const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" ? v : typeof v === "string" && /^[-+]?(\d{1,3}(,\d{3})+(\.\d*)?|\d+(\.\d*)?|\.\d+)$/.test(v.trim()) ? Number(v.trim().replace(/,/g, "")) : undefined;
const sameNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

function checkText(f: Field, ev: Evidence[]) {
  const notes: string[] = [];
  let verdict: Verdict = "grounded";
  const worse = (v: Verdict) => {
    const rank: Verdict[] = ["grounded", "weak", "ungrounded"];
    if (rank.indexOf(v) > rank.indexOf(verdict)) verdict = v;
  };
  for (const e of ev) {
    const q = norm(e.quote ?? "");
    if (!q) {
      worse("ungrounded");
      notes.push("text evidence with an empty quote");
      continue;
    }
    const page = e.page;
    const onPage = typeof page === "number" && pages[page - 1]?.includes(q);
    if (onPage) continue;
    const found = pages.findIndex((t) => t.includes(q));
    if (found >= 0) {
      worse("weak");
      notes.push(`quote is on page ${found + 1}, not page ${page}`);
      continue;
    }
    const folded = pages.findIndex((t) => t.toLowerCase().includes(q.toLowerCase()));
    if (folded >= 0) {
      worse("weak");
      notes.push(`quote matches page ${folded + 1} only when case is ignored`);
      continue;
    }
    worse("ungrounded");
    notes.push(`quote not found in the document: "${q.slice(0, 80)}"`);
  }
  // every number the field states must be in one of its quotes, and string values must appear verbatim
  const quotes = ev.map((e) => norm(e.quote ?? ""));
  const nums = quotes.flatMap(numbersIn);
  const values = [f.value, f.min, f.typ, f.max].flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v !== null && v !== undefined);
  let valueInQuote = true;
  for (const v of values) {
    const n = asNumber(v);
    const ok = n !== undefined ? nums.some((x) => sameNumber(x, n)) : quotes.some((q) => q.toLowerCase().includes(norm(String(v)).toLowerCase()));
    if (!ok) {
      valueInQuote = false;
      notes.push(`value ${JSON.stringify(v)} is not in the quote`);
    }
  }
  if (!valueInQuote) worse("weak");
  return { verdict: verdict as Verdict, notes, value_in_quote: values.length ? valueInQuote : null };
}

function checkFigures(f: Field, ev: Evidence[], base: string) {
  const notes: string[] = [];
  let ok = true;
  // a crop that cannot be hashed here is an unverified citation: it can make a field weak, never visual
  let verified = true;
  for (const e of ev) {
    if (e.quote) {
      ok = false;
      notes.push("figure evidence carries a quote: text you can quote is text evidence");
    }
    if (!e.image || !e.image_sha256 || !e.reading || typeof e.page !== "number") {
      ok = false;
      notes.push("figure evidence needs page, image, image_sha256 and the reading as printed");
      continue;
    }
    if (!Number.isInteger(e.page) || e.page < 1 || e.page > pages.length) {
      ok = false;
      notes.push(`figure cites page ${e.page}; the document has ${pages.length}`);
      continue;
    }
    const img = resolve(base, e.image);
    if (!existsSync(img)) {
      verified = false;
      notes.push(`crop ${e.image} is not on this machine, so its hash is unchecked: weak until the crop is here`);
    }
    else if (createHash("sha256").update(readFileSync(img)).digest("hex") !== e.image_sha256) {
      ok = false;
      notes.push(`crop ${e.image} does not hash to the cited sha256`);
    }
  }
  const readings = f.readings ?? [];
  const readers = new Set(readings.map((r) => r.reader));
  if (readers.size !== readings.length) {
    ok = false;
    notes.push("two readings from the same reader: one reader asked twice is not two readings");
  }
  const target = asNumber(f.value);
  // a number agrees within 0.5 %; a reading that is not a number (a material, a finish, a marking) agrees when it reads
  // the same, ignoring case and spacing (it was always "disagree" before: asNumber gave undefined)
  const sameText = (v: unknown) => typeof f.value === "string" && typeof v === "string" && norm(v).toLowerCase().replace(/\s+/g, " ") === norm(f.value).toLowerCase().replace(/\s+/g, " ");
  const agrees = (v: unknown) => {
    if (target === undefined) return sameText(v);
    const n = asNumber(v);
    return n !== undefined && Math.abs(n - target) <= 0.005 * Math.abs(target);
  };
  let readings_agree: boolean | null = null;
  if (readers.size >= 2 && readers.size === readings.length) {
    readings_agree = f.value !== null && f.value !== undefined && readings.every((r) => agrees(r.value));
    if (!readings_agree) notes.push("independent readings disagree with each other or with the value: never average, take it to a human");
  } else notes.push("single reading: a second independent reader is required before this is cited");
  const verdict: Verdict = !ok ? "invalid" : readings_agree === false || !verified ? "weak" : "visual";
  return { verdict, notes, readings_agree };
}

const paths = new Set((extraction.fields as Field[]).map((f) => f.path));
const base = dirname(resolve(extractionFile));
const results = (extraction.fields as Field[]).map((f) => {
  const ev = f.evidence ?? [];
  if (f.status === "absent") {
    const clean = (f.value === null || f.value === undefined) && !ev.length;
    return { path: f.path, verdict: (clean ? "absent" : "invalid") as Verdict, notes: clean ? [] : ["an absent field has no value and no evidence"] };
  }
  if (f.status === "derived") {
    const from = f.derived_from ?? [];
    const missing = from.filter((x) => !paths.has(x));
    const ok = from.length > 0 && !missing.length && !!f.working;
    return { path: f.path, verdict: (ok ? "derived" : "invalid") as Verdict, notes: ok ? [] : [`a derived field lists its inputs (derived_from) and its working${missing.length ? `; unknown inputs ${missing.join(", ")}` : ""}`] };
  }
  if (f.status !== "stated") return { path: f.path, verdict: "invalid" as Verdict, notes: [`status must be stated, derived or absent, not ${JSON.stringify(f.status)}`] };
  if (!ev.length) return { path: f.path, verdict: "ungrounded" as Verdict, notes: ["a stated field with no evidence"] };
  const textEv = ev.filter((e) => (e.kind ?? "text") === "text");
  const figEv = ev.filter((e) => e.kind === "figure");
  const t = textEv.length ? checkText(f, textEv) : undefined;
  const g = figEv.length ? checkFigures(f, figEv, base) : undefined;
  // a mixed field takes the stronger rung of its two halves (a quote names the parameter, a figure gives the number),
  // except that an invalid figure citation is invalid and a quote not in the document is ungrounded whatever the figure says
  const rank: Verdict[] = ["grounded", "visual", "weak", "ungrounded", "invalid"];
  const verdict: Verdict =
    g?.verdict === "invalid" ? "invalid" : t?.verdict === "ungrounded" ? "ungrounded" : t && g ? (rank.indexOf(t.verdict) <= rank.indexOf(g.verdict) ? t.verdict : g.verdict) : (t ?? g)!.verdict;
  return { path: f.path, verdict, notes: [...(t?.notes ?? []), ...(g?.notes ?? [])], value_in_quote: t?.value_in_quote ?? null, ...(g && { readings_agree: g.readings_agree }) };
});

const summary = Object.fromEntries((["grounded", "visual", "weak", "ungrounded", "absent", "derived", "invalid"] as Verdict[]).map((v) => [v, results.filter((r) => r.verdict === v).length]));
const report = {
  schema: "protoboard.quote-check/v0",
  extraction: extractionFile,
  source_sha256: extraction.source?.sha256 ?? null,
  ordering_code: extraction.ordering_code ?? null,
  checker: "@protoboardai/ext-sourcing quote-check (deterministic, pdftotext text layer, page-level)",
  pages: pages.length,
  summary,
  fields: results,
};
if (opt("out")) writeFileSync(opt("out")!, JSON.stringify(report, null, 2) + "\n");
if (argv.includes("--json")) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
else {
  for (const r of results) process.stdout.write(`${r.verdict.padEnd(10)} ${r.path}${r.notes.length ? `  — ${r.notes.join("; ")}` : ""}\n`);
  process.stdout.write(`\n${Object.entries(summary).filter(([, n]) => n).map(([v, n]) => `${n} ${v}`).join(", ")} (${pages.length} pages)\n`);
}
process.exitCode = summary.ungrounded || summary.invalid ? 5 : 0;
