/**
 * The Atlas's inspector card: a preview of the selected node at the top
 * (an image file's own pixels, else a large glyph of its kind), what it is
 * (its kind, path, owner modules, size, status, when it was created, the
 * artifacts that name it, what produced it), its first neighbors as links,
 * and where to go from here (open the file, or copy its path; a module's
 * source and its diagram). A selected group gets a summary card with its
 * first members.
 *
 * An image is fetched the way every view fetches a project file: through
 * the artifact that names it and the host's `artifactUrl` (the dev
 * server's artifact route, on the dev page and in VS Code alike). An image
 * no artifact names (a render an operation made, an unlinked photo) comes
 * from the Atlas's own data (`imageUrl`: the dev server's image route, which
 * serves only images the index lists). When there is no URL, or the image
 * does not load, the preview falls back to the glyph and says why.
 */
import { useEffect, useState } from "react";
import type { UhdBundle } from "@deltarobotics/uhd";
import { Badge, Icon, IconButton, InspectorPanel, PropertyRow, Section, StatusDot, cx, type Tone } from "@deltarobotics/uhd-viewer/components";
import { ATLAS_KINDS, isUnlinkedFile, type AtlasNode, type EdgeType, type NodeStatus } from "@protoboardai/core/atlas";
import { definition } from "../applies.js";
import { artifactHref } from "../drawing/boards.js";
import type { HostAdapter } from "../types.js";
import type { AtlasData } from "./data.js";
import { KIND_ICON } from "./palette.js";
import { formatDay } from "./timeline.js";

/** How a link reads from the node at each end. */
const OUT: Record<EdgeType, string> = { has: "holds", "made-from": "made from", harness: "wired to", link: "linked to", uses: "uses", contains: "contains" };
const IN: Record<EdgeType, string> = { has: "belongs to", "made-from": "makes", harness: "wired to", link: "linked to", uses: "used by", contains: "inside" };

const STATUS: Record<NodeStatus, { tone: Tone; label: string }> = {
  ok: { tone: "ok", label: "Present" },
  missing: { tone: "warning", label: "Missing" },
  remote: { tone: "info", label: "Remote" },
  unused: { tone: "neutral", label: "Not used" },
  failed: { tone: "error", label: "Unreadable" },
};

/** A byte count for people: 512 B, 12.4 kB, 3.1 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = bytes / 1000;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/**
 * What links a file that no module names, in the census's terms: an
 * operation produced it (linked by its record), or nothing points to it
 * (unlinked). Undefined for a file a module names, and for anything else.
 */
export function fileLinkage(n: AtlasNode): string | undefined {
  if (!n.file || n.file.owners.length) return undefined;
  if (n.file.producedBy) return `Produced by the ${operationName(n.file.producedBy)} operation, attached to no module.`;
  if (isUnlinkedFile(n)) return "Unlinked: no artifact, folder artifact or operation points to it.";
  return undefined;
}

/** An operation record's name: its file name without the timestamp and .json ("operations/2026-01-01T00-00-00-000Z-tech-docs.json" is "tech-docs"). */
export function operationName(record: string): string {
  const file = record.slice(record.lastIndexOf("/") + 1).replace(/\.json$/i, "");
  return file.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d+)?Z-/, "") || file;
}

/** Where a creation time came from, in the inspector's words. */
const CREATED_FROM = { git: "git", birthtime: "file system", mtime: "last modified" } as const;

/** Names longer than this (characters) are cut short in the header: the card repeats them whole. */
const LONG_NAME = 28;

/** A value a row may cut short, whole on hover. */
const whole = (text: string | undefined) =>
  text ? (
    // a long value (cut short in its row) whole in a tooltip above the row: never on top of it
    <span data-tooltip={text.length > 24 ? text : undefined} data-tooltip-side="top">
      {text}
    </span>
  ) : undefined;

