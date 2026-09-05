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
  /**
   * A TileJSON document, read by the renderer for the tile template and the
   * zoom range. Use this rather than `tiles` for a service whose tile URL is
   * versioned — OpenFreeMap puts the build date in the path and rotates it
   * weekly, so a template pinned in the document goes stale on its own.
   */
  url?: string;
  /** The template, when it is stable enough to write down. Either this or `url`. */
  tiles?: string[];
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
  minzoom?: number;
  /**
   * The deepest zoom the service actually has tiles for.
   *
   * This is not a limit on how far the map zooms: past it the renderer stretches
   * the last real tile, which is blurry and continuous. Leaving it off is what
   * is not continuous, because then the renderer asks for tiles the service does
   * not have and draws whatever comes back — and a tile service does not
   * necessarily answer 404. Esri answers with an image that says "Map data not
   * yet available", so the map fills with grey placards instead of the map.
   */
  maxzoom?: number;
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

/**
 * A point drawn as a glyph instead of a dot.
 *
 * @deprecated Superseded by `LayerNode.marker`, which sits over the layer's own
 * symbology rather than replacing it. Old documents still hold this shape, so
 * the compiler reads it and translates; nothing new writes it.
 */
export interface MarkerSymbol {
  kind: "marker";
  /** An emoji, or any single character. */
  glyph: string;
  /** Behind the glyph. Set to "none" for the glyph on its own. */
  color: string;
  size: number;
  /** Drawn as a pin with a point, or as a plain badge. */
  shape: "pin" | "circle" | "square" | "none";
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
  | MarkerSymbol
  | ExtrusionSymbol;

export type MarkerShape = "pin" | "circle" | "square" | "none";

/**
 * Where the marker image sits relative to the place it belongs to.
 *
 * `above` floats it clear of the feature, the way a pin stands over the spot it
 * names, and leaves the feature's own symbol readable underneath. `on` centres
 * it, which is what you want for a glyph that is meant to *be* the symbol.
 */
export type MarkerAnchor = "above" | "on";

/**
 * How a marker is spread over a feature that is not a single position.
 *
 * `centre` is one marker per feature, at the middle of the line or inside the
 * polygon. `along` repeats it down a line, which is how a route gets arrows.
 */
export type MarkerPlacement = "centre" | "along";

/**
 * A glyph drawn over a layer, on top of whatever the layer is already wearing.
 *
 * This is a decoration, not a classification: a graduated choropleth can carry a
 * marker and stay graduated. It used to be a `Symbology` kind, which meant
 * choosing a marker threw away the layer's colours and replaced the geometry
 * with an icon — the point stopped being a point and became the emoji.
 *
 * The glyph is rasterised by the application and handed to the renderer as an
 * image, because a vector tile has no idea what an emoji is and the demo glyph
 * set has no emoji in it. The document stores the character, not the pixels.
 */
export interface MarkerStyle {
  /** An emoji, or any short run of characters. */
  glyph: string;
  /** Behind the glyph. Ignored when `shape` is "none". */
  color: string;
  size: number;
  /** Drawn as a pin with a point, as a plain badge, or not at all. */
  shape: MarkerShape;
  /** Default "above", so the feature underneath stays visible. */
  anchor: MarkerAnchor;
  /** Only consulted for line and polygon layers. Default "centre". */
  placement?: MarkerPlacement;
  /** Metres between repeats when `placement` is "along". Default 200. */
  spacing?: number;
}

/**
 * What a marker is before anyone has an opinion about it.
 *
 * The glyph on its own, centred on the feature. The pin was the default and it
 * was the wrong one: asking for an emoji on a point and getting a coloured
 * badge with the emoji inside it, standing above the place it names, is a
 * decoration nobody asked for. The shapes are still there for whoever wants one.
 */
export const defaultMarker = (color = "#4c8dff"): MarkerStyle => ({
  glyph: "📍",
  color,
  size: 22,
  shape: "none",
  anchor: "on",
  placement: "centre",
});

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
  /**
   * A glyph drawn over the layer, in addition to its symbology. Works on every
   * vector geometry: over the dot for a point layer, at the middle of a line,
   * inside a polygon.
   */
  marker?: MarkerStyle;
  labels?: LabelStyle;
  filter?: FilterNode;
  /** Kept for the interface, never used for rendering. */
  metadata?: {
    sourceCrs?: string;
    featureCount?: number;
    fields?: string[];
    /**
     * The column whose value picks out exactly one feature, when the table has
     * one. Highlighting needs a key, and the first field is not one: for Natural
     * Earth it is `scalerank`, which every country shares with dozens of others.
     */
    key?: string;
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

/**
 * The colours a vector basemap is drawn in.
 *
 * A raster basemap arrives already coloured; a vector one is coloured here, so
 * the palette is part of the document and a basemap is a small object rather
 * than a link to someone's server.
 */
export interface BasemapPalette {
  water: string;
  green: string;
  sand: string;
  built: string;
  roadFill: string;
  roadCasing: string;
  rail: string;
  boundary: string;
  label: string;
  labelHalo: string;
  minorLabel: string;
}

/**
 * A basemap drawn from vector tiles rather than pictures of tiles.
 *
 * Crisp at every zoom because the labels are drawn by the renderer, and free of
 * the cache ceiling a raster service has: the tiles stop at 14 and are
 * overzoomed with the geometry intact, so zoom 19 is sharp rather than blurry.
 */
export interface VectorBasemap {
  /** Names a vector source in `sources`, in the OpenMapTiles schema. */
  source: string;
  palette: BasemapPalette;
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
  /** Drawn from vector tiles. Mutually exclusive with `raster` in practice. */
  vector?: VectorBasemap;
  /**
   * Low-zoom pictures, for the overview map and the gallery thumbnail only.
   *
   * A vector basemap has nothing to show in an `<img>`, and the overview map
   * draws the whole world in a two-inch box. A raster service that only has
   * shallow zooms is exactly right for both, and wrong for nothing, because
   * neither of them is ever at street zoom.
   */
  overview?: BasemapTiles;
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
 * Building footprints raised to their real height.
 *
 * This is the basemap in 3D rather than a data layer: the footprints come from
 * open vector tiles, the heights come from OpenStreetMap, and the whole thing
 * is one engine layer whatever city it is over — so it belongs beside terrain
 * and hillshade in the environment, not in the table of contents.
 *
 * The fields are named rather than assumed because a schema is a choice. These
 * defaults are OpenMapTiles', which is what the open tile services publish;
 * point them at `height` and `min_height` for a plain OSM extract, or at your
 * own columns for footprints you loaded into PostGIS yourself.
 */
export interface Buildings {
  /** Names a vector source in `sources`. */
  source: string;
  /** The layer inside the tile. `building` in OpenMapTiles. */
  sourceLayer: string;
  /** Metres to the top. `render_height` in OpenMapTiles. */
  heightField: string;
  /** Metres to the bottom, for a thing that starts above the ground. */
  baseField?: string;
  color: string;
  /** Roofs are drawn lighter than walls, so a block reads as blocks. */
  roofColor?: string;
  opacity: number;
  /**
   * Footprints are not in the tiles below this zoom, so asking for them below it
   * is a request that can only come back empty. 14 is where OpenMapTiles starts
   * carrying them.
   */
  minzoom: number;
  /** Multiplies every height. 1 is the truth; more is a diagram. */
  exaggeration: number;
  /**
   * Metres for a building whose height nobody has surveyed, which is most of
   * them outside a handful of cities. Zero would make a mapped city look empty.
   */
  defaultHeight: number;
  /** Shade the walls from dark at the base to the fill colour at the top. */
  verticalGradient: boolean;
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
  /** Extruded footprints. Present means on, the way terrain and hillshade are. */
  buildings?: Buildings;
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
  /**
   * Further columns that all have to match, which is how a feature is picked out
   * of a table with no key.
   *
   * One column is only enough when that column is unique. For Natural Earth the
   * first column is `scalerank`, which every feature shares with dozens of
   * others, so hovering one airport ringed every airport of the same rank. The
   * pointer now hands over the whole property bag of the feature it is actually
   * over, and the highlight matches on all of it.
   */
  where?: { field: string; value: string | number | boolean }[];
  /** A hover is drawn more quietly than a click, and is not kept. */
  hover?: boolean;
}

/** A named camera position. */
export interface Bookmark {
  id: string;
  name: string;
  view: View;
}

/* ---------------------------------------------------------------- models */

/**
 * Where a model's origin is held against the ground.
 *
 * `base` puts the lowest point of the mesh on the ground, which is what a
 * building or a vehicle wants and what most exported files do not do for
 * themselves: a glTF's origin is wherever the modeller left it, and that is
 * often the middle of the object. `origin` trusts the file.
 */
export type ModelAnchor = "base" | "origin";

/**
 * A glTF model placed on the map.
 *
 * The document holds a reference and a placement, never the geometry. A model
 * is fetched from its URL by the renderer the way a tile is, so a project with
 * a hundred models is still forty kilobytes, and two placements of the same
 * file share one download.
 *
 * The placement is stated the way a surveyor would state it — a position, a
 * height, a bearing — rather than as a matrix. A matrix cannot be edited one
 * number at a time and cannot be read back into words.
 */
export interface Model3D {
  id: string;
  name: string;
  /** A .glb or .gltf, absolute or relative to the studio. */
  url: string;
  /** lon, lat of the model's origin. */
  position: [number, number];
  /** Metres above the ground. Measured from the terrain surface when `clamp` is set and terrain is on. */
  altitude: number;
  /** Degrees clockwise from north, the way a bearing is stated. */
  heading: number;
  /** Uniform. 1 draws the file's own units as metres, which is what glTF specifies. */
  scale: number;
  anchor: ModelAnchor;
  /** Sit on the terrain surface rather than on sea level. Only matters when terrain is on. */
  clamp: boolean;
  visible: boolean;
  opacity: number;
  /** Where the file came from and who it belongs to. Kept for the interface, never rendered. */
  attribution?: string;
}

/**
 * Every model on the map.
 *
 * Models live beside the tree rather than in it for the same reason drawings
 * do: they are one layer no matter how many there are, drawn together into one
 * scene with one light, and a table of contents entry per model would be a
 * list of things that cannot be reordered because a 3D scene is ordered by
 * depth and not by the user.
 */
export interface Models {
  visible: boolean;
  items: Model3D[];
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
  /** Optional so a project written before models existed still loads. */
  models?: Models;
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

export const defaultModels = (): Models => ({
  visible: true,
  items: [],
});
