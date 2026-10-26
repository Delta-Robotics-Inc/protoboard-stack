/**
 * The package's first page (PB-935): what the device is, its features, what
 * it does and what it must meet, each requirement with how it is shown,
 * from the project's own statement (`docs/product.json`, and the brief's
 * requirements table; @protoboardai/core readProduct). What the project has
 * not stated is said plainly on the page, never filled in, and reported by
 * `release --check` as a warning.
 */
import { PRODUCT_FILE, PRODUCT_PART_TEXT, type ProductStatement } from "@protoboardai/core";
import type { Block, SectionDiagnostic } from "./types.ts";

const HOW_TO_STATE = `State it in ${PRODUCT_FILE} (the system-compose skill, step 1).`;

/** The warnings a release reports about the statement. */
export function productDiagnostics(product: ProductStatement): SectionDiagnostic[] {
  const out: SectionDiagnostic[] = [];
  if (product.problems.length) out.push({ code: "REL_PRODUCT_INVALID", severity: "warning", message: `${PRODUCT_FILE} is not used: ${product.problems.join("; ")}` });
  if (product.missing.length) {
    const what = product.missing.map((k) => ({ summary: "what the device is (summary)", features: "its features", functions: "the system's functions", requirements: "its requirements" })[k]);
    out.push({
      code: "REL_PRODUCT_NOT_STATED",
      severity: "warning",
      message: `the package's first page cannot say ${what.join(", ")}: ${product.file ? `${PRODUCT_FILE} does not state ${what.length === 1 ? "it" : "them"}` : `the project has no ${PRODUCT_FILE}`}. The page says so instead; nothing is made up. ${HOW_TO_STATE}`,
    });
  }
  return out;
}

/** The first page's blocks. `description` is the root module's own, shown when no summary is stated. */
export function productBlocks(product: ProductStatement, description?: string): Block[] {
  const out: Block[] = [];
  const missing = (k: keyof typeof PRODUCT_PART_TEXT): Block => ({ kind: "note", level: "caution", text: `${PRODUCT_PART_TEXT[k].missing} ${HOW_TO_STATE}` });
  out.push({ kind: "heading", text: PRODUCT_PART_TEXT.summary.title });
  if (product.summary) out.push({ kind: "paragraph", text: product.summary });
  else {
    if (description) out.push({ kind: "paragraph", text: description });
    out.push(missing("summary"));
  }
  out.push({ kind: "heading", text: PRODUCT_PART_TEXT.features.title });
  out.push(product.features.length ? { kind: "list", items: product.features } : missing("features"));
  out.push({ kind: "heading", text: PRODUCT_PART_TEXT.functions.title });
  if (product.functions.length) {
    const by = product.functions.some((f) => f.by);
    out.push({
      kind: "table",
      columns: [{ key: "id", label: "ID" }, { key: "text", label: "Function" }, ...(by ? [{ key: "by", label: "Done by" }] : [])],
      rows: product.functions.map((f) => ({ id: f.id ?? "", text: f.text, by: f.by ?? "" })),
      ...(product.functionsFrom && product.functionsFrom !== PRODUCT_FILE ? { note: `From ${product.functionsFrom}.` } : {}),
    });
  } else out.push(missing("functions"));
  out.push({ kind: "heading", text: PRODUCT_PART_TEXT.requirements.title });
  if (product.requirements.length) {
    const pass = product.requirements.some((r) => r.pass);
    const ids = product.requirements.some((r) => r.id);
    const unshown = product.requirements.filter((r) => !r.how).length;
    out.push({
      kind: "table",
      columns: [...(ids ? [{ key: "id", label: "ID" }] : []), { key: "text", label: "Requirement" }, { key: "how", label: "How it is shown" }, ...(pass ? [{ key: "pass", label: "Pass" }] : [])],
      rows: product.requirements.map((r) => ({ id: r.id ?? "", text: r.text, how: r.how ?? "Not stated", pass: r.pass ?? "" })),
      note: `From ${product.requirementsFrom}. The system test plan carries one functional check per requirement.${unshown ? ` ${unshown} of ${product.requirements.length} do not say how they are shown; the test plan's method for those follows their wording.` : ""}`,
    });
  } else out.push(missing("requirements"));
  return out;
}
