/** Types for scripts/registry/uhd-version.mjs (used by packages/cli/test/publish-stack.test.ts). */
export declare const UHD: string;
export interface UhdGitState {
  head: string;
  tagCommit?: string;
  dirty: boolean;
}
export type UhdPublishPlan = { publishAs: string; dev: boolean; note?: string; refuse?: undefined } | { refuse: string; publishAs?: undefined; dev?: undefined; note?: undefined };
export declare function nextVersion(version: string): string;
export declare function devVersion(base: string, sha: string): string;
export declare function uhdPublishPlan(input: { version: string; hosted: boolean; dev: boolean; git: UhdGitState | undefined }): UhdPublishPlan;
export declare function pinUhd(pkg: Record<string, any>, version: string): string[];
export declare function uhdGitState(dir: string, version: string): UhdGitState | undefined;
