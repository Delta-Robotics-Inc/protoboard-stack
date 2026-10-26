/**
 * The extension's React webviews (PB-912): one bundle, one screen per
 * webview, named by `data-screen` on the body: the Library sidebar, the
 * full-page library, a part's detail, the libraries manager, the Project
 * Parts side bar and its page, the Cloud view, the BOM editor, the
 * Inspector's selection, the DRC panel and the settings page. The
 * extension computes each screen's model and posts it
 * (`{ type: "model", model }`); the page posts back what the user does as
 * `{ type: <action>, ...args }`. The theme is VS Code's (high contrast
 * included); `data-theme` picks another for a standalone page.
 */
import "@deltarobotics/uhd-viewer/components.css";
import "./styles.css";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@deltarobotics/uhd-viewer/components";
import { themeAdapterFor, vscodeViewThemeAdapter } from "@protoboardai/views/theme";
import { BomEditor, CloudPanel, LibrariesManager, LibraryBrowser, LibraryPage, PartDetail, ProjectParts, ProjectPartsPage, SettingsPage, type ProjectPartsActions } from "@protoboardai/views/parts";
import { DrcPanel, SelectionInspector, type DrcPanelModel, type InspectorActions, type InspectorBundle, type InspectorContent } from "@protoboardai/views/inspector";
import { modelThumb } from "./model-thumb";
import type {
  BomModel,
  CloudModel,
  LibrariesModel,
  LibraryModel,
  PartDetailModel,
  PartDetailTab,
  PartPages,
  PartPagesRef,
  PartPricesModel,
  ProjectPartsModel,
  SettingsModel,
} from "@protoboardai/views/parts";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const vscode: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : { postMessage: (m) => console.debug("post", m), getState: () => undefined, setState: () => undefined };

/** Send an action to the extension. */
const send = (type: string, args: Record<string, unknown> = {}) => vscode.postMessage({ type, ...args });

/**
 * Ask the extension for something and wait for it: a card's pages, a part's
 * prices. The extension answers `{ type: "answer", ask, ok, value | error }`.
 */
let asked = 0;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function ask<T>(type: string, args: Record<string, unknown> = {}): Promise<T> {
  const id = ++asked;
  return new Promise<T>((ok, fail) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      fail(new Error("the extension did not answer"));
    }, 60_000);
    waiting.set(id, { ok: ok as (v: unknown) => void, fail, timer });
    send(type, { ...args, ask: id });
  });
}
window.addEventListener("message", (e: MessageEvent) => {
  const m = e.data as { type?: string; ask?: number; ok?: boolean; value?: unknown; error?: string };
  if (m?.type !== "answer" || typeof m.ask !== "number") return;
  const w = waiting.get(m.ask);
  if (!w) return;
  waiting.delete(m.ask);
  clearTimeout(w.timer);
  if (m.ok) w.ok(m.value);
  else w.fail(new Error(m.error ?? "failed"));
});

/** A card's pages, from the extension (it reads the part's revision from its library). */
const pages = (ref: PartPagesRef) => ask<PartPages>("pages", { ref });

type Screen = "library" | "library-page" | "part" | "libraries" | "project-parts" | "project-parts-page" | "cloud" | "bom" | "inspector" | "drc" | "settings";

interface Incoming {
  type: "model";
  model: unknown;
  /** The part whose detail is open (library screens). */
  selected?: string;
  /** The section a part's detail opens on. */
  tab?: PartDetailTab;
  /** The project's name (the Project Parts page). */
  project?: string;
}

function useModel<T>(): [T | undefined, Omit<Incoming, "model" | "type">] {
  const [state, setState] = useState<{ model?: T; extra: Omit<Incoming, "model" | "type"> }>(() => {
    const saved = vscode.getState() as { model?: T; extra?: Omit<Incoming, "model" | "type"> } | undefined;
    return { model: saved?.model, extra: saved?.extra ?? {} };
  });
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const m = e.data as Incoming;
      if (!m || m.type !== "model") return;
      const { model, type: _t, ...extra } = m;
      setState({ model: model as T, extra });
      // other keys of the saved state (the DRC panel's open rows) stay
      vscode.setState({ ...((vscode.getState() as object | undefined) ?? {}), model, extra });
    };
    window.addEventListener("message", on);
    send("ready");
    return () => window.removeEventListener("message", on);
  }, []);
  return [state.model, state.extra];
}

