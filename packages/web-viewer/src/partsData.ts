/**
 * The parts views' data from `protoboard dev` (its `/__protoboard/parts/`
 * routes, packages/cli/src/dev/parts.ts): the library's search and parts,
 * the project's parts, the bill of materials, and adding a part with the
 * page's session token.
 */
import type { BomModel, LibraryQuery, PartDetailModel, PartPages, PartPricesModel, PartsData, ProjectPartsModel, LibraryPageResult } from "@protoboardai/views";

export interface DevPartsOptions {
  /** The parts routes' base URL (`…/__protoboard/parts/`), absolute. */
  base: string;
  /** The session token writes carry, and the header it goes in. */
  token?: string;
  tokenHeader?: string;
}

export function createDevPartsData(o: DevPartsOptions): PartsData {
  const base = o.base.endsWith("/") ? o.base : `${o.base}/`;
  const at = (path: string) => new URL(path, base);
  const get = async <T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> => {
    const url = at(path);
    for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    const res = await fetch(url, { cache: "no-store" });
    const body = (await res.json().catch(() => ({ error: `${path}: ${res.status}` }))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `${path}: ${res.status}`);
    return body;
  };
  // thumbnails and models come back as paths relative to the dev page's root: make them absolute here
  const root = new URL("../../", base);
  const abs = (u: string | undefined) => (u ? new URL(u, root).href : u);
  // a part's pages carry pictures the same way
  const absPages = (p: PartPages): PartPages => ({ ...p, images: p.images.map((i) => ({ ...i, url: abs(i.url)! })), ...(p.cad ? { cad: { ...p.cad, ...(p.cad.preview ? { preview: abs(p.cad.preview) } : {}) } } : {}) });
  return {
    async search(q: LibraryQuery, cursor?: string): Promise<LibraryPageResult> {
      const r = await get<LibraryPageResult>("library", { text: q.text, category: q.category, domain: q.domain, protocol: q.protocol, sort: q.sort, cursor });
      return { ...r, model: { ...r.model, items: r.model.items.map((x) => ({ ...x, ...(x.thumbnail ? { thumbnail: abs(x.thumbnail) } : {}) })) } };
    },
    async part(key: string, revision?: number): Promise<PartDetailModel> {
      const d = await get<PartDetailModel>("part", { key, revision: revision ? String(revision) : undefined });
      return { ...d, ...(d.thumbnail ? { thumbnail: abs(d.thumbnail) } : {}), ...(d.model ? { model: abs(d.model) } : {}), ...(d.pages ? { pages: absPages(d.pages) } : {}) };
    },
    // asked for when a card first shows a page; a revision never changes, so the views keep what they got
    async pages(ref) {
      return absPages(await get<PartPages>("pages", { key: ref.key, revision: ref.revision ? String(ref.revision) : undefined }));
    },
    prices: (key) => get<PartPricesModel>("prices", { key }),
    async vendor(key, kind, revision) {
      const res = await fetch(at("vendor"), {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.token ? { [o.tokenHeader ?? "x-protoboard-dev"]: o.token } : {}) },
        body: JSON.stringify({ key, kind: kind === "add" ? "add" : "update", revision }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `vendor: ${res.status}`);
      return body.message ?? "done";
    },
    // pictures come back as paths relative to the dev page's root, like the library's
    projectParts: async (check?: boolean) => {
      const r = await get<ProjectPartsModel>("project", { check: check ? "1" : undefined });
      return { ...r, parts: r.parts.map((p) => ({ ...p, ...(p.thumbnail ? { thumbnail: abs(p.thumbnail) } : {}) })) };
    },
    bom: () => get<BomModel>("bom"),
    async saveBom(change) {
      const res = await fetch(at("bom"), {
        method: "POST",
        headers: { "content-type": "application/json", ...(o.token ? { [o.tokenHeader ?? "x-protoboard-dev"]: o.token } : {}) },
        body: JSON.stringify(change),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `bom: ${res.status}`);
    },
    async refreshOffers() {
      const res = await fetch(at("offers"), { method: "POST", headers: { "content-type": "application/json", ...(o.token ? { [o.tokenHeader ?? "x-protoboard-dev"]: o.token } : {}) }, body: "{}" });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `offers: ${res.status}`);
      return body.message ?? "The offers were refreshed.";
    },
    openLink: (url) => void window.open(url, "_blank", "noopener"),
  };
}
