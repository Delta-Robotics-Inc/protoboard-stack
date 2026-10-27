/**
 * What the Inspector and the DRC panel draw (PB-940, PB-901): plain data a
 * shell computes and hands to the components, and the actions they call back
 * with. No React and no host API here: the VS Code extension's Node side
 * builds these models and imports only this file's types.
 */
import type { PartTrust } from "../parts/part-status.js";

/** A small outlined label: the kind, the part's tier, its status, a sync state. */
export interface InspectorChip {
  text: string;
  /** A part status (PB-932): the chip starts with the state's dot. */
  status?: PartTrust;
  /** The part is a blank block (no part chosen yet): the dot is a dashed ring and the chip stands out with a dashed outline. */
  blank?: boolean;
  /** A severity or "ok": the chip takes its colour. */
  tone?: string;
  title?: string;
}

export interface InspectorRow {
  /** Lucide icon name. */
  icon: string;
  label: string;
  detail?: string;
  chips?: InspectorChip[];
  /** A dot in the severity colour. */
  tone?: string;
  /** What a click does. */
  action?: { type: "focus"; path: string } | { type: "finding"; key: string };
  /** A finding's code, under its message. */
  code?: string;
}

export interface InspectorSection {
  title: string;
  count?: number;
  rows: InspectorRow[];
  /** What it holds, said in its header, shown open or closed ("FC · ESC · cable", "DolphinRC · $69.99"). */
  summary?: string;
  /** A secondary section: it starts closed (design A, PB-1042). */
  collapsed?: boolean;
  /** Rows shown at a time (default 10, PB-1088): "Show 10 more" adds the next ones. */
  limit?: number;
}

/** A finding the interface cards show (on an interface or its links), with the canonical ids it is about. */
export interface InspectorFinding {
  key: string;
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  /** Links as the viewer selects them (`owner/local`, `local` at the root; a derived link by its own id), interfaces as `path:id`. */
  refs: string[];
}

/** An interface card's request: the module, the interface, and the links that end on it as their module declares them. */
export interface InspectorInterfaceRequest {
  path: string;
  interfaceId: string;
  owner: string;
  links: string[];
}

/** A picture a card may show: an image file, or a model small enough to draw. `F` is how a file is named: a path on the host's side, a URL on the page's. */
export interface InspectorPreview<F = string> {
  kind: "image" | "model";
  src: F;
}

/**
 * What the viewer's own details show for the selection, and the files they
 * may load. `target` is uhd-viewer's `DetailsTarget`.
 */
export interface InspectorDetails<F = string> {
  target: { kind: "module"; path: string } | { kind: "link"; owner: string; ids: string[] } | { kind: "definition"; id: string };
  /** Artifact files the page may load, by `<definition id>\n<file path>`. */
  files: Record<string, F>;
  /** Pictures for artifacts that are not images themselves (a model's exported preview, or a small model to draw), by `<definition id>#<artifact id>`. */
  previews: Record<string, InspectorPreview<F>>;
  /** Evidence files by definition id (sources.json, verification.json), as read. */
  evidence?: Record<string, { sources?: unknown[]; verification?: unknown }>;
  /** Definitions that are not in the project's bundle (a library part shown on its own). */
  definitions?: unknown[];
  /**
   * The definition whose artifacts are shown: the selection's own, never the
   * parts below it (PB-1063). A child's are seen by selecting the child.
   */
  artifactsOf?: string;
  /** A picture of the part that is not one of its definition's artifacts (a library's thumbnail). */
  picture?: F;
  /** Web addresses the page may ask the host to open (artifact and evidence links of what is shown). */
  links?: string[];
  /** The findings the interface cards show, with the keys the DRC panel knows them by. */
  findings?: InspectorFinding[];
}

/** An artifact card the shell builds itself (an interface's geometry), drawn like the details' cards. */
export interface InspectorArtifact<F = string> {
  defId: string;
  artifactId: string;
  title: string;
  /** "Interface geometry", "3D model". */
  kindLabel: string;
  format?: string;
  /** Where it comes from: a file's name. */
  source?: string;
  /** Lucide icon name. */
  icon: string;
  preview?: InspectorPreview<F>;
}

export type InspectorAction = "focus" | "source" | "artifacts" | "operation" | "pair" | "detail";