function Waiting() {
  return <div className="size-full" />;
}

function Library() {
  const [model, extra] = useModel<LibraryModel>();
  if (!model) return <Waiting />;
  return (
    <LibraryBrowser
      model={model}
      selected={extra.selected}
      actions={{
        query: (query) => send("query", { query }),
        open: (key, tab) => send("open", { key, ...(tab ? { tab } : {}) }),
        add: (key) => send("add", { key }),
        update: (key) => send("update", { key }),
        loadMore: () => send("loadMore"),
        retry: () => send("retry"),
        more: (key) => send("more", { key }),
        openPage: () => send("openPage"),
        manage: () => send("manage", { open: true }),
        pages,
      }}
    />
  );
}

function FullLibrary() {
  const [model, extra] = useModel<LibraryModel>();
  if (!model) return <Waiting />;
  return (
    <LibraryPage
      model={model}
      selected={extra.selected}
      actions={{
        query: (query) => send("query", { query }),
        open: (key, tab) => send("open", { key, ...(tab ? { tab } : {}) }),
        add: (key) => send("add", { key }),
        update: (key) => send("update", { key }),
        loadMore: () => send("loadMore"),
        retry: () => send("retry"),
        more: (key) => send("more", { key }),
        pages,
      }}
    />
  );
}

function Part() {
  const [model, extra] = useModel<PartDetailModel>();
  if (!model) return <Waiting />;
  return (
    <PartDetail
      model={model}
      tab={extra.tab}
      actions={{
        act: (kind, revision) => send("act", { kind, revision }),
        revision: (revision) => send("revision", { revision }),
        back: () => send("back"),
        openSource: () => send("openDefinition"),
        openLink: (url) => send("openLink", { url }),
        openInViewer: () => send("openViewer"),
        copy: (text) => send("copy", { text }),
        loadModel: () => send("loadModel"),
        prices: () => ask<PartPricesModel>("prices"),
        signIn: () => send("signIn"),
      }}
    />
  );
}

function Libraries() {
  const [model] = useModel<LibrariesModel>();
  if (!model) return <Waiting />;
  return (
    <LibrariesManager
      model={model}
      actions={{
        add: (url, scope, authEnv) => send("libAdd", { url, scope, ...(authEnv ? { authEnv } : {}) }),
        remove: (id, scope) => send("libRemove", { id, scope }),
        move: (id, scope, direction, steps) => send(direction === "up" ? "libUp" : "libDown", { id, scope, ...(steps && steps > 1 ? { steps } : {}) }),
        check: () => send("libCheck"),
        signIn: () => send("signIn"),
        signOut: () => send("signOut"),
      }}
    />
  );
}

/** What the project's parts can do, in the side bar and on the page: the extension does it (the CLI vendors, a terminal publishes). */
const PARTS_ACTIONS: ProjectPartsActions = {
  open: (id) => send("open", { id }),
  openSource: (id) => send("openSource", { id }),
  update: (id) => send("update", { id }),
  restore: (id) => send("restore", { id }),
  compare: (id) => send("compare", { id }),
  publish: (id) => send("publish", { id }),
  check: () => send("check"),
  openLibrary: () => send("openLibrary"),
};

/** The project parts' groups folded away (PB-1039): kept in the page's state, so a reload or a new model keeps them folded. */
const folded = {
  closed: ((vscode.getState() as { folded?: unknown } | undefined)?.folded as string[] | undefined) ?? [],
  onClosed: (ids: string[]) => vscode.setState({ ...((vscode.getState() as object | undefined) ?? {}), folded: ids }),
};

function Parts() {
  const [model, extra] = useModel<ProjectPartsModel>();
  if (!model) return <Waiting />;
  return <ProjectParts model={model} selected={extra.selected} folded={folded} actions={{ ...PARTS_ACTIONS, openPage: () => send("openPage") }} />;
}

function PartsPage() {
  const [model, extra] = useModel<ProjectPartsModel>();
  if (!model) return <Waiting />;
  return <ProjectPartsPage model={model} selected={extra.selected} project={extra.project} folded={folded} actions={{ ...PARTS_ACTIONS, pages }} />;
}

