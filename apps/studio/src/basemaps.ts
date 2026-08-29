import type { Basemap } from "@alidade/core";

const carto = (style: string) => ({
  tiles: ["a", "b", "c"].map((s) => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}.png`),
  tileSize: 256,
  maxzoom: 19,
  attribution: "© OpenStreetMap contributors, © CARTO",
});

/** Everything here is open and needs no key, which is what keeps the demo up. */
export const BASEMAPS: Basemap[] = [
  {
    id: "dark",
    name: "Dark matter",
    background: "#0b0b0c",
    raster: carto("dark_nolabels"),
    labelTiles: carto("dark_only_labels"),
    labels: true,
  },
  {
    id: "light",
    name: "Positron",
    background: "#f4f4f4",
    raster: carto("light_nolabels"),
    labelTiles: carto("light_only_labels"),
    labels: true,
  },
  {
    id: "voyager",
    name: "Voyager",
    background: "#e8e4df",
    raster: carto("rastertiles/voyager_nolabels"),
    labelTiles: carto("rastertiles/voyager_only_labels"),
    labels: true,
  },
  {
    id: "imagery",
    name: "Imagery",
    background: "#0f110e",
    raster: {
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
    labels: false,
  },
  { id: "none", name: "No basemap", background: "#0b0b0c", labels: false },
];
