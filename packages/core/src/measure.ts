import type { DistanceUnits } from "./types/project";

/**
 * Measuring on the sphere, not on the screen.
 *
 * Everything here works in lon/lat and returns metres, because a distance read
 * off web mercator is wrong by a factor of 1/cos(latitude) and nobody notices
 * until the number is in a report. The authalic mean radius is used throughout,
 * which keeps areas honest to about 0.1 percent and distances to about 0.3.
 */
const R = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance between two positions, in metres. */
export function distance(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length of a path, in metres. */
export function pathLength(path: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distance(path[i - 1]!, path[i]!);
  return total;
}

/** Initial bearing from a to b, in degrees clockwise from north. */
export function bearing(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const dLon = (lon2 - lon1) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * RAD);
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
    Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/**
 * Area of a ring, in square metres, by spherical excess.
 *
 * The ring may be given open or closed; the sign is dropped, so winding order
 * does not change the answer.
 */
export function ringArea(ring: [number, number][]): number {
  const points = closed(ring);
  if (points.length < 4) return 0;

  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [lon1, lat1] = points[i]!;
    const [lon2, lat2] = points[i + 1]!;
    total += (lon2 - lon1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
  }
  return Math.abs((total * R * R) / 2);
}

/** Perimeter of a ring, in metres, the closing segment included. */
export function ringPerimeter(ring: [number, number][]): number {
  return pathLength(closed(ring));
}

/** The centre of mass of a ring, good enough to hang a label on. */
export function centroid(points: [number, number][]): [number, number] {
  if (points.length === 0) return [0, 0];
  let lon = 0;
  let lat = 0;
  for (const p of points) {
    lon += p[0];
    lat += p[1];
  }
  return [lon / points.length, lat / points.length];
}

function closed(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/* ---------------------------------------------------------------- printing */

const LENGTH: Record<DistanceUnits, { per: number; small: string; large: string; cut: number }> = {
  metric: { per: 1, small: "m", large: "km", cut: 1000 },
  imperial: { per: 3.28084, small: "ft", large: "mi", cut: 5280 },
  nautical: { per: 0.000539957, small: "nm", large: "nm", cut: Infinity },
};

/** A distance in metres, written the way the scale bar writes it. */
export function formatDistance(metres: number, units: DistanceUnits = "metric"): string {
  const unit = LENGTH[units];
  const value = metres * unit.per;
  if (value >= unit.cut) return `${trim(value / unit.cut)} ${unit.large}`;
  return `${trim(value)} ${unit.small}`;
}

/**
 * An area in square metres.
 *
 * Hectares are included because everyone who measures a field asks for them, and
 * acres for the same reason on the imperial side.
 */
export function formatArea(squareMetres: number, units: DistanceUnits = "metric"): string {
  if (units === "imperial") {
    const squareFeet = squareMetres * 10.7639;
    if (squareFeet >= 27878400) return `${trim(squareFeet / 27878400)} sq mi`;
    if (squareMetres >= 4046.86) return `${trim(squareMetres / 4046.86)} acres`;
    return `${trim(squareFeet)} sq ft`;
  }
  if (squareMetres >= 1e6) return `${trim(squareMetres / 1e6)} km²`;
  if (squareMetres >= 10000) return `${trim(squareMetres / 10000)} ha`;
  return `${trim(squareMetres)} m²`;
}

/** Bearing as a whole number of degrees plus the compass point. */
export function formatBearing(degrees: number): string {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
  return `${Math.round(degrees)}° ${points[index]}`;
}

/**
 * Two significant-ish digits, without a trailing run of zeros after the point.
 *
 * The strip has to be anchored to the decimal point. Without the point in the
 * pattern it ate the zero off the end of whole numbers as well, so 940 metres
 * printed as "94 m".
 */
function trim(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return value
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
