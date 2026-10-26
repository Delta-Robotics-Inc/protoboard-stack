/** Types for scripts/reference-docs.mjs (used by packages/cli/test/reference-docs.test.ts). */
export declare const REPO: string;
export declare const REFERENCE_FILES: Record<string, () => string>;
export declare function helpText(): string;
export declare function helpEntries(help: string, section: string, next?: string): { signature: string; description: string }[];
export declare function cliReference(): string;
export declare function extensionsReference(): string;
export declare function extensionManifests(): { folder: string; manifest: Record<string, any> }[];
