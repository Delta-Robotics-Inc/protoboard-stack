/**
 * Section content → HTML. The same markup goes into the paginated PDFs
 * (ext-docs' page shell, flow paginator and print theme) and into index.html.
 */
import { esc } from "@protoboardai/ext-docs/html";
import { callouts as calloutSvg, figure, note, sec, sub, table } from "@protoboardai/ext-docs/blocks";
import type { Block, Callout, Cell, Column, KitItem, Step } from "./types.ts";

/** Printed width of a full-width figure (mm): the A4 text block. Callout bubbles are sized against it. */
const TEXT_WIDTH_MM = 178;

const cell = (v: Cell) => (v === null || v === undefined ? "" : esc(String(v)));

/** Blocks as flow blocks (each top-level element can move to the next page). `img` maps a package path to a URL relative to the document. */
export function blocksHtml(blocks: Block[], img: (packagePath: string) => string): string {
  return blocks.map((b) => blockHtml(b, img)).join("\n");
}

function blockHtml(b: Block, img: (p: string) => string): string {
  switch (b.kind) {
    case "heading":
      return sub(b.text);
    case "paragraph":
      return `<p class="prose block${b.keep ? " keep-next" : ""}">${esc(b.text)}</p>`;
    case "list":
      return `<${b.ordered ? "ol" : "ul"} class="plain block">${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
    case "keyvalues":
      return table(
        [{ h: "Item" }, { h: "Value" }],
        b.rows.map((r) => [`<b>${esc(r.label)}</b>`, `${esc(r.value)}${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ""}`]),
        { cls: "dense kv" },
      );
    case "figures": {
      const k = b.items.length > 4 ? " k6" : "";
      return `<div class="kpis${k} block">${b.items.map((i) => `<div class="kpi"><div class="k-label">${esc(i.label)}</div><div class="k-value">${kpiValue(i.value)}</div>${i.sub ? `<div class="k-sub">${esc(i.sub)}</div>` : ""}</div>`).join("")}</div>`;
    }
    case "table": {
      const cols = b.columns.map((c) => ({ h: esc(c.label), cls: [c.align === "right" ? "num" : "", c.nowrap ? "nw" : ""].filter(Boolean).join(" ") }));
      const rows = b.rows.map((r) => ("group" in r && typeof r.group === "string" ? { group: r.group } : b.columns.map((c) => cell((r as Record<string, Cell>)[c.key]))));
      return table(cols, rows as string[][], { split: true, cls: "dense", caption: b.caption, foot: b.note ? esc(b.note) : undefined });
    }
    case "note":
      return note(b.level, esc(b.text));
    case "steps":
      return b.steps.map((s, i) => stepHtml(s, i + 1, img)).join("\n");
    case "image":
      return figure({ src: img(b.file), w: b.width ?? 2000, h: b.height ?? 1180, caption: esc(b.caption), widthPct: b.size === "small" ? 55 : b.callouts?.length || b.size === "full" ? undefined : 78, overlay: overlay(b.width ?? 2000, b.height ?? 1180, b.callouts) });
    case "kit":
      return kitHtml(b.items, img, b.note);
  }
}

/** Lettered bubbles with leaders (ext-docs' callouts), for an image of `w` × `h` pixels. */
function overlay(w: number, h: number, items?: Callout[]): string | undefined {
  if (!items?.length) return undefined;
  const anchors = Object.fromEntries(items.map((c, i) => [`c${i}`, { x: c.x, y: c.y }]));
  return calloutSvg({ file: "", width: w, height: h, anchors, mmPerPx: 0 }, items.map((c, i) => ({ anchor: `c${i}`, label: c.label, accent: c.accent })), TEXT_WIDTH_MM);
}

/** Kit grid: five per row, blocks of 25 so a long kit flows onto the next page. */
function kitHtml(items: KitItem[], img: (p: string) => string, foot?: string): string {
  const cells = items.map(
    (k) =>
      `<div class="kit-item${k.image ? "" : " noimg"}">${k.image ? `<img src="${esc(img(k.image))}" alt="">` : `<div class="ph">${esc(k.placeholder ?? "no CAD")}</div>`}<div class="k-qty">×${k.quantity}</div><div class="k-name">${esc(k.name)}</div>${k.ref ? `<div class="k-id">${esc(k.ref)}</div>` : ""}</div>`,
  );
  const out: string[] = [];
  for (let i = 0; i < cells.length; i += 25) out.push(`<div class="block"><div class="kit">${cells.slice(i, i + 25).join("")}</div>${i + 25 >= cells.length && foot ? `<p class="fn">${esc(foot)}</p>` : ""}</div>`);
  return out.join("\n");
}

function stepTable(t: { columns: Column[]; rows: Record<string, Cell>[] }): string {
  return table(
    t.columns.map((c) => ({ h: esc(c.label), cls: [c.align === "right" ? "num" : "", c.nowrap ? "nw" : ""].filter(Boolean).join(" ") })),
    t.rows.map((r) => t.columns.map((c) => cell(r[c.key]))),
    { cls: "dense" },
  );
}

/** Number and unit in separate spans, so the unit is set in the text face (as ext-docs does). */
/** A figure's value with its unit set apart; a sum in several currencies ("12 USD + 3 EUR") sets each one apart. */
function kpiValue(v: string): string {
  const one = (x: string) => {
    const nu = x.match(/^(.*\d)\s([^\d\s][^\d]*)$/);
    return nu ? `<span class="n">${esc(nu[1])}</span>\u00a0<span class="u">${esc(nu[2])}</span>` : undefined;
  };
  const parts = v.split(" + ");
  const each = parts.length > 1 ? parts.map(one) : [];
  if (each.length && each.every((x) => x !== undefined)) return each.join(" + ");
  return one(v) ?? esc(v);
}

function stepHtml(s: Step, n: number, img: (p: string) => string): string {
  const meta = [
    s.tools?.length ? `<span><b>Tools</b> ${esc(s.tools.join(", "))}</span>` : "",
    s.materials?.length ? `<span><b>Materials</b> ${esc(s.materials.join(", "))}</span>` : "",
    s.torque ? `<span><b>Torque</b> ${esc(s.torque)}</span>` : "",
    s.inspect ? `<span><b>Inspect</b> ${esc(s.inspect)}</span>` : "",
    s.test ? `<span><b>Then test</b> ${esc(s.test)}</span>` : "",
  ].filter(Boolean);
  const no = s.id ?? String(n);
  const pictured = s.parts?.some((p) => p.image);
  const part = (p: NonNullable<Step["parts"]>[number]) =>
    `<div class="part${pictured ? "" : " noimg"}">${p.image ? `<img src="${esc(img(p.image))}" alt="">` : pictured ? `<span class="ph-s"></span>` : ""}<span class="p-qty">${p.letter ? `<span class="letter${p.accent ? " acc" : ""}">${esc(p.letter)}</span>` : ""}× ${p.quantity}</span><span class="p-name">${esc(p.name)}</span></div>`;
  const fig = s.figure
    ? figure({ src: img(s.figure.file), w: s.figure.width, h: s.figure.height, caption: s.figure.caption ? esc(s.figure.caption) : undefined, overlay: overlay(s.figure.width, s.figure.height, s.figure.callouts) })
    : "";
  // the head, parts and figure stay together; the rest may follow on the next page
  const top = `<div class="step block${s.figure ? " step-top keep-next" : ""}">
  <div class="step-head"><div class="step-no${no.length > 2 ? " wide" : ""}">${esc(no)}</div><h2 data-num="${esc(no)}">${esc(s.title)}</h2>${s.trace?.length ? `<div class="trace">${esc(s.trace.join(" · "))}</div>` : ""}</div>
  ${s.parts?.length ? `<div class="parts">${s.parts.map(part).join("")}</div>` : ""}
  ${fig}
  ${!s.figure && s.actions?.length ? `<ol class="actions">${s.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : ""}
  ${!s.figure && !s.table && meta.length ? `<div class="step-meta">${meta.join("")}</div>` : ""}
  ${!s.figure && !s.table ? (s.notes ?? []).map((x) => note(x.level, esc(x.text))).join("") : ""}
</div>`;
  if (!s.figure && !s.table) return top;
  const rest = [
    s.figure && s.actions?.length ? `<div class="step-cont block"><ol class="actions">${s.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol></div>` : "",
    s.table ? stepTable(s.table) : "",
    meta.length ? `<div class="step-cont block"><div class="step-meta">${meta.join("")}</div></div>` : "",
    ...(s.notes ?? []).map((x) => `<div class="step-cont block">${note(x.level, esc(x.text))}</div>`),
  ].filter(Boolean);
  return [top, ...rest].join("\n").replace(/class="step-cont block">(?![\s\S]*class="step-cont block">)/, 'class="step-cont block step-end">');
}

export { esc, sec, sub };
