/**
 * The data the parts views draw (PB-902, PB-903, PB-904, PB-912): the
 * library browser and its part cards, a part's detail, the project's parts,
 * the libraries manager, the bill of materials and the Cloud panel. Plain
 * data, computed by the shell (the VS Code extension from the CLI and the
 * library client; the web shell from `protoboard dev`), so the views run the
 * same in every host. Actions go back through the `*Actions` callbacks.
 */

import type { LibrarySort } from "@protoboardai/core/library-sort";
import type { Bom, BomGroup, BomLine } from "@protoboardai/core/bom";
import type { PartTrust } from "@protoboardai/core/part-trust";

export type { LibrarySort, PartTrust };

// ---------------------------------------------------------------- library

export interface LibraryQuery {
  text: string;
  /** Taxonomy path ("" for every category). */
  category: string;
  domain: string;
  protocol: string;
  /** The order asked for (the `sort` request parameter of a library that sorts). */
  sort: LibrarySort;
}

/** The order of the results and what the control may offer (library-data.ts `sortState`). */
export interface LibrarySortModel {
  /** The order shown: the one asked for when it can be made, else the nearest that can. */
  value: LibrarySort;
  /** Every order that works here: those the libraries sort by, and those made from the loaded parts. */
  options: LibrarySort[];
  /** The order was made here, over the parts loaded so far (the libraries do not sort by it). */
  local: boolean;
}

/** One part as a card or a row of results. */
export interface PartCardModel {
  /** Unique in the list (library and part id). */
  key: string;
  partId: string;
  /** The short name ("Adafruit BME688"). */
  name: string;
  /** What it is, for the second half of a compact title ("Temp, Humidity, Pressure, Gas"). */
  summary?: string;
  manufacturer?: string;
  mpn?: string;
  /** The category trail's last names ("Environmental · Gas"). */
  category?: string;
  /** One short sentence that tells it apart from its neighbours. */
  description?: string;
  /** Protocols, packages and the like, as small tags. */
  tags: string[];
  library: string;
  /** The revision Add takes. */
  revision: number;
  /** A thumbnail URL, once the host has it. */
  thumbnail?: string;
  /** The project's copy: its pinned revision (absent when the part is not in the project). */
  used?: { revision?: number; elsewhere?: boolean };
  /** A newer revision than the project's pin. */
  update?: number;
  deprecated?: boolean;
  /** An earlier library provides the same id. */
  shadowedBy?: string;
  /** Adding or updating now ("Adding"). */
  busy?: string;
  /** Flags the "Show only" filters use, when the library says. */
  hasModel?: boolean;
  audited?: boolean;
  /** The part's relevance in its library, when the library ranks. */
  relevance?: number;
  /**
   * How the card asks for its pages (PB-918): the library part and revision
   * whose specifications, dimensions, interfaces, CAD and artifacts it shows.
   * Absent: the card has only its overview (a part no library holds).
   */
  pages?: PartPagesRef;
}

// ---------------------------------------------------------------- a part's pages (PB-918)

/** The pages a card's text carousel turns through, in order; a part shows only those it has data for. */
export const CARD_PAGES = ["overview", "specs", "dimensions", "interfaces", "cad", "artifacts"] as const;
export type CardPageId = (typeof CARD_PAGES)[number];

/** Which part's pages: `<library>/<part id>` and the revision (the recommended one when absent). */
export interface PartPagesRef {
  key: string;
  revision?: number;
}

export interface PartImage {
  url: string;
  /** What the picture is ("Photo", "CAD render"), for its accessible name. */
  label: string;
}

/** A part's outline, in millimetres, as far as the definition states it. */
export interface PartOutline {
  length?: number;
  width?: number;
  height?: number;
  diameter?: number;
}

export interface PartCadInfo {
  /** A still picture of the model (a list never loads the model itself). */
  preview?: string;
  /** "STEP · 0.85 MB". */
  file?: string;
  /** "Vendor CAD · MIT", "Generated · KCL". */
  origin?: string;
  /** Named mate features (one per interface with geometry). */
  features: number;
  /** The revision carries a mesh the detail can orbit, and its size in bytes. */
  mesh?: number;
}

