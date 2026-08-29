import type { EngineLayer } from "./types/ops";
import type {
  GroupNode,
  LayerNode,
  MapProject,
  Slot,
  Source,
  TreeNode,
} from "./types/project";
import { SLOT_ORDER } from "./types/project";
import { toExpression } from "./filter";
import { graticuleGeoJSON, graticuleSourceId } from "./graticule";
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
function flatten(nodes: TreeNode[], opacity = 1, visible = true): Flat[] {
  const out: Flat[] = [];
  for (const node of nodes) {
    if (node.type === "group") {
      const g = node as GroupNode;
      out.push(...flatten(g.children, opacity * g.opacity, visible && g.visible));
    } else {
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
      paint: { "raster-opacity": 1 },
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

  // Within a slot the top of the table of contents draws on top, so the engine
  // order is the reverse. Slots are applied before tree order, always.
  const layers: EngineLayer[] = [];
  for (const slot of SLOT_ORDER) {
    if (slot === "base") layers.push(...systemBase);
    if (slot === "labels") layers.push(...systemLabels);
    layers.push(...groupsReversed(bySlot.get(slot)!));
  }

  return { sources, layers };
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
