/**
 * Live re-fetch of a part's pinned sources (verify-part --refetch, PB-862):
 * every sources.json row that records a `sha256` is downloaded again and
 * hashed. `match` means the cited bytes are still what the publisher serves;
 * `changed` means the publisher now serves another file (re-read the facts
 * against the new file before trusting the old citation); `page` means an
 * HTML page differs, which most pages do on every request (session tokens,
 * prices, scripts), so only a re-read of its text says whether a fact moved;
 * `failed` means the download did not complete, or a file URL now answers
 * with an HTML page (login wall, bot block, expired link: the pinned copy in
 * .research/downloads is the evidence then). Rows without a sha256 are
 * listed as `unpinned`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PartFiles } from "./layout.ts";

export type RefetchStatus = "match" | "changed" | "page" | "failed" | "unpinned";

export interface RefetchResult {
  id: string;
  url: string;
  status: RefetchStatus;
  /** HTTP status, size, the new sha256, or the error. */
  detail: string;
}

export type Fetcher = (url: string) => Promise<{ status: number; body: Uint8Array; contentType?: string }>;

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 protoboard-verify-part";

export const httpFetch =
  (timeoutMs = 60_000): Fetcher =>
  async (url) => {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? undefined };
  };

/** A URL whose path names a file (a document, an image, CAD, an archive), not a page. */
export const isFileUrl = (url: string): boolean => {
  try {
    return /\.(pdf|png|jpe?g|gif|webp|svg|step|stp|stl|glb|gltf|igs|iges|zip|7z|rar|brd|sch|kicad_pcb|kicad_sch|f3d|dxf|dwg|txt|csv|json|xml)$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

export async function refetchSources(f: PartFiles, opts: { fetcher?: Fetcher; concurrency?: number } = {}): Promise<RefetchResult[]> {
  const file = join(f.root, f.evidence, "sources.json");
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
  const fetcher = opts.fetcher ?? httpFetch();
  const results: RefetchResult[] = rows.map((r, i) => ({ id: String(r.id ?? `#${i}`), url: String(r.url ?? ""), status: "unpinned", detail: "no sha256 recorded" }));
  const todo = rows.flatMap((r, i) => (typeof r.sha256 === "string" && /^https?:\/\//.test(String(r.url)) ? [i] : []));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const i = todo[next++];
      const want = String(rows[i].sha256).toLowerCase();
      try {
        const { status, body, contentType } = await fetcher(results[i].url);
        if (status < 200 || status >= 300) {
          results[i] = { ...results[i], status: "failed", detail: `HTTP ${status}` };
          continue;
        }
        const got = createHash("sha256").update(body).digest("hex");
        const html = /text\/html/i.test(contentType ?? "");
        const detail = `now ${got.slice(0, 12)}… (${body.length} bytes${contentType ? `, ${contentType.split(";")[0]}` : ""}), pinned ${want.slice(0, 12)}…`;
        if (got === want) results[i] = { ...results[i], status: "match", detail: `${body.length} bytes` };
        else if (html && isFileUrl(results[i].url)) results[i] = { ...results[i], status: "failed", detail: `a file URL answered with an HTML page (login wall, bot block or expired link); ${detail}` };
        else results[i] = { ...results[i], status: html ? "page" : "changed", detail };
      } catch (e) {
        results[i] = { ...results[i], status: "failed", detail: (e as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return results;
}

export function formatRefetch(results: RefetchResult[]): string[] {
  const count = (s: RefetchStatus) => results.filter((r) => r.status === s).length;
  return [
    `refetch: ${count("match")} match, ${count("changed")} changed, ${count("page")} page(s) differ, ${count("failed")} failed, ${count("unpinned")} unpinned`,
    ...results.filter((r) => r.status !== "match").map((r) => `  ${r.status.padEnd(9)} ${r.id}  ${r.url}  ${r.detail}`),
  ];
}
