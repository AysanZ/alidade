import type { StyleSpecification } from "maplibre-gl";

/**
 * Phase 0 style. Written by hand here; from phase 1 on it is produced by the
 * core module from the project document and applied through the adapter.
 */
export const style: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    wards: {
      type: "vector",
      tiles: [`${location.origin}/api/tiles/wards/{z}/{x}/{y}.mvt`],
      minzoom: 0,
      maxzoom: 16,
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#0b0b0c" },
    },
    {
      id: "wards-fill",
      type: "fill",
      source: "wards",
      "source-layer": "wards",
      paint: {
        "fill-opacity": 0.86,
        "fill-color": [
          "step",
          ["coalesce", ["get", "density"], -1],
          "#3a3a40", // no data
          0, "#0f2438",
          900, "#1b4674",
          2100, "#2e6fe0",
          3900, "#6fa8ff",
          6200, "#bbdaff",
        ],
      },
    },
    {
      id: "wards-line",
      type: "line",
      source: "wards",
      "source-layer": "wards",
      paint: { "line-color": "#0a0a0b", "line-width": 0.6 },
    },
  ],
};
