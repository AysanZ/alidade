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

/**
 * How the sphere is put on the screen.
 *
 * `globe` is MapLibre's own name for a projection that is a sphere when zoomed
 * out and quietly becomes mercator on the way in, which is what you want for
 * normal work. `vertical-perspective` is the sphere at every zoom, which is what
 * you want when you asked for a globe and meant it.
 */
export type Projection = "mercator" | "globe" | "vertical-perspective";

/** Below this zoom `globe` is drawn as a sphere; above it, it is mercator. */
export const GLOBE_IS_ROUND_BELOW = 9;

export interface Light {
  anchor: "map" | "viewport";
  color: string;
  intensity: number;
  /** Degrees clockwise from north, then degrees down from straight up. */
  position?: [number, number, number];
}

export interface Environment {
  terrain?: { source: string; exaggeration: number };
  /** Drawn just above the basemap, below everything the user added. */
  hillshade?: Hillshade;
  fog?: { color: string; range: [number, number] };
  light?: Light;
  sky?: boolean;
  projection?: Projection;
}

/* ---------------------------------------------------------------- chrome */

export type CoordinateFormat = "dd" | "dms" | "utm";
export type DistanceUnits = "metric" | "imperial" | "nautical";

/**
 * Furniture around and over the map. Only the graticule reaches the renderer;
 * the rest is drawn by the application, which is why it lives beside the tree
 * rather than in it.
 */
/**
 * Reference grids other than the graticule.
 *
 * `utm` is the zone and band framework, which is global and fixed, so it is
 * generated once. `square` is a grid of true metric squares, which only exists
 * relative to somewhere, so it is generated for the view and regenerated when
 * the view has moved far enough to matter.
 */
export interface GridBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Grids {
  utm: boolean;
  square: { enabled: boolean; spacing: number };
  /**
   * The patch of world the square grid was last built for. It lives in the
   * document so the same project redraws the same grid; the application replaces
   * it when the view leaves the patch.
   */
  squareBounds?: GridBounds;
  color: string;
}

export interface Chrome {
  graticule: { enabled: boolean; interval: number; labels: boolean; color: string };
  grids: Grids;
  scaleBar: { enabled: boolean; units: DistanceUnits };
  northArrow: boolean;
  overview: boolean;
  legend: boolean;
  coordinates: CoordinateFormat;
}

/* ---------------------------------------------------------------- drawings */

export type AnnotationKind = "point" | "line" | "polygon";

/**
 * Something the user drew, in lon/lat, with the measurement it carries.
 *
 * Drawings live beside the tree rather than in it because they are one layer no
 * matter how many there are, and because they hold their own geometry: this is
 * the only part of the project that is not just a description of data elsewhere.
 */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  name: string;
  /** point: one position. line: the path. polygon: the ring, not closed. */
  coordinates: [number, number][];
  color: string;
  /** Set when the drawing was made by a measuring tool. */
  measure?: "distance" | "area";
  /** Metres, or square metres for an area. Recomputed on edit, stored for export. */
  value?: number;
  note?: string;
}

export interface Annotations {
  visible: boolean;
  opacity: number;
  features: Annotation[];
}

/**
 * What the user is pointing at.
 *
 * Held as attribute values rather than as renderer feature ids, because the
 * demo table is keyed on text and an uploaded one on an integer, and a vector
 * tile only carries a feature id when the key happens to be an integer. Matching
 * on a column works for both and needs nothing from the tile that is not
 * already in it.
 */
export interface Selection {
  layer: string;
  field: string;
  values: (string | number)[];
  /** A hover is drawn more quietly than a click, and is not kept. */
  hover?: boolean;
}

/** A named camera position. */
export interface Bookmark {
  id: string;
  name: string;
  view: View;
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
  /** Optional so a project written before drawings existed still loads. */
  annotations?: Annotations;
  bookmarks?: Bookmark[];
  selection?: Selection;
}

export const defaultGrids = (): Grids => ({
  utm: false,
  square: { enabled: false, spacing: 10000 },
  color: "#3b6ea5",
});

export const defaultChrome = (): Chrome => ({
  graticule: { enabled: false, interval: 0.5, labels: true, color: "#2b2b30" },
  grids: defaultGrids(),
  scaleBar: { enabled: true, units: "metric" },
  northArrow: true,
  overview: false,
  legend: true,
  coordinates: "dd",
});

export const defaultAnnotations = (): Annotations => ({
  visible: true,
  opacity: 1,
  features: [],
});
