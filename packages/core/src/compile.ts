import type { EngineLayer } from "./types/ops";
import type {
  GroupNode,
  LayerNode,
  MapProject,
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
 * One logical layer becomes several engine layers. They always move together and
 * keep this internal order; the user never sees the expansion.
 */
export function bundleFor(layer: LayerNode): string[] {
  const ids: string[] = [];
  if (layer.geometry === "raster") ids.push(`${layer.id}:raster`);
  else if (layer.symbology.kind === "marker") ids.push(`${layer.id}:marker`);
  else if (layer.geometry === "polygon") {
    ids.push(layer.symbology.kind === "extrusion" ? `${layer.id}:extrusion` : `${layer.id}:fill`);
    if (layer.symbology.kind !== "extrusion" && layer.symbology.stroke) ids.push(`${layer.id}:line`);
  } else if (layer.geometry === "line") ids.push(`${layer.id}:line`);
  else ids.push(`${layer.id}:circle`);
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
        layer: node,
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
    const match = [
      "in",
      ["to-string", ["get", selection.field]],
      ["literal", selection.values.map(String)],
    ];
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
       * symbology, so changing the glyph changes the name and the renderer picks
       * up a different image rather than being asked to mutate one in place.
       */
      const marker = layer.symbology as Extract<Symbology, { kind: "marker" }>;
      out.push({
        ...base,
        id,
        type: "symbol",
        paint: { "icon-opacity": opacity },
        layout: layout({
          "icon-image": markerImageId(marker),
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-anchor": marker.shape === "pin" ? "bottom" : "center",
        }),
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
 * A stable name for a marker image.
 *
 * Derived from the symbology rather than from the layer, so two layers using the
 * same pin share one image, and so changing the glyph asks the renderer for a
 * different name instead of asking it to mutate an image it is already drawing.
 */
export function markerImageId(marker: Extract<Symbology, { kind: "marker" }>): string {
  const glyph = [...marker.glyph].map((c) => c.codePointAt(0)!.toString(16)).join("-");
  return `marker:${marker.shape}:${marker.color.replace("#", "")}:${Math.round(marker.size)}:${glyph}`;
}

/** Every marker image a project needs, so they can be registered before drawing. */
export function markersIn(project: MapProject): Extract<Symbology, { kind: "marker" }>[] {
  const out: Extract<Symbology, { kind: "marker" }>[] = [];
  const seen = new Set<string>();
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.type === "group") visit(node.children);
      else if (node.symbology.kind === "marker") {
        const marker = node.symbology;
        const id = markerImageId(marker);
        if (!seen.has(id)) {
          seen.add(id);
          out.push(marker);
        }
      }
    }
  };
  visit(project.tree);
  return out;
}
