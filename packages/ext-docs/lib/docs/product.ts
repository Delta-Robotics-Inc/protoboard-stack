/**
 * The datasheet's first page after the cover (PB-935): what the device is,
 * its features, what it does and what it must meet, from the project's own
 * statement (`docs/product.json` and the brief's requirements table;
 * @protoboardai/core readProduct). These are the project's words, not model
 * values, so they are not bound values. What the project has not stated is
 * said on the page; nothing is written for it.
 */
import { PRODUCT_FILE, PRODUCT_PART_TEXT, readProduct, type ProductPart } from "@protoboardai/core";
import { sec, sub, table } from "../blocks.ts";
import { esc } from "../html.ts";

const missing = (k: ProductPart) => `<p class="small muted"><i>${esc(PRODUCT_PART_TEXT[k].missing)} State it in <code>${esc(PRODUCT_FILE)}</code>.</i></p>`;

/** The page, as flow blocks: the heading with the summary, then features, functions and requirements. */
export function productPage(root: string, title: string, description?: string): string {
  const p = readProduct(root);
  const out: string[] = [];
  out.push(
    `<div class="block">${sec("00", "The product", esc(title))}${sub(PRODUCT_PART_TEXT.summary.title)}${p.summary ? `<p class="lead">${esc(p.summary)}</p>` : `${description ? `<p class="lead">${esc(description)}</p>` : ""}${missing("summary")}`}</div>`,
  );
  out.push(`<div class="block">${sub(PRODUCT_PART_TEXT.features.title)}${p.features.length ? `<ul class="plain">${p.features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : missing("features")}</div>`);
  const by = p.functions.some((f) => f.by);
  out.push(
    `<div class="block">${sub(PRODUCT_PART_TEXT.functions.title)}${
      p.functions.length ? table([{ h: "ID" }, { h: "Function" }, ...(by ? [{ h: "Done by" }] : [])], p.functions.map((f) => [esc(f.id ?? ""), esc(f.text), ...(by ? [esc(f.by ?? "")] : [])]), { cls: "dense", ...(p.functionsFrom && p.functionsFrom !== PRODUCT_FILE ? { foot: `From ${esc(p.functionsFrom)}.` } : {}) }) : missing("functions")
    }</div>`,
  );
  const pass = p.requirements.some((r) => r.pass);
  const ids = p.requirements.some((r) => r.id);
  const unshown = p.requirements.filter((r) => !r.how).length;
  out.push(
    `<div class="block">${sub(PRODUCT_PART_TEXT.requirements.title)}${
      p.requirements.length
        ? table([...(ids ? [{ h: "ID" }] : []), { h: "Requirement" }, { h: "How it is shown" }, ...(pass ? [{ h: "Pass" }] : [])], p.requirements.map((r) => [...(ids ? [esc(r.id ?? "")] : []), esc(r.text), r.how ? esc(r.how) : `<span class="muted"><i>Not stated</i></span>`, ...(pass ? [esc(r.pass ?? "")] : [])]), {
            cls: "dense",
            // a table that fits a page moves to the next page whole rather than leave a row behind
            split: p.requirements.length > 18,
            foot: `From ${esc(p.requirementsFrom ?? "")}.${unshown ? ` ${unshown} of ${p.requirements.length} do not say how they are shown.` : ""}`,
          })
        : missing("requirements")
    }</div>`,
  );
  return out.join("\n");
}
