import type { Basemap } from "@alidade/core";

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

/** Esri numbers its tiles z/y/x, which is not the order everyone else uses. */
const esri = (service: string, maxzoom = 19) => ({
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
    raster: esri("Canvas/World_Dark_Gray_Base"),
    labelTiles: esri("Canvas/World_Dark_Gray_Reference"),
    labels: true,
  },
  {
    id: "light",
    name: "Light canvas",
    group: "Canvas",
    background: "#f2f2f2",
    raster: esri("Canvas/World_Light_Gray_Base"),
    labelTiles: esri("Canvas/World_Light_Gray_Reference"),
    labels: true,
  },
  {
    id: "imagery",
    name: "Imagery",
    group: "Aerial",
    background: "#0f110e",
    raster: esri("World_Imagery"),
    labelTiles: esri("Reference/World_Boundaries_and_Places"),
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
    labelTiles: esri("Reference/World_Boundaries_and_Places"),
    labels: true,
  },
  {
    id: "hybrid",
    name: "Imagery with roads",
    group: "Aerial",
    background: "#0f110e",
    raster: esri("World_Imagery"),
    labelTiles: esri("Reference/World_Transportation"),
    labels: true,
  },
  {
    id: "streets",
    name: "Streets",
    group: "Street",
    background: "#efeae2",
    raster: esri("World_Street_Map"),
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
    raster: esri("World_Topo_Map"),
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
