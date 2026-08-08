import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Prebundles the extension DOM-PDF boot into one public JS file so the
 * download tab does not wait on Vite's module waterfall over the tunnel.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    emptyOutDir: false,
    outDir: path.resolve(root, "public"),
    lib: {
      entry: path.resolve(root, "app/extension-pdf-boot.ts"),
      formats: ["es"],
      fileName: () => "extension-pdf-download.js",
    },
    cssCodeSplit: false,
    minify: true,
    sourcemap: false,
    target: "es2020",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "extension-pdf-download.[ext]",
      },
    },
  },
});
