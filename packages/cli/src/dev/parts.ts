/**
 * The parts routes of `protoboard dev` (PB-912): what the web viewer's
 * `library` and `bom` tabs show, computed the way the VS Code extension
 * computes them (@protoboardai/views/parts-data, the CLI's own commands).
 *
 * - `GET  parts/library?text&category&domain&protocol&sort&cursor`: a search over
 *   the project's libraries (the list from `protoboard libraries`, the
 *   client and the merging from @protoboardai/core/library-client), as the
 *   Library's model; thumbnails by `parts/blob`.
 * - `GET  parts/part?key=<library>/<id>&revision`: a part's detail, with its pages.
 * - `GET  parts/pages?key=<library>/<id>&revision`: a part's pages, for the
 *   cards' text carousel (PB-918): asked for when a card first shows one.
 * - `GET  parts/prices?key=<library>/<id>`: the part's prices by source, as
 *   its library serves them to the signed-in user (`partPrices`).
 * - `GET  parts/blob?library&sha&size&type`: a thumbnail or model, verified
 *   against its address by the library client, cached under
 *   .protoboard/cache/library.
 * - `GET  parts/project[?check=1]`: `protoboard parts list [--check]`, each
 *   library part with its picture (the library's thumbnail, by `parts/blob`).
 * - `GET  parts/bom`: `protoboard bom`.
 * - `POST parts/offers`: `protoboard parts offers`: the library's current
 *   offers for the project's parts into parts/offers.json; the page's
 *   session token, like every write. The answer says how many came back.
 * - `POST parts/bom`: keep the units to build (`{ units }`) or a line's
 *   chosen offer (`{ line, offer }`, `offer: null` for the best one) in
 *   parts/bom.json; the page's session token, like every write.
 * - `POST parts/vendor {key, kind, revision}` (the session token): `protoboard
 *   parts add|update`, as in a terminal.
 *
 * The CLI runs in a child process for anything that loads the project, as
 * the build does; only the library client runs here.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readOrigins } from "@protoboardai/core";
import { accountTokensFor } from "@protoboardai/core/account";
import { connectLibrary, explainCloudError, libraryTaxonomy, markShadowed, partPrices, searchLibraries, type LibrariesTaxonomy, type LibraryConnection } from "@protoboardai/core/library-client";
import { categoryNamer, detailModel, drillDown, itemModel, libraryViewModel, pageImages, parseLibraryQuery, partPages, previewModel, previewTrust, type LibraryQuery, type Usage } from "@protoboardai/views/parts-data";
import { parseVerificationRecord } from "@protoboardai/core/part-trust";

export const PARTS_PREFIX = "/__protoboard/parts/";
const CLI = fileURLToPath(new URL("../../bin/protoboard.mjs", import.meta.url));
const PAGE = 30;
const SHA = /^[0-9a-f]{64}$/;

/** `protoboard <args> --format json` in the project, its JSON or its error. */
export function runCliJson<T>(root: string, args: string[], timeoutMs = 180_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args, "--format", "json"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out) as T & { error?: string };
        if (code !== 0 && json && typeof json === "object" && "error" in json && json.error) return reject(new Error(json.error));
        resolve(json);
      } catch {
        reject(new Error((err || out).trim().split("\n").pop() || `protoboard ${args[0]} exited ${code}`));
      }
    });
  });
}

interface LibraryInfo {
  id: string;
  url: string;
  authEnv?: string;
}

export interface PartsRoutes {
  handle(req: IncomingMessage, res: ServerResponse, url: URL, write: { authorised: boolean }): Promise<void>;
  /** The project's files changed (a rebuild): forget what was read from them. */
  changed(): void;
}

