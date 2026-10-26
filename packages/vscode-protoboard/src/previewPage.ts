/**
 * The messages of a part's detail tab (@protoboardai/views' PartDetail in the
 * extension's React webviews, appPage.ts). The extension posts
 * `{ type: "model", model, tab? }` (libraryView.ts, PartPreview).
 */

/** Page → extension. */
export type PreviewAction =
  | { type: "ready" }
  | { type: "act"; kind: "add" | "update" | "switch"; revision: number }
  | { type: "revision"; revision: number }
  | { type: "openViewer" }
  | { type: "openDefinition" }
  | { type: "openPage" }
  | { type: "back" }
  | { type: "openLink"; url: string }
  | { type: "copy"; text: string }
  /** The CAD section asked for a model too large to fetch with the detail. */
  | { type: "loadModel" }
  /** The Prices section opened: answered with `{ type: "answer", ask, ... }`. */
  | { type: "prices"; ask: number }
  | { type: "signIn" }
  | { type: "retry" };