export interface PartArtifactItem {
  name: string;
  /** Its format or size: "PDF", "web", "0.85 MB". */
  note?: string;
  url?: string;
  /** Its licence, short: "MIT", "Protoboard library terms", "REV IP Policy". */
  license?: string;
  /** What the terms say, from the part's terms.json (the card's tooltip). */
  licenseSummary?: string;
  /** The terms' page. */
  licenseUrl?: string;
}

/** A part's artifacts of one kind: datasheets, CAD models, CAD sources. */
export interface PartArtifactGroup {
  kind: string;
  label: string;
  icon: string;
  items: PartArtifactItem[];
  /** One line for the group as a row: its only item's name, or its formats ("STEP · 3MF · F3D"). */
  summary: string;
  /** The row's right-hand note: the only item's format, or the count ("3 files"). */
  note: string;
}

/** What a part's pages show, from its definition and its revision's files. Fetched when a page is first shown. */
export interface PartPages {
  revision: number;
  /** Its pictures: the catalog picture first, then the others the revision carries. */
  images: PartImage[];
  specs: PartFact[];
  /** Remarks the definition makes about its figures, under the specifications. */
  specNotes: string[];
  dimensions?: { outline?: PartOutline; rows: PartFact[] };
  /** One chip per interface or bus, the same ones folded ("STEMMA QT ×2"); `count` is every interface. */
  interfaces: { chips: string[]; count: number };
  cad?: PartCadInfo;
  artifacts: PartArtifactGroup[];
}

// ---------------------------------------------------------------- prices by source

/** One price a supplier lists, as the library serves it. */
export interface PartPriceOffer {
  mpn: string;
  sku?: string;
  url?: string;
  unitPrice?: number;
  currency?: string;
  priceBreaks?: { quantity: number; unitPrice: number }[];
  minQuantity?: number;
  stock?: number;
  leadTimeWeeks?: number;
  packaging?: string;
  market?: string;
  authorized?: boolean;
  observedAt: string;
  stale?: boolean;
}

export interface PartPriceSource {
  supplier: string;
  authorized?: boolean;
  from?: { unitPrice: number; currency: string };
  observedAt: string;
  offers: PartPriceOffer[];
}

/** A part's prices by source (`partPrices` of @protoboardai/core/library-client). */
export interface PartPricesModel {
  partId: string;
  sources: PartPriceSource[];
  offers: number;
  /** Why there are none to show, and what to do about it. */
  unavailable?: { code: string; message: string };
}

export interface CategoryRow {
  path: string;
  name: string;
  count: number;
  /** A Lucide icon name; the views pick one by name when absent. */
  icon?: string;
  /** It has sub-categories with parts: choosing it drills in. */
  more?: boolean;
  description?: string;
}

export interface LibrarySource {
  id: string;
  /** The library's own name, when its discovery document gives one. */
  name?: string;
  /** How many parts matched there, or why it did not answer. */
  total?: number;
  error?: string;
}

export interface LibraryModel {
  query: LibraryQuery;
  /** From the top ("All") to the current category. */
  crumbs: { path: string; name: string }[];
  /** The current category's sub-categories: the rows of the category list at this level. */
  categories: CategoryRow[];
  /** The category whose sub-categories `categories` are: the current one, or its parent when the current one has none. */
  level: { path: string; name: string; count: number };
  /** The order of `items`, and the orders the control offers. */
  sort: LibrarySortModel;
  /** The top level (the full page's category list). */
  topCategories: CategoryRow[];
  total: number;
  /** Every part in the libraries searched (the unfiltered search's total), when known. */
  catalogTotal?: number;
  libraries: LibrarySource[];
  items: PartCardModel[];
  more: boolean;
  loading: boolean;
  loadingMore?: boolean;
  error?: string;
  /** The libraries could not be listed at all. */
  setupError?: string;
  /** No project is open: browsing works, adding does not. */
  noProject?: boolean;
}

