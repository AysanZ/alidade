/**
 * Imagery: many GeoTIFFs over the same ground, and which of them is drawn.
 *
 * The arithmetic only. Nothing here fetches anything, and nothing here knows
 * what a renderer is — what it produces is a tile template and an ordering,
 * both of which are data.
 *
 * The catalogue itself is deliberately *not* in the document. What is stored is
 * the rule and the rendering, the same way the live layer stores the address of
 * its feed and not the positions that arrived from it: the settings are the
 * map, the catalogue is what the server happens to hold today, and a project
 * reopened next month should show what is in the registry then rather than a
 * frozen list of filenames.
 */

import type { RasterSource } from "./types/project";

/* ---------------------------------------------------------------- catalogue */

/**
 * One image, as the search endpoint reports it.
 *
 * Named after the STAC fields where STAC has a name for the thing, so that the
 * registry can answer with an ItemCollection and this can read it unchanged.
 */
export interface ImageRecord {
  id: string;
  title: string;
  file: string;
  /**
   * ISO 8601, or null.
   *
   * Null is a legal state and not a broken one — STAC allows a null `datetime`
   * for an item with no meaningful single instant, and a great many exported
   * GeoTIFFs carry no acquisition tag at all. An image without a date is drawn,
   * listed and searchable like any other; it simply sorts last.
   */
  datetime: string | null;
  /** Where the date came from, so a date the user typed is never mistaken for one the file stated. */
  datetimeFrom: "tag" | "filename" | "user" | null;
  /** Ground sample distance in metres. `gsd` in STAC. */
  gsd: number;
  /** `proj:epsg`, as the file declared it before reprojection. */
  epsg: number | null;
  /** `eo:cloud_cover`, per cent, when anything knows it. */
  cloudCover: number | null;
  bands: number;
  dtype: string;
  /** Bounding box in lon/lat, west south east north. */
  bbox: [number, number, number, number];
  /**
   * The real outline in lon/lat, as the outer ring of a polygon.
   *
   * Kept beside the bounding box rather than instead of it because they answer
   * different questions — the box aims a camera, the ring says what is actually
   * covered. A scene is a rotated quadrilateral with nodata in its corners, so
   * drawing the box on the map would claim ground the file has no pixels for.
   */
  footprint: [number, number][];
  /**
   * What share of the requested view this image's footprint actually covers.
   *
   * Computed by the server against the real footprint rather than the bounding
   * box, and only meaningful for the view it was asked about. Absent when the
   * search was not given one.
   */
  coverage?: number;
  sensor?: string;
  note?: string;
}

/* ---------------------------------------------------------------- the rule */

/**
 * How the candidate images are sorted before pixels are chosen from them.
 *
 * Locking to one image is one rule among several rather than the only way to
 * see anything. With four images each covering part of the view, drawing only
 * the chosen one means looking at a mostly empty map and hunting the list for
 * whichever file happens to reach the corner in question.
 *
 * The vocabulary is Esri's, because a mosaic dataset has been answering this
 * question for twenty years and there is nothing to gain from new names.
 */
export type MosaicRule =
  /** This image and nothing else. */
  | { kind: "lock"; image: string }
  /** Sorted by how far each date is from a target. Undated images sort last. */
  | { kind: "closest"; date: string }
  | { kind: "newest" }
  /** Finest ground sample distance first: a 5 cm survey over a 10 m tile. */
  | { kind: "sharpest" }
  /** Best covering of the current view first, so you are not shown a corner. */
  | { kind: "centre" };

/** How overlapping pixels resolve once the candidates are in order. */
export type Overlap = "first" | "blend" | "mean" | "max";

export type Resampling = "nearest" | "bilinear" | "cubic" | "lanczos";

/**
 * What the tiler is asked to make of the pixels.
 *
 * `expression` is why this is worth having at all. NDVI, NDWI, a burn index and
 * a ratio nobody has thought of yet are one string each and cost nothing on
 * disk; the alternative is a derived raster per index per date, which is how a
 * folder of four files becomes a folder of forty.
 */
