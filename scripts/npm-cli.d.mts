/** Types for scripts/npm-cli.mjs (used by packages/vscode-protoboard/scripts/build-stack.ts and packages/cli/test/packaging-scripts.test.ts). */
import type { ExecFileSyncOptions } from "node:child_process";
export interface NpmLook {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
}
export interface NpmCommand {
  command: string;
  args: string[];
  shell: boolean;
}
export declare function npmCliPath(tool?: "npm" | "npx", look?: NpmLook): string | undefined;
export declare function cmdArg(a: string): string;
export declare function npmCommand(args: string[], options?: NpmLook & { tool?: "npm" | "npx" }): NpmCommand;
export declare function runNpm(args: string[], options?: ExecFileSyncOptions & { tool?: "npm" | "npx" }): string | Buffer;
