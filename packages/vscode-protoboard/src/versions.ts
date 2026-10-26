/**
 * One version number (PB-944, decided 2026-10-07): the VS Code extension and
 * the stack (@protoboardai/core, the CLI and the extensions of a project)
 * share it and move together. An extension-only fix bumps the whole stack.
 * UHD keeps its own (it is the separate public protocol).
 *
 * esbuild.mjs writes the stack's version in from packages/core/package.json
 * and refuses to build when this package's own version differs, so the
 * number is typed once per release and cannot drift.
 */
declare const __PB_STACK_VERSION__: string | undefined;

/** The stack version this extension was built from (undefined when run unbundled, as in unit tests). */
export const STACK_VERSION: string | undefined = typeof __PB_STACK_VERSION__ === "string" && __PB_STACK_VERSION__ ? __PB_STACK_VERSION__ : undefined;

/** The log's first line, and what **Protoboard: About** shows. */
export function aboutLine(extensionVersion: string, stackVersion: string | undefined = STACK_VERSION): string {
  const line = `Protoboard for VS Code ${extensionVersion}`;
  // the build refuses this; said here for a build made some other way
  return stackVersion && stackVersion !== extensionVersion ? `${line} (stack ${stackVersion}: mismatched build, please report it)` : line;
}
