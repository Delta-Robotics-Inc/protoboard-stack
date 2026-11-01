// Types for detect.cjs (the kicad-cli detection shared by cli.ts and probe.cjs).

/** Where the kicad-cli in use came from. */
export type KicadCliSource = "override" | "path" | "install";

/** The kicad-cli found: its path and the version it answered (asked once per process). */
export interface KicadCli {
  path: string;
  /** As kicad-cli printed it, e.g. "10.0.8" or "10.99.0-1234-gabc". */
  version: string;
  major: number;
  minor: number;
  source: KicadCliSource;
  /** A development build (minor 99, e.g. 10.99). */
  nightly: boolean;
}

export interface KicadCliSearch {
  cli: KicadCli | undefined;
  /** Candidates that existed and were turned down, with why. */
  tried: { path: string; source: KicadCliSource; why: string }[];
  /** Why nothing usable was found (undefined when `cli` is set). */
  reason: string | undefined;
}

/** What the search touches; every field defaults to the real machine (tests pass a fake tree and runner). */
export interface KicadDetectDeps {
  env?: Record<string, string | undefined>;
  platform?: string;
  home?: string;
  exists?: (path: string) => boolean;
  readdir?: (dir: string) => string[];
  run?: (file: string, args: string[]) => { status: number | null; stdout: string; stderr?: string };
}

export declare const MIN_MAJOR: number;
export declare const ENV: "PROTOBOARD_KICAD_CLI";
export declare function parseVersion(text: string): { version: string; major: number; minor: number; patch: number } | undefined;
export declare function candidates(deps?: KicadDetectDeps): { path: string; source: KicadCliSource }[];
export declare function findKicadCli(deps?: KicadDetectDeps): KicadCliSearch;
export declare function describeKicadCli(cli: KicadCli): string;
export declare function kicadCliCached(): KicadCliSearch;
export declare function resetKicadCliCache(): void;
