/**
 * A part's detail, in its own editor tab (PB-902, PB-917, and PB-918's
 * design 08): the back control and the category trail at the top left; the
 * part's pictures as a carousel (arrows, dots, a strip of thumbnails, and a
 * larger view); the name, the identifiers in the mono face, the state pills,
 * the description and the actions; below, the text carousel of the cards,
 * larger, as tabs: Overview, Specs, Dimensions, Interfaces, CAD, Artifacts,
 * then Prices (by source, from the library) and Revisions. A section the
 * part has nothing for is left out. The 3D model is fetched only when the
 * CAD section is opened.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArtifactGrid, EmptyState, HostContext, Icon, IconButton, ScrollArea, cx, type ArtifactCardModel } from "@deltarobotics/uhd-viewer/components";
import { ImageCarousel, OutlineDrawing } from "./CardPages.js";
import { Segments, StepButton, stepIn, useSwipe } from "./carousel.js";
import { GlbPreview } from "./GlbPreview.js";
import type { PartArtifactGroup, PartArtifactItem, PartDetailActions, PartDetailModel, PartDetailTab, PartImage } from "./model.js";
import { fileSize } from "./part-pages.js";
import { PartStatusDot } from "./PartStatus.js";
import { PricesPanel, usePrices } from "./Prices.js";
import { rev } from "./revision.js";
import { PartsSurface } from "./Surface.js";
import { BODY, Button, Pill, Tag, Thumb, factIcon } from "./ui.js";

export const DETAIL_TABS: { id: PartDetailTab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "info" },
  { id: "specs", label: "Specs", icon: "gauge" },
  { id: "dimensions", label: "Dimensions", icon: "ruler" },
  { id: "interfaces", label: "Interfaces", icon: "plug" },
  { id: "cad", label: "CAD", icon: "box" },
  { id: "artifacts", label: "Artifacts", icon: "paperclip" },
  { id: "prices", label: "Prices", icon: "circle-dollar-sign" },
  { id: "revisions", label: "Revisions", icon: "history" },
];

/** The sections a part has something for, in order (the overview and the revisions always). */
export function detailTabs(model: PartDetailModel, actions: Pick<PartDetailActions, "prices">): typeof DETAIL_TABS {
  const p = model.pages;
  const has: Record<PartDetailTab, boolean> = {
    overview: true,
    specs: p ? p.specs.length > 0 : model.facts.length > 0,
    dimensions: !!p?.dimensions,
    interfaces: model.interfaces.length > 0,
    cad: !!p?.cad || !!model.model || !!model.modelError,
    artifacts: !!p?.artifacts.length || !!model.datasheet || model.links.length > 0 || model.evidence.length > 0,
    prices: !!model.hasPrices && !!actions.prices,
    revisions: true,
  };
  return DETAIL_TABS.filter((t) => has[t.id]);
}

/** A mesh larger than this is fetched when the reader asks, not when the section opens. */
const AUTO_MESH_BYTES = 25e6;

export interface PartDetailProps {
  model: PartDetailModel;
  actions: PartDetailActions;
  tab?: PartDetailTab;
  onTab?: (tab: PartDetailTab) => void;
}

function MainAction({ model, actions }: Pick<PartDetailProps, "model" | "actions">) {
  const a = model.action;
  if (model.busy) return <Button kind="primary" icon="loader" disabled>{model.busy}…</Button>;
  if (model.noProject) return <Button kind="primary" icon="plus" disabled title="Open a Protoboard project to add parts">Add part</Button>;
  switch (a.kind) {
    case "add":
      return <Button kind="primary" icon="plus" onClick={() => actions.act("add", a.revision)}>Add part</Button>;
    case "update":
      return <Button kind="primary" icon="download" onClick={() => actions.act("update", a.revision)}>Update to {rev(a.revision)}</Button>;
    case "switch":
      return <Button kind="primary" icon="pin" onClick={() => actions.act("switch", a.revision)}>Pin {rev(a.revision)}</Button>;
    case "pinned":
      return <Button kind="primary" icon="check" disabled>In this project</Button>;
    default:
      return <Button kind="primary" icon="plus" disabled title="The project has this id from another library">From another library</Button>;
  }
}

