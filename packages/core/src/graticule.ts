import type { Chrome } from "./types/project";

export interface GraticuleGeoJSON {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { label: string; axis: "meridian" | "parallel" };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
}

/** Mercator cannot draw past about 85°, so the graticule stops there too. */
const LAT_LIMIT = 85;

/**
 * Meridians and parallels as plain GeoJSON, generated from the interval alone.
 *
 * It depends on nothing but the interval on purpose: panning the map must not
 * rebuild the source, or every mouse drag would emit source operations.
 */
export function graticuleGeoJSON(interval: number): GraticuleGeoJSON {
  if (!(interval > 0)) throw new Error("A graticule interval must be positive.");
  const features: GraticuleGeoJSON["features"] = [];

  for (let lon = -180; lon <= 180; lon = round(lon + interval)) {
    features.push({
      type: "Feature",
      properties: { label: degrees(lon, "E", "W"), axis: "meridian" },
      geometry: {
        type: "LineString",
        coordinates: [
          [lon, -LAT_LIMIT],
          [lon, 0],
          [lon, LAT_LIMIT],
        ],
      },
    });
  }

  for (let lat = -LAT_LIMIT; lat <= LAT_LIMIT; lat = round(lat + interval)) {
    features.push({
      type: "Feature",
      properties: { label: degrees(lat, "N", "S"), axis: "parallel" },
      geometry: {
        type: "LineString",
        coordinates: [
          [-180, lat],
          [0, lat],
          [180, lat],
        ],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

export function graticuleSourceId(): string {
  return "chrome:graticule";
}

export function graticuleLayers(chrome: Chrome): { line: string; label: string } {
  void chrome;
  return { line: "chrome:graticule:line", label: "chrome:graticule:label" };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function degrees(value: number, positive: string, negative: string): string {
  const suffix = value === 0 ? "" : value > 0 ? positive : negative;
  const magnitude = Math.abs(value);
  const text = Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(2);
  return `${text}°${suffix}`;
}
