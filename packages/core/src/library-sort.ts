/**
 * The orders of a library search (beta test 1, F14): their names, and how two
 * parts compare in each. Shared by the library client (which merges several
 * libraries' sorted pages) and the views (which order the loaded parts when
 * a library does not sort). No Node API here: the views bundle it for the
 * browser.
 */

/**
 * The orders a search can be asked for: the `sort` request parameter of a
 * library that sorts (protoboard-cloud's capability `x-sort`). `relevance` is
 * the library's own ranking, `updated` the newest revision first.
 */
export const LIBRARY_SORTS = ["relevance", "name", "manufacturer", "updated"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const isLibrarySort = (v: unknown): v is LibrarySort => typeof v === "string" && (LIBRARY_SORTS as readonly string[]).includes(v);

/** What an order reads of a part. */
export interface Sortable {
  partId: string;
  name: string;
  manufacturer?: string;
  relevance?: number;
}

const text = (v: string | undefined) => (v ?? "").toLowerCase();

/** Two parts in an order, the way a library that sorts orders them (ties end on the part id); `undefined` when a part summary cannot say (`updated`: it has no date). */
export function compareHits(sort: LibrarySort): ((a: Sortable, b: Sortable) => number) | undefined {
  const id = (a: Sortable, b: Sortable) => a.partId.localeCompare(b.partId);
  switch (sort) {
    case "name":
      return (a, b) => text(a.name).localeCompare(text(b.name)) || id(a, b);
    case "manufacturer":
      // parts without a manufacturer last
      return (a, b) => Number(!a.manufacturer) - Number(!b.manufacturer) || text(a.manufacturer).localeCompare(text(b.manufacturer)) || text(a.name).localeCompare(text(b.name)) || id(a, b);
    case "relevance":
      return (a, b) => (b.relevance ?? 0) - (a.relevance ?? 0) || id(a, b);
    default:
      return undefined;
  }
}

/**
 * The orders that can be made here from the parts already loaded, for
 * libraries that do not sort: by name and by manufacturer always; by
 * relevance only when the parts carry one. Never `updated`: a part summary
 * has no date.
 */
export function localSorts(hits: readonly { relevance?: number }[]): LibrarySort[] {
  return [...(hits.some((h) => typeof h.relevance === "number") ? (["relevance"] as const) : []), "name", "manufacturer"];
}
