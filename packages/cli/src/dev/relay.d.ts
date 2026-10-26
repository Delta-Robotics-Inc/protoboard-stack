/** Types for relay.js (the dev page's relay between the viewer and a framing host). */

/** Where a module is written down, as the dev server resolves it (./sources.ts). */
export interface RelayPlace {
  file: string;
  line?: number;
  path: string;
}

/** The parts of `window` the relay uses (a test passes its own). */
export interface RelayWindow {
  parent: { postMessage(message: unknown, targetOrigin: string): void } | RelayWindow;
  location: { origin: string; ancestorOrigins?: ArrayLike<string> };
  document?: { referrer?: string };
  addEventListener(type: "message", listener: (e: { data: unknown; origin: string; source: unknown }) => void): void;
  removeEventListener(type: "message", listener: (e: { data: unknown; origin: string; source: unknown }) => void): void;
}

export interface OpenSourceEvent {
  type: "uhd-viewer:openSource";
  defId: string;
  instancePath?: string;
  /** Where the definition is declared. */
  source?: RelayPlace;
  /** Where the instance is declared in its parent's definition. */
  instanceSource?: RelayPlace;
}

export interface RelayOptions {
  window: RelayWindow;
  /** Parent origins taken: exact origins, `scheme://*`, `*`, or `self` (default: `self` and `vscode-webview://*`). */
  origins?: string[];
  /** Asks the dev server where a definition and an instance are written. */
  resolveSource(request: { defId: string; instancePath?: string }): Promise<{ source?: RelayPlace; instanceSource?: RelayPlace } | undefined>;
  /** openSource in a tab of its own (no host to send it to). */
  onLocal?(event: OpenSourceEvent): void;
}

export interface Relay {
  /** The page is in a frame (a host may be listening). */
  framed: boolean;
  /** The viewer's callbacks (mountViewer options). `onOpenArtifact` and `onOpenPair` only in a frame. */
  callbacks: {
    onReady(): void;
    onSelectionChanged(selection: unknown): void;
    onOpenSource(request: { defId: string; instancePath?: string }): void;
    onOpenArtifact?(request: { defId: string; artifactId: string }): void;
    /** A link's pair view asked for (`uhd-viewer:openPair`); only in a frame. */
    onOpenPair?(request: { linkId: string; a: string; b: string }): void;
  };
  /** Hand host messages to the viewer (those that came before are delivered now). */
  attach(viewer: { post(message: unknown): boolean }): void;
  /** Resolve and send (or show) an openSource; resolves with the event. */
  openSource(request: { defId: string; instancePath?: string }): Promise<OpenSourceEvent>;
  close(): void;
}

export declare const DEFAULT_HOST_ORIGINS: string[];
export declare function originAllowed(origin: string, allowed: readonly string[], self?: string): boolean;
export declare function createRelay(options: RelayOptions): Relay;
