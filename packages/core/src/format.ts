import type { CoordinateFormat, DistanceUnits } from "./types/project";

/** Coordinates the way a surveyor writes them, not the way JSON stores them. */
export function formatCoordinate(
  lon: number,
  lat: number,
  format: CoordinateFormat,
): string {
  switch (format) {
    case "dd":
      return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"} · ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
    case "dms":
      return `${dms(lat, "N", "S")} · ${dms(lon, "E", "W")}`;
    case "utm": {
      const { zone, easting, northing, band } = toUtm(lon, lat);
      return `${zone}${band} ${Math.round(easting)} E · ${Math.round(northing)} N`;
    }
  }
}

export function dms(value: number, positive: string, negative: string): string {
  const hemisphere = value >= 0 ? positive : negative;
  const magnitude = Math.abs(value);
  const d = Math.floor(magnitude);
  const m = Math.floor((magnitude - d) * 60);
  const s = ((magnitude - d) * 60 - m) * 60;
  return `${d}° ${String(m).padStart(2, "0")}′ ${s.toFixed(1).padStart(4, "0")}″ ${hemisphere}`;
}

const UNITS: Record<DistanceUnits, { perMetre: number; small: string; large: string; cut: number }> =
  {
    metric: { perMetre: 1, small: "m", large: "km", cut: 1000 },
    imperial: { perMetre: 3.28084, small: "ft", large: "mi", cut: 5280 },
    nautical: { perMetre: 0.000539957, small: "nm", large: "nm", cut: Infinity },
  };

export interface ScaleBar {
  /** What to print, for example "2 km". */
  label: string;
  /** How wide to draw it, in screen pixels. */
  width: number;
}

/**
 * A scale bar is a round distance first and a width second, never the other way
 * round: nobody wants to read "1 km" off a bar that is 137 pixels long.
 */
export function scaleBar(
  metresPerPixel: number,
  maxWidth: number,
  units: DistanceUnits = "metric",
): ScaleBar {
  const unit = UNITS[units];
  const maxDistance = metresPerPixel * maxWidth * unit.perMetre;
  const nice = niceNumber(maxDistance);
  const width = nice / unit.perMetre / metresPerPixel;

  const useLarge = nice >= unit.cut;
  const shown = useLarge ? nice / unit.cut : nice;
  const suffix = useLarge ? unit.large : unit.small;
  const text = shown >= 1 ? String(round(shown)) : shown.toFixed(1);

  return { label: `${text} ${suffix}`, width: Math.round(width) };
}

/** The largest 1, 2 or 5 times a power of ten that fits. */
function niceNumber(value: number): number {
  if (value <= 0) return 0;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [5, 2, 1]) {
    if (magnitude * step <= value) return magnitude * step;
  }
  return magnitude;
}

/** Enough UTM for a coordinate readout. Not a projection library. */
export function toUtm(lon: number, lat: number) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const band = "CDEFGHJKLMNPQRSTUVWX"[Math.floor((Math.min(84, Math.max(-80, lat)) + 80) / 8)] ?? "Z";
  const a = 6378137;
  const e = 0.081819191;
  const k0 = 0.9996;
  const rad = Math.PI / 180;
  const phi = lat * rad;
  const lambda = lon * rad;
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * rad;

  const N = a / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ((e * e) / (1 - e * e)) * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lambda - lambda0);
  const e2 = e * e;
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T) * A ** 5) / 120) + 500000;
  let northing =
    k0 *
    (M +
      N *
        Math.tan(phi) *
        ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T) * A ** 6) / 720));
  if (lat < 0) northing += 10000000;

  return { zone, band, easting, northing };
}

const round = (n: number) => Math.round(n * 100) / 100;


/**
 * Read a coordinate the way a person types one.
 *
 * Accepts decimal degrees and degrees-minutes-seconds, comma or space separated,
 * with or without hemisphere letters. Latitude comes first, as it does on every
 * form a surveyor has ever filled in, unless a hemisphere letter says otherwise.
 */
export function parseCoordinate(text: string): [number, number] | null {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;

  const halves = split(cleaned);
  if (!halves) return null;

  const first = readAngle(halves[0]);
  const second = readAngle(halves[1]);
  if (first === null || second === null) return null;

  // A hemisphere letter is authoritative; without one, latitude is written first.
  const firstIsLon = /[EWew]$/.test(halves[0].trim());
  const lat = firstIsLon ? second.value : first.value;
  const lon = firstIsLon ? first.value : second.value;

  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

/**
 * Cutting the string in two, in order of how reliable the separator is: a comma,
 * then hemisphere letters, then simply two numbers and nothing else.
 */
function split(text: string): [string, string] | null {
  const byComma = text.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (byComma.length === 2) return [byComma[0]!, byComma[1]!];

  const byHemisphere = text.match(/-?[\d.]+[^NSEWnsew]*[NSEWnsew]/g);
  if (byHemisphere?.length === 2) return [byHemisphere[0]!, byHemisphere[1]!];

  const numbers = text.match(/-?\d+(?:\.\d+)?/g);
  if (numbers?.length === 2) return [numbers[0]!, numbers[1]!];
  return null;
}

function readAngle(text: string): { value: number } | null {
  const hemisphere = text.trim().match(/[NSEWnsew]$/)?.[0]?.toUpperCase();
  const numbers = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.length === 0) return null;

  const [degrees = 0, minutes = 0, seconds = 0] = numbers;
  const sign = degrees < 0 ? -1 : 1;
  let value = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  value *= sign;
  if (hemisphere === "S" || hemisphere === "W") value = -Math.abs(value);
  return { value };
}