export interface LibraryActions {
  query(q: Partial<LibraryQuery>): void;
  open(key: string, tab?: PartDetailTab): void;
  add(key: string): void;
  update(key: string): void;
  loadMore(): void;
  retry?(): void;
  /** The part's other actions (copy its id, open its definition): the host's menu. */
  more?(key: string): void;
  /** Open the full-page library (from the sidebar). */
  openPage?(): void;
  /** Open the libraries manager. */
  manage?(): void;
  /** A part's pages, for the cards' text carousel (PB-918); without it the cards keep to their overview. */
  pages?(ref: PartPagesRef): Promise<PartPages>;
}

// ---------------------------------------------------------------- part detail

export type PartDetailTab = "overview" | "specs" | "dimensions" | "interfaces" | "cad" | "artifacts" | "prices" | "revisions";

export interface PartFact {
  label: string;
  value: string;
  /** A Lucide icon name; picked from the label when absent. */
  icon?: string;
}

export interface PartDetailModel {
  key: string;
  partId: string;
  name: string;
  /** Category trail, top first. */
  crumbs: string[];
  manufacturer?: string;
  mpn?: string;
  /** More identifiers for the sub line (a breakout's chip, a connector system). */
  identifiers: string[];
  description?: string;
  library: string;
  libraryUrl?: string;
  revision: number;
  recommended?: number;
  latest: number;
  thumbnail?: string;
  /** The body model to orbit, when the revision has one. */
  model?: string;
  modelError?: string;
  facts: PartFact[];
  interfaces: { id: string; name: string; domain?: string; protocols: string; count: number }[];
  interfaceCount: number;
  datasheet?: { label: string; url: string };
  links: { label: string; url: string }[];
  revisions: { revision: number; createdAt: string; publisher: string; deprecated?: string; recommended: boolean; current: boolean; pinned: boolean }[];
  evidence: { kind: string; title?: string }[];
  dependencies: string[];
  used?: { revision?: number; elsewhere?: boolean };
  /** What the main action does. */
  action: { kind: "add" | "update" | "switch" | "pinned" | "elsewhere"; revision: number };
  busy?: string;
  /** No project is open: the part can be browsed, not added. */
  noProject?: boolean;
  /** A CAD licence or vendor note ("vendor · MIT"). */
  cad?: string;
  /** The part's status (PB-932) and why, when the revision's evidence could be read. */
  trust?: PartTrust;
  trustBasis?: string;
  /** Where the back control returns to ("Library", "Project parts"); none when the detail was not opened from a list. */
  back?: string;
  /** The back control's keyboard shortcut, handled by the page itself ("Alt+←": the web shell). */
  backShortcut?: string;
  /** A shortcut the host itself binds to the back control (VS Code's keybinding): only shown, in the tooltip. */
  backShortcutLabel?: string;
  /** Its pages (PB-918): pictures, specifications, dimensions, interface chips, CAD and artifacts. */
  pages?: PartPages;
  /** The body model is fetched when the CAD section is first shown (`actions.loadModel`), not with the detail. */
  modelLazy?: boolean;
  /** The library can be asked for prices (`actions.prices`). */
  hasPrices?: boolean;
  /** Changes when the prices should be asked for again (the sign-in changed). */
  pricesAs?: string;
}

export interface PartDetailActions {
  act(kind: "add" | "update" | "switch", revision: number): void;
  revision(revision: number): void;
  /** Back to the list the part was opened from (its scroll position kept). */
  back?(): void;
  /** Compare the shown revision with the project's (or another). */
  compare?(): void;
  /** Open the definition source (the vendored copy, or the library's). */
  openSource?(): void;
  openLink(url: string): void;
  openInViewer?(): void;
  copy?(text: string): void;
  /** Fetch the body model (the CAD section was shown); it arrives in `model.model`. */
  loadModel?(): void;
  /** The part's prices by source, from its library. */
  prices?(): Promise<PartPricesModel>;
  /** Sign in to the library's service (the prices need an account). */
  signIn?(): void;
}

// ---------------------------------------------------------------- project parts

export type ProjectPartStatus = "pinned" | "up-to-date" | "update-available" | "diverged" | "local" | "designed";

