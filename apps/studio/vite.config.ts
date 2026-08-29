import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The workspace packages ship TypeScript source, so point Vite straight at it.
    alias: {
      "@alidade/core": pkg("core"),
      "@alidade/maplibre": pkg("maplibre"),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000" },
  },
});
