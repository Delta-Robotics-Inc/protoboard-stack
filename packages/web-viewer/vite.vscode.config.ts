import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// The VS Code shell (src/vscode): one ES module and one stylesheet the
// extension ships and loads into each viewer tab's webview
// (dist/vscode/protoboard-viewer.js, .css), React, Three and the viewer
// bundled in. Built after the web shell, into its own folder.
export default defineConfig({
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { dedupe: ["react", "react-dom", "three", "@xyflow/react", "@radix-ui/react-scroll-area", "lucide-react"] },
  build: {
    outDir: "dist/vscode",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    minify: true,
    // Radix's modules start with "use client" (for React Server Components); a client bundle drops it, as it should
    rolldownOptions: { onwarn: (w, warn) => void (w.code !== "MODULE_LEVEL_DIRECTIVE" && warn(w)) },
    lib: { entry: "src/vscode/index.ts", formats: ["es"], fileName: () => "protoboard-viewer.js", cssFileName: "protoboard-viewer" },
  },
});
