/**
 * A vector basemap, compiled here rather than fetched as someone else's style.
 *
 * The alternative was to hand MapLibre an external style URL and replay the
 * project on top of it. That looks cheaper and is not: the reconciler's whole
 * model is that it owns every layer on the map, a foreign style arrives with
 * two hundred layers it has never heard of, and the one property this
 * application is built around — the user's data underneath the place names —
 * becomes a guess about which of those two hundred layers to insert before.
 *
 * So the basemap is described the same way everything else here is: as engine
 * layers, from a palette, over the OpenMapTiles schema. It is a plainer map
 * than a cartographer's style. It is also crisp at every zoom, keyless, and
 * swaps without destroying anything, which is what it is for.
 */

import type { EngineLayer } from "./types/ops";
import type { BasemapPalette, VectorBasemap } from "./types/project";

/**
 * The fontstack every label asks for.
 *
 * Named explicitly rather than left to the renderer's default, which is
 * "Open Sans Regular": the glyph service that comes with the vector tiles does
 * not publish that stack, and a label whose font 404s is a label that silently
 * does not appear.
 */
export const LABEL_FONT = ["Noto Sans Regular"];
export const LABEL_FONT_BOLD = ["Noto Sans Bold"];

/**
 * Roads carried by the schema, widest first.
 *
 * `path` and `rail` are drawn separately: one is not a road with a thinner line
 * and the other is not a road at all.
 */
const MAJOR = ["motorway", "trunk", "primary"];
const MINOR = ["secondary", "tertiary", "minor", "service"];

/** Latin first, falling back to whatever the feature calls itself. */
const NAME: unknown = ["coalesce", ["get", "name:latin"], ["get", "name"]];

/**
 * A width that grows with zoom.
 *
 * Exponential rather than linear because a road holds its apparent width
 * against a scale that doubles every level; interpolating linearly makes it
 * thin out on the way in.
 */
const width = (low: number, high: number): unknown => [
  "interpolate",
  ["exponential", 1.2],
  ["zoom"],
  6,
  low,
  20,
  high,
];

