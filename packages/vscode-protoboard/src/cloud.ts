/**
 * The Cloud view's model, from the cost model and the project's releases
 * (cost.ts), and the state of `protoboard release` runs. No VS Code API here.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CloudModel } from "@protoboardai/views/parts-model";
import { accountView, type AccountState } from "./account.js";
import type { CloudPageModel } from "./cloudPage.js";
import { money, type CostLine, type CostModel, type ReleaseInfo } from "./cost.js";

/** The account card before the CLI has said who is signed in. */
export const ACCOUNT_PENDING: CloudPageModel["account"] = { signedIn: false, title: "Account", note: "Checking the sign-in…" };

export type ReleaseState = CloudPageModel["release"];

const when = (d: Date) => d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const qty = (l: CostLine) => (l.order !== l.qtyPerProduct && l.order > 0 ? `${l.qtyPerProduct}/product, order ${l.order}` : `${l.qtyPerProduct}/product`);

/** A line's note, unless its group already says it (an unpriced line without offers; a made line shows what is made). */
const lineNote = (l: CostLine) => (l.kind === "made" ? l.process : l.kind === "unpriced" && /^no offer recorded/.test(l.note) ? "" : l.note);

function price(l: CostLine): string {
  switch (l.kind) {
    case "priced":
      return money(l.extended!, l.currency!);
    case "unpriced":
      return "unpriced";
    case "made":
      return "quote";
    case "included":
      return "included";
  }
}

function title(l: CostLine): string {
  const out = [l.item, [l.manufacturer, l.mpn].filter(Boolean).join(" "), `definition ${l.definition}`];
  if (l.kind === "priced") out.push(`${money(l.unitPrice!, l.currency!)} each × ${Math.round(l.extended! / l.unitPrice!)} from ${l.supplier ?? "?"} (${l.priceFrom}${l.priceAsOf ? `, ${l.priceAsOf.slice(0, 10)}` : ""})`);
  if (l.note) out.push(l.note);
  if (l.instances.length) out.push(`used by ${l.instances.length === 1 ? (l.instances[0] || "the system") : `${l.instances.length} instances: ${l.instances.slice(0, 4).join(", ")}${l.instances.length > 4 ? ", …" : ""}`}`);
  return out.filter(Boolean).join("\n");
}

const authors = new Map<string, string | undefined>();

/**
 * Who made the project, for the Cloud panel: package.json's `author`, else
 * the author of the project's first git commit. Read once per root; nothing
 * when neither says.
 */
export function projectAuthor(root: string, git: (root: string) => string | undefined = firstCommitAuthor): string | undefined {
  if (authors.has(root)) return authors.get(root);
  let author: string | undefined;
  try {
    const a = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { author?: string | { name?: string } }).author;
    author = (typeof a === "string" ? a.replace(/\s*[<(].*$/, "") : a?.name)?.trim() || undefined;
  } catch {
    // no package.json, or not JSON
  }
  author ??= git(root);
  authors.set(root, author);
  return author;
}

