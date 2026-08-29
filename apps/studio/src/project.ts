import { defaultChrome, type MapProject } from "@alidade/core";

import { BASEMAPS } from "./basemaps";

/**
 * The sample project. From phase 8 this is loaded from the database; for now it is
 * the one thing the application starts with, and every panel edits it.
 */
export const demoProject: MapProject = {
  schema: 3,
  id: "demo",
  name: "Tehran · population density 2024",
  view: { center: [51.4, 35.715], zoom: 10.6, pitch: 0, bearing: 0 },
  basemap: BASEMAPS[0]!,
  environment: {},
  chrome: { ...defaultChrome(), graticule: { ...defaultChrome().graticule, interval: 0.1 } },
  sources: {
    wards: {
      type: "vector",
      tiles: [`${location.origin}/api/tiles/wards/{z}/{x}/{y}.mvt`],
      maxzoom: 16,
    },
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
            fields: ["ward_id", "name", "density"],
            extent: { west: 51.2, south: 35.6, east: 51.6, north: 35.83 },
          },
        },
      ],
    },
  ],
};

export const HILLSHADE = {
  source: "dem",
  illumination: 315,
  intensity: 0.5,
  shadowColor: "#000000",
  highlightColor: "#5a6470",
};

/** An empty style. Everything on the map is put there by the adapter. */
export const emptyStyle = {
  version: 8 as const,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {},
  layers: [],
};
