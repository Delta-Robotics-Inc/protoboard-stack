/**
 * Bundling a browser entry that runs the board core in a page (the headless render page, the dev page): esbuild,
 * with Node's built-ins replaced by the small shims in ../shims (an in-memory board service never touches files).
 * Node only. esbuild is already installed in the workspace (Vite and tsx bring it).
 */
import { build, type Plugin } from "esbuild";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIMS = join(HERE, "..", "shims");
const REPO = join(HERE, "..", "..", "..", "..", "..");

const nodeShims: Plugin = {
  name: "node-shims",
  setup(b) {
    b.onResolve({ filter: /^(node:)?(fs|path|crypto)$/ }, (args) => ({ path: join(SHIMS, args.path.replace(/^node:/, "") === "crypto" ? "node-crypto.ts" : "node-fs.ts") }));
  },
};

/** React 19 for the bundles: the root's react, and the shells' react-dom (the root's react-dom is 18; vitest.config.ts says why). */
export function reactAliases(): Record<string, string> {
  const shell = createRequire(join(REPO, "packages", "web-viewer", "package.json"));
  const root = createRequire(join(REPO, "package.json"));
  return { react: dirname(root.resolve("react/package.json")), "react-dom": dirname(shell.resolve("react-dom/package.json")) };
}

export interface BundleOptions {
  format?: "iife" | "esm";
  minify?: boolean;
  react?: boolean;
  define?: Record<string, string>;
}

/** Bundle one entry file to a single script (returned, not written). */
export async function bundleBrowser(entry: string, options: BundleOptions = {}): Promise<string> {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: options.format ?? "iife",
    platform: "browser",
    target: "es2022",
    minify: options.minify ?? true,
    sourcemap: false,
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', ...options.define },
    plugins: [nodeShims],
    ...(options.react ? { alias: reactAliases() } : {}),
    logLevel: "silent",
  });
  return res.outputFiles[0].text;
}