export function partsRoutes(root: string): PartsRoutes {
  let libs: Promise<LibraryConnection[]> | undefined;
  let taxonomy: { key: string; value: Promise<LibrariesTaxonomy | undefined> } | undefined;
  const cacheDir = join(root, ".protoboard", "cache", "library");

  const connections = () =>
    (libs ??= (async () => {
      const out = await runCliJson<{ libraries: LibraryInfo[] }>(root, ["libraries"]);
      const signedIn = await accountTokensFor(out.libraries.map((l) => l.url)).catch(() => ({ tokens: new Map<string, string>(), problems: [] }));
      return out.libraries.map((l) => connectLibrary(l, { accountTokens: signedIn.tokens }));
    })().catch((e) => {
      libs = undefined;
      throw e;
    }));

  const usage = (): Map<string, Usage> => {
    const out = new Map<string, Usage>();
    try {
      for (const [id, rec] of Object.entries(readOrigins(root).definitions)) {
        const library = rec.library ?? (rec.provider === "protoboard-cloud" ? "protoboard" : undefined);
        out.set(id, { ...(typeof rec.revision === "number" ? { revision: rec.revision } : {}), ...(library ? { library } : {}), ...(rec.tier ? { tier: rec.tier } : {}), file: rec.file });
      }
    } catch {
      // no origins yet
    }
    return out;
  };

  const blobUrl = (library: string, b: { sha256: string; size: number; mediaType: string }) => `${PARTS_PREFIX.slice(1)}blob?${new URLSearchParams({ library, sha: b.sha256, size: String(b.size), type: b.mediaType })}`;

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  async function library(url: URL) {
    const conns = await connections();
    const p = url.searchParams;
    const q: LibraryQuery = parseLibraryQuery({ text: p.get("text") ?? "", category: p.get("category") ?? "", domain: p.get("domain") ?? "", protocol: p.get("protocol") ?? "", sort: p.get("sort") ?? undefined });
    const key = JSON.stringify([q.text, q.domain, q.protocol]);
    if (taxonomy?.key !== key) taxonomy = { key, value: libraryTaxonomy(conns, { q: q.text || undefined, domain: q.domain || undefined, protocol: q.protocol || undefined }).catch(() => undefined) };
    const cursor = p.get("cursor");
    const [r, tax] = await Promise.all([
      searchLibraries(conns, { q: q.text || undefined, taxonomy: q.category || undefined, domain: q.domain || undefined, protocol: q.protocol || undefined, sort: q.sort, limit: PAGE, facets: !cursor, ...(cursor ? { cursor } : {}) }),
      taxonomy.value,
    ]);
    const used = usage();
    const hits = markShadowed(r.parts, conns.map((c) => c.id));
    const thumbs = Object.fromEntries(hits.filter((h) => h.thumbnail).map((h) => [h.thumbnail!.sha256, blobUrl(h.library, h.thumbnail!)]));
    const model = libraryViewModel({
      query: q,
      ...(tax ? { drill: drillDown(tax.nodes, q.category, { facets: r.facets?.taxonomy, total: tax.total }), top: tax.nodes } : {}),
      items: hits.map((h) => itemModel(h, used)),
      total: r.total,
      // the taxonomy counts each part once; it is the whole catalog while no text, domain or protocol narrows it
      ...(tax && !q.text && !q.domain && !q.protocol ? { catalogTotal: tax.total } : {}),
      more: !!r.nextCursor,
      sources: r.libraries.map((l) => ({ id: l.id, ...(l.total !== undefined ? { total: l.total } : {}), ...(l.error ? { error: l.error } : {}) })),
      thumbs,
      loading: false,
      ...(tax ? { categoryName: categoryNamer(tax.nodes) } : {}),
      sorts: r.sorts,
    });
    const { loading: _l, loadingMore: _m, ...rest } = model;
    return { model: rest, ...(r.nextCursor ? { cursor: r.nextCursor } : {}) };
  }

  /** The library and part id of a `<library>/<id>` key. */
  async function keyed(url: URL) {
    const key = url.searchParams.get("key") ?? "";
    const [libraryId, ...rest] = key.split("/");
    const partId = rest.join("/");
    const conn = (await connections()).find((c) => c.id === libraryId);
    if (!conn || !partId) throw new Error(`no part ${key} in the project's libraries`);
    return { conn, partId };
  }

  /** A revision's pictures as this server's URLs (verified and cached by `parts/blob`). */
  const pictureUrls = (library: string, env: Parameters<typeof pageImages>[0]) => Object.fromEntries(pageImages(env).map((i) => [i.sha256, blobUrl(library, i)]));

  /** A part's pages: its revision's specifications, dimensions, interfaces, CAD and artifacts (a revision never changes, so the client keeps them). */
  async function pages(url: URL) {
    const { conn, partId } = await keyed(url);
    try {
      const asked = Number(url.searchParams.get("revision"));
      const revision = Number.isInteger(asked) && asked > 0 ? asked : await conn.client.getPart(partId).then((r) => r.part.recommendedRevision ?? r.part.latestRevision);
      const envelope = await conn.client.getRevision(partId, revision);
      return partPages(envelope, { urls: pictureUrls(conn.id, envelope) });
    } catch (e) {
      throw explainCloudError(e, conn, partId);
    }
  }

  /** The part's prices by source: what its library serves, nothing else. A refusal comes back in `unavailable`, with what to do. */
  async function prices(url: URL) {
    const { conn, partId } = await keyed(url);
    return partPrices(conn, partId);
  }

  async function part(url: URL) {
    const { conn, partId } = await keyed(url);
    try {
      const { part, revisions } = await conn.client.getPart(partId);
      const asked = Number(url.searchParams.get("revision"));
      const revision = Number.isInteger(asked) && asked > 0 ? asked : (part.recommendedRevision ?? part.latestRevision);
      const envelope = await conn.client.getRevision(partId, revision);
      const tax = await taxonomy?.value;
      const preview = previewModel({ part, revisions, envelope, library: { id: conn.id, url: conn.url }, usage: usage().get(partId), ...(tax ? { categoryName: categoryNamer(tax.nodes) } : {}) });
      // the verification record among the evidence says the part's status (PB-932); one that cannot be read reads as unverified
      const record = preview.verification
        ? await conn.client.downloadBlob(preview.verification.sha256, { size: preview.verification.size }).then(
            (bytes) => parseVerificationRecord(Buffer.from(bytes).toString("utf8")),
            () => null,
          )
        : undefined;
      return detailModel(preview, {
        pages: partPages(envelope, { urls: pictureUrls(conn.id, envelope) }),
        hasPrices: true,
        ...previewTrust(preview, record),
        ...(part.thumbnail ? { thumb: blobUrl(conn.id, part.thumbnail) } : {}),
        ...(preview.glb ? { model: blobUrl(conn.id, { sha256: preview.glb.sha256, size: preview.glb.size, mediaType: "model/gltf-binary" }) } : {}),
      });
    } catch (e) {
      throw explainCloudError(e, conn, partId);
    }
  }

  /** Library parts' thumbnails by `library/id` (null: the library has none), kept until the project changes. */
  const pictures = new Map<string, Promise<string | null>>();

  /** `parts list`, each library part with its picture from its library, as the Project Parts page shows it. */
  async function project(check: boolean) {
    const report = await runCliJson<{ parts: { id: string; tier: string; library?: string; thumbnail?: string }[] }>(root, ["parts", "list", ...(check ? ["--check"] : [])]);
    const conns = await connections().catch(() => [] as LibraryConnection[]);
    await Promise.all(
      report.parts.map(async (p) => {
        const conn = p.tier === "catalog" && p.library ? conns.find((c) => c.id === p.library) : undefined;
        if (!conn) return;
        const key = `${conn.id}/${p.id}`;
        if (!pictures.has(key)) {
          pictures.set(
            key,
            conn.client.getPart(p.id).then(
              (r) => (r.part.thumbnail ? blobUrl(conn.id, r.part.thumbnail) : null),
              () => {
                pictures.delete(key); // the library did not answer: ask again next time
                return null;
              },
            ),
          );
        }
        const url = await pictures.get(key);
        if (url) p.thumbnail = url;
      }),
    );
    return report;
  }

  async function blob(url: URL, res: ServerResponse) {
    const p = url.searchParams;
    const sha = p.get("sha") ?? "";
    const type = p.get("type") ?? "application/octet-stream";
    if (!SHA.test(sha) || !/^(image\/(png|jpeg|webp|svg\+xml)|model\/gltf-binary)$/.test(type)) return json(res, 400, { error: "not a part file" });
    const file = join(cacheDir, sha);
    if (!existsSync(file)) {
      const conn = (await connections()).find((c) => c.id === p.get("library"));
      if (!conn) return json(res, 404, { error: `no library ${p.get("library")}` });
      const size = Number(p.get("size"));
      const bytes = await conn.client.downloadBlob(sha, Number.isInteger(size) && size > 0 ? { size } : {});
      mkdirSync(cacheDir, { recursive: true });
      const tmp = `${file}.${process.pid}.part`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
    }
    // an SVG from a library is shown as an image only, never as a page
    res.writeHead(200, { "content-type": type, "cache-control": "max-age=31536000, immutable", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" });
    res.end(readFileSync(file));
  }

  async function body(req: IncomingMessage): Promise<unknown> {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 64 << 10) throw new Error("request too large");
    }
    return JSON.parse(text);
  }

  async function vendor(req: IncomingMessage) {
    const m = (await body(req)) as { key?: unknown; kind?: unknown; revision?: unknown };
    const key = typeof m.key === "string" ? m.key : "";
    const [library, ...rest] = key.split("/");
    const partId = rest.join("/");
    const revision = Number(m.revision);
    if (!library || !/^[a-z0-9][a-z0-9._-]*$/i.test(partId) || !Number.isInteger(revision) || revision < 1) throw new Error("give a part key and a revision");
    const args = m.kind === "add" ? ["parts", "add", `${partId}@${revision}`, "--library", library] : ["parts", "update", partId, "--to", String(revision), "--library", library];
    const out = await runCliJson<{ results: { id: string; status: string; revision?: number; message?: string }[] }>(root, args);
    taxonomy = undefined;
    const self = out.results.find((x) => x.id === partId);
    const conflict = out.results.find((x) => x.status === "conflict");
    if (conflict) throw new Error(`${conflict.id}: ${conflict.message ?? "conflict"}`);
    return { message: `${partId}@${self?.revision ?? revision} ${self?.status ?? "added"} from ${library}` };
  }

  /** Keep the units to build, or a line's chosen offer, in the project (parts/bom.json), through the CLI. */
  async function saveBom(req: IncomingMessage) {
    const m = (await body(req)) as { units?: unknown; line?: unknown; offer?: unknown };
    if (typeof m.units === "number") {
      if (!Number.isInteger(m.units) || m.units < 1 || m.units > 1_000_000) throw new Error("units is a whole number from 1 to 1,000,000");
      return runCliJson(root, ["bom", "units", String(m.units)]);
    }
    // a line key is a part id, with an ordering code after "#"; an offer id never starts with a dash
    if (typeof m.line !== "string" || !m.line || m.line.startsWith("-") || m.line.length > 300) throw new Error("give units, or a line and an offer");
    if (m.offer !== null && (typeof m.offer !== "string" || !m.offer || m.offer.startsWith("-") || m.offer === "auto" || m.offer.length > 300)) throw new Error("give the offer's id, or null for the best offer");
    return runCliJson(root, ["bom", "choose", m.line, m.offer ?? "auto"]);
  }

  /** Ask the library for its current offers for the project's parts (parts/offers.json), through the CLI. Says what came back, not how. */
  async function refreshOffers() {
    const r = await runCliJson<{ id: string; status: string; offers?: number }[]>(root, ["parts", "offers"]);
    const got = r.filter((x) => x.status === "vendored");
    const offers = got.reduce((n, x) => n + (x.offers ?? 0), 0);
    return { message: got.length ? `The library gave ${offers} offer${offers === 1 ? "" : "s"} for ${got.length} part${got.length === 1 ? "" : "s"}.` : "The library holds no offers for this project's parts." };
  }

  return {
    changed() {
      libs = undefined;
      taxonomy = undefined;
      pictures.clear();
    },
    async handle(req, res, url, write) {
      const route = url.pathname.slice(PARTS_PREFIX.length);
      try {
        if (route === "vendor") {
          if (req.method !== "POST") return json(res, 405, { error: "POST only" });
          if (!write.authorised) return json(res, 403, { error: "not this page's session" });
          return json(res, 200, await vendor(req));
        }
        if (route === "bom" && req.method === "POST") {
          if (!write.authorised) return json(res, 403, { error: "not this page's session" });
          return json(res, 200, await saveBom(req));
        }
        if (route === "offers") {
          if (req.method !== "POST") return json(res, 405, { error: "POST only" });
          if (!write.authorised) return json(res, 403, { error: "not this page's session" });
          return json(res, 200, await refreshOffers());
        }
        if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "GET only" });
        switch (route) {
          case "library":
            return json(res, 200, await library(url));
          case "part":
            return json(res, 200, await part(url));
          case "pages":
            return json(res, 200, await pages(url));
          case "prices":
            return json(res, 200, await prices(url));
          case "blob":
            return await blob(url, res);
          case "project":
            return json(res, 200, await project(!!url.searchParams.get("check")));
          case "bom":
            return json(res, 200, await runCliJson(root, ["bom"]));
          default:
            return json(res, 404, { error: `no parts route ${route}` });
        }
      } catch (e) {
        if (!res.headersSent) json(res, 502, { error: (e as Error).message });
        else res.end();
      }
    },
  };
}
