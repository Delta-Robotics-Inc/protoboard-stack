/**
 * The category taxonomy as the parts service holds it (PB-849). Pure, and
 * free of `@deltarobotics/uhd` like the rest of the server: the documents
 * are UHD's taxonomy format (a base taxonomy file and library extensions,
 * UHD docs/taxonomy.md), which the seed reads from UHD and the library and
 * sends with `PUT /v1/taxonomy`. test/taxonomy.test.ts checks these helpers
 * agree with UHD's.
 *
 * Parts are indexed by the ancestors of their categories, so a filter on a
 * path is an exact match and returns the whole subtree.
 */

export interface TaxonomyNodeData {
  name: string;
  description?: string;
  docs_url?: string;
  links?: { label: string; url: string }[];
  agent_notes?: string;
  kit?: { sku: string; vendor: string; controller_part_id?: string; manifest?: string };
  children?: Record<string, TaxonomyNodeData>;
}

/** What the service is given and stores: UHD's taxonomy document and the library's extensions. */
export interface ServiceTaxonomyDocument {
  base: { id: string; version: string; delimiter: "."; description?: string; provenance?: Record<string, unknown>; aliases?: Record<string, string[]>; categories: Record<string, TaxonomyNodeData>; $schema?: string };
  extensions: { library: string; taxonomy: { id: string; version: string }; description?: string; categories?: Record<string, TaxonomyNodeData>; $schema?: string }[];
}

/** One node of `GET /v1/taxonomy`: parts at or under it in `count`. */
export interface TaxonomyTreeNode {
  id: string;
  path: string;
  name: string;
  description?: string;
  docsUrl?: string;
  links?: { label: string; url: string }[];
  agentNotes?: string;
  kit?: { sku: string; vendor: string; controllerPartId?: string; manifest?: string };
  /** The taxonomy id ("uhd") or the library of the extension that defines the node. */
  source: string;
  count: number;
  children: TaxonomyTreeNode[];
}

const DELIM = ".";
const NODE_ID = /^[a-z][a-z0-9_]*$/;
const LIBRARY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** Each path and every ancestor of it, once, sorted (UHD `categoryAncestors`). */
export function categoryAncestors(paths: readonly unknown[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of paths ?? []) {
    if (typeof raw !== "string") continue;
    const ids = raw.split(DELIM).filter((s) => s.length > 0);
    for (let i = 1; i <= ids.length; i++) out.add(ids.slice(0, i).join(DELIM));
  }
  return [...out].sort();
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Shape problems with a taxonomy the service is asked to store (UHD validates the content; this guards the service). */
export function taxonomyDocumentProblems(doc: unknown): { message: string; at?: string }[] {
  const out: { message: string; at?: string }[] = [];
  const nodes = (map: unknown, at: string, root: boolean, library?: string) => {
    if (!isObject(map)) return void out.push({ message: "must be an object of nodes by id", at });
    for (const [id, node] of Object.entries(map)) {
      const okId = root && library !== undefined ? id === `x-${library}` : NODE_ID.test(id);
      if (!okId) out.push({ message: library !== undefined && root ? `extension root must be x-${library}` : `node id "${id}" is not a lower-case id`, at });
      if (!isObject(node) || typeof node.name !== "string" || node.name === "") out.push({ message: "a node needs a name", at: `${at}.${id}` });
      else if (node.children !== undefined) nodes(node.children, `${at}.${id}.children`, false);
    }
  };
  if (!isObject(doc)) return [{ message: "body must be { base, extensions }" }];
  const base = doc.base;
  if (!isObject(base) || typeof base.id !== "string" || typeof base.version !== "string" || !SEMVER.test(base.version) || base.delimiter !== DELIM)
    out.push({ message: "base must be a taxonomy document with id, version (MAJOR.MINOR.PATCH) and delimiter \".\"", at: "base" });
  else nodes(base.categories, "base.categories", true);
  if (!Array.isArray(doc.extensions)) out.push({ message: "extensions must be an array", at: "extensions" });
  else
    doc.extensions.forEach((e, i) => {
      if (!isObject(e) || typeof e.library !== "string" || !LIBRARY.test(e.library) || !isObject(e.taxonomy)) return void out.push({ message: "an extension needs library and taxonomy { id, version }", at: `extensions[${i}]` });
      if (e.categories !== undefined) nodes(e.categories, `extensions[${i}].categories`, true, e.library);
    });
  return out;
}

/** Every node path the document defines. */
export function taxonomyPaths(doc: ServiceTaxonomyDocument): Set<string> {
  const out = new Set<string>();
  const walk = (map: Record<string, TaxonomyNodeData> | undefined, prefix: string) => {
    for (const [id, n] of Object.entries(map ?? {})) {
      const path = prefix ? `${prefix}${DELIM}${id}` : id;
      out.add(path);
      walk(n.children, path);
    }
  };
  walk(doc.base.categories, "");
  for (const e of doc.extensions) walk(e.categories, "");
  return out;
}

/** The tree with each node's count (UHD `taxonomyTree`, with every count present). */
export function taxonomyTreeWithCounts(doc: ServiceTaxonomyDocument, counts: ReadonlyMap<string, number>): TaxonomyTreeNode[] {
  const convert = (id: string, n: TaxonomyNodeData, prefix: string, source: string): TaxonomyTreeNode => {
    const path = prefix ? `${prefix}${DELIM}${id}` : id;
    return {
      id,
      path,
      name: n.name,
      ...(n.description !== undefined ? { description: n.description } : {}),
      ...(n.docs_url !== undefined ? { docsUrl: n.docs_url } : {}),
      ...(n.links?.length ? { links: n.links.map((l) => ({ label: l.label, url: l.url })) } : {}),
      ...(n.agent_notes !== undefined ? { agentNotes: n.agent_notes } : {}),
      ...(n.kit
        ? {
            kit: {
              sku: n.kit.sku,
              vendor: n.kit.vendor,
              ...(n.kit.controller_part_id !== undefined ? { controllerPartId: n.kit.controller_part_id } : {}),
              ...(n.kit.manifest !== undefined ? { manifest: n.kit.manifest } : {}),
            },
          }
        : {}),
      source,
      count: counts.get(path) ?? 0,
      children: Object.entries(n.children ?? {}).map(([cid, c]) => convert(cid, c, path, source)),
    };
  };
  return [
    ...Object.entries(doc.base.categories).map(([id, n]) => convert(id, n, "", doc.base.id)),
    ...doc.extensions.flatMap((e) => Object.entries(e.categories ?? {}).map(([id, n]) => convert(id, n, "", e.library))),
  ];
}