function Fact({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[4px] bg-[var(--pb-card)] px-3 py-3 outline-1 -outline-offset-1 outline-contrast">
      <span className={cx(BODY, "flex items-center gap-1.5 text-[11.5px] text-fg-muted")}>
        <Icon name={icon} size={13} strokeWidth={1.75} aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-ui text-[15px] leading-tight break-words text-fg">{value}</span>
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <div className={cx(BODY, "divide-y divide-line-subtle text-[13px]")}>{children}</div>;
}

/** The CAD section: a still of the model until the mesh is here; a large mesh waits for the reader to ask. */
function CadSection({ model, actions }: { model: PartDetailModel; actions: PartDetailActions }) {
  const cad = model.pages?.cad;
  const bytes = cad?.mesh ?? 0;
  const [asked, setAsked] = useState(bytes <= AUTO_MESH_BYTES);
  const want = asked && !model.model && !model.modelError && !!model.modelLazy;
  useEffect(() => {
    if (want) actions.loadModel?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, model.key, model.revision]);
  const lines = [cad?.file, cad?.origin, cad?.features ? `${cad.features} mate feature${cad.features === 1 ? "" : "s"}` : undefined, model.cad && !cad?.origin ? model.cad : undefined].filter((x): x is string => !!x);
  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-[320px] overflow-hidden rounded-[4px] bg-[var(--pb-row-head)] outline-1 -outline-offset-1 outline-contrast">
        {model.model && asked ? (
          <GlbPreview url={model.model} label={model.name} />
        ) : model.modelError ? (
          <div className="grid size-full place-items-center">
            <EmptyState icon={<Icon name="box" size={24} strokeWidth={1.25} />} title="The model did not download">
              {model.modelError}
            </EmptyState>
          </div>
        ) : model.model || model.modelLazy ? (
          <>
            {cad?.preview && <Thumb src={cad.preview} alt={`${model.name}: a still of the model`} className="size-full" iconSize={44} icon="box" />}
            <div className="absolute inset-0 grid place-items-center">
              {asked ? (
                <span role="status" className={cx(BODY, "flex items-center gap-2 rounded-full bg-[var(--pb-card)] px-3 py-1.5 text-[12px] text-fg outline-1 outline-contrast")}>
                  <Icon name="loader" size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                  Loading the 3D model{bytes ? ` (${fileSize(bytes)})` : ""}…
                </span>
              ) : (
                <Button kind="primary" icon="rotate-3d" onClick={() => setAsked(true)}>
                  Load the 3D model{bytes ? ` (${fileSize(bytes)})` : ""}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="grid size-full place-items-center">
            <EmptyState icon={<Icon name="box" size={24} strokeWidth={1.25} />} title="No 3D model">
              This revision carries CAD files, but no mesh to show here.
            </EmptyState>
          </div>
        )}
      </div>
      {lines.length > 0 && (
        <p className={cx(BODY, "flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-muted")}>
          <Icon name="box" size={13} strokeWidth={1.75} aria-hidden />
          {lines.map((l, i) => (
            <span key={l} className={i === 0 ? "font-ui text-[12px] text-fg" : undefined}>
              {i > 0 && <span aria-hidden className="mr-2 text-fg-faint">·</span>}
              {l}
            </span>
          ))}
          {model.model && asked && <span className="ml-auto text-fg-faint">Drag to orbit, scroll to zoom</span>}
        </p>
      )}
    </div>
  );
}

function Section({ tab, model, actions, prices }: { tab: PartDetailTab; model: PartDetailModel; actions: PartDetailActions; prices: ReturnType<typeof usePrices> }) {
  const p = model.pages;
  switch (tab) {
    case "overview":
      return (
        <div className={cx(BODY, "flex flex-col gap-4 text-[13px] leading-relaxed")}>
          <p className="text-fg">{model.description ?? "The library gives no description."}</p>
          {model.facts.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {model.facts.slice(0, 3).map((f) => (
                <Fact key={f.label} icon={f.icon ?? factIcon(f.label)} label={f.label} value={f.value} />
              ))}
            </div>
          )}
          {model.dependencies.length > 0 && (
            <p className="text-fg-muted">
              Comes with: <span className="font-ui text-fg">{model.dependencies.join(", ")}</span>
            </p>
          )}
          <p className="text-fg-muted">
            From <span className="text-fg">{model.library}</span>
            {model.libraryUrl && <span className="font-ui"> · {model.libraryUrl}</span>} · part id <span className="font-ui text-fg">{model.partId}</span>
          </p>
        </div>
      );
    case "specs": {
      const facts = p ? p.specs : model.facts;
      return (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {facts.map((f) => (
              <Fact key={f.label} icon={f.icon ?? factIcon(f.label)} label={f.label} value={f.value} />
            ))}
          </div>
          {(p?.specNotes ?? []).map((n) => (
            <p key={n} className={cx(BODY, "flex items-start gap-1.5 text-[12.5px] leading-snug text-fg-muted")}>
              <Icon name="info" size={13} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
              {n}
            </p>
          ))}
        </div>
      );
    }
    case "dimensions": {
      const d = p!.dimensions!;
      return (
        <div className="flex gap-4 max-[640px]:flex-col">
          {d.outline && (
            <div className="grid shrink-0 place-items-center rounded-[4px] bg-[var(--pb-card)] p-4 outline-1 -outline-offset-1 outline-contrast min-[641px]:w-[240px]">
              <OutlineDrawing outline={d.outline} width={200} height={150} />
            </div>
          )}
          <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(220px,1fr))] content-start gap-3">
            {d.rows.map((f) => (
              <Fact key={f.label} icon={f.icon ?? factIcon(f.label)} label={f.label} value={f.value} />
            ))}
          </div>
        </div>
      );
    }
    case "interfaces":
      return (
        <div className="flex flex-col gap-3">
          {p && p.interfaces.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Interfaces in short">
              {p.interfaces.chips.map((c) => (
                <Tag key={c}>{c}</Tag>
              ))}
            </div>
          )}
          <Rows>
            {model.interfaces.map((i, n) => (
              <div key={`${i.id}-${n}`} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,0.6fr)_minmax(0,1.6fr)] items-center gap-3 py-2">
                <span className="truncate text-fg">{i.name}</span>
                <span className="truncate text-fg-muted">{i.domain ?? "—"}</span>
                <span className="truncate font-ui text-[12px] text-fg">{i.protocols || "—"}</span>
              </div>
            ))}
            {model.interfaceCount > model.interfaces.length && <p className="py-2 text-fg-muted">{model.interfaceCount} interfaces in all; pins alike are folded.</p>}
          </Rows>
        </div>
      );
    case "cad":
      return <CadSection model={model} actions={actions} />;
    case "artifacts":
      return p?.artifacts.length ? (
        <div className={cx(BODY, "flex flex-col gap-4 text-[13px]")}>
          {p.artifacts.map((g) => (
            <section key={g.kind} aria-label={g.label}>
              <h3 className="flex items-center gap-1.5 pb-1 text-fg-muted">
                <Icon name={g.icon} size={13} strokeWidth={1.75} aria-hidden />
                <span className="font-ui text-[10.5px] tracking-[0.14em] uppercase">{g.label}</span>
                <span className="font-ui text-[11px] tabular-nums">{g.items.length}</span>
              </h3>
              {/* the same cards the Inspector draws a module's artifacts with (PB-940): one component for an artifact */}
              <HostContext.Provider value={{ openLink: actions.openLink }}>
                <ArtifactGrid cards={g.items.map((it, i) => artifactItemCard(g, it, i))} />
              </HostContext.Provider>
            </section>
          ))}
          <TermsSection groups={p.artifacts} onOpen={actions.openLink} />
        </div>
      ) : (
        <Rows>
          {model.datasheet && <LinkRow icon="file-text" label={model.datasheet.label} url={model.datasheet.url} onOpen={actions.openLink} />}
          {model.links.map((l) => (
            <LinkRow key={l.url} icon="link" label={l.label} url={l.url} onOpen={actions.openLink} />
          ))}
          {model.evidence.map((e, i) => (
            <div key={`${e.kind}-${i}`} className="flex items-center gap-2 py-2 text-fg">
              <Icon name="shield-check" size={14} className="text-fg-muted" aria-hidden />
              <span>{e.title ?? e.kind}</span>
              <span className="text-fg-muted">evidence · {e.kind}</span>
            </div>
          ))}
        </Rows>
      );
    case "prices":
      return <PricesPanel state={prices.state} onLoad={prices.load} onOpenLink={actions.openLink} {...(actions.signIn ? { onSignIn: actions.signIn } : {})} />;
    case "revisions":
      return (
        <Rows>
          {model.revisions.map((r) => (
            <div key={r.revision} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="w-10 font-ui text-fg">{rev(r.revision)}</span>
              <span className="text-fg-muted">{r.createdAt.slice(0, 10)}</span>
              <span className="min-w-0 truncate text-fg-muted">{r.publisher}</span>
              <span className="flex flex-1 flex-wrap gap-1">
                {r.recommended && <Pill>recommended</Pill>}
                {r.pinned && <Pill tone="ok">in this project</Pill>}
                {r.current && <Pill tone="info">shown</Pill>}
                {r.deprecated && (
                  <Pill tone="warning" title={r.deprecated}>
                    deprecated
                  </Pill>
                )}
              </span>
              {!r.current && (
                <Button size="sm" kind="ghost" icon="eye" onClick={() => actions.revision(r.revision)}>
                  Show
                </Button>
              )}
            </div>
          ))}
        </Rows>
      );
  }
}

