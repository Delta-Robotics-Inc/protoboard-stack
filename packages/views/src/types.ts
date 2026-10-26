/**
 * The view contract: what a view is, what it is given, and the host and theme
 * adapters a shell (web, VS Code, desktop) implements so the same views run
 * in each without rebuilding (docs/specs/viewer-stack.md).
 */
import type { ComponentType } from "react";
import type { ModuleDef, UhdBundle } from "@deltarobotics/uhd";
import type { Theme, ThemeAdapter, ViewerSelection } from "@deltarobotics/uhd-viewer/components";

export type { Theme, ThemeAdapter };

/** Where a view is opened: the focused module, by instance path, in the loaded bundle. */
export interface ViewTarget {
  /** The focused module's definition. */
  module: ModuleDef;
  /** Its instance path from the root system ("" is the root). */
  path: string;
  bundle: UhdBundle;
}

/** What a view's component receives. */
export interface ViewProps extends ViewTarget {
  host: HostAdapter;
  /** The view's own registration (its id, title, icon). */
  view: ViewDefinition;
  /**
   * What the view was opened with (`openView`'s `params`): the pair view's
   * two modules (`a`, `b`) or link (`link`), a board (`board`). Each view
   * documents its own; absent keys mean its default.
   */
  params?: Readonly<Record<string, string>>;
}

/** `ready`: a working view. `planned`: registered so the tab exists; the shells show what is coming. */
export type ViewStatus = "ready" | "planned";

export interface ViewDefinition {
  /** Unique: `diagram`, `3d`, `schematic`, or `<extension>.<view>` for an extension's own. */
  id: string;
  title: string;
  /** A Lucide icon name (kebab-case). */
  icon: string;
  /** Whether the view has anything to show for a module (its tab is offered only then). */
  applies(module: ModuleDef, bundle: UhdBundle, at?: { path: string }): boolean;
  /** The view. Absent: a planned view (the shell shows its placeholder). */
  component?: ComponentType<ViewProps>;
  status?: ViewStatus;
  /** Sort key among a module's tabs (lower first: diagram 0, 3d 10, schematic 20, pcb 30, bom 40, pair 50, library 60). */
  order?: number;
  /** One sentence for the tab's tooltip and the placeholder. */
  description?: string;
  /** Who registered it: `builtin`, or the contributing extension's id. */
  source?: string;
  /**
   * The view draws the shared UHD viewer (diagram, 3D): shells keep one
   * viewer state for all of these, so selection and drill level carry across.
   */
  uhd?: boolean;
}

/**
 * What a view may ask of the shell around it. Every method is optional: a
 * shell offers what it can (VS Code opens a source file in an editor, the
 * web shell in a new tab, a static page not at all).
 */
export interface HostAdapter {
  /** `web`, `vscode`, `desktop`, … (for views that word things per host). */
  kind: string;
  /** Show a module's definition (or its instance's line) in source. */
  openSource?(request: { defId: string; instancePath?: string }): void;
  /** Open one of a module's artifact files (VS Code: STEP and GLB in its CAD viewer, the rest in an editor). */
  openArtifact?(request: { defId: string; artifactId: string }): void;
  /**
   * Open a view for a module: a new editor tab in VS Code, the tab in the web
   * shell. `params` reach the view as its `params` (see ViewProps).
   */
  openView?(viewId: string, path: string, params?: Record<string, string>): void;
  /**
   * A URL the view can fetch a module's artifact file from (a drawing, a
   * pick-and-place file): the dev server's, a webview resource. Absent: the
   * view uses the artifact's own `url` when it has one.
   */
  artifactUrl?(defId: string, filePath: string): string | undefined;
  /** The user's selection changed (VS Code's native Inspector follows it). */
  selectionChanged?(selection: ViewerSelection | null): void;
  /** A short status message ("layout saved"). */
  notify?(message: string, severity?: "info" | "warning" | "error"): void;
  /** Add the library parts the project names and does not hold (VS Code: Fetch Parts, B6). */
  fetchParts?(): void;
}

/** A host that offers nothing (tests, static pages). */
export const NULL_HOST: HostAdapter = { kind: "none" };
