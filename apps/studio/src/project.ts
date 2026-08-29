import type { MapProject } from "@alidade/core";

/**
 * The sample project. From phase 8 this is loaded from the database; for now it is
 * the one thing the application starts with, and every panel edits it.
 */
export const demoProject: MapProject = {
  schema: 3,
  id: "demo",
  name: "Dushanbe · population density 2024",
  view: { center: [68.79, 38.5598], zoom: 11.2, pitch: 0, bearing: 0 },
  basemap: { id: "graphite", name: "Graphite", background: "#0b0b0c", labels: true },
  environment: {},
  sources: {
    wards: {
      type: "vector",
      tiles: [`${location.origin}/api/tiles/wards/{z}/{x}/{y}.mvt`],
      maxzoom: 16,
    },
  },
  tree: [
    {
      type: "group",
      id: "census",
      name: "Census 1400",
      visible: true,
      opacity: 1,
      children: [
        {
          type: "layer",
          id: "density",
          name: "Population density",
          slot: "data",
          source: "wards",
          sourceLayer: "wards",
          geometry: "polygon",
          visible: true,
          opacity: 1,
          scale: { minDenominator: 2000, maxDenominator: 500000 },
          symbology: {
            kind: "graduated",
            field: "density",
            breaks: [900, 2100, 3900, 6200],
            colors: ["#0f2438", "#1b4674", "#2e6fe0", "#6fa8ff", "#bbdaff"],
            noDataColor: "#3a3a40",
            stroke: { color: "#0a0a0b", width: 0.6 },
          },
          metadata: { sourceCrs: "EPSG:32642", fields: ["ward_id", "name", "density"] },
        },
      ],
    },
  ],
};

/** An empty style. Everything on the map is put there by the adapter. */
export const emptyStyle = {
  version: 8 as const,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [],
};
