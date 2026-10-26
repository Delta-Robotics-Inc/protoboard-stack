/**
 * The `library` and `bom` view tabs (registry views, PB-902, PB-904), for
 * shells that draw the registry's views themselves (the web shell). Their
 * data comes from the shell through `PartsDataProvider` (the web shell asks
 * `protoboard dev`); VS Code draws the same components in native slots and
 * editor tabs instead.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, Icon, IconButton, cx } from "@deltarobotics/uhd-viewer/components";
import type { ViewProps } from "../types.js";
import { bomCsv } from "@protoboardai/core/bom";
import { BomEditor } from "./BomEditor.js";
import { EMPTY_QUERY, sortLocally } from "./library-data.js";
import { LibraryPage } from "./LibraryPage.js";
import type { BomModel, LibraryModel, LibraryQuery, PartDetailModel, PartDetailTab, PartPages, PartPagesRef, PartPricesModel, ProjectPartsModel } from "./model.js";
import { PartDetail } from "./PartDetail.js";
import { ProjectPartsPage } from "./ProjectPartsPage.js";
import { rev } from "./revision.js";
import { PartsSurface } from "./Surface.js";

/** A library search's page: the model without the view's own loading state, and the cursor of the next page. */
export interface LibraryPageResult {
  model: Omit<LibraryModel, "loading" | "loadingMore">;
  cursor?: string;
}

/** What a shell offers the parts views. Every method may fail; the views show why. */
export interface PartsData {
  search(query: LibraryQuery, cursor?: string): Promise<LibraryPageResult>;
  part(key: string, revision?: number): Promise<PartDetailModel>;
  /** A part's pages, for the cards' text carousel (PB-918). */
  pages?(ref: PartPagesRef): Promise<PartPages>;
  /** A part's prices by source, from its library. */
  prices?(key: string): Promise<PartPricesModel>;
  /** Add (or update, or re-pin) a part in the project; the message says what happened. */
  vendor?(key: string, kind: "add" | "update" | "switch", revision: number): Promise<string>;
  projectParts?(check?: boolean): Promise<ProjectPartsModel>;
  bom?(): Promise<BomModel>;
  /** Keep the units to build, or the offer chosen for a line (`null`: the best offer again), in the project. */
  saveBom?(change: { units: number } | { line: string; offer: string | null }): Promise<void>;
  /** Ask the library for its current offers for the project's parts (parts/offers.json); the message says what came back. */
  refreshOffers?(): Promise<string>;
  openLink?(url: string): void;
  /** Where a part's definition is written, opened by the host. */
  openSource?(file: string, line?: number): void;
}

const Ctx = createContext<PartsData | null>(null);

