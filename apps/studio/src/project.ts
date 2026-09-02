import { defaultAnnotations, defaultChrome, type MapProject } from "@alidade/core";

import { BASEMAPS } from "./basemaps";

/**
 * What the application opens with.
 *
 * It used to open with a Tehran density map hard-coded into it, title and all,
 * which made a general purpose tool look like one specific map that happened to
 * let you add layers to it. The project starts empty and unnamed, and the
 * database ships empty to match: every layer on the map is one you put there.
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