/** Where a part's artifact sits among the viewer's kinds of artifact card. */
const CARD_KIND: Record<string, ArtifactCardModel["kind"]> = {
  datasheet: "datasheet",
  documentation: "document",
  document: "document",
  schematic: "schematic",
  pcb: "pcb",
  cad: "model",
  "cad-model": "model",
  "3d_model": "model",
  mesh: "model",
  "cad-source": "source",
  firmware: "firmware",
  image: "image",
  evidence: "evidence",
};

/** One artifact of a part as the viewer's artifact card: its name, its kind, its format or size, and where it leads. */
export function artifactItemCard(g: Pick<PartArtifactGroup, "kind" | "label" | "icon">, it: PartArtifactItem, i: number): ArtifactCardModel {
  let host: string | undefined;
  try {
    host = it.url ? new URL(it.url).host.replace(/^www\./, "") : undefined;
  } catch {
    host = undefined;
  }
  const source = host ?? it.license;
  return {
    key: `${g.kind}#${i}#${it.name}`,
    defId: "",
    title: it.name,
    kind: CARD_KIND[g.kind] ?? "data",
    group: "data",
    // the group's heading names the kind: the card says the format or size ("PDF", "web", "0.85 MB")
    kindLabel: it.note ?? g.label,
    ...(source ? { source } : {}),
    ...(host && it.license ? { sourceNote: it.license } : {}),
    // what the licence's terms say (the part's terms.json), in the card's tooltip
    ...(it.licenseSummary ? { description: `${it.license}: ${it.licenseSummary}` } : {}),
    ...(it.url ? { location: it.url, href: it.url } : {}),
    icon: g.icon,
    remote: !!it.url,
  };
}

