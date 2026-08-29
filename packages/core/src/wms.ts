import type { RasterSource } from "./types/project";

export interface WmsLayerChoice {
  /** The machine name the server expects in a GetMap request. */
  name: string;
  title: string;
  crs: string[];
  styles: string[];
  /** Geographic bounding box as [west, south, east, north]. */
  bbox?: [number, number, number, number];
  queryable: boolean;
  abstract?: string;
}

export interface WmsCapabilities {
  title: string;
  version: string;
  formats: string[];
  layers: WmsLayerChoice[];
}

export interface WmsOptions {
  url: string;
  layers: string;
  version?: "1.1.1" | "1.3.0";
  styles?: string;
  format?: string;
  transparent?: boolean;
  /** Rendering is web mercator, so this is 3857 unless a server refuses it. */
  crs?: string;
  tileSize?: number;
}

/**
 * A GetMap request with the bounding box left as a placeholder for the renderer.
 *
 * The version matters more than it looks: 1.3.0 names the parameter `crs` and
 * 1.1.1 names it `srs`, and a server given the wrong one answers with an
 * exception image rather than a map.
 */
export function wmsTileUrl(options: WmsOptions): string {
  const version = options.version ?? "1.3.0";
  const crs = options.crs ?? "EPSG:3857";
  const size = options.tileSize ?? 256;

  const params: [string, string][] = [
    ["service", "WMS"],
    ["version", version],
    ["request", "GetMap"],
    ["layers", options.layers],
    ["styles", options.styles ?? ""],
    ["format", options.format ?? "image/png"],
    ["transparent", String(options.transparent ?? true)],
    [version === "1.3.0" ? "crs" : "srs", crs],
    ["width", String(size)],
    ["height", String(size)],
  ];

  const query = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  // The renderer substitutes the bbox, so it must survive unencoded.
  return `${base(options.url)}?${query}&bbox={bbox-epsg-3857}`;
}

export function wmsSource(options: WmsOptions & { attribution?: string }): RasterSource {
  return {
    type: "raster",
    tiles: [wmsTileUrl(options)],
    tileSize: options.tileSize ?? 256,
    ...(options.attribution ? { attribution: options.attribution } : {}),
  };
}

/** GetFeatureInfo for the layer under the cursor. Used by identify in phase 6. */
export function wmsFeatureInfoUrl(
  options: WmsOptions & { x: number; y: number; bbox: [number, number, number, number] },
): string {
  const version = options.version ?? "1.3.0";
  const size = options.tileSize ?? 256;
  const params: [string, string][] = [
    ["service", "WMS"],
    ["version", version],
    ["request", "GetFeatureInfo"],
    ["layers", options.layers],
    ["query_layers", options.layers],
    ["info_format", "application/json"],
    [version === "1.3.0" ? "crs" : "srs", options.crs ?? "EPSG:3857"],
    ["width", String(size)],
    ["height", String(size)],
    ["bbox", options.bbox.join(",")],
    [version === "1.3.0" ? "i" : "x", String(Math.round(options.x))],
    [version === "1.3.0" ? "j" : "y", String(Math.round(options.y))],
  ];
  return `${base(options.url)}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** Servers advertise capabilities URLs with query strings already attached. */
function base(url: string): string {
  const cut = url.indexOf("?");
  return cut === -1 ? url : url.slice(0, cut);
}