/** One of the project's parts (`protoboard parts list`). */
export interface ProjectPartModel {
  id: string;
  name: string;
  tier: "catalog" | "project-researched" | "project-specific";
  status: ProjectPartStatus;
  file: string;
  line?: number;
  library?: string;
  revision?: number | string;
  recommended?: number;
  edited?: string[];
  instances: number;
  capability?: { capability: string; provider: string };
  published?: { revision: number; service: string };
  manufacturer?: string;
  partNumber?: string;
  category?: string;
  description?: string;
  /** The part's status (PB-932): local, unverified, verified or official, and why. */
  trust?: PartTrust;
  trustBasis?: string;
  /** A picture, once the host has one (the library's thumbnail of a library part). */
  thumbnail?: string;
  /** Updating or restoring now ("Updating"). */
  busy?: string;
}

export interface ProjectPartsModel {
  parts: ProjectPartModel[];
  counts: { total: number; library: number; researched: number; designed: number; updates: number; diverged: number };
  checked?: { at: string; problems: string[] };
  loading?: boolean;
  error?: string;
  /** Why there is no list yet (B12: signed out, or no project set up): said in place of "no parts". */
  waiting?: string;
}

export interface ProjectPartsActions {
  /** A part's detail (a library part), or where it is written (the project's own). */
  open(id: string): void;
  /** Where the part is written, whatever its tier. */
  openSource?(id: string): void;
  /** The Project Parts page, in the editor area (from the side bar). */
  openPage?(): void;
  /** The library, to add parts from. */
  openLibrary?(): void;
  update?(id: string): void;
  /** Restore a diverged part to its pinned revision. */
  restore?(id: string): void;
  /** Compare a part's copy with its library revision. */
  compare?(id: string): void;
  publish?(id: string): void;
  check?(): void;
  /** A library part's pages, for the cards' text carousel (PB-918). */
  pages?(ref: PartPagesRef): Promise<PartPages>;
}

// ---------------------------------------------------------------- account and libraries

export interface AccountModel {
  state: "unknown" | "signed-out" | "open" | "signed-in" | "expired";
  service?: string;
  email?: string;
  /** A second line: the organisation and plan when known, else where the sign-in is kept. */
  detail?: string;
  publisher?: boolean;
  problem?: string;
}

export interface ManagedLibraryModel {
  id: string;
  name?: string;
  url: string;
  scope: "default" | "project" | "personal";
  /** Parts it holds, when it says. */
  parts?: number;
  access: "signed-in" | "token" | "token-missing" | "public" | "sign-in" | "error" | "checking";
  authEnv?: string;
  error?: string;
  /** Vendored parts pinned to it. */
  pinned: number;
  position: number;
}

export interface LibrariesModel {
  account: AccountModel;
  libraries: ManagedLibraryModel[];
  problems: string[];
  working: boolean;
  noProject?: boolean;
}

export interface LibrariesActions {
  add(url: string, scope: "project" | "personal", authEnv?: string): void;
  remove(id: string, scope: ManagedLibraryModel["scope"]): void;
  /** Move a library `steps` places (default 1) within its scope's search order. */
  move(id: string, scope: ManagedLibraryModel["scope"], direction: "up" | "down", steps?: number): void;
  check?(): void;
  signIn?(): void;
  signOut?(): void;
  /** Open the account page on the sign-in site (PB-1089): the profile, the sign-ins, delete the account. */
  manageAccount?(): void;
}

// ---------------------------------------------------------------- settings

/** An agent on this machine and whether Protoboard's MCP server is in its configuration (PB-930). */
export interface AgentRowModel {
  id: string;
  name: string;
  /** Connected; an older entry of ours; installed but not connected; its configuration does not parse. */
  status: "connected" | "outdated" | "not-connected" | "unreadable";
  /** Its configuration file, as shown (the home folder as `~`). */
  file: string;
  /** A second line: what went wrong, what was just written, or that another server holds the name. */
  detail?: string;
  detailTone?: "neutral" | "ok" | "warning" | "error";
  /** A change to this agent is running. */
  working?: boolean;
  /** The command the user runs in a terminal to connect it, when Protoboard does not make the change itself: the row offers it to copy in place of Connect. */
  manual?: string;
}

