import type { Projection, View } from "./types/project";

export interface Extent {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface FrameOptions {
  projection?: Projection;
  /** Fraction of the viewport left empty around the extent. */
  padding?: number;
  maxZoom?: number;
  minZoom?: number;
}

/** Mercator cannot draw past about 85°, and neither can a camera aimed at it. */
const LAT_LIMIT = 85.0511;
const TILE = 512;

/**
 * Where to put the camera so an extent fills the screen.
 *
 * `fitBounds` was being used for this, which is fine until the extent is most of
 * the world. Two things then go wrong at once. It frames using the mercator y
 * axis, so the centre of a box from 41° south to 78° north lands well north of
 * the middle of the data — which a sphere then draws half off the screen,
 * because a sphere has no mercator stretching to justify the offset. And a
 * latitude outside ±85° has no mercator y at all, so an extent that reaches the
 * poles produces a centre that is nonsense rather than merely wrong.
 *
 * Doing the arithmetic here rather than handing it to the renderer also means it
 * can be tested in Node, which is where this was found.
 */
export function frameExtent(
  extent: Extent,
  viewport: Viewport,
  options: FrameOptions = {},
): { center: [number, number]; zoom: number } {
  const projection = options.projection ?? "mercator";
  const padding = options.padding ?? 0.12;
  const maxZoom = options.maxZoom ?? 16;
  const minZoom = options.minZoom ?? 0;

  const south = clampLat(Math.min(extent.south, extent.north));
  const north = clampLat(Math.max(extent.south, extent.north));

  /* An extent crossing the antimeridian arrives with east < west. */
  let west = extent.west;
  let east = extent.east;
  if (east < west) east += 360;
  const lonSpan = Math.min(360, Math.max(1e-6, east - west));
  const latSpan = Math.max(1e-6, north - south);

  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const usable = Math.max(0.05, 1 - padding * 2);

  const zoomForLon = Math.log2((360 / lonSpan) * (width / TILE) * usable);
  const ySpan = Math.max(1e-9, mercatorY(south) - mercatorY(north));
  const zoomForLat = Math.log2((height / (TILE * ySpan)) * usable);

  let zoom = Math.min(zoomForLon, zoomForLat);

  /*
   * A sphere shows the whole planet somewhere around zoom two; asking for less
   * than that just makes it smaller in a bigger void. It also has to be capped,
   * because MapLibre's `globe` stops being a sphere on the way in and framing a
   * country would silently land back in mercator.
   */
  const round = projection !== "mercator";
  if (round) zoom = Math.min(zoom, 5.5);

  zoom = clamp(zoom, minZoom, maxZoom);
  if (!Number.isFinite(zoom)) zoom = minZoom;

  const centreLon = normaliseLon(west + lonSpan / 2);
  /*
   * On a sphere the middle of the data is the middle of the data. On mercator it
   * is the middle of the projected height, which is not the same number and is
   * the one that keeps the extent inside the screen.
   */
  const centreLat = round
    ? (south + north) / 2
    : clampLat(inverseMercatorY((mercatorY(south) + mercatorY(north)) / 2));

  return { center: [centreLon, centreLat], zoom: Number(zoom.toFixed(3)) };
}

/**
 * The same, as a whole view, keeping the pitch and bearing already in use.
 *
 * A tilted camera cannot frame an extent the way a flat one can, so a request to
 * look at something levels the camera rather than pretending it succeeded.
 */
export function viewForExtent(
  extent: Extent,
  viewport: Viewport,
  current: View,
  options: FrameOptions = {},
): View {
  const { center, zoom } = frameExtent(extent, viewport, options);
  const wide = spansMostOfTheWorld(extent);
  return {
    center,
    zoom,
    pitch: wide ? 0 : current.pitch,
    bearing: wide ? 0 : current.bearing,
  };
}

/** True when an extent is big enough that framing it is really framing the world. */
export function spansMostOfTheWorld(extent: Extent): boolean {
  const east = extent.east < extent.west ? extent.east + 360 : extent.east;
  return east - extent.west > 180 || Math.abs(extent.north - extent.south) > 90;
}

/** An extent with no width or height, which nothing can be fitted to. */
export function isDegenerate(extent: Extent): boolean {
  return (
    !Number.isFinite(extent.west) ||
    !Number.isFinite(extent.east) ||
    !Number.isFinite(extent.south) ||
    !Number.isFinite(extent.north) ||
    (Math.abs(extent.east - extent.west) < 1e-9 && Math.abs(extent.north - extent.south) < 1e-9)
  );
}

/** Grow a point, or a line with no thickness, into something with an area. */
export function withMinimumSize(extent: Extent, degrees = 0.01): Extent {
  const padLon = Math.max(0, (degrees - Math.abs(extent.east - extent.west)) / 2);
  const padLat = Math.max(0, (degrees - Math.abs(extent.north - extent.south)) / 2);
  return {
    west: extent.west - padLon,
    east: extent.east + padLon,
    south: clampLat(extent.south - padLat),
    north: clampLat(extent.north + padLat),
  };
}

/** Mercator y in the 0 to 1 range, north at the top. */
function mercatorY(lat: number): number {
  const phi = (clampLat(lat) * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
}

function inverseMercatorY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

const clampLat = (lat: number) => Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat));
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

function normaliseLon(lon: number): number {
  let value = lon;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return Number(value.toFixed(6));
}