export function PartsDataProvider({ data, children }: { data: PartsData | null; children: ReactNode }) {
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export const usePartsData = () => useContext(Ctx);


/** The library's state over a `PartsData`: the query, the pages loaded, and the next one. */
export function useLibrary(data: PartsData | null) {
  const [query, setQuery] = useState<LibraryQuery>(EMPTY_QUERY);
  const [model, setModel] = useState<LibraryModel>({ query: EMPTY_QUERY, crumbs: [], categories: [], level: { path: "", name: "All categories", count: 0 }, sort: { value: "name", options: ["name", "manufacturer"], local: true }, topCategories: [], total: 0, libraries: [], items: [], more: false, loading: true });
  const cursor = useRef<string | undefined>(undefined);
  const seq = useRef(0);
  const load = useCallback(
    async (q: LibraryQuery) => {
      if (!data) return;
      const n = ++seq.current;
      setModel((m) => ({ ...m, query: q, loading: true, error: undefined }));
      try {
        const r = await data.search(q);
        if (n !== seq.current) return;
        cursor.current = r.cursor;
        setModel({ ...r.model, loading: false });
      } catch (e) {
        if (n === seq.current) setModel((m) => ({ ...m, loading: false, items: [], total: 0, error: (e as Error).message }));
      }
    },
    [data],
  );
  useEffect(() => void load(query), [load, query]);
  const loadMore = useCallback(async () => {
    if (!data || !cursor.current) return;
    const n = seq.current;
    setModel((m) => (m.loadingMore ? m : { ...m, loadingMore: true }));
    try {
      const r = await data.search(query, cursor.current);
      if (n !== seq.current) return;
      cursor.current = r.cursor;
      // an order made here covers every part loaded, so the new page is ordered in with the rest
      setModel((m) => {
        const items = [...m.items, ...r.model.items.filter((x) => !m.items.some((y) => y.key === x.key))];
        return { ...m, items: m.sort.local ? sortLocally(items, m.sort.value) : items, more: r.model.more, loadingMore: false };
      });
    } catch (e) {
      if (n === seq.current) setModel((m) => ({ ...m, loadingMore: false, error: (e as Error).message }));
    }
  }, [data, query]);
  return { model, query, setQuery: (q: Partial<LibraryQuery>) => setQuery((old) => ({ ...old, ...q })), reload: () => load(query), loadMore };
}

function Unavailable({ what }: { what: string }) {
  return (
    <div className="grid size-full place-items-center bg-canvas">
      <EmptyState icon={<Icon name="plug-zap" size={26} strokeWidth={1.25} />} title={`No ${what} here`}>
        This page was opened without the project's parts service; run <code>protoboard dev</code> on the project.
      </EmptyState>
    </div>
  );
}

/** The `library` tab: the full-page library, a part's detail in place of the grid, and the project's parts. */
export function LibraryView(_: ViewProps) {
  const data = usePartsData();
  const lib = useLibrary(data);
  const [mode, setMode] = useState<"browse" | "project">("browse");
  const [open, setOpen] = useState<{ key: string; tab?: PartDetailTab; revision?: number } | null>(null);
  const [detail, setDetail] = useState<PartDetailModel | { error: string } | null>(null);
  const [project, setProject] = useState<ProjectPartsModel | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!data || !open) return setDetail(null);
    let live = true;
    setDetail(null);
    data.part(open.key, open.revision).then(
      (d) => live && setDetail(d),
      (e: Error) => live && setDetail({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [data, open]);
  const loadProject = useCallback(
    async (check = false) => {
      if (!data?.projectParts) return;
      setProject((p) => (p ? { ...p, loading: true } : { parts: [], counts: { total: 0, library: 0, researched: 0, designed: 0, updates: 0, diverged: 0 }, loading: true }));
      await data.projectParts(check).then(setProject, (e: Error) => setProject((p) => ({ ...(p ?? { parts: [], counts: { total: 0, library: 0, researched: 0, designed: 0, updates: 0, diverged: 0 } }), loading: false, error: e.message })));
    },
    [data],
  );
  // first the offline list (what the project pins), then what the libraries recommend: each part's sync status
  const listed = useRef(false);
  useEffect(() => {
    if (mode !== "project" || project || listed.current) return;
    listed.current = true;
    void loadProject().then(() => loadProject(true));
  }, [mode, project, loadProject]);
  if (!data) return <Unavailable what="library" />;
  const vendor = async (key: string, kind: "add" | "update" | "switch", revision: number) => {
    if (!data.vendor) return;
    setNote(`${kind === "add" ? "Adding" : "Updating"} ${key.split("/").pop()}…`);
    try {
      setNote(await data.vendor(key, kind, revision));
      void lib.reload();
      // the project's parts changed: list them again, with the libraries' word
      if (mode === "project") void loadProject(true);
      else {
        listed.current = false;
        setProject(null);
      }
      if (open?.key === key) setOpen({ ...open });
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const item = (key: string) => lib.model.items.find((x) => x.key === key);
  const part = (id: string) => project?.parts.find((x) => x.id === id);
  const keyOf = (id: string) => {
    const p = part(id);
    return p?.tier === "catalog" && p.library ? `${p.library}/${id}` : undefined;
  };
  // a part's detail goes back to the list it was opened from: the library, or the Project Parts page
  const shown = detail && !("error" in detail) ? { ...detail, back: mode === "project" ? "Project parts" : "Library", backShortcut: "Alt+←", ...(data?.prices ? { hasPrices: true } : {}) } : detail;
  return (
    <div className="flex size-full flex-col bg-background pt-[var(--uhd-inset-top,0px)]">
      {!open && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle px-3 py-1">
          <IconButton icon="library-big" label="Browse the library" pressed={mode === "browse"} onClick={() => setMode("browse")} />
          <IconButton icon="package" label="The project's parts" pressed={mode === "project"} onClick={() => setMode("project")} disabled={!data.projectParts} />
          {note && <span className="ml-2 min-w-0 truncate text-[12px] text-fg-muted" role="status">{note}</span>}
        </div>
      )}
      {/* the list stays where it was while a part is open over it: its scroll position and its cards' pages are kept (PB-918) */}
      <div className="relative min-h-0 flex-1">
        <div className={cx("absolute inset-0", open && "invisible")} inert={!!open} aria-hidden={open ? true : undefined}>
          {mode === "project" ? (
              <ProjectPartsPage
                model={project ?? { parts: [], counts: { total: 0, library: 0, researched: 0, designed: 0, updates: 0, diverged: 0 }, loading: true }}
                actions={{
                  open: (id) => {
                    const key = keyOf(id);
                    const p = part(id);
                    if (key) setOpen({ key });
                    else if (p && data.openSource) data.openSource(p.file, p.line);
                  },
                  compare: (id) => {
                    const key = keyOf(id);
                    if (key) setOpen({ key, tab: "revisions" });
                  },
                  ...(data.openSource
                    ? {
                        openSource: (id: string) => {
                          const p = part(id);
                          if (p) data.openSource!(p.file, p.line);
                        },
                      }
                    : {}),
                  ...(data.vendor
                    ? {
                        update: (id: string) => {
                          const key = keyOf(id);
                          const p = part(id);
                          if (key && p?.recommended !== undefined) void vendor(key, "update", p.recommended);
                        },
                        restore: (id: string) => {
                          const key = keyOf(id);
                          const p = part(id);
                          if (!key || typeof p?.revision !== "number") return;
                          if (window.confirm(`Restore ${p.name} to ${rev(p.revision)}? Your edits to its vendored files are replaced by that revision.`)) void vendor(key, "add", p.revision);
                        },
                      }
                    : {}),
                  check: () => loadProject(true),
                  openLibrary: () => setMode("browse"),
                  ...(data.pages ? { pages: data.pages } : {}),
                }}
              />
          ) : (
              <LibraryPage
                model={lib.model}
                actions={{
                  query: lib.setQuery,
                  open: (key, tab) => setOpen({ key, ...(tab ? { tab } : {}) }),
                  add: (key) => {
                    const it = item(key);
                    if (it) void vendor(key, "add", it.revision);
                  },
                  update: (key) => {
                    const it = item(key);
                    if (it?.update !== undefined) void vendor(key, "update", it.update);
                  },
                  loadMore: () => void lib.loadMore(),
                  retry: () => void lib.reload(),
                  ...(data.pages ? { pages: data.pages } : {}),
                }}
              />
          )}
        </div>
        {open && (
          <div className="absolute inset-0">
            {shown && "error" in shown ? (
            <div className="grid size-full place-items-center">
              <EmptyState icon={<Icon name="triangle-alert" size={24} />} title="The part did not load">
                {shown.error}
                <span className="mt-3 block">
                  <IconButton icon="arrow-left" label={mode === "project" ? "Back to Project parts" : "Back to the library"} onClick={() => setOpen(null)} />
                </span>
              </EmptyState>
            </div>
          ) : shown ? (
            <PartDetail
              model={shown}
              tab={open.tab}
              actions={{
                act: (kind, revision) => void vendor(open.key, kind, revision),
                revision: (revision) => setOpen({ ...open, revision }),
                back: () => setOpen(null),
                openLink: (url) => (data.openLink ? data.openLink(url) : window.open(url, "_blank", "noopener")),
                ...(data.prices ? { prices: () => data.prices!(open.key) } : {}),
              }}
            />
          ) : (
            <PartsSurface place="editor">
              <div className="grid size-full place-items-center">
                <Icon name="loader" size={20} className="animate-spin text-fg-muted" aria-label="Loading the part" />
              </div>
            </PartsSurface>
          )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Hand the reader a file the page made (a browser download). */
function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The `bom` tab: the bill of materials of the project. A line opens its
 * part: a library part's page in place of the bill (back returns to it), a
 * part of the project's own where it is written, when the shell can open
 * source. "Show in the viewer" goes to the diagram at the part's first
 * place.
 */
export function BomView({ host }: ViewProps) {
  const data = usePartsData();
  const [bom, setBom] = useState<BomModel | { error: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ key: string; revision?: number } | null>(null);
  const [detail, setDetail] = useState<PartDetailModel | { error: string } | null>(null);
  // which library each of the project's parts comes from, asked once
  const parts = useRef<Promise<ProjectPartsModel> | null>(null);
  const load = useCallback(() => {
    if (!data?.bom) return Promise.resolve();
    return data.bom().then(setBom, (e: Error) => setBom({ error: e.message }));
  }, [data]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!data || !open) return setDetail(null);
    let live = true;
    setDetail(null);
    data.part(open.key, open.revision).then(
      (d) => live && setDetail(d),
      (e: Error) => live && setDetail({ error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [data, open]);
  if (!data?.bom) return <Unavailable what="bill of materials" />;
  if (!bom)
    return (
      <div className="grid size-full place-items-center bg-background">
        <Icon name="loader" size={20} className="animate-spin text-fg-muted" aria-label="Loading the bill of materials" />
      </div>
    );
  if ("error" in bom)
    return (
      <div className="grid size-full place-items-center bg-background">
        <EmptyState icon={<Icon name="sheet" size={26} strokeWidth={1.25} />} title="No bill of materials">{bom.error}</EmptyState>
      </div>
    );
  const openLink = (url: string) => (data.openLink ? data.openLink(url) : void window.open(url, "_blank", "noopener"));
  const openPart = async (line: { definition: string; item: string; instances: string[] }) => {
    setNote(null);
    const list = data.projectParts ? await (parts.current ??= data.projectParts()).catch(() => ((parts.current = null), undefined)) : undefined;
    const p = list?.parts.find((x) => x.id === line.definition);
    if (p?.tier === "catalog" && p.library) return setOpen({ key: `${p.library}/${p.id}` });
    if (p && data.openSource) return data.openSource(p.file, p.line);
    if (host.openSource) return host.openSource({ defId: line.definition, ...(line.instances[0] ? { instancePath: line.instances[0] } : {}) });
    if (line.instances.length && host.openView) return focus(line);
    setNote(`${line.item} is a part of this project, not of a library: it has no page to open here.`);
  };
  const focus = (line: { instances: string[] }) => {
    const path = line.instances[0];
    if (!path || !host.openView) return;
    const at = path.split("/");
    host.openView("diagram", at.slice(0, -1).join("/"), { select: at[at.length - 1] });
  };
  if (open)
    return (
      <div className="size-full bg-background pt-[var(--uhd-inset-top,0px)]">
        {detail && "error" in detail ? (
          <div className="grid size-full place-items-center">
            <EmptyState icon={<Icon name="triangle-alert" size={24} />} title="The part did not load">
              {detail.error}
              <span className="mt-3 block">
                <IconButton icon="arrow-left" label="Back to the bill of materials" onClick={() => setOpen(null)} />
              </span>
            </EmptyState>
          </div>
        ) : detail ? (
          <PartDetail
            model={{ ...detail, back: "Bill of materials" }}
            actions={{
              act: (kind, revision) => {
                if (!data.vendor) return;
                void data.vendor(open.key, kind, revision).then(
                  (message) => (setNote(message), setOpen({ ...open }), load()),
                  (e: Error) => setNote(e.message),
                );
              },
              revision: (revision) => setOpen({ ...open, revision }),
              back: () => setOpen(null),
              openLink,
            }}
          />
        ) : (
          <PartsSurface place="editor">
            <div className="grid size-full place-items-center">
              <Icon name="loader" size={20} className="animate-spin text-fg-muted" aria-label="Loading the part" />
            </div>
          </PartsSurface>
        )}
      </div>
    );
  return (
    <div className="flex size-full flex-col pt-[var(--uhd-inset-top,0px)]">
      {note && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle bg-background px-3 py-1 text-[12px] text-fg-muted" role="status">
          <span className="min-w-0 flex-1 truncate">{note}</span>
          <IconButton icon="x" size="sm" label="Dismiss" onClick={() => setNote(null)} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <BomEditor
          model={bom}
          actions={{
            openLink,
            openPart: (l) => void openPart(l),
            ...(host.openView ? { focus } : {}),
            ...(data.openSource ? { openRow: (l) => l.source && data.openSource!(l.source.file, l.source.line) } : {}),
            ...(data.saveBom
              ? {
                  // the bill as the project now holds it, so it is still right after a visit to a part's page
                  setUnits: (units) => void data.saveBom!({ units }).then(load, (e: Error) => setBom({ error: e.message })),
                  chooseOffer: (line, offer) => void data.saveBom!({ line, offer }).then(load, (e: Error) => setBom({ error: e.message })),
                }
              : {}),
            ...(data.refreshOffers
              ? {
                  refreshOffers: () => {
                    setNote("Asking the library for its current offers…");
                    void data.refreshOffers!().then(
                      (message) => (setNote(message), load()),
                      (e: Error) => setNote(`The offers were not refreshed: ${e.message}`),
                    );
                  },
                }
              : {}),
            exportCsv: (shown) => downloadText(`${shown.project}-bom.csv`, bomCsv(shown), "text/csv;charset=utf-8"),
          }}
        />
      </div>
    </div>
  );
}
