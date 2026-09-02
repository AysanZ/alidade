import type { QueryClient } from "@tanstack/react-query";
import type { Geometry, LayerNode, MapProject } from "@alidade/core";
import { nextColor, representativeColor, singleSymbol } from "@alidade/core";

import type { RegisteredLayer } from "./api";
import { fetchLayerDetail } from "./queries";
import { uniqueId, walk } from "./tree";

export interface Extent {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * PostGIS reports geometry types in upper case (`POINT`, `MULTIPOLYGON`), GDAL in
 * mixed case, and `ST_GeometryType` with an `ST_` on the front. Matching on the
 * wrong case silently produced a fill layer for a point table, which draws
 * nothing at all: the layer was there, and invisible.
 */
const GEOMETRY: Record<string, Geometry> = {
  point: "point",
  multipoint: "point",
  linestring: "line",
  multilinestring: "line",
  linearring: "line",
  curve: "line",
  multicurve: "line",
  compoundcurve: "line",
  circularstring: "line",
  polygon: "polygon",
  multipolygon: "polygon",
  surface: "polygon",
  multisurface: "polygon",
  curvepolygon: "polygon",
  triangle: "polygon",
  polyhedralsurface: "polygon",
  tin: "polygon",
};

/**
 * Everything a table can say about its geometry that does not name a shape.
 *
 * A column declared `geometry(Geometry, 4326)` is what ogr2ogr leaves behind
 * whenever the source held more than one shape, and it says nothing at all about
 * what is in it.
 */
const VAGUE = new Set(["", "geometry", "geometrycollection", "multigeometry", "unknown", "none"]);

/**
 * What to draw when the table will not say.
 *
 * This used to be `polygon`, and getting it wrong that way is not a small
 * mistake: a renderer asked to fill a line closes it into a ring first, so a
 * coastline file became a continent-sized green wedge lying across the Pacific.
 * Drawing a polygon as a line is the same map with the fill missing — wrong, but
 * legible, and obviously wrong rather than alarming. So the guess is a line, and
 * `LayerNode.geometry` is editable in the inspector for when the guess is off.
 */
const WHEN_UNKNOWN: Geometry = "line";

export function geometryOf(reported: string | null): Geometry {
  const cleaned = (reported ?? "")
    .trim()
    .toLowerCase()
    // ST_MultiLineString -> multilinestring
    .replace(/^st_/, "")
    // MULTIPOLYGONZM, POINT Z, LINESTRINGM -> the shape on its own
    .replace(/\s*z?m?$/, "");
  if (VAGUE.has(cleaned)) return WHEN_UNKNOWN;
  return GEOMETRY[cleaned] ?? WHEN_UNKNOWN;
}

/**
 * What every layer already on the map is wearing.
 *
 * Imports all arrived as the same blue, so three of them on top of each other
 * were one indistinguishable smear and the table of contents was the only way to
 * tell which was which.
 */
export function colorsInUse(project: MapProject): string[] {
  const colors: string[] = [];
  walk(project.tree, (node) => {
    if (node.type === "layer") colors.push(representativeColor(node.symbology));
  });
  return colors;
}

export function vectorLayer(layer: RegisteredLayer, id: string, color: string): LayerNode {
  return {
    type: "layer",
    id,
    name: layer.title,
    slot: "data",
    source: id,
    // The layer name inside the vector tile is the registry id, not the node id.
    sourceLayer: layer.id,
    geometry: geometryOf(layer.geometryType),
    visible: true,
    opacity: 1,
    // A point layer with a polygon stroke is a fill layer that draws nothing.
    symbology: singleSymbol(color, geometryOf(layer.geometryType)),
    metadata: {
      sourceCrs: layer.sourceCrs ?? undefined,
      featureCount: layer.featureCount ?? undefined,
      fields: layer.fields,
      key: layer.key ?? undefined,
      extent: layer.extent ?? undefined,
    },
  };
}

/**
 * Put a registered layer in the project and take the map to it.
 *
 * The registry id names the tile endpoint, but it cannot also name the node in
 * the tree: adding the same layer twice gives the same id twice, and two nodes
 * with one id compile to two engine layers with one id. The node gets a free
 * name; the source keeps pointing at the real endpoint.
 */
export function place(
  layer: RegisteredLayer,
  edit: (change: (draft: MapProject) => MapProject) => void,
  onAdded: (id: string) => void,
  onFlyTo: (extent: Extent) => void,
  client: QueryClient,
): void {
  let placed = layer.id;
  edit((draft) => {
    placed = uniqueId(draft, layer.id);
    draft.sources[placed] = {
      type: "vector",
      tiles: [`${location.origin}/api/tiles/${layer.id}/{z}/{x}/{y}.mvt`],
      maxzoom: 16,
    };
    draft.tree.unshift(vectorLayer(layer, placed, nextColor(colorsInUse(draft))));
    return draft;
  });
  onAdded(placed);
  if (layer.extent) onFlyTo(layer.extent);

  /*
   * The key column takes a query per candidate to find, so the list endpoint does
   * not compute it. Fetched here, after the layer is already on the map, because
   * highlighting is the only thing that needs it and it can wait a beat.
   */
  if (!layer.key) {
    void fetchLayerDetail(client, layer.id)
      .then((full) => {
        if (!full.key) return;
        edit((draft) => {
          walk(draft.tree, (node) => {
            if (node.type === "layer" && node.id === placed && node.metadata) {
              node.metadata.key = full.key ?? undefined;
            }
          });
          return draft;
        });
      })
      .catch(() => {
        // Highlighting falls back to the first field. Not worth a message.
      });
  }
}

/** Whether a registered layer is already on the map, whatever its node is called. */
export function alreadyAdded(project: MapProject, layer: RegisteredLayer): boolean {
  let found = false;
  walk(project.tree, (node) => {
    if (node.type === "layer" && node.sourceLayer === layer.id) found = true;
  });
  return found;
}