export interface ImageryRender {
  mode: "rgb" | "single" | "expression";
  /** 1-based band indexes, as GDAL numbers them. Three for rgb, one for single. */
  bands?: number[];
  /** Band maths, for example `(b8-b4)/(b8+b4)`. Only read when mode is expression. */
  expression?: string;
  /**
   * Per-band [min, max] for the eight-bit stretch.
   *
   * One pair stretches every band alike, which is what a true-colour composite
   * of one sensor wants. Several pairs stretch band by band.
   */
  rescale?: [number, number][];
  /** A named ramp, for single-band and expression output. */
  colormap?: string;
  resampling?: Resampling;
  gamma?: number;
  /** Overrides whatever the file declares. Drawn transparent. */
  nodata?: number;
}

/**
 * Everything about an imagery layer that is not the pixels.
 *
 * Lives on the layer rather than on the source because it is the question the
 * source is the answer to — the same arrangement as `environment.sun`, which is
 * kept beside the `light` it produces so that a saved project reopens at half
 * past three in March rather than at whatever bearing that worked out to. The
 * tile template is derived from this at compile time and never authored.
 */
export interface ImagerySettings {
  /** Where the catalogue and the tiler are. Relative, so one document works everywhere. */
  endpoint?: string;
  rule: MosaicRule;
  overlap: Overlap;
  render: ImageryRender;
}

export const IMAGERY_ENDPOINT = "/api/rasters";

export const defaultImagery = (): ImagerySettings => ({
  rule: { kind: "newest" },
  overlap: "first",
  render: { mode: "rgb", bands: [1, 2, 3], resampling: "bilinear" },
});

/* ---------------------------------------------------------------- ordering */

const instant = (image: ImageRecord): number | null =>
  image.datetime ? Date.parse(image.datetime) : null;

/**
 * The candidates in the order the rule puts them.
 *
 * Total and stable: images that the rule cannot distinguish keep the order they
 * arrived in, so the same catalogue always produces the same map. Undated
 * images sort last under every date rule rather than being dropped, because a
 * list that silently omits them makes the count in the panel a number nobody
 * can reconcile with what is on the screen.
 */
export function orderByRule(images: ImageRecord[], rule: MosaicRule): ImageRecord[] {
  const list = images.slice();

  if (rule.kind === "lock") {
    const found = list.find((image) => image.id === rule.image);
    return found ? [found] : [];
  }

  const undated = list.filter((image) => instant(image) === null);
  const dated = list.filter((image) => instant(image) !== null);

  if (rule.kind === "sharpest") {
    return list.sort((a, b) => a.gsd - b.gsd);
  }
  if (rule.kind === "centre") {
    return list.sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));
  }
  if (rule.kind === "newest") {
    dated.sort((a, b) => instant(b)! - instant(a)!);
    return [...dated, ...undated];
  }

  const target = Date.parse(rule.date);
  dated.sort((a, b) => Math.abs(instant(a)! - target) - Math.abs(instant(b)! - target));
  return [...dated, ...undated];
}

/**
 * How much of the view a set of images covers between them.
 *
 * An estimate, and honest about it: the exact answer is the area of the union
 * of the footprints clipped to the view, which only the database can work out,
 * and it is what the server reports for a single image. This combines several
 * of those single figures for the panel, assuming each image is as likely to
 * fall on a gap as on ground already covered.
 */
export function estimateCoverage(images: ImageRecord[]): number {
  const shares = images
    .map((image) => image.coverage ?? 0)
    .sort((a, b) => b - a);
  if (!shares.length) return 0;
  let union = shares[0]!;
  for (const share of shares.slice(1)) union += ((100 - union) * share) / 100;
  return Math.min(100, Math.round(union));
}

/**
 * Which images the rule actually draws with, in draw order.
 *
 * Under `lock` it is the one image, whatever it covers. Otherwise images are
 * taken in the rule's order until the view is covered or the ceiling is
 * reached: reading a hundred assets for one tile is not a mosaic, it is a
 * timeout, and past a handful of overlapping scenes the ones underneath are
 * never seen anyway.
 */
