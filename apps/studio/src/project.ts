import { defaultAnnotations, defaultChrome, type LayerNode, type MapProject } from "@alidade/core";

import { BASEMAPS } from "./basemaps";

/**
 * What the application opens with.
 *
 * It used to open with a Tehran density map hard-coded into it, title and all,
 * which made a general purpose tool look like one specific map that happened to
 * let you add layers to it. The project now starts empty and unnamed; the demo
 * data is something you can load, not something you have to remove.
 */
export const emptyProject: MapProject = {
  schema: 3,
  id: "untitled",
  name: "Untitled map",
  view: { center: [20, 25], zoom: 1.9, pitch: 0, bearing: 0 },
  basemap: BASEMAPS[0]!,
  environment: {},
  chrome: { ...defaultChrome(), overview: true },
  annotations: defaultAnnotations(),
  bookmarks: [],
  sources: {
    // Open elevation tiles, no key required. Terrain and hillshade both read this.
    dem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
      attribution: "Elevation: Mapzen and partners",
    },
  },
  tree: [],
};

/**
 * The layer the shipped database is seeded with.
 *
 * Offered rather than assumed, so an empty database is not a broken first run
 * and a full one is not stuck with somebody else's map.
 */
export const DEMO_LAYER: LayerNode = {
  type: "layer",
  id: "wards",
  name: "Tehran population density",
  slot: "data",
  source: "wards",
  sourceLayer: "wards",
  geometry: "polygon",
  visible: true,
  opacity: 1,
  scale: { minDenominator: 2000, maxDenominator: 2000000 },
  symbology: {
    kind: "graduated",
    field: "density",
    breaks: [900, 2100, 3900, 6200],
    colors: ["#0f2438", "#1b4674", "#2e6fe0", "#6fa8ff", "#bbdaff"],
    noDataColor: "#3a3a40",
    stroke: { color: "#0a0a0b", width: 0.6 },
  },
  metadata: {
    sourceCrs: "EPSG:32639",
    fields: ["ward_id", "name", "pop_2024", "area_km2", "density", "updated_at"],
    extent: { west: 51.2, south: 35.6, east: 51.6, north: 35.83 },
  },
};

export const DEMO_SOURCE = {
  type: "vector" as const,
  tiles: [`${location.origin}/api/tiles/wards/{z}/{x}/{y}.mvt`],
  maxzoom: 16,
};

export const HILLSHADE = {
  source: "dem",
  illumination: 315,
  intensity: 0.5,
  shadowColor: "#000000",
  highlightColor: "#5a6470",
};

/**
 * An empty style. Everything on the map is put there by the adapter.
 *
 * The projection is declared here as well as applied through an operation, because
 * a style replaces it wholesale and the document has to win.
 */
export const emptyStyle = {
  version: 8 as const,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  projection: { type: emptyProject.environment.projection ?? "mercator" },
  sources: {},
  layers: [],
};
