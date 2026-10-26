import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// One ES module and one stylesheet (dist/web-viewer.js, dist/web-viewer.css),
// with React, Three and the viewer bundled in: `protoboard dev` serves them as
// they are. Peers of the viewer's component library resolve once, from here.
export default defineConfig({
  // JSX through Vite 8's own transform (Oxc, automatic runtime): no React plugin, no Fast Refresh needed for a build
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic" } },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { dedupe: ["react", "react-dom", "three", "@xyflow/react", "@radix-ui/react-scroll-area", "lucide-react"] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    minify: true,
    // Radix's modules start with "use client" (for React Server Components); a client bundle drops it, as it should
    rolldownOptions: { onwarn: (w, warn) => void (w.code !== "MODULE_LEVEL_DIRECTIVE" && warn(w)) },
    lib: { entry: "src/index.ts", formats: ["es"], fileName: () => "web-viewer.js", cssFileName: "web-viewer" },
  },
});
