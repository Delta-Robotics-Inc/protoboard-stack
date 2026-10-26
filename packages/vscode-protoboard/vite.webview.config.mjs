// The extension's React webviews (webview/views-app): one ES module and one
// stylesheet (dist/views-app.js, dist/views-app.css) with React, the viewer's
// components and the parts views bundled in, fonts inlined, so a webview
// loads only the extension's own files. React and React DOM are the web
// shell's copies (the stack's one React 19 for its shells).
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const here = dirname(fileURLToPath(import.meta.url));
const shell = createRequire(new URL("../web-viewer/package.json", import.meta.url));
const dir = (name) => dirname(shell.resolve(`${name}/package.json`));

export default defineConfig({
  root: here,
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    alias: { react: dir("react"), "react-dom": dir("react-dom"), scheduler: dir("scheduler") },
    dedupe: ["react", "react-dom", "three", "@radix-ui/react-scroll-area", "lucide-react"],
  },
  logLevel: "error",
  build: {
    outDir: "dist",
    emptyOutDir: false,
    chunkSizeWarningLimit: 4000,
    minify: true,
    sourcemap: false,
    lib: { entry: "webview/views-app/main.tsx", formats: ["es"], fileName: () => "views-app.js", cssFileName: "views-app" },
    // Radix's modules start with "use client" (for React Server Components); a client bundle drops it, as it should
    rolldownOptions: { output: { codeSplitting: false }, onwarn: (w, warn) => void (w.code !== "MODULE_LEVEL_DIRECTIVE" && warn(w)) },
  },
});
