import type { EngineLayer } from "./types/ops";
import type {
  Geometry,
  GroupNode,
  LayerNode,
  MapProject,
  MarkerStyle,
  Selection,
  Slot,
  Source,
  Symbology,
  TreeNode,
} from "./types/project";
import { SLOT_ORDER } from "./types/project";
import { annotationSourceId, annotationsGeoJSON, vertexGeoJSON } from "./annotate";
import { toExpression } from "./filter";
import { graticuleGeoJSON, graticuleSourceId } from "./graticule";
import { squareGridGeoJSON, squareGridSourceId, utmGridGeoJSON, utmGridSourceId } from "./grids";
import { zoomRange } from "./scale";
import { labelLayout, labelPaint, paintFor, strokePaint } from "./symbology";

export interface Compiled {
  sources: Record<string, Source>;
  /** Bottom first, which is the order the renderer wants. */
  layers: EngineLayer[];
}

/**
 * Read a layer the way the rest of the compiler expects it.
 *
 * A marker used to be a `Symbology` kind, so choosing one replaced the layer's
 * drawing instead of decorating it. Documents written then still exist; they are
 * translated here, once, and everything downstream sees the current shape.
 */
export function normalise(layer: LayerNode): LayerNode {
  if (layer.symbology.kind !== "marker") return layer;
  const legacy = layer.symbology;
  return {
    ...layer,
    symbology: { kind: "single", color: legacy.color },
    marker: layer.marker ?? {
      glyph: legacy.glyph,
      color: legacy.color,
      size: legacy.size,
      shape: legacy.shape,
      // The old renderer centred everything but a pin. Everything is now placed
      // the way a pin was, because that is the one that reads as "this spot".
      anchor: "above",
      placement: "centre",
    },
  };
}

/**
 * One logical layer becomes several engine layers. They always move together and
 * keep this internal order; the user never sees the expansion.
 *
 * On a point layer the marker *is* the point: the dot is not drawn, because a
 * pin standing over its own blue dot looks like two things where there is one.
 * A line or an area cannot be replaced by an icon, so there the marker is drawn
 * in addition to the geometry, at the middle of each feature.
 */
export function bundleFor(node: LayerNode): string[] {
  const layer = normalise(node);
  const ids: string[] = [];
  const marker = layer.marker && layer.geometry !== "raster" ? `${layer.id}:marker` : null;

  if (layer.geometry === "raster") ids.push(`${layer.id}:raster`);
  else if (layer.geometry === "point") {
    if (!marker) ids.push(`${layer.id}:circle`);
  } else if (layer.geometry === "polygon") {
    const symbology = layer.symbology;
    ids.push(symbology.kind === "extrusion" ? `${layer.id}:extrusion` : `${layer.id}:fill`);
    // `normalise` has already turned a legacy marker symbology into a single, so
    // the only kinds left here either carry a stroke or are an extrusion.
    if (symbology.kind !== "extrusion" && symbology.kind !== "marker" && symbology.stroke) {
      ids.push(`${layer.id}:line`);
    }
  } else ids.push(`${layer.id}:line`);

  if (marker) ids.push(marker);
  if (layer.labels) ids.push(`${layer.id}:label`);
  return ids;
}

interface Flat {
  layer: LayerNode;
  opacity: number;
  visible: boolean;
}

/** Depth first, table of contents order: the first entry is the top of the list. */
function flatten(nodes: TreeNode[], opacity = 1, visible = true, seen = new Set<string>()): Flat[] {
  const out: Flat[] = [];
  for (const node of nodes) {
    if (node.type === "group") {
      const g = node as GroupNode;
      out.push(...flatten(g.children, opacity * g.opacity, visible && g.visible, seen));
    } else {
      /*
       * Two nodes with the same id compile to two engine layers with the same id,
       * which a renderer refuses to add and a reconciler cannot tell apart. It
       * used to happen every time the same file was imported twice: the second
       * layer appeared in the table of contents and nothing was drawn. The tree
       * should not contain a duplicate, and if it does, the first one wins.
       */
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({
        layer: normalise(node),
        opacity: opacity * node.opacity,
        visible: visible && node.visible,
      });
    }
  }
  return out;
}

