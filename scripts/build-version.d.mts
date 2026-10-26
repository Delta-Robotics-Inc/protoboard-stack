/** Types for scripts/build-version.mjs (used by packages/vscode-protoboard/scripts/build-stack.ts and its tests). */
import type { BuildStamp } from "../packages/core/src/build-info.ts";
export type GitRunner = (args: string[], cwd: string) => string | undefined;
export interface BuildVersion {
  version: string;
  /** The committed version (packages/core/package.json). */
  base: string;
  release: boolean;
  /** The release stamp (release builds only). */
  stamp?: BuildStamp;
}
export declare function nextPatch(version: string): string;
export declare function devVersion(base: string, o: { released: boolean; commits: number; sha?: string | null }): string;
export declare function releaseStamp(file: string, version: string, commit?: string | null): BuildStamp | undefined;
export declare function buildVersion(repo: string, options?: { git?: GitRunner }): BuildVersion;
