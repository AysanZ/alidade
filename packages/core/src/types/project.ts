/**
 * The whole map as one serialisable object.
 *
 * Plain JSON only: no functions, no class instances, no Date. If it cannot survive
 * JSON.parse(JSON.stringify(x)), it does not belong in the project.
 */

export type Slot = "base" | "data" | "labels" | "overlay";

/** Slots are applied before tree order. Earlier in this list draws further down. */
export const SLOT_ORDER: readonly Slot[] = ["base", "data", "labels", "overlay"];

export type Geometry = "polygon" | "line" | "point" | "raster";

/** Scale denominators. Visible while minDenominator <= current <= maxDenominator. */
export interface ScaleRange {
  /** Largest scale, most zoomed in. The 2 000 in 1:2 000. */
  minDenominator: number;
  /** Smallest scale, most zoomed out. The 250 000 in 1:250 000. */
  maxDenominator: number;
}

export interface VectorSource {
  type: "vector";
  tiles: string[];
  minzoom?: number;
  maxzoom?: number;
  attribution?: string;
}

export interface GeoJSONSource {
  type: "geojson";
  data: unknown;
}

export interface RasterSource {
  type: "raster";
  tiles: string[];
  tileSize?: number;
  attribution?: string;
}

/** Elevation tiles. `terrarium` and `mapbox` are the two encodings in the wild. */
export interface RasterDEMSource {
  type: "raster-dem";
  tiles: string[];
  tileSize?: number;
  encoding?: "terrarium" | "mapbox";
  maxzoom?: number;
  attribution?: string;
}

export type Source = VectorSource | GeoJSONSource | RasterSource | RasterDEMSource;

/* ---------------------------------------------------------------- symbology */

export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
}

export interface SingleSymbol {
  kind: "single";
  color: string;
  stroke?: Stroke;
}

export interface GraduatedSymbol {
  kind: "graduated";
  field: string;
  /** n - 1 break values for n classes, ascending. */
  breaks: number[];
  /** n colours, one per class. */
  colors: string[];
  noDataColor: string;
  stroke?: Stroke;
}

export interface CategorizedSymbol {
  kind: "categorized";
  field: string;
  categories: { value: string | number; color: string; label?: string }[];
  fallbackColor: string;
  stroke?: Stroke;
}

export interface ExtrusionSymbol {
  kind: "extrusion";
  color: string;
  heightField: string;
  heightScale?: number;
}

export type Symbology =
  | SingleSymbol
  | GraduatedSymbol
  | CategorizedSymbol
  | ExtrusionSymbol;

export interface LabelStyle {
  /** Template over field names, for example "{name} · {density}". */
  template: string;
  size: number;
  color: string;
  haloColor?: string;
  haloWidth?: number;
  placement?: "point" | "line";
  allowOverlap?: boolean;
  scale?: ScaleRange;
}

/* ---------------------------------------------------------------- filters */

export type FilterValue = string | number | boolean | null;

export type FilterNode =
  | { op: "and" | "or"; children: FilterNode[] }
  | { op: "not"; child: FilterNode }
  | { op: "="; field: string; value: FilterValue }
  | { op: "!="; field: string; value: FilterValue }
  | { op: "<" | "<=" | ">" | ">="; field: string; value: number }
  | { op: "like"; field: string; value: string }
  | { op: "in"; field: string; value: FilterValue[] }
  | { op: "isnull" | "notnull"; field: string };

/* ---------------------------------------------------------------- tree */

export interface LayerNode {
  type: "layer";
  id: string;
  name: string;
  slot: Slot;
  source: string;
  sourceLayer?: string;
  geometry: Geometry;
  visible: boolean;
  opacity: number;
  scale?: ScaleRange;
  symbology: Symbology;
  labels?: LabelStyle;
  filter?: FilterNode;
  /** Kept for the interface, never used for rendering. */
  metadata?: {
    sourceCrs?: string;
    featureCount?: number;
    fields?: string[];
    extent?: { west: number; south: number; east: number; north: number };
  };
}

export interface GroupNode {
  type: "group";
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  /** Radio behaviour: at most one visible child. */
  exclusive?: boolean;
  children: TreeNode[];
}

export type TreeNode = LayerNode | GroupNode;

/* ---------------------------------------------------------------- document */

export interface View {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface BasemapTiles {
  tiles: string[];
  tileSize?: number;
  maxzoom?: number;
  attribution: string;
}

export interface Basemap {
  id: string;
  name: string;
  /** A heading in the gallery. Carries no meaning to the renderer. */
  group?: string;
  /** Shows through wherever the tiles have not loaded, so it is never optional. */
  background: string;
  opacity?: number;
  raster?: BasemapTiles;
  /**
   * A labels-only overlay. It is compiled into the labels slot, above the user's
   * data, because place names belong on top of a choropleth and not under it.
   */
  labelTiles?: BasemapTiles;
  labels: boolean;
}

export interface Hillshade {
  /** Names a raster-dem source. */
  source: string;
  /** Degrees clockwise from north, the way a GIS user states a sun azimuth. */
  illumination: number;
  intensity: number;
  shadowColor: string;
  highlightColor: string;
}

export interface Environment {
  terrain?: { source: string; exaggeration: number };
  /** Drawn just above the basemap, below everything the user added. */
  hillshade?: Hillshade;
  fog?: { color: string; range: [number, number] };
  light?: { anchor: "map" | "viewport"; intensity: number };
  sky?: boolean;
  projection?: "mercator" | "globe";
}

/* ---------------------------------------------------------------- chrome */

export type CoordinateFormat = "dd" | "dms" | "utm";
export type DistanceUnits = "metric" | "imperial" | "nautical";

/**
 * Furniture around and over the map. Only the graticule reaches the renderer;
 * the rest is drawn by the application, which is why it lives beside the tree
 * rather than in it.
 */
export interface Chrome {
  graticule: { enabled: boolean; interval: number; labels: boolean; color: string };
  scaleBar: { enabled: boolean; units: DistanceUnits };
  northArrow: boolean;
  overview: boolean;
  legend: boolean;
  coordinates: CoordinateFormat;
}

export interface MapProject {
  schema: 3;
  id: string;
  name: string;
  view: View;
  basemap: Basemap;
  environment: Environment;
  chrome: Chrome;
  sources: Record<string, Source>;
  tree: TreeNode[];
}

export const defaultChrome = (): Chrome => ({
  graticule: { enabled: false, interval: 0.5, labels: true, color: "#2b2b30" },
  scaleBar: { enabled: true, units: "metric" },
  northArrow: true,
  overview: false,
  legend: true,
  coordinates: "dd",
});