function firstCommitAuthor(root: string): string | undefined {
  try {
    const out = execFileSync("git", ["-C", root, "log", "--reverse", "--format=%an", "--", "."], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** What the Cloud panel says about the project besides its cost. */
export interface ProjectFacts {
  name: string;
  description?: string;
  author?: string;
  libraries: number;
  parts?: number;
  currency?: string;
}

export function cloudPageModel(input: { project: string; cost?: CostModel; costMissing?: string; releases: ReleaseInfo[]; release: ReleaseState; account?: CloudPageModel["account"]; accountState?: AccountState; facts?: ProjectFacts }): CloudPageModel {
  const c = input.cost;
  return {
    view: cloudView(input),
    type: "model",
    project: input.project,
    account: input.account ?? ACCOUNT_PENDING,
    release: input.release,
    releases: input.releases.map((r) => ({ version: r.version, date: when(r.date), index: !!r.index, overview: !!r.overview })),
    ...(c
      ? {
          cost: {
            source: c.source,
            units: c.bill.units,
            perUnit: money(c.bill.totals.perUnit, c.bill.currency),
            order: money(c.bill.totals.order, c.bill.currency),
            total: c.bom.totals.length ? `${c.bom.totals.map((t) => money(t.amount, t.currency)).join(" + ")} + quote` : "BOM prices + quote",
            bom: { totals: c.bom.totals.map((t) => money(t.amount, t.currency)), priced: c.bom.priced, unpriced: c.bom.unpriced, included: c.bom.included },
            made: c.manufacturing.made,
            offers: c.offers,
            lines: pageOrder(c).map((l) => ({
                kind: l.kind,
                item: l.item,
                definition: l.definition,
                detail: [l.manufacturer, l.mpn].filter(Boolean).join(" ") || l.definition,
                qty: qty(l),
                price: price(l),
                note: lineNote(l),
                ...(l.row ? { row: l.row.line } : {}),
                ...(l.instances.length ? { module: l.instances[0] } : {}),
                title: title(l),
              })),
          },
        }
      : { costMissing: input.costMissing }),
  };
}

/** The lines in the order the page shows them, so a page index finds its line. */
export function pageOrder(c: CostModel): CostLine[] {
  const kinds = { unpriced: 0, priced: 1, made: 2, included: 3 } as const;
  return [...c.lines].sort((a, b) => kinds[a.kind] - kinds[b.kind] || a.line - b.line);
}

/** A release run's JSON (`protoboard release --format json`, an operation record): what the view says about it. */
export interface ReleaseRecord {
  status: string;
  summary?: string;
  outputs?: { path: string }[];
  data?: { status?: string; summary?: string; diagnostics?: { code: string; severity?: string; message: string }[]; version?: string };
}

export function releaseOutcome(rec: ReleaseRecord): { ok: boolean; message: string; problems: { code: string; message: string }[]; dirtyOnly: boolean; folder?: string } {
  const problems = (rec.data?.diagnostics ?? []).filter((d) => d.severity !== "info" && d.severity !== "warning").map((d) => ({ code: d.code, message: d.message }));
  const ok = rec.status === "succeeded";
  const folder = rec.outputs?.map((o) => /^(release\/[^/]+)\//.exec(o.path)?.[1]).find(Boolean);
  return {
    ok,
    message: rec.summary ?? rec.data?.summary ?? rec.status,
    problems,
    dirtyOnly: !ok && problems.length > 0 && problems.every((p) => p.code === "REL_DIRTY"),
    ...(folder ? { folder } : {}),
  };
}

/** Files in a release folder (the Manufacturing Package's size), and the units its manifest names. */
export function releaseFacts(dir: string): { files: number; units?: number } {
  let files = 0;
  const walk = (d: string, depth: number) => {
    let list: import("node:fs").Dirent[];
    try {
      list = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of list) {
      if (e.isDirectory()) {
        if (depth < 8) walk(join(d, e.name), depth + 1);
      } else files++;
    }
  };
  walk(dir, 0);
  let units: number | undefined;
  try {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { units?: unknown[] | Record<string, unknown> };
    if (Array.isArray(m.units)) units = m.units.length;
    else if (m.units && typeof m.units === "object") units = Object.keys(m.units).length;
  } catch {
    // no manifest
  }
  return { files, ...(units !== undefined ? { units } : {}) };
}

/** The Cloud panel's model (PB-904): account, project, releases, the cost as a preview, quotes. */
export function cloudView(input: { project: string; cost?: CostModel; costMissing?: string; releases: ReleaseInfo[]; release: ReleaseState; accountState?: AccountState; facts?: ProjectFacts }): CloudModel {
  const c = input.cost;
  const facts = input.facts ?? { name: input.project, libraries: 0 };
  // one currency (PB-933): the bill is in dollars, converted prices marked with the rate table's date
  const bill = c?.bill;
  const top = (c?.lines ?? [])
    .filter((l) => l.kind === "priced" && l.extended !== undefined)
    .sort((a, b) => b.extended! - a.extended!)
    .slice(0, 3)
    .map((l) => ({ item: `${l.item}${l.qtyPerProduct > 1 ? ` ×${l.qtyPerProduct}` : ""}`, price: money(l.extended!, l.currency!) }));
  const notes = bill
    ? [
        ...(bill.counts.converted ? [`${bill.counts.converted} converted at the rates of ${bill.fx.date}`] : []),
        ...(bill.counts.stale ? [`${bill.counts.stale} stale price${bill.counts.stale === 1 ? "" : "s"}`] : []),
      ]
    : [];
  return {
    account: accountView(input.accountState ?? { state: "unknown" }),
    project: {
      name: facts.name,
      ...(facts.description ? { description: facts.description } : {}),
      ...(facts.author ? { author: facts.author } : {}),
      libraries: facts.libraries,
      ...(facts.parts !== undefined ? { parts: facts.parts } : {}),
      published: false,
    },
    release: input.release,
    releases: input.releases.map((r) => ({ version: r.version, date: r.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }), ...(existsSync(r.dir) ? releaseFacts(r.dir) : {}), index: !!r.index })),
    ...(c
      ? {
          cost: {
            total: money(bill!.totals.perUnit, bill!.currency),
            ...(bill!.counts.priced && (bill!.totals.surplus > 0 || bill!.units > 1) ? { order: `${money(bill!.totals.order, bill!.currency)} to order ${bill!.units}` } : {}),
            others: notes,
            bought: c.bom.priced + c.bom.unpriced,
            priced: c.bom.priced,
            unpriced: c.bom.unpriced,
            made: c.manufacturing.made,
            top,
            source: c.source.kind === "release" ? `release ${c.source.version}` : c.source.kind === "design" ? "the design" : c.source.file,
          },
        }
      : { costMissing: input.costMissing ?? "Nothing to cost yet." }),
    quotes: [],
  };
}