export function compile(project: MapProject): Compiled {
  const sources: Record<string, Source> = { ...project.sources };
  const bySlot = new Map<Slot, EngineLayer[]>();
  for (const slot of SLOT_ORDER) bySlot.set(slot, []);

  /*
   * Layers the application owns rather than the user. They are not reversed with
   * the tree, because their draw order is fixed: background, basemap, hillshade.
   */
  const systemBase: EngineLayer[] = [
    {
      id: "basemap:background",
      type: "background",
      slot: "base",
      paint: { "background-color": project.basemap.background },
      layout: {},
    },
  ];
  const systemLabels: EngineLayer[] = [];

  if (project.basemap.raster) {
    sources["basemap:raster"] = { type: "raster", ...project.basemap.raster };
    systemBase.push({
      id: "basemap:raster",
      type: "raster",
      source: "basemap:raster",
      slot: "base",
      paint: { "raster-opacity": project.basemap.opacity ?? 1 },
      layout: {},
    });
  }

  // Hillshade sits on the basemap, under everything the user added.
  const hillshade = project.environment.hillshade;
  if (hillshade) {
    systemBase.push({
      id: "environment:hillshade",
      type: "hillshade",
      source: hillshade.source,
      slot: "base",
      paint: {
        "hillshade-illumination-direction": hillshade.illumination,
        "hillshade-illumination-anchor": "map",
        "hillshade-exaggeration": hillshade.intensity,
        "hillshade-shadow-color": hillshade.shadowColor,
        "hillshade-highlight-color": hillshade.highlightColor,
      },
      layout: {},
    });
  }

  if (project.basemap.labelTiles && project.basemap.labels) {
    sources["basemap:labels"] = { type: "raster", ...project.basemap.labelTiles };
    systemLabels.push({
      id: "basemap:labels",
      type: "raster",
      source: "basemap:labels",
      slot: "labels",
      paint: { "raster-opacity": 1 },
      layout: {},
    });
  }

  const lat = project.view.center[1];

  for (const entry of flatten(project.tree)) {
    for (const engine of engineLayersFor(entry, lat)) {
      bySlot.get(entry.layer.slot)!.push(engine);
    }
  }

  const grids = project.chrome.grids;
  if (grids?.utm) {
    sources[utmGridSourceId()] = { type: "geojson", data: utmGridGeoJSON() };
    systemLabels.push({
      id: "chrome:grid:utm:line",
      type: "line",
      source: utmGridSourceId(),
      slot: "labels",
      paint: { "line-color": grids.color, "line-width": 0.9, "line-opacity": 0.75 },
      layout: {},
    });
    systemLabels.push({
      id: "chrome:grid:utm:label",
      type: "symbol",
      source: utmGridSourceId(),
      slot: "labels",
      paint: { "text-color": grids.color, "text-halo-color": "#050505", "text-halo-width": 1.2 },
      layout: {
        "text-field": ["get", "label"],
        "text-size": 10,
        "symbol-placement": "line",
        "text-allow-overlap": false,
      },
    });
  }

  if (grids?.square.enabled) {
    // Metric squares only exist relative to somewhere, so they are built for the
    // view. `bounds` is carried on the project so the same document redraws the
    // same grid; the application refreshes it when the view leaves the patch.
    sources[squareGridSourceId()] = {
      type: "geojson",
      data: squareGridGeoJSON(
        project.chrome.grids.squareBounds ?? viewBounds(project.view),
        grids.square.spacing,
      ),
    };
    systemLabels.push({
      id: "chrome:grid:square:line",
      type: "line",
      source: squareGridSourceId(),
      slot: "labels",
      paint: { "line-color": grids.color, "line-width": 0.55, "line-opacity": 0.5 },
      layout: {},
    });
  }

  // The graticule is chrome, but it is the one piece of chrome the renderer draws.
  if (project.chrome.graticule.enabled) {
    const { interval, color, labels } = project.chrome.graticule;
    sources[graticuleSourceId()] = { type: "geojson", data: graticuleGeoJSON(interval) };
    systemLabels.push({
      id: "chrome:graticule:line",
      type: "line",
      source: graticuleSourceId(),
      slot: "labels",
      paint: { "line-color": color, "line-width": 0.7, "line-dasharray": [3, 5] },
      layout: {},
    });
    if (labels) {
      systemLabels.push({
        id: "chrome:graticule:label",
        type: "symbol",
        source: graticuleSourceId(),
        slot: "labels",
        paint: { "text-color": color, "text-halo-color": "#050505", "text-halo-width": 1 },
        layout: {
          "text-field": ["get", "label"],
          "text-size": 10,
          "symbol-placement": "line",
          "text-allow-overlap": false,
        },
      });
    }
  }

  /*
   * What the user is pointing at, drawn over its own layer rather than instead of
   * it, so a highlight cannot hide the thing it is highlighting.
   */
  const systemOverlay: EngineLayer[] = [];
  const selection = project.selection;
  const target = selection ? findLayer(project.tree, selection.layer) : undefined;
  if (selection && target && selection.values.length > 0 && target.geometry !== "raster") {
    const match = selectionFilter(selection);
    const strong = selection.hover ? 0.55 : 1;
    const base = {
      source: target.source,
      sourceLayer: target.sourceLayer,
      slot: "overlay" as const,
      filter: match,
      layout: {},
    };

    if (target.geometry === "point") {
      systemOverlay.push({
        ...base,
        id: "chrome:selection:point",
        type: "circle",
        paint: {
          "circle-color": "rgba(0,0,0,0)",
          "circle-radius": 9,
          "circle-stroke-color": "#ffd166",
          "circle-stroke-width": 2.4,
          "circle-stroke-opacity": strong,
        },
      });
    } else {
      if (target.geometry === "polygon") {
        systemOverlay.push({
          ...base,
          id: "chrome:selection:fill",
          type: "fill",
          paint: { "fill-color": "#ffd166", "fill-opacity": 0.18 * strong },
        });
      }
      systemOverlay.push({
        ...base,
        id: "chrome:selection:line",
        type: "line",
        paint: { "line-color": "#ffd166", "line-width": 2.4, "line-opacity": strong },
      });
    }
  }

  /*
   * Drawings sit in the overlay slot, above everything, because they are what the
   * user is doing right now. Vertices are a separate layer so they can be given
   * a hit target the fill does not have.
   */
  const annotations = project.annotations;
  if (annotations && annotations.features.length > 0) {
    const shown = annotations.visible ? "visible" : "none";
    const alpha = annotations.opacity;
    sources[annotationSourceId()] = {
      type: "geojson",
      data: annotationsGeoJSON(annotations, project.chrome.scaleBar.units),
    };
    sources[`${annotationSourceId()}:vertices`] = {
      type: "geojson",
      data: vertexGeoJSON(annotations),
    };

    systemOverlay.push({
      id: "chrome:annotations:fill",
      type: "fill",
      source: annotationSourceId(),
      slot: "overlay",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.18 * alpha },
      layout: { visibility: shown },
      filter: ["==", ["geometry-type"], "Polygon"],
    });
    systemOverlay.push({
      id: "chrome:annotations:line",
      type: "line",
      source: annotationSourceId(),
      slot: "overlay",
      paint: { "line-color": ["get", "color"], "line-width": 2.2, "line-opacity": alpha },
      layout: { visibility: shown, "line-join": "round", "line-cap": "round" },
      filter: ["!=", ["geometry-type"], "Point"],
    });
    systemOverlay.push({
      id: "chrome:annotations:point",
      type: "circle",
      source: annotationSourceId(),
      slot: "overlay",
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": 5,
        "circle-opacity": alpha,
        "circle-stroke-color": "#050505",
        "circle-stroke-width": 1.2,
      },
      layout: { visibility: shown },
      filter: ["==", ["geometry-type"], "Point"],
    });
    systemOverlay.push({
      id: "chrome:annotations:vertex",
      type: "circle",
      source: `${annotationSourceId()}:vertices`,
      slot: "overlay",
      paint: {
        "circle-color": "#050505",
        "circle-radius": 3.4,
        "circle-opacity": alpha,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.4,
      },
      layout: { visibility: shown },
    });
    systemOverlay.push({
      id: "chrome:annotations:label",
      type: "symbol",
      source: annotationSourceId(),
      slot: "overlay",
      paint: { "text-color": "#e4e4e6", "text-halo-color": "#050505", "text-halo-width": 1.4 },
      layout: {
        visibility: shown,
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-allow-overlap": false,
      },
    });
  }

  // Within a slot the top of the table of contents draws on top, so the engine
  // order is the reverse. Slots are applied before tree order, always.
  const layers: EngineLayer[] = [];
  for (const slot of SLOT_ORDER) {
    if (slot === "base") layers.push(...systemBase);
    if (slot === "labels") layers.push(...systemLabels);
    layers.push(...groupsReversed(bySlot.get(slot)!));
    if (slot === "overlay") layers.push(...systemOverlay);
  }

  return { sources, layers };
}

