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
    /*
     * `ws: true` is not optional here. A proxy without it answers the live
     * feed's upgrade request with a plain 200 and the socket closes
     * immediately, which the studio reports as a connection that keeps
     * dropping — a message about the dev server, phrased as a fault in the feed.
     */
    proxy: { "/api": { target: "http://localhost:8000", ws: true } },
  },
});
