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
  const bySlot = new Map<Slot, EngineLayer[]>();
  for (const slot of SLOT_ORDER) bySlot.set(slot, []);

  // The basemap owns the bottom of the base slot and nothing else.
  bySlot.get("base")!.push({
    id: "basemap:background",
    type: "background",
    slot: "base",
    paint: { "background-color": project.basemap.background },
    layout: {},
  });

  const lat = project.view.center[1];

  for (const entry of flatten(project.tree)) {
    for (const engine of engineLayersFor(entry, lat)) {
      bySlot.get(entry.layer.slot)!.push(engine);
    }
  }

  // Within a slot the top of the table of contents draws on top, so the engine
  // order is the reverse. Slots are applied before tree order, always.
  const layers: EngineLayer[] = [];
  for (const slot of SLOT_ORDER) {
    const inSlot = bySlot.get(slot)!;
    const head = slot === "base" ? inSlot.slice(0, 1) : [];
    const rest = slot === "base" ? inSlot.slice(1) : inSlot;
    layers.push(...head, ...groupsReversed(rest));
  }

  return { sources: project.sources, layers };
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