/** A path the host can open: a project file (not a package's, not a URL). */
const projectPath = (n: AtlasNode) => (n.path && !n.path.startsWith("package:") && n.status !== "remote" ? n.path : undefined);

export interface InspectorNeighbor {
  node: AtlasNode;
  type: EdgeType;
  out: boolean;
}

/** Image extensions a browser draws. */
const BROWSER_IMAGES = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp", "ico", "apng"]);
/** Image extensions it does not. */
const OTHER_IMAGES = new Set(["heic", "heif", "tif", "tiff"]);

/** What the preview shows: an image URL, or the glyph and, when the node is an image, why its pixels are not shown. */
export type PreviewSource = { url: string } | { reason?: string };

/**
 * Where to fetch an image node's pixels: the first artifact naming the file
 * that the host can serve (`artifactHref`, the dev server's artifact route).
 * Anything else gets the glyph; an image says why it has no picture.
 */
export function previewSource(node: AtlasNode, bundle: UhdBundle | undefined, host: Pick<HostAdapter, "artifactUrl">, data?: Pick<AtlasData, "imageUrl"> | null): PreviewSource {
  const ext = node.file?.ext ?? "";
  if (OTHER_IMAGES.has(ext)) return { reason: `Browsers cannot draw .${ext} images, so there is no preview.` };
  if (!BROWSER_IMAGES.has(ext)) return {};
  // first as every view fetches a module's file: the artifact that names it
  if (host.artifactUrl && bundle) {
    for (const ref of node.file?.artifacts ?? []) {
      const def = definition(bundle, ref.definition) ?? bundle.scenarios?.flatMap((sc) => sc.definitions ?? []).find((d) => d.id === ref.definition);
      const a = def?.artifacts?.find((x) => x.id === ref.id);
      const url = def && a ? artifactHref(host as HostAdapter, def, a) : undefined;
      if (url) return { url };
    }
  }
  // else an image the index lists, through the Atlas's own data (the dev server's image route)
  const local = node.path && !node.path.startsWith("package:") && node.id.startsWith("file:") ? data?.imageUrl?.(node.path) : undefined;
  if (local) return { url: local };
  if (!host.artifactUrl && !data?.imageUrl) return { reason: "This host cannot load project files, so there is no preview." };
  return {
    reason: node.file?.artifacts.length
      ? "The artifact naming this image has no file the viewer can fetch, so there is no preview."
      : "The viewer loads only files an artifact names, and no artifact names this one, so there is no preview.",
  };
}

/** The top of the inspector: the image itself, or a file (or folder) outline with the kind's icon inside. */
export function AtlasPreview({ node, bundle, host, data }: { node: AtlasNode; bundle?: UhdBundle; host: HostAdapter; data?: AtlasData | null }) {
  const source = previewSource(node, bundle, host, data);
  const url = "url" in source ? source.url : undefined;
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [url]);
  const reason = failed ?? ("reason" in source ? source.reason : undefined);
  if (url && !failed) {
    return (
      <figure className="m-0 mt-2 grid h-[150px] place-items-center overflow-hidden rounded-md border border-line bg-sunken" data-pb-atlas-preview="image">
        <img
          src={url}
          alt={node.label}
          className="max-h-full max-w-full object-contain"
          onError={() => {
            setFailed(`The image could not be loaded from ${url}.`);
            console.warn(`Atlas: the preview of ${node.path ?? node.id} could not be loaded from ${url}`);
          }}
        />
      </figure>
    );
  }
  const folder = node.id.startsWith("dir:");
  return (
    <figure className="m-0 mt-2 flex flex-col items-center gap-1.5 rounded-md border border-line bg-sunken px-3 py-4" data-pb-atlas-preview={reason ? "fallback" : "glyph"}>
      <span className="relative grid place-items-center text-fg-faint" aria-hidden>
        <Icon name={folder ? "folder" : "file"} size={76} strokeWidth={0.9} />
        <Icon name={KIND_ICON[node.kind]} size={26} strokeWidth={1.5} className={cx("absolute text-fg-muted", folder ? "top-[30px]" : "top-[28px]")} />
      </span>
      {node.file?.ext && <span className="font-code text-[10.5px] text-fg-muted uppercase">.{node.file.ext}</span>}
      {reason && (
        <figcaption role="note" className="text-center text-[11px] text-fg-muted">
          {reason}
        </figcaption>
      )}
    </figure>
  );
}

