import { defaultChrome } from "../src/types/project";
import type { MapProject } from "../src/types/project";

/** The demo project, small enough to read in a diff and real enough to be useful. */
export function project(): MapProject {
  return {
    schema: 3,
    id: "demo",
    name: "Tehran · population density 2024",
    view: { center: [51.4, 35.715], zoom: 11.5, pitch: 0, bearing: 0 },
    basemap: { id: "graphite", name: "Graphite", background: "#0b0b0c", labels: true },
    environment: {},
    chrome: defaultChrome(),
    sources: {
      wards: { type: "vector", tiles: ["/api/tiles/wards/{z}/{x}/{y}.mvt"], maxzoom: 16 },
      sensors: { type: "vector", tiles: ["/api/tiles/sensors/{z}/{x}/{y}.mvt"] },
    },
    tree: [
      {
        type: "layer",
        id: "sensors",
        name: "Sensor points",
        slot: "data",
        source: "sensors",
        sourceLayer: "sensors",
        geometry: "point",
        visible: true,
        opacity: 1,
        symbology: { kind: "single", color: "#4c8dff" },
      },
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
            scale: { minDenominator: 2000, maxDenominator: 250000 },
            symbology: {
              kind: "graduated",
              field: "density",
              breaks: [900, 2100, 3900, 6200],
              colors: ["#0f2438", "#1b4674", "#2e6fe0", "#6fa8ff", "#bbdaff"],
              noDataColor: "#3a3a40",
              stroke: { color: "#0a0a0b", width: 0.6 },
            },
            labels: {
              template: "{name}",
              size: 12,
              color: "#e4e4e6",
              haloColor: "#050505",
              haloWidth: 1.5,
            },
          },
        ],
      },
    ],
  };
}

/** Structural clone, so a test never mutates the fixture another test reads. */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
