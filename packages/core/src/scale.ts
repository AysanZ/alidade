/**
 * Scale denominators, not zoom levels. Zoom depends on latitude and screen DPI and
 * is a rendering detail; a GIS user thinks in 1:25 000.
 *
 * At 96 dpi one pixel is 0.28 mm on paper, which is the OGC convention.
 */
const EARTH_CIRCUMFERENCE = 40075016.686;
const TILE_SIZE = 512;
const PIXEL_SIZE_M = 0.00028;

export function metresPerPixel(zoom: number, latitude: number): number {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  return (EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) / scale;
}

/** The 25 000 in 1:25 000. */
export function denominatorAt(zoom: number, latitude: number): number {
  return metresPerPixel(zoom, latitude) / PIXEL_SIZE_M;
}

export function zoomForDenominator(denominator: number, latitude: number): number {
  const mpp = denominator * PIXEL_SIZE_M;
  return Math.log2(
    (EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) /
      (mpp * TILE_SIZE),
  );
}

/**
 * A scale range becomes a zoom range. Note the inversion: the largest denominator
 * is the most zoomed out, so it produces minzoom.
 */
export function zoomRange(
  range: { minDenominator: number; maxDenominator: number },
  latitude: number,
): { minzoom: number; maxzoom: number } {
  return {
    minzoom: round2(zoomForDenominator(range.maxDenominator, latitude)),
    maxzoom: round2(zoomForDenominator(range.minDenominator, latitude)),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