export function vectorBasemapLayers(basemap: VectorBasemap): {
  base: EngineLayer[];
  labels: EngineLayer[];
} {
  const p = basemap.palette;
  const src = { source: basemap.source, slot: "base" as const };

  const base: EngineLayer[] = [
    {
      ...src,
      id: "basemap:landcover",
      type: "fill",
      sourceLayer: "landcover",
      filter: ["match", ["get", "class"], ["wood", "grass", "ice"], true, false],
      paint: { "fill-color": p.green, "fill-opacity": 0.55, "fill-antialias": false },
      layout: {},
    },
    {
      ...src,
      id: "basemap:landuse",
      type: "fill",
      sourceLayer: "landuse",
      filter: ["==", ["get", "class"], "residential"],
      paint: { "fill-color": p.built, "fill-opacity": 0.5, "fill-antialias": false },
      layout: {},
    },
    {
      ...src,
      id: "basemap:sand",
      type: "fill",
      sourceLayer: "landcover",
      filter: ["==", ["get", "class"], "sand"],
      paint: { "fill-color": p.sand, "fill-antialias": false },
      layout: {},
    },
    {
      ...src,
      id: "basemap:park",
      type: "fill",
      sourceLayer: "park",
      paint: { "fill-color": p.green, "fill-opacity": 0.45 },
      layout: {},
    },
    {
      ...src,
      id: "basemap:water",
      type: "fill",
      sourceLayer: "water",
      // A tunnel under a river is not a river, and a covered culvert is not water.
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": p.water },
      layout: {},
    },
    {
      ...src,
      id: "basemap:waterway",
      type: "line",
      sourceLayer: "waterway",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "line-color": p.water, "line-width": width(0.4, 5) },
      layout: { "line-cap": "round" },
    },
    {
      ...src,
      id: "basemap:road:casing",
      type: "line",
      sourceLayer: "transportation",
      filter: ["match", ["get", "class"], [...MAJOR, ...MINOR], true, false],
      paint: { "line-color": p.roadCasing, "line-width": width(1.4, 24) },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      ...src,
      id: "basemap:road:minor",
      type: "line",
      sourceLayer: "transportation",
      minzoom: 12,
      filter: ["match", ["get", "class"], MINOR, true, false],
      paint: { "line-color": p.roadFill, "line-width": width(0.5, 14) },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      ...src,
      id: "basemap:road:major",
      type: "line",
      sourceLayer: "transportation",
      filter: ["match", ["get", "class"], MAJOR, true, false],
      paint: { "line-color": p.roadFill, "line-width": width(0.8, 18) },
      layout: { "line-cap": "round", "line-join": "round" },
    },
    {
      ...src,
      id: "basemap:rail",
      type: "line",
      sourceLayer: "transportation",
      minzoom: 10,
      filter: ["match", ["get", "class"], ["rail", "transit"], true, false],
      paint: { "line-color": p.rail, "line-width": width(0.4, 3) },
      layout: {},
    },
    {
      ...src,
      id: "basemap:boundary:sub",
      type: "line",
      sourceLayer: "boundary",
      minzoom: 4,
      filter: [
        "all",
        [">=", ["get", "admin_level"], 3],
        ["<=", ["get", "admin_level"], 6],
        ["!=", ["get", "maritime"], 1],
      ],
      paint: { "line-color": p.boundary, "line-width": 0.8, "line-dasharray": [2, 2], "line-opacity": 0.6 },
      layout: {},
    },
    {
      ...src,
      id: "basemap:boundary:country",
      type: "line",
      sourceLayer: "boundary",
      filter: ["all", ["<=", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": p.boundary, "line-width": width(0.8, 3) },
      layout: { "line-cap": "round", "line-join": "round" },
    },
  ];

  const label = {
    source: basemap.source,
    slot: "labels" as const,
    paint: {
      "text-color": p.label,
      "text-halo-color": p.labelHalo,
      "text-halo-width": 1.2,
    },
  };

  const labels: EngineLayer[] = [
    {
      ...label,
      id: "basemap:label:road",
      type: "symbol",
      sourceLayer: "transportation_name",
      minzoom: 13,
      paint: { ...label.paint, "text-color": p.minorLabel },
      layout: {
        "text-field": NAME,
        "text-font": LABEL_FONT,
        "text-size": 11,
        "symbol-placement": "line",
        "text-rotation-alignment": "map",
      },
    },
    {
      ...label,
      id: "basemap:label:place",
      type: "symbol",
      sourceLayer: "place",
      filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
      layout: {
        "text-field": NAME,
        "text-font": LABEL_FONT,
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 12, 16],
        "text-max-width": 8,
      },
    },
    {
      ...label,
      id: "basemap:label:country",
      type: "symbol",
      sourceLayer: "place",
      // Countries stop where cities start being the thing you are looking at.
      maxzoom: 9,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": NAME,
        "text-font": LABEL_FONT_BOLD,
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 7, 16],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.1,
        "text-max-width": 6,
      },
    },
  ];

  return { base, labels };
}

/** A dark canvas: the map recedes and the data on it comes forward. */
export const DARK_PALETTE: BasemapPalette = {
  water: "#141d28",
  green: "#16211a",
  sand: "#241f18",
  built: "#17181c",
  roadFill: "#2f3138",
  roadCasing: "#111216",
  rail: "#282a30",
  boundary: "#3d424c",
  label: "#9aa1ad",
  labelHalo: "#08090b",
  minorLabel: "#6b7280",
};

/** The same map with the lights on. */
export const LIGHT_PALETTE: BasemapPalette = {
  water: "#c2d8ea",
  green: "#dde8d5",
  sand: "#f0e8d4",
  built: "#e9e7e2",
  roadFill: "#ffffff",
  roadCasing: "#d8d4cd",
  rail: "#cfcbc4",
  boundary: "#a8a29a",
  label: "#3f434a",
  labelHalo: "#fbfaf8",
  minorLabel: "#6b7280",
};