function Cloud() {
  const [model] = useModel<CloudModel>();
  if (!model) return <Waiting />;
  return (
    <CloudPanel
      model={model}
      actions={{
        signIn: () => send("signIn"),
        signOut: () => send("signOut"),
        generate: () => send("generate"),
        openRelease: (version) => send("openPackage", { version, what: "index" }),
        openBom: () => send("openBom"),
        publish: () => send("publish"),
        requestQuote: () => send("requestQuote"),
        fetchOffers: () => send("fetchOffers"),
      }}
    />
  );
}

function Bom() {
  const [model, extra] = useModel<BomModel>();
  if (!model) return <Waiting />;
  return (
    <BomEditor
      model={model}
      title={(extra as { title?: string }).title}
      actions={{
        openPart: (line) => send("openPart", { key: line.key }),
        openRow: (line) => send("openRow", { key: line.key }),
        focus: (line) => send("focus", { key: line.key }),
        setUnits: (units) => send("setUnits", { units }),
        chooseOffer: (line, offer) => send("chooseOffer", { key: line, offer }),
        refreshOffers: () => send("refreshOffers"),
        exportCsv: () => send("exportCsv"),
        openLink: (url) => send("openLink", { url }),
      }}
    />
  );
}

/** The project's UHD bundle, read from the build (a webview URL) once per build; the last one stays while the next loads. */
function useBundle(ref: InspectorBundle | undefined): unknown {
  const [loaded, setLoaded] = useState<{ key: string; bundle: unknown }>();
  const key = ref ? `${ref.src}#${ref.version}` : "";
  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    fetch(ref.src, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(
        (bundle) => !cancelled && setLoaded({ key, bundle }),
        () => !cancelled && setLoaded({ key, bundle: undefined }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // a bundle of another project is not this selection's
  return ref && loaded && loaded.key.split("#")[0] === ref.src ? loaded.bundle : undefined;
}

const INSPECTOR_ACTIONS: InspectorActions = {
  action: (action) => send("action", { action }),
  focus: (path) => send("focus", { path }),
  select: (selection) => send("select", { selection }),
  finding: (key) => send("finding", { key }),
  explain: (key) => send("explain", { key }),
  openArtifact: (defId, artifactId) => send("openArtifact", { defId, artifactId }),
  openLink: (url) => send("openLink", { url }),
  interfaceSource: (request) => send("interfaceSource", { request }),
  connect: (request) => send("connect", { request }),
  drawModel: modelThumb,
};

/**
 * Tells the extension what the page drew, once it has settled: how many artifact cards, how many of their pictures
 * loaded and how many did not. The extension's log and its tests read it (a picture that does not load is a file
 * outside the webview's roots, or a missing one).
 */
function useDrawnReport(what: string, deps: unknown[]) {
  useEffect(() => {
    const report = () => {
      const pictures = [...document.querySelectorAll<HTMLImageElement>(".uhd-artifact-picture img, .artifact-thumb img")];
      send("drawn", {
        what,
        details: !!document.querySelector(".uhd-selection-details .details"),
        cards: document.querySelectorAll(".uhd-artifact-card").length,
        rows: document.querySelectorAll(".artifact-file").length,
        loaded: pictures.filter((i) => i.complete && i.naturalWidth > 0).length,
        // a lazy picture below the fold has not been asked for yet: it is neither loaded nor failed
        failed: pictures.filter((i) => i.complete && i.naturalWidth === 0 && !!i.currentSrc).length,
        icons: document.querySelectorAll('[data-artifact-picture="icon"]').length,
        lanes: document.querySelectorAll("[data-lane]").length,
        findings: document.querySelectorAll("[data-finding]").length,
        scrolls: document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight,
        // the page's own size is its view's: the extension's tests read the side bar's width and the panel's height from it
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    const t = setTimeout(report, 1500);
    // the extension's tests ask for every picture at once (a lazy one below the fold, or in a view that is not showing, is
    // otherwise never asked for), then for the report again
    const probe = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type !== "probe") return;
      const lazy = [...document.querySelectorAll<HTMLImageElement>(".uhd-artifact-picture img, .artifact-thumb img")];
      for (const i of lazy) i.loading = "eager";
      void Promise.all(lazy.map((i) => (i.complete && i.currentSrc ? undefined : new Promise<void>((ok) => (i.addEventListener("load", () => ok(), { once: true }), i.addEventListener("error", () => ok(), { once: true }), setTimeout(ok, 8000)))))).then(report);
    };
    window.addEventListener("message", probe);
    return () => {
      clearTimeout(t);
      window.removeEventListener("message", probe);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function Inspector() {
  const [content] = useModel<InspectorContent>();
  const bundle = useBundle(content && "card" in content ? content.bundle : undefined);
  const card = content && "card" in content ? content.card : undefined;
  useDrawnReport(card ? `${card.kind}:${card.linkId ?? card.part?.partId ?? card.path}:${card.title}` : "", [content, bundle]);
  return <SelectionInspector content={content} bundle={bundle} actions={INSPECTOR_ACTIONS} />;
}

function Drc() {
  const [model] = useModel<DrcPanelModel>();
  const [saved] = useState(() => (vscode.getState() as { drc?: { expanded?: string[]; collapsed?: string[] } } | undefined)?.drc);
  useDrawnReport(model ? `${model.project}:${model.state}` : "", [model]);
  return (
    <DrcPanel
      model={model}
      actions={{
        query: (query) => send("query", { query }),
        locate: (key) => send("locate", { key }),
        openSource: (key) => send("openSource", { key }),
        explain: (key) => send("explain", { key }),
        fix: (key) => send("fix", { key }),
        refresh: () => send("refresh"),
        saved,
        save: (drc) => vscode.setState({ ...((vscode.getState() as object | undefined) ?? {}), drc }),
      }}
    />
  );
}

function Settings() {
  const [model] = useModel<SettingsModel>();
  if (!model) return <Waiting />;
  return (
    <SettingsPage
      model={model}
      actions={{
        signIn: () => send("signIn"),
        signOut: () => send("signOut"),
        connect: (id) => send("connect", { id }),
        disconnect: (id) => send("disconnect", { id }),
        refresh: () => send("refresh"),
        openFile: (id) => send("openFile", { id }),
        copy: (text, what) => send("copy", { text, what }),
        openVsCodeSettings: () => send("openVsCodeSettings"),
        openLibraries: () => send("openLibraries"),
        showLog: () => send("showLog"),
        run: (id) => send("run", { id }),
      }}
    />
  );
}

const SCREENS: Record<Screen, () => React.JSX.Element> = {
  library: Library,
  "library-page": FullLibrary,
  part: Part,
  libraries: Libraries,
  "project-parts": Parts,
  "project-parts-page": PartsPage,
  cloud: Cloud,
  bom: Bom,
  inspector: Inspector,
  drc: Drc,
  settings: Settings,
};

// ---- the Protoboard library signed out (PB-928, PB-1039): a sign-in card in place of the library

interface Access {
  signedOut: boolean;
  reason?: string;
  message?: string;
}

/** What the card says and offers for a reason; the first button is the main one. */
function signedOutContent(reason: string): { title: string; buttons: [label: string, action: string, title: string][] } {
  switch (reason) {
    case "checking":
      return { title: "Checking your sign-in…", buttons: [] };
    case "not-invited":
      return { title: "This account is not invited to the library yet", buttons: [["Use Another Account", "signIn", "Sign in with an invited account"], ["Check Again", "checkAccount", "Ask the service again, after you were invited"]] };
    case "email-unverified":
      return { title: "Verify your e-mail address", buttons: [["Check Again", "checkAccount", "Ask the service again, after you verified it"], ["Use Another Account", "signIn", "Opens the sign-in page in your browser"]] };
    case "unreachable":
    case "unknown":
      return { title: "The Protoboard library could not be reached", buttons: [["Check Again", "checkAccount", "Ask the service again"], ["Show Log", "showLog", "What the extension ran and what it was told"]] };
    case "sign-in-invalid":
      return { title: "Your sign-in no longer works", buttons: [["Sign In Again", "signIn", "Opens the sign-in page in your browser"]] };
    default:
      return { title: "Sign in to use the Protoboard library", buttons: [["Sign In", "signIn", "Opens the sign-in page in your browser"], ["Sign In with a Code", "signInDevice", "For a remote or headless window"]] };
  }
}

/** The message without a first sentence that only repeats the card's title. */
function withoutTitle(message: string | undefined, title: string): string {
  const m = (message ?? "").trim();
  const t = title.replace(/[.…]+$/, "");
  if (m.toLowerCase().startsWith(`${t.toLowerCase()}.`)) return m.slice(t.length + 1).trim();
  if (m.toLowerCase().startsWith(`${t.toLowerCase()}:`)) return `${m.charAt(t.length + 2).toUpperCase()}${m.slice(t.length + 3)}`.trim();
  return m;
}

/** What needs no account, said on the card so it is plain that only the library waits. */
const LOCAL_STILL_WORKS = "Projects work without an account.";

/**
 * The screens of the part library: the cloud (PB-928). Signed out they show
 * no parts at all, only the sign-in card (PB-1039). Every other screen
 * (Project Parts, the BOM, the Inspector, DRC, Cloud, settings) is local
 * work and is never covered.
 */
const LIBRARY_SCREENS: ReadonlySet<Screen> = new Set<Screen>(["library", "library-page", "part"]);

/**
 * Wraps a screen: a Library screen, signed out, is the sign-in card and
 * nothing else; every other screen is drawn as it is. The extension says so
 * with one message (`{ type: "protoboard:access", signedOut }`), and the page
 * is written with `data-signed-out` when the user is signed out already.
 */
function AccessGate({ screen, children }: { screen: Screen; children: React.ReactNode }) {
  const [access, setAccess] = useState<Access>(() => {
    const reason = document.body.dataset.signedOut;
    return reason ? { signedOut: true, reason, message: document.body.dataset.signedOutMessage } : { signedOut: false };
  });
  const library = LIBRARY_SCREENS.has(screen);
  useEffect(() => {
    if (!library) return;
    const on = (e: MessageEvent) => {
      const m = e.data as (Access & { type?: string }) | undefined;
      if (m?.type !== "protoboard:access") return;
      setAccess({ signedOut: !!m.signedOut, ...(m.reason ? { reason: m.reason } : {}), ...(m.message ? { message: m.message } : {}) });
      if (m.signedOut) document.body.dataset.signedOut = m.reason ?? "signed-out";
      else delete document.body.dataset.signedOut;
    };
    window.addEventListener("message", on);
    send("protoboard:access?");
    return () => window.removeEventListener("message", on);
  }, [library]);
  if (!library || !access.signedOut) return <>{children}</>;
  const c = signedOutContent(access.reason ?? "signed-out");
  const said = withoutTitle(access.message, c.title);
  return (
    <div className="pb-access size-full" style={{ position: "relative" }}>
      <div className="pb-signed-out" data-reason={access.reason ?? "signed-out"}>
        <div className="pb-signed-out-card" role="region" aria-labelledby="pb-signed-out-title">
          <h1 id="pb-signed-out-title">{c.title}</h1>
          {said && <p>{said}</p>}
          {access.reason !== "checking" && !/no account|without an account/i.test(said) && <p className="pb-signed-out-unlocks">{LOCAL_STILL_WORKS}</p>}
          {c.buttons.length > 0 && (
            <div className="pb-signed-out-actions">
              {c.buttons.map(([label, action, title], i) => (
                <button key={action} type="button" className={i === 0 ? "primary" : undefined} title={title} data-action={action} onClick={() => send("protoboard:account", { action })}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App({ screen, theme }: { screen: Screen; theme: string }) {
  const Screen = SCREENS[screen] ?? Waiting;
  // the Inspector's selection and the DRC panel are native views: VS Code's own faces, as in the viewer tab beside them
  // (the Protoboard faces only under a Protoboard colour theme)
  const adapter = useMemo(() => (theme === "vscode" && (screen === "inspector" || screen === "drc") ? vscodeViewThemeAdapter() : themeAdapterFor(theme)), [screen, theme]);
  return (
    <ThemeProvider adapter={adapter} className="pb-app size-full">
      <AccessGate screen={screen}>
        <Screen />
      </AccessGate>
    </ThemeProvider>
  );
}

const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>
    <App screen={(document.body.dataset.screen ?? "library") as Screen} theme={document.body.dataset.theme ?? "vscode"} />
  </StrictMode>,
);