/**
 * The expression that picks out what is selected.
 *
 * `field` and `values` carry a set — a row range dragged in the attribute table
 * is many values of one column. `where` narrows that set down to one feature,
 * which is what a pointer over a map means and what a table with no unique key
 * cannot express on its own.
 *
 * Everything is compared as text on both sides. A vector tile will hand back
 * `3` where the database held `3.0`, and a column that is an integer in one tile
 * and null in the next has no numeric comparison that is true.
 */
export function selectionFilter(selection: Selection): unknown {
  const clauses: unknown[] = [
    ["in", ["to-string", ["get", selection.field]], ["literal", selection.values.map(String)]],
  ];
  for (const constraint of selection.where ?? []) {
    if (constraint.field === selection.field) continue;
    clauses.push(["==", ["to-string", ["get", constraint.field]], String(constraint.value)]);
  }
  return clauses.length === 1 ? clauses[0] : ["all", ...clauses];
}

/** The layer a selection or a style edit names, wherever it is in the tree. */
export function findLayer(nodes: TreeNode[], id: string): LayerNode | undefined {
  for (const node of nodes) {
    if (node.type === "layer") {
      if (node.id === id) return node;
    } else {
      const found = findLayer(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * A rough bounding box for a camera position.
 *
 * Only used as the starting patch for the square grid before the application has
 * measured the real one, so an approximation from zoom and latitude is enough.
 */
export function viewBounds(view: MapProject["view"]): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const span = 360 / Math.pow(2, view.zoom);
  const [lon, lat] = view.center;
  return {
    west: lon - span,
    east: lon + span,
    south: Math.max(-85, lat - span / 2),
    north: Math.min(85, lat + span / 2),
  };
}

/** Reverse the layers but keep each bundle's internal order intact. */
function groupsReversed(layers: EngineLayer[]): EngineLayer[] {
  const bundles: EngineLayer[][] = [];
  let current = "";
  for (const l of layers) {
    const key = l.id.split(":")[0]!;
    if (key !== current) {
      bundles.push([]);
      current = key;
    }
    bundles[bundles.length - 1]!.push(l);
  }
  return bundles.reverse().flat();
}

function engineLayersFor(entry: Flat, latitude: number): EngineLayer[] {
  const { layer, opacity, visible } = entry;
  const zoom = layer.scale ? zoomRange(layer.scale, latitude) : undefined;
  const filter = layer.filter ? toExpression(layer.filter) : undefined;

  const base = {
    source: layer.source,
    sourceLayer: layer.sourceLayer,
    slot: layer.slot,
    ...(zoom ?? {}),
    ...(filter !== undefined ? { filter } : {}),
  };
  const layout = (extra: Record<string, unknown> = {}) => ({
    visibility: visible ? "visible" : "none",
    ...extra,
  });

  const out: EngineLayer[] = [];
  for (const id of bundleFor(layer)) {
    const role = id.slice(layer.id.length + 1);
    if (role === "label") {
      out.push({
        ...base,
        id,
        type: "symbol",
        paint: labelPaint(layer.labels!, opacity),
        layout: layout(labelLayout(layer.labels!)),
        ...(layer.labels!.scale ? zoomRange(layer.labels!.scale, latitude) : {}),
      });
    } else if (role === "marker") {
      /*
       * The icon is registered by the application under an id derived from the
       * marker, so changing the glyph changes the name and the renderer picks up
       * a different image rather than being asked to mutate one in place.
       */
      out.push({
        ...base,
        id,
        type: "symbol",
        paint: { "icon-opacity": opacity },
        layout: layout(markerLayout(layer.marker!, layer.geometry)),
      });
    } else if (role === "line" && layer.geometry === "polygon") {
      out.push({
        ...base,
        id,
        type: "line",
        paint: strokePaint(layer.symbology, opacity) ?? {},
        layout: layout(),
      });
    } else {
      const type =
        role === "raster"
          ? "raster"
          : role === "extrusion"
            ? "fill-extrusion"
            : role === "circle"
              ? "circle"
              : role === "line"
                ? "line"
                : "fill";
      out.push({
        ...base,
        id,
        type,
        paint: paintFor(layer.symbology, layer.geometry, opacity),
        layout: layout(),
      });
    }
  }
  return out;
}


/**
 * Where the marker image goes, for every geometry, in one place.
 *
 * The old rule was a shape test — a pin was anchored at its bottom and anything
 * else at its centre — which is why an emoji swallowed the point it was meant to
 * mark while a pin stood politely above it. Position is now the user's decision
 * and applies the same way to a point, a line and a polygon.
 */
export function markerLayout(marker: MarkerStyle, geometry: Geometry): Record<string, unknown> {
  const above = marker.anchor !== "on";
  const layout: Record<string, unknown> = {
    "icon-image": markerImageId(marker),
    "icon-size": 1,
    // A marker is the thing the reader is looking for, so it is never dropped to
    // make room for a label, and never collides itself out of existence.
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
    "icon-anchor": above ? "bottom" : "center",
  };

  /*
   * A pin already ends in a point, so its bottom edge is the spot. A badge does
   * not, so it is lifted clear of whatever is underneath it. `icon-offset` is in
   * the image's own pixels and negative is up.
   */
  if (above && marker.shape !== "pin") layout["icon-offset"] = [0, -4];

  /*
   * A line or a polygon has no single position, so the renderer picks one:
   * `point` puts one marker at the middle of a line and inside a polygon.
   * Repeating along a line is a line's option only — a polygon compiled with
   * `symbol-placement: line` draws markers around its ring, which is not what
   * anybody means by putting a marker on a polygon.
   */
  if (geometry === "line" && marker.placement === "along") {
    layout["symbol-placement"] = "line";
    layout["symbol-spacing"] = marker.spacing ?? 200;
  } else {
    layout["symbol-placement"] = "point";
  }

  return layout;
}

/**
 * A stable name for a marker image.
 *
 * Derived from the marker rather than from the layer, so two layers using the
 * same pin share one image, and so changing the glyph asks the renderer for a
 * different name instead of asking it to mutate an image it is already drawing.
 *
 * Anchor and placement are deliberately not part of the name: they move the same
 * pixels around rather than changing them, so they are a layout edit and not a
 * new image.
 */
export function markerImageId(marker: MarkerStyle | Extract<Symbology, { kind: "marker" }>): string {
  const glyph = [...marker.glyph].map((c) => c.codePointAt(0)!.toString(16)).join("-");
  return `marker:${marker.shape}:${marker.color.replace("#", "")}:${Math.round(marker.size)}:${glyph}`;
}

/** Every marker image a project needs, so they can be registered before drawing. */
export function markersIn(project: MapProject): MarkerStyle[] {
  const out: MarkerStyle[] = [];
  const seen = new Set<string>();
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "group") {
        visit(node.children);
        continue;
      }
      const marker = normalise(node).marker;
      if (!marker) continue;
      const id = markerImageId(marker);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(marker);
    }
  };
  visit(project.tree);
  return out;
}
