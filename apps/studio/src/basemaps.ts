import type { Basemap } from "@alidade/core";
import { DARK_PALETTE, LIGHT_PALETTE } from "@alidade/core";

import { OSM_SOURCE_ID } from "./sources";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

/**
 * An Esri tile service.
 *
 * Esri numbers its tiles z/y/x, which is not the order everyone else uses.
 *
 * `maxzoom` is not optional in practice, and the old default of 19 was wrong for
 * most of these. Past its deepest cached level an Esri service does not answer
 * 404: it answers 200 with a grey image reading "Map data not yet available",
 * which the renderer draws, because it has no way to know it was handed a
 * placard rather than a map. Stating the real limit makes the renderer stretch
 * the last real tile instead — blurry, and continuous, which is what a basemap
 * has to be.
 *
 * The levels come from each service's own description. Where a service is
 * documented as worldwide to one level and regional beyond it, the number here
 * is the regional one: refusing to draw Boston at zoom 18 to punish Dushanbe
 * helps nobody, and outside the covered regions the last worldwide level is
 * what gets stretched, which is the same behaviour one level further out.
 */
const esri = (service: string, maxzoom: number) => ({
  tiles: [`${ESRI}/${service}/MapServer/tile/{z}/{y}/{x}`],
  tileSize: 256,
  maxzoom,
  attribution: "Esri and the GIS user community",
});

const mirrored = (hosts: string[], attribution: string, maxzoom = 17) => ({
  tiles: hosts,
  tileSize: 256,
  maxzoom,
  attribution,
});

/**
 * Every basemap here is open: no key, no account, no referrer rules. That is the
 * whole selection criterion, because a demo that stops working when a trial ends
 * is worse than a demo with fewer basemaps.
 *
 * The canvas and imagery styles publish their labels as a separate service, which
 * is what lets Alidade put place names above your data instead of under it.
 */
export const BASEMAPS: Basemap[] = [
  {
    id: "dark",
    name: "Dark canvas",
    group: "Canvas",
    background: "#0b0b0c",
    vector: { source: OSM_SOURCE_ID, palette: DARK_PALETTE },
    overview: esri("Canvas/World_Dark_Gray_Base", 10),
    labels: true,
  },
  {
    id: "light",
    name: "Light canvas",
    group: "Canvas",
    background: "#f4f2ee",
    vector: { source: OSM_SOURCE_ID, palette: LIGHT_PALETTE },
    overview: esri("Canvas/World_Light_Gray_Base", 10),
    labels: true,
  },
  {
    id: "imagery",
    name: "Imagery",
    group: "Aerial",
    background: "#0f110e",
    raster: esri("World_Imagery", 19),
    labelTiles: esri("Reference/World_Boundaries_and_Places", 16),
    labels: true,
  },
  {
    id: "s2cloudless",
    name: "Sentinel-2 cloudless",
    group: "Aerial",
    background: "#0d1410",
    raster: {
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg"],
      tileSize: 256,
      maxzoom: 14,
      attribution: "Sentinel-2 cloudless 2020 by EOX, modified Copernicus data",
    },
    labelTiles: esri("Reference/World_Boundaries_and_Places", 16),
    labels: true,
  },
  {
    id: "hybrid",
    name: "Imagery with roads",
    group: "Aerial",
    background: "#0f110e",
    raster: esri("World_Imagery", 19),
    labelTiles: esri("Reference/World_Transportation", 19),
    labels: true,
  },
  {
    id: "streets",
    name: "Streets",
    group: "Street",
    background: "#efeae2",
    raster: esri("World_Street_Map", 19),
    labels: false,
  },
  {
    id: "osm",
    name: "OpenStreetMap",
    group: "Street",
    background: "#f2efe9",
    raster: {
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
    labels: false,
  },
  {
    id: "natgeo",
    name: "National Geographic",
    group: "Street",
    background: "#e9e3d8",
    raster: esri("NatGeo_World_Map", 16),
    labels: false,
  },
  {
    id: "topo",
    name: "Topographic",
    group: "Terrain",
    background: "#e8e4dc",
    raster: esri("World_Topo_Map", 19),
    labels: false,
  },
  {
    id: "opentopo",
    name: "OpenTopoMap",
    group: "Terrain",
    background: "#eeeadf",
    raster: mirrored(
      ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      "© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)",
    ),
    labels: false,
  },
  {
    id: "esri-canvas",
    name: "Esri gray canvas",
    group: "Canvas",
    background: "#f2f2f2",
    // Worldwide to level 10, regional to 16. Kept as a raster alternative to
    // the vector canvases; past 16 it is stretched rather than requested.
    raster: esri("Canvas/World_Light_Gray_Base", 16),
    labelTiles: esri("Canvas/World_Light_Gray_Reference", 16),
    labels: true,
  },
  {
    id: "relief",
    name: "Shaded relief",
    group: "Terrain",
    background: "#cfc9bd",
    raster: esri("World_Shaded_Relief", 13),
    labels: false,
  },
  {
    id: "physical",
    name: "Physical",
    group: "Terrain",
    background: "#d9d2c2",
    raster: esri("World_Physical_Map", 8),
    labels: false,
  },
  {
    id: "ocean",
    name: "Ocean",
    group: "Terrain",
    background: "#a5c3d8",
    raster: esri("Ocean/World_Ocean_Base", 13),
    labelTiles: esri("Ocean/World_Ocean_Reference", 13),
    labels: true,
  },
  { id: "none", name: "No basemap", group: "Canvas", background: "#0b0b0c", labels: false },
];