export interface AtlasInspectorProps {
  node: AtlasNode;
  neighbors: readonly InspectorNeighbor[];
  data: AtlasData | null;
  host: HostAdapter;
  /** The loaded model: where an image's artifact is found for its preview. */
  bundle?: UhdBundle;
  onSelect(id: string): void;
  onClose(): void;
  /** Fold the right panel away (the selection stays); a button brings it back. */
  onCollapse?(): void;
  className?: string;
}

export function AtlasInspector({ node, neighbors, data, host, bundle, onSelect, onClose, onCollapse, className }: AtlasInspectorProps) {
  const kind = ATLAS_KINDS[node.kind];
  const status = STATUS[node.status];
  const path = projectPath(node);
  const def = node.definition;
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => host.notify?.("Path copied"),
      () => host.notify?.("The path could not be copied", "warning"),
    );
  };
  const shown = neighbors.slice(0, 6);
  const linkage = fileLinkage(node);
  return (
    <InspectorPanel
      className={className}
      title={node.label}
      actions={
        <>
          {onCollapse && <IconButton icon="panel-right-close" size="sm" label="Hide the inspector" aria-expanded onClick={onCollapse} />}
          <IconButton icon="x" size="sm" label="Clear the selection" onClick={onClose} />
        </>
      }
    >
      <AtlasPreview node={node} bundle={bundle} host={host} data={data} />
      {/* the header cuts a long name short: the whole of it here */}
      {[...node.label].length > LONG_NAME && <p className="m-0 mt-2 text-[12px] [overflow-wrap:anywhere] text-fg">{node.label}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5" data-pb-atlas-node={node.id}>
        <Badge tone={node.kind === "module" ? "accent" : "neutral"}>{kind.one}</Badge>
        <span className="flex items-center gap-1 text-[11px] text-fg-muted">
          <StatusDot tone={status.tone} label={status.label} />
          {status.label}
          {node.reason ? ` (${node.reason})` : ""}
        </span>
      </div>
      {linkage && <p className="m-0 mt-1.5 text-[11px] text-fg-muted">{linkage}</p>}
      <Section title="About">
        <PropertyRow name="Path" value={whole(node.path)} mono />
        <PropertyRow name="Folder" value={whole(node.folder || undefined)} mono />
        {node.url && <PropertyRow name="URL" value={whole(node.url)} mono />}
        {node.file && <PropertyRow name="Size" value={formatSize(node.file.size)} />}
        {node.created && <PropertyRow name="Created" value={`${formatDay(node.created.at)} (${CREATED_FROM[node.created.from]})`} />}
        {node.file && <PropertyRow name="Modules" value={node.file.owners.length ? whole(node.file.owners.join(", ")) : "None"} />}
        {node.file?.producedBy && <PropertyRow name="Produced by" value={whole(node.file.producedBy)} mono />}
        {def && <PropertyRow name="Definition" value={whole(def.id)} mono />}
        {def && <PropertyRow name="Tier" value={def.tier} />}
        {def && <PropertyRow name="Instances" value={def.root ? "the root" : def.instances.length ? String(def.instances.length) : "none"} />}
        <PropertyRow name="Links" value={String(neighbors.length)} />
      </Section>
      {!!node.file?.artifacts.length && (
        <Section title="Named by" count={node.file.artifacts.length}>
          <ul className="m-0 list-none p-0 text-[11px]">
            {node.file.artifacts.map((a) => (
              <li key={`${a.definition}#${a.id}`} className="truncate py-0.5">
                <span className="font-code text-fg">{a.name ?? a.id}</span>
                <span className="text-fg-muted"> · {a.definition}</span>
                {a.role && <span className="text-fg-faint"> · {a.role}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {shown.length > 0 && (
        <Section title="Linked" count={neighbors.length}>
          <ul className="m-0 list-none p-0">
            {shown.map((n) => (
              <li key={`${n.node.id}~${n.type}~${n.out}`}>
                <button
                  type="button"
                  onClick={() => onSelect(n.node.id)}
                  // its path, beside the card (to its left, over the map): never over the row
                  data-tooltip={n.node.path ?? n.node.label}
                  data-tooltip-side="left"
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded-sm border-0 bg-transparent px-1 py-0.5 text-left text-[11px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
                >
                  <span className="w-[72px] shrink-0 text-fg-muted">{n.out ? OUT[n.type] : IN[n.type]}</span>
                  <span className="min-w-0 truncate text-fg">{n.node.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {neighbors.length > shown.length && <div className="px-1 pt-0.5 text-[10px] text-fg-faint">{neighbors.length - shown.length} more</div>}
        </Section>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {path && data?.openFile && <ActionButton icon="external-link" label="Open" onClick={() => data.openFile!(path)} />}
        {path && !data?.openFile && <ActionButton icon="copy" label="Copy path" onClick={() => copy(path)} />}
        {def && host.openSource && <ActionButton icon="braces" label="Open source" onClick={() => host.openSource!({ defId: def.id })} />}
        {def && host.openView && (def.root || def.instances.length > 0) && (
          <ActionButton icon="workflow" label="Show in diagram" onClick={() => host.openView!("diagram", def.root ? "" : def.instances[0]!)} />
        )}
      </div>
    </InspectorPanel>
  );
}

/** A selected group: its name, how many, and its first members. */
export function AtlasGroupCard({ name, summary, members, more, onSelect, onFit, onClose, onCollapse, className }: { name: string; summary: string; members: readonly AtlasNode[]; more: number; onSelect(id: string): void; onFit(): void; onClose(): void; onCollapse?(): void; className?: string }) {
  return (
    <InspectorPanel
      className={className}
      title={name}
      actions={
        <>
          <IconButton icon="scan" size="sm" label="Fit the group" onClick={onFit} />
          {onCollapse && <IconButton icon="panel-right-close" size="sm" label="Hide the inspector" aria-expanded onClick={onCollapse} />}
          <IconButton icon="x" size="sm" label="Clear the selection" onClick={onClose} />
        </>
      }
    >
      {/* a folder's whole path (the map draws its last segment) */}
      {[...name].length > LONG_NAME && <p className="m-0 mt-2 font-code text-[11.5px] [overflow-wrap:anywhere] text-fg">{name}</p>}
      <p className="m-0 mt-2 text-[11px] text-fg-muted">{summary}</p>
      <ul className="m-0 mt-2 list-none p-0">
        {members.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onSelect(n.id)}
              data-tooltip={n.path ?? n.label}
              data-tooltip-side="left"
              className="flex w-full cursor-pointer items-baseline gap-2 rounded-sm border-0 bg-transparent px-1 py-0.5 text-left text-[11px] hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
            >
              <span className="min-w-0 truncate text-fg">{n.label}</span>
              <span className="ml-auto shrink-0 text-fg-faint">{ATLAS_KINDS[n.kind].one}</span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 && <div className="px-1 pt-0.5 text-[10px] text-fg-faint">{more} more</div>}
    </InspectorPanel>
  );
}

/** A small text button with an icon (the inspector's actions; the Appearance popover's Reset). */
export function ActionButton({ icon, label, onClick }: { icon: string; label: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-transparent px-2 text-[11px] text-fg hover:bg-hover focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus"
    >
      <Icon name={icon} size={13} strokeWidth={1.75} aria-hidden className="text-fg-muted" />
      {label}
    </button>
  );
}