/** The selection as a card: its header, state and sections; the viewer's details fill the middle. */
export interface InspectorCard<F = string> {
  kind: "module" | "link" | "level" | "part" | "interface";
  /** Lucide icon name. */
  icon: string;
  title: string;
  subtitle?: string;
  /** What it is, before the subtitle: "Module", "Assembly", "Part", "Link" (design A: "Module · DolphinRC F405 V3 stack"). */
  kindLabel?: string;
  /** The header's summary row (design A): its price and how many modules are below it. */
  summary?: { price?: string; children?: number };
  chips: InspectorChip[];
  /** Findings here (and below a module): the worst first. */
  counts: { error: number; warning: number; info: number };
  /** Sections of rows after the details: where a part is used, the modules below, the links it declares, its findings. */
  sections: InspectorSection[];
  /** Which actions apply (icon buttons in the header). */
  actions: { focus: boolean; source: boolean; artifacts: boolean; operation: boolean; pair?: boolean; detail?: boolean };
  /** The file the source action opens (project-relative), and the line when it is known: the action is drawn with the file's name. */
  source?: { file: string; line?: number };
  /** The instance path the actions are about ("" the root), and a link id for a link. */
  path: string;
  linkId?: string;
  /** A part's card: the part and the library it comes from (its page opens from the card). */
  part?: { partId: string; library?: string };
  details?: InspectorDetails<F>;
  /** Artifact cards of the card's own (an interface's geometry), before the sections. */
  artifacts?: InspectorArtifact<F>[];
}

/** The project's UHD bundle as the page loads it: a URL, and a version that changes with every build. */
export interface InspectorBundle {
  src: string;
  version: string;
}

export type InspectorContent<F = string> = { card: InspectorCard<F>; project: string; bundle?: InspectorBundle } | { empty: string; project?: string };

export interface InspectorActions {
  action(action: InspectorAction): void;
  /** Show a module in the viewer. */
  focus(path: string): void;
  /** Something picked inside the details: canonical ids from the root. */
  select(selection: { kind: "node" | "link"; id: string }): void;
  finding(key: string): void;
  explain(key: string): void;
  openArtifact(defId: string, artifactId: string): void;
  openLink(url: string): void;
  /** Draws a model small, as a picture's URL (the shell's three.js). */
  drawModel?(src: string): Promise<string>;
  /** An interface card's Open in source: the line of its link, else of the interface. */
  interfaceSource?(request: InspectorInterfaceRequest): void;
  /** An open slot's Connect…: where a link from it is written. */
  connect?(request: InspectorInterfaceRequest): void;
}

// ---- the DRC panel

export interface DrcRowModel {
  key: string;
  code: string;
  summary: string;
  message: string;
  reasons: string[];
  module: string;
  means?: string;
  todo?: string;
  validator: string;
  sourceKind: string;
  sourceLabel?: string;
  hasSource: boolean;
  /** A fix the extension can run for this finding (B6: Fetch Parts for a library part that was not fetched). */
  fix?: { label: string; icon?: string };
}

export interface DrcLaneModel {
  id: "blocking" | "warnings" | "info";
  title: string;
  total: number;
  shown: number;
  groups: { key: string; label: string; items: DrcRowModel[] }[];
}

export interface DrcQueryModel {
  groupBy: "module" | "rule" | "source";
  text: string;
  severity: "all" | "error" | "warning";
  info: boolean;
}

export interface DrcPanelModel {
  state: "none" | "idle" | "running" | "failed";
  project: string;
  /** When the findings were produced, as a time of day. */
  at?: string;
  query: DrcQueryModel;
  model?: {
    lanes: DrcLaneModel[];
    counts: { error: number; warning: number; info: number };
    configured: { links: number; linksTotal: number; checksRan: number; checksSkipped: number };
  };
}

export interface DrcPanelActions {
  query(query: DrcQueryModel): void;
  locate(key: string): void;
  openSource(key: string): void;
  explain(key: string): void;
  /** Run the row's fix (`DrcRowModel.fix`). */
  fix?(key: string): void;
  refresh(): void;
  /** Which rows are open and which groups are closed, kept by the shell across reloads. */
  saved?: { expanded?: string[]; collapsed?: string[] };
  save?(state: { expanded: string[]; collapsed: string[] }): void;
}