export function contributing(
  images: ImageRecord[],
  rule: MosaicRule,
  limit = 4,
): ImageRecord[] {
  const ordered = orderByRule(images, rule);
  if (rule.kind === "lock") return ordered;

  const out: ImageRecord[] = [];
  for (const image of ordered) {
    out.push(image);
    if (estimateCoverage(out) >= 100) break;
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------------------------------------------------------------- the URL */

/**
 * The query the tiler is given, as pairs, in a fixed order.
 *
 * Ordered rather than built from an object so that two equal settings produce
 * character-identical URLs. The reconciler compares tile templates as strings:
 * a template whose parameters shuffle between renders would look like a changed
 * source on every edit and rebuild the layer for nothing.
 */
export function imageryQuery(settings: ImagerySettings): [string, string][] {
  const { rule, render } = settings;
  const params: [string, string][] = [];

  params.push(["rule", rule.kind]);
  if (rule.kind === "lock") params.push(["image", rule.image]);
  if (rule.kind === "closest") params.push(["date", rule.date]);
  params.push(["overlap", settings.overlap]);

  if (render.mode === "expression") {
    if (render.expression) params.push(["expression", render.expression]);
  } else if (render.bands?.length) {
    for (const band of render.bands) params.push(["bidx", String(band)]);
  }

  for (const [low, high] of render.rescale ?? []) params.push(["rescale", `${low},${high}`]);
  if (render.colormap) params.push(["colormap_name", render.colormap]);
  if (render.resampling && render.resampling !== "nearest") {
    params.push(["resampling", render.resampling]);
  }
  if (render.gamma !== undefined && render.gamma !== 1) {
    params.push(["gamma", String(render.gamma)]);
  }
  if (render.nodata !== undefined) params.push(["nodata", String(render.nodata)]);

  return params;
}

/**
 * The tile template, with the tile coordinates left for the renderer.
 *
 * `{z}/{x}/{y}` must survive unencoded, so they are written after the query is
 * built rather than passed through it.
 */
export function imageryTileUrl(settings: ImagerySettings): string {
  const base = settings.endpoint ?? IMAGERY_ENDPOINT;
  const query = imageryQuery(settings)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}/tiles/{z}/{x}/{y}.png?${query}`;
}

/**
 * The raster source an imagery layer reads.
 *
 * `maxzoom` is the finest image's own resolution expressed as a zoom, for the
 * reason `RasterSource.maxzoom` already gives: past the detail the data holds,
 * the renderer should stretch the last real tile rather than ask the server for
 * pixels nobody photographed.
 */
export function imagerySource(
  settings: ImagerySettings,
  options: { tileSize?: number; maxzoom?: number; attribution?: string } = {},
): RasterSource {
  return {
    type: "raster",
    tiles: [imageryTileUrl(settings)],
    /*
     * Everything but `tiles` is carried through rather than asserted. The
     * settings decide where the pixels come from and nothing else; tile size,
     * the zoom ceiling and the attribution belong to whoever wrote the source,
     * and a derivation that overwrites them means an imagery layer can never
     * have a 512-pixel tile and nobody can find out why.
     */
    tileSize: options.tileSize ?? 256,
    ...(options.maxzoom !== undefined ? { maxzoom: options.maxzoom } : {}),
    ...(options.attribution ? { attribution: options.attribution } : {}),
  };
}

/**
 * The zoom at which one screen pixel is one image pixel.
 *
 * Web mercator at the equator is about 156543 metres per pixel at zoom 0, so a
 * ten metre image is native at about zoom 14 and a five centimetre one at about
 * zoom 21. Clamped to the pyramid, and rounded up, because half a zoom of
 * slightly-too-much detail is invisible and half a zoom too little is not.
 */
export function nativeZoom(gsd: number): number {
  if (!(gsd > 0)) return 22;
  return Math.max(0, Math.min(22, Math.ceil(Math.log2(156543.03392 / gsd))));
}