/**
 * The terms the part's files come under (PB-1061), once each: the Protoboard library terms, a vendor's terms by name,
 * an SPDX licence. A row opens the terms' page; its tooltip is what the part's terms.json says of them.
 */
export function termsOf(groups: Pick<PartArtifactGroup, "items">[]): { label: string; summary?: string; url?: string; files: number }[] {
  const out = new Map<string, { label: string; summary?: string; url?: string; files: number }>();
  for (const g of groups)
    for (const it of g.items) {
      if (!it.license) continue;
      const t = out.get(it.license) ?? { label: it.license, files: 0 };
      t.files++;
      if (!t.summary && it.licenseSummary) t.summary = it.licenseSummary;
      if (!t.url && it.licenseUrl) t.url = it.licenseUrl;
      out.set(it.license, t);
    }
  return [...out.values()];
}

function TermsSection({ groups, onOpen }: { groups: PartArtifactGroup[]; onOpen: (url: string) => void }) {
  const terms = termsOf(groups);
  if (!terms.length) return null;
  return (
    <section aria-label="Terms" data-terms="">
      <h3 className="flex items-center gap-1.5 pb-1 text-fg-muted">
        <Icon name="scale" size={13} strokeWidth={1.75} aria-hidden />
        <span className="font-ui text-[10.5px] tracking-[0.14em] uppercase">Terms</span>
        <span className="font-ui text-[11px] tabular-nums">{terms.length}</span>
      </h3>
      <div className="divide-y divide-line-subtle">
        {terms.map((t) => {
          const note = `${t.files} file${t.files === 1 ? "" : "s"}`;
          return t.url ? (
            <span key={t.label} title={t.summary} className="block">
              <LinkRow icon="scale" label={t.label} url={t.url} note={note} onOpen={onOpen} />
            </span>
          ) : (
            <div key={t.label} title={t.summary} className="flex items-center gap-2 py-2 text-fg">
              <Icon name="scale" size={14} className="shrink-0 text-fg-muted" aria-hidden />
              <span className="truncate">{t.label}</span>
              <span className="ml-auto shrink-0 font-ui text-[11px] text-fg-muted">{note}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LinkRow({ icon, label, url, note, onOpen }: { icon: string; label: string; url: string; note?: string; onOpen: (url: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(url)} className="flex w-full cursor-pointer items-center gap-2 py-2 text-left text-fg hover:text-link focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus">
      <Icon name={icon} size={14} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="truncate">{label}</span>
      <span className="ml-auto flex min-w-0 shrink items-center gap-2 font-ui text-[11px] text-fg-muted">
        <span className="truncate">{url.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}</span>
        {note && <span className="shrink-0">{note}</span>}
      </span>
    </button>
  );
}

/** The pictures, larger: over the page, closed with Escape or its button; ← and → turn them. */
function Lightbox({ images, index, onIndex, onClose, alt }: { images: PartImage[]; index: number; onIndex: (i: number) => void; onClose: () => void; alt: string }) {
  const close = useRef<HTMLButtonElement>(null);
  const n = images.length;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => before?.focus?.();
  }, []);
  const keys = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight" && n > 1) onIndex((index + 1) % n);
    else if (e.key === "ArrowLeft" && n > 1) onIndex((index - 1 + n) % n);
    else if (e.key === "Tab") {
      // the dialog holds the focus: its close button is its one tab stop besides the carousel's
      const stops = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([tabindex='-1'])")];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      stops[(at + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={`Pictures of ${alt}`} onKeyDown={keys} onClick={onClose} className="absolute inset-0 z-40 grid place-items-center bg-[color-mix(in_oklab,var(--pb-bg)_88%,transparent)] p-6 max-[640px]:p-3">
      <div onClick={(e) => e.stopPropagation()} className="pb-reveal-host relative flex size-full max-h-[820px] max-w-[1100px] flex-col overflow-hidden rounded-[6px] border border-line bg-[var(--pb-card)] shadow-float outline-1 -outline-offset-1 outline-contrast">
        <ImageCarousel images={images} alt={alt} index={index} onIndex={onIndex} className="min-h-0 w-full flex-1" arrow={36} tabbable iconSize={56} />
        <span className="absolute top-2 right-2 z-[2]">
          <IconButton ref={close} icon="x" label="Close" shortcut="Esc" onClick={onClose} />
        </span>
      </div>
    </div>
  );
}

export function PartDetail({ model, actions, tab: given, onTab }: PartDetailProps) {
  const tabs = detailTabs(model, actions);
  const [own, setOwn] = useState<PartDetailTab>(given ?? "specs");
  useEffect(() => {
    if (given) setOwn(given);
  }, [given]);
  // a section the part has nothing for is not offered: the part opens on its overview instead
  const tab = tabs.some((t) => t.id === own) ? own : "overview";
  const dir = useRef(1);
  const set = (t: PartDetailTab, focus = false) => {
    dir.current = tabs.findIndex((x) => x.id === t) >= tabs.findIndex((x) => x.id === tab) ? 1 : -1;
    setOwn(t);
    onTab?.(t);
    if (focus) requestAnimationFrame(() => document.getElementById(`pb-tab-${t}`)?.focus());
  };
  const i = tabs.findIndex((t) => t.id === tab);
  const step = (d: number, focus = false) => set(stepIn(tabs, tabs[i], d).id, focus);
  const swipe = useSwipe((d) => step(d));
  const prices = usePrices([model.key, model.revision, model.pricesAs ?? ""].join(" "), actions.prices);

  const images: PartImage[] = model.pages?.images.length ? model.pages.images : model.thumbnail ? [{ url: model.thumbnail, label: "Catalog picture" }] : [];
  const [picture, setPicture] = useState(0);
  const [large, setLarge] = useState(false);
  useEffect(() => setPicture(0), [model.key, model.revision]);
  const shown = Math.min(picture, Math.max(images.length - 1, 0));

  // the host's own shortcut for the back control (the web shell: Alt+←; VS Code binds its own)
  useEffect(() => {
    if (!model.backShortcut || !model.back || !actions.back) return;
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === "ArrowLeft") {
        e.preventDefault();
        actions.back!();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.backShortcut, model.back, !!actions.back]);

  const used = model.used && !model.used.elsewhere ? model.used.revision : undefined;
  const audited = model.evidence.some((e) => /verif|audit/i.test(e.kind));
  const sub = [[model.manufacturer, model.mpn].filter(Boolean).join(" "), ...model.identifiers].filter(Boolean);
  const dims = model.pages?.dimensions?.rows ?? [];
  const chips = [...(model.pages?.interfaces.chips.slice(0, 3) ?? []), ...dims.filter((f) => f.label === "Size" || f.label === "Mass").map((f) => f.value)];
  const backTip = model.back === "Project parts" ? "Back to the Project Parts page" : `Back to ${model.back === "Library" ? "the library" : model.back}`;
  const product = model.links[0];
  return (
    <PartsSurface place="editor">
      <ScrollArea className="size-full" contentClassName="mx-auto max-w-[1180px] px-8 pt-4 pb-10 max-[640px]:px-4">
        {/* back, top left (the 2026-10-05 review, design 08): to the list the part was opened from, where it was scrolled to; then where the part is in the catalog */}
        {(model.back || model.crumbs.length > 0) && (
          <nav aria-label={model.back && actions.back ? "Back" : "Category"} className={cx(BODY, "flex min-h-8 min-w-0 items-center gap-2.5 pb-3 text-[13px]")}>
            {model.back && actions.back && (
              <button
                type="button"
                onClick={actions.back}
                aria-label={backTip}
                data-tooltip={backTip}
                {...((model.backShortcut ?? model.backShortcutLabel) ? { "data-tooltip-shortcut": model.backShortcut ?? model.backShortcutLabel } : {})}
                className={cx(
                  "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[4px] border border-[var(--pb-control-border)] text-fg hover:bg-hover",
                  "outline-1 -outline-offset-1 outline-contrast focus-visible:outline focus-visible:outline-focus",
                )}
              >
                <Icon name="arrow-left" size={15} strokeWidth={1.75} aria-hidden />
              </button>
            )}
            <ol className="flex min-w-0 items-center gap-1.5 text-fg-muted">
              {[...(model.back ? [model.back] : []), ...model.crumbs].map((c, n) => (
                <li key={`${c}-${n}`} className={cx("flex items-center gap-1.5", n === 0 && model.back ? "shrink-0" : "min-w-0 shrink max-[640px]:hidden")}>
                  {n > 0 && <Icon name="chevron-right" size={12} className="shrink-0 text-fg-faint" aria-hidden />}
                  <span className="truncate">{c}</span>
                </li>
              ))}
              <li className="flex min-w-0 shrink-[0.5] items-center gap-1.5">
                <Icon name="chevron-right" size={12} className="shrink-0 text-fg-faint" aria-hidden />
                <span className="truncate text-fg" aria-current="page">
                  {model.name}
                </span>
              </li>
            </ol>
          </nav>
        )}
        <header className="flex gap-7 max-[760px]:flex-col max-[760px]:gap-4">
          <div className="flex w-[440px] max-w-full shrink-0 flex-col gap-2 max-[760px]:w-full">
            <div className="pb-reveal-host">
              <ImageCarousel images={images} alt={model.name} index={shown} onIndex={setPicture} className="h-[264px] w-full rounded-[6px] border border-line outline-1 -outline-offset-1 outline-contrast max-[520px]:h-[200px]" arrow={36} tabbable iconSize={44}>
                {images.length > 0 && (
                  <span className="absolute top-2 right-2 z-[1]">
                    <IconButton icon="expand" label="Show the picture larger" onClick={() => setLarge(true)} className="bg-[color-mix(in_oklab,black_64%,transparent)] !text-white" />
                  </span>
                )}
              </ImageCarousel>
            </div>
            {images.length > 1 && (
              <div className={cx(BODY, "flex min-w-0 items-center gap-2")}>
                <ScrollArea axis="horizontal" className="min-w-0" contentClassName="flex gap-2 p-px">
                  {images.map((img, k) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={`Picture ${k + 1} of ${images.length}: ${img.label}`}
                      aria-current={k === shown || undefined}
                      data-tooltip={img.label}
                      onClick={() => setPicture(k)}
                      className={cx(
                        "h-12 w-16 shrink-0 cursor-pointer overflow-hidden rounded-[4px] border outline-1 -outline-offset-1 outline-contrast",
                        k === shown ? "border-focus outline-contrast-active" : "border-line hover:border-[var(--pb-control-border)]",
                        "focus-visible:outline focus-visible:outline-focus",
                      )}
                    >
                      <Thumb src={img.url} alt="" className="size-full" iconSize={16} />
                    </button>
                  ))}
                </ScrollArea>
                <span className="shrink-0 text-[12px] text-fg-muted">{images.length} pictures</span>
              </div>
            )}
          </div>
          <div className={cx(BODY, "flex min-w-0 flex-1 flex-col gap-1.5")}>
            <h1 className="text-[20px] leading-tight font-semibold text-fg">{model.name}</h1>
            {sub.length > 0 && <p className="truncate font-ui text-[12.5px] tracking-[0.02em] text-fg-muted">{sub.join(" · ")}</p>}
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Pill>
                {rev(model.revision)}
                {model.recommended === model.revision ? " · recommended" : model.latest === model.revision ? " · latest" : ""}
              </Pill>
              {model.trust && (
                <span className="inline-flex h-[18px] items-center rounded-full border border-[var(--pb-control-border)] px-1.5">
                  <PartStatusDot trust={model.trust} basis={model.trustBasis} label size={7} />
                </span>
              )}
              {used !== undefined && <Pill tone="ok">used {rev(used)} in this project</Pill>}
              {model.used?.elsewhere && <Pill tone="warning">in the project from another library</Pill>}
              {!model.trust && audited && <Pill>verification record</Pill>}
              {model.pages?.cad?.origin ? <Pill tone="info">CAD: {model.pages.cad.origin.replace(/^(Vendor CAD|Generated)/, (m) => (m === "Vendor CAD" ? "vendor" : "generated"))}</Pill> : model.cad ? <Pill tone="info">CAD: {model.cad}</Pill> : model.model ? <Pill tone="info">3D model</Pill> : null}
            </div>
            {model.description && <p className="line-clamp-4 pt-1 text-[13px] leading-relaxed text-fg">{model.description}</p>}
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {chips.map((c) => (
                  <Tag key={c}>{c}</Tag>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2.5">
              <MainAction model={model} actions={actions} />
              <Button icon="git-compare-arrows" aria-label="Compare revisions" data-tooltip="Compare revisions" className="w-8 !px-0" onClick={() => (actions.compare ? actions.compare() : set("revisions"))} />
              {actions.openSource && <Button icon="file-code" aria-label="Open the definition's source" data-tooltip="Open the definition's source" className="w-8 !px-0" onClick={actions.openSource} />}
              {model.datasheet && <Button icon="file-text" aria-label={`Datasheet: ${model.datasheet.label}`} data-tooltip={`Datasheet: ${model.datasheet.label}`} className="w-8 !px-0" onClick={() => actions.openLink(model.datasheet!.url)} />}
              {product && <Button icon="external-link" aria-label={product.label} data-tooltip={product.label} className="w-8 !px-0" onClick={() => actions.openLink(product.url)} />}
              {actions.openInViewer && used !== undefined && <Button icon="scan-eye" aria-label="Show in the viewer" data-tooltip="Show in the viewer" className="w-8 !px-0" onClick={actions.openInViewer} />}
              {actions.copy && <Button icon="copy" aria-label="Copy the part id" data-tooltip={`Copy the part id (${model.partId})`} className="w-8 !px-0" onClick={() => actions.copy!(model.partId)} />}
            </div>
          </div>
        </header>

        <section aria-label="Part sections" aria-roledescription="carousel" className="mt-6 rounded-[6px] border border-line outline-1 -outline-offset-1 outline-contrast">
          <div className="flex items-center gap-2 border-b border-line-subtle pr-2 pl-3">
            <ScrollArea axis="horizontal" className="min-w-0 flex-1" contentClassName="flex">
              <div
                role="tablist"
                aria-label="Sections"
                className="flex"
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    step(e.key === "ArrowRight" ? 1 : -1, true);
                  } else if (e.key === "Home" || e.key === "End") {
                    e.preventDefault();
                    set(tabs[e.key === "Home" ? 0 : tabs.length - 1].id, true);
                  }
                }}
              >
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    id={`pb-tab-${t.id}`}
                    type="button"
                    role="tab"
                    aria-selected={t.id === tab}
                    aria-controls="pb-tabpanel"
                    tabIndex={t.id === tab ? 0 : -1}
                    onClick={() => set(t.id)}
                    className={cx(
                      BODY,
                      "relative flex h-10 shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-[13px] transition-colors",
                      t.id === tab ? "font-semibold text-fg" : "text-fg-muted hover:text-fg",
                      "focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                    )}
                  >
                    <Icon name={t.icon} size={14} strokeWidth={1.75} className={t.id === tab ? "text-accent" : undefined} aria-hidden />
                    {t.label}
                    {t.id === tab && <span aria-hidden className="absolute right-2.5 bottom-0 left-2.5 h-0.5 rounded-full bg-accent outline-1 outline-contrast-active" />}
                  </button>
                ))}
              </div>
            </ScrollArea>
            <span aria-hidden className="shrink-0 font-ui text-[11px] text-fg-muted tabular-nums max-[640px]:hidden">
              {i + 1} / {tabs.length}
            </span>
            <StepButton dir="prev" label="Previous section" onClick={() => step(-1)} size={26} className="border border-[var(--pb-control-border)] !text-fg outline-1 -outline-offset-1 outline-contrast" />
            <StepButton dir="next" label="Next section" onClick={() => step(1)} size={26} className="border border-[var(--pb-control-border)] !text-fg outline-1 -outline-offset-1 outline-contrast" />
          </div>
          <div id="pb-tabpanel" role="tabpanel" aria-labelledby={`pb-tab-${tab}`} className="touch-pan-y p-4" {...(tab === "cad" ? {} : swipe)}>
            <div key={tab} className="pb-page-in" style={{ "--pb-page-from": `${dir.current * 8}px` } as React.CSSProperties}>
              <Section tab={tab} model={model} actions={actions} prices={prices} />
            </div>
          </div>
          <div className="flex justify-center pb-3">
            <Segments index={i} count={tabs.length} />
          </div>
        </section>
      </ScrollArea>
      {large && images.length > 0 && <Lightbox images={images} index={shown} onIndex={setPicture} onClose={() => setLarge(false)} alt={model.name} />}
    </PartsSurface>
  );
}