/** The entry for an MCP client Protoboard does not set up itself, in each form. */
export interface OtherClientsModel {
  steps: string[];
  forms: { id: string; label: string; text: string }[];
}

export interface SettingsModel {
  account: AccountModel;
  about: {
    /** The version the extension and the stack share. */
    version: string;
    /** Which CLI runs, and where it was found. */
    cli?: string;
    cliFrom?: string;
    /** Why no CLI runs. */
    problem?: string;
  };
  agents: {
    state: "loading" | "ready" | "failed";
    rows: AgentRowModel[];
    /** Known agents that were not found here, by name. */
    notFound: string[];
    problem?: string;
  };
  other?: OtherClientsModel;
  /** More actions: the first steps, the bill of materials, the stack's folder, the command on PATH. */
  links?: SettingsLinkModel[];
}

/** A row of the settings page that opens something of the host's. */
export interface SettingsLinkModel {
  id: string;
  label: string;
  note: string;
  /** A lucide icon name. */
  icon: string;
  /** The button's word: "Open", "Show Folder", "Add to PATH". */
  action: string;
  /**
   * What the button does: `external` opens something outside VS Code (a web
   * page, the file manager) and is the only kind that shows the external-link
   * icon; `view` opens a view of VS Code's; absent, it runs an action here.
   */
  opens?: "external" | "view";
}

export interface SettingsActions {
  signIn?(): void;
  signOut?(): void;
  /** Open the account page on the sign-in site (PB-1089): the profile, the sign-ins, delete the account. */
  manageAccount?(): void;
  connect(id: string): void;
  disconnect(id: string): void;
  refresh(): void;
  openFile(id: string): void;
  copy(text: string, what: string): void;
  openVsCodeSettings(): void;
  openLibraries?(): void;
  showLog?(): void;
  /** One of `links`, by id. */
  run?(id: string): void;
}

// ---------------------------------------------------------------- bill of materials

/** `protoboard bom --format json`: core's structured bill of materials (`@protoboardai/core/bom`). */
export type BomModel = Bom;
export type BomRowModel = BomLine;
export type BomGroupModel = BomGroup;

export interface BomActions {
  /** Open the part of a line (its page in the library, or its definition). */
  openPart?(line: BomLine): void;
  /** Open a line where it is written, when it comes from a file. */
  openRow?(line: BomLine): void;
  /** Show the line's instances in the viewer. */
  focus?(line: BomLine): void;
  /** Keep the units to build (the view has already re-priced). */
  setUnits?(units: number): void;
  /** Keep the offer chosen for a line; `null` goes back to the best offer. */
  chooseOffer?(line: string, offer: string | null): void;
  refreshOffers?(): void;
  /** Export the bill as shown (units and offers included) as CSV. */
  exportCsv?(bom: Bom): void;
  openLink?(url: string): void;
}

// ---------------------------------------------------------------- cloud

export interface CloudModel {
  account: AccountModel;
  project: {
    name: string;
    description?: string;
    author?: string;
    libraries: number;
    parts?: number;
    published: false | { at: string };
  };
  release: { state: "idle" | "running" | "failed" | "refused" | "done"; message?: string; step?: string; problems?: { code: string; message: string }[] };
  releases: { version: string; date: string; units?: number; files?: number; index: boolean }[];
  cost?: {
    /** What the parts of one unit cost, in dollars ("$299.81"). */
    total: string;
    /** What the order costs for the units built, when packs and minimum orders make it more ("$412.10 to order 1"). */
    order?: string;
    /** Notes under the total: converted prices and their rate date, stale prices. */
    others: string[];
    bought: number;
    priced: number;
    unpriced: number;
    made: number;
    /** The largest lines, most first. */
    top: { item: string; price: string }[];
    source: string;
  };
  costMissing?: string;
  quotes: { id: string; title: string; state: string }[];
}

export interface CloudActions {
  signIn?(): void;
  signOut?(): void;
  /** Open the account page on the sign-in site (PB-1089): the profile, the sign-ins, delete the account. */
  manageAccount?(): void;
  generate?(): void;
  openRelease?(version: string): void;
  openBom?(): void;
  publish?(): void;
  requestQuote?(): void;
  fetchOffers?(): void;
}
