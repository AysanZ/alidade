import { toUtm } from "./format";

export interface GridGeoJSON {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { label: string; kind: "zone" | "band" | "square" };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
}

export const utmGridSourceId = () => "chrome:grid:utm";
export const squareGridSourceId = () => "chrome:grid:square";

const LAT_LIMIT = 84;
const LAT_FLOOR = -80;

/**
 * The UTM framework: sixty six-degree zones and twenty eight-degree bands.
 *
 * It is global and fixed, so it is generated once and never depends on where the
 * map is looking. The Norway and Svalbard exceptions are not drawn, because a
 * reference grid that lies about two cells is better than one that is missing.
 */
export function utmGridGeoJSON(): GridGeoJSON {
  const features: GridGeoJSON["features"] = [];

  for (let zone = 1; zone <= 61; zone++) {
    const lon = -180 + (zone - 1) * 6;
    const coordinates: [number, number][] = [];
    for (let lat = LAT_FLOOR; lat <= LAT_LIMIT; lat += 4) coordinates.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: { label: zone <= 60 ? `Zone ${zone}` : "", kind: "zone" },
      geometry: { type: "LineString", coordinates },
    });
  }

  for (let lat = LAT_FLOOR; lat <= LAT_LIMIT; lat += 8) {
    const band = "CDEFGHJKLMNPQRSTUVWX"[Math.floor((lat + 80) / 8)] ?? "";
    const coordinates: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 6) coordinates.push([lon, lat]);
    features.push({
      type: "Feature",
      properties: { label: band ? `${band}` : "", kind: "band" },
      geometry: { type: "LineString", coordinates },
    });
  }

  return { type: "FeatureCollection", features };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * True metric squares over the area being looked at.
 *
 * A square kilometre is a square kilometre on the ground, so this grid cannot be
 * global: the spacing in degrees of longitude depends on latitude. It is built
 * for the current view and rebuilt when the view has moved off the edge of it,
 * which `gridKey` decides.
 */
export function squareGridGeoJSON(bounds: Bounds, spacing: number): GridGeoJSON {
  const features: GridGeoJSON["features"] = [];
  const midLat = clampLat((bounds.north + bounds.south) / 2);

  const degreesPerMetreLat = 1 / 110574;
  const degreesPerMetreLon = 1 / (111320 * Math.max(0.02, Math.cos(midLat * (Math.PI / 180))));

  const stepLat = spacing * degreesPerMetreLat;
  const stepLon = spacing * degreesPerMetreLon;

  const south = clampLat(Math.floor(bounds.south / stepLat) * stepLat);
  const north = clampLat(Math.ceil(bounds.north / stepLat) * stepLat);
  const west = Math.floor(bounds.west / stepLon) * stepLon;
  const east = Math.ceil(bounds.east / stepLon) * stepLon;

  // A grid nobody can read is a grid nobody wants: give up rather than emit
  // fifty thousand hairlines when the spacing is far finer than the view.
  const columns = Math.round((east - west) / stepLon);
  const rows = Math.round((north - south) / stepLat);
  if (columns > 400 || rows > 400) return { type: "FeatureCollection", features };

  for (let i = 0; i <= columns; i++) {
    const lon = west + i * stepLon;
    features.push({
      type: "Feature",
      properties: { label: "", kind: "square" },
      geometry: {
        type: "LineString",
        coordinates: [
          [lon, south],
          [lon, north],
        ],
      },
    });
  }
  for (let i = 0; i <= rows; i++) {
    const lat = clampLat(south + i * stepLat);
    features.push({
      type: "Feature",
      properties: { label: "", kind: "square" },
      geometry: {
        type: "LineString",
        coordinates: [
          [west, lat],
          [east, lat],
        ],
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * A stable name for the patch of world a square grid was built for.
 *
 * Panning within a patch must not rebuild the source, or every drag would emit
 * source operations and every drag would be a repaint of the whole grid.
 */
export function gridKey(bounds: Bounds, spacing: number): string {
  const cell = spacing * 20 * (1 / 110574);
  return [
    spacing,
    Math.floor(bounds.west / cell),
    Math.floor(bounds.south / cell),
    Math.ceil(bounds.east / cell),
    Math.ceil(bounds.north / cell),
  ].join(":");
}

/** Grow a view's bounds so a small pan stays inside what was already built. */
export function padded(bounds: Bounds, factor = 0.5): Bounds {
  const width = (bounds.east - bounds.west) * factor;
  const height = (bounds.north - bounds.south) * factor;
  return {
    west: bounds.west - width,
    east: bounds.east + width,
    south: clampLat(bounds.south - height),
    north: clampLat(bounds.north + height),
  };
}

/** The UTM zone and band a position falls in, for the status bar. */
export function utmCell(lon: number, lat: number): string {
  const { zone, band } = toUtm(lon, lat);
  return `${zone}${band}`;
}

const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
