import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Core and adapter tests run in Node. No browser, no WebGL, no canvas.
export default defineConfig({
  resolve: {
    alias: {
      "@alidade/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@alidade/maplibre": fileURLToPath(new URL("./packages/maplibre/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts", "apps/*/tests/**/*.test.ts"],
  },
});
