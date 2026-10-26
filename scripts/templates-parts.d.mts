/** Types for scripts/templates-parts.mjs (used by packages/core/test/templates-parts.test.ts). */
export interface TemplatePin {
  partId: string;
  revision: number;
}
export interface TemplatePins {
  template: string;
  derivedFrom?: string;
  pins: TemplatePin[];
}
export interface PinResult extends TemplatePin {
  status: "current" | "behind" | "ahead" | "deprecated" | "missing";
  recommended?: number;
  latest?: number;
  /** For `behind`: whether the recommended revision's definition differs from the pinned one's. */
  definition?: "same" | "changed" | "unknown";
  note?: string;
}
export interface TemplateResult {
  template: string;
  derivedFrom?: string;
  parts: PinResult[];
}
export declare function hostedLibraryUrl(repo?: string): string;
export declare function templatePins(dir?: string): TemplatePins[];
export declare function comparePin(pin: TemplatePin, answer: { part: { recommendedRevision?: number; latestRevision: number }; revisions?: { revision: number; definitionDigest?: string; deprecated?: { reason?: string } }[] } | undefined): PinResult;
export declare function compareTemplates(url: string, templates: TemplatePins[], options?: { fetch?: typeof fetch; timeoutMs?: number }): Promise<TemplateResult[]>;
export declare function report(url: string, result: TemplateResult[], options?: { all?: boolean }): string;
