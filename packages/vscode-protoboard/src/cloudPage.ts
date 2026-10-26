/**
 * The Cloud view's model and messages (spec §2.4, PB-904): account,
 * project, releases and the Manufacturing Package, the cost estimate as a
 * preview of the BOM, and quotes. The view is @protoboardai/views' CloudPanel
 * in the extension's React webviews (appPage.ts); `view` is its model, the
 * rest is what the integration test and the cost actions read.
 */
import type { CloudModel } from "@protoboardai/views/parts-model";

/** Page → extension. */
export type CloudPageMessage =
  | { type: "ready" }
  | { type: "generate" }
  | { type: "focus"; index: number }
  | { type: "openRow"; index: number }
  | { type: "openList" }
  | { type: "fetchOffers" }
  | { type: "openPackage"; version: string; what: "index" | "browser" | "overview" | "folder" }
  | { type: "showLog" }
  | { type: "signIn" }
  | { type: "signOut" }
  | { type: "openBom" }
  | { type: "publish" }
  | { type: "requestQuote" };

/** Extension → page. */
export interface CloudPageModel {
  type: "model";
  project: string;
  /** The Protoboard Cloud sign-in (account.ts): who, a note, and the action the card offers. */
  account: { signedIn: boolean; title: string; note: string; action?: "signIn" | "signOut" };
  release: { state: "idle" | "running" | "failed" | "refused" | "done"; message?: string; problems?: { code: string; message: string }[]; step?: string };
  /** Newest first. */
  releases: { version: string; date: string; index: boolean; overview: boolean }[];
  cost?: {
    /** Where the lines come from: the design as last built, or a file. */
    source: { kind: "design" } | { kind: "release"; version: string; file: string } | { kind: "file"; file: string };
    /** Units the order is for, and both costs in dollars. */
    units: number;
    perUnit: string;
    order: string;
    total: string;
    bom: { totals: string[]; priced: number; unpriced: number; included: number };
    made: number;
    offers: { catalog: boolean; sourcing: number };
    lines: {
      kind: "priced" | "unpriced" | "made" | "included";
      item: string;
      definition: string;
      detail: string;
      qty: string;
      price: string;
      note: string;
      row?: number;
      module?: string;
      title: string;
    }[];
  };
  /** No build and no release: nothing to cost. */
  costMissing?: string;
  /** What the Cloud panel draws. */
  view: CloudModel;
}
