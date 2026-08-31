import type { EngineLayer } from "@alidade/core";

/**
 * The slice of the MapLibre map this adapter uses. Declaring it means the tests can
 * pass a recorder instead of a real map, and the core never needs a browser.
 */
export interface Renderer {
  addSource(id: string, source: unknown): void;
  removeSource(id: string): void;
  addLayer(spec: Record<string, unknown>, before?: string): void;
  removeLayer(id: string): void;
  moveLayer(id: string, before?: string): void;
  setPaintProperty(id: string, key: string, value: unknown): void;
  setLayoutProperty(id: string, key: string, value: unknown): void;
  setFilter(id: string, value: unknown): void;
  setLayerZoomRange(id: string, minzoom: number, maxzoom: number): void;
  jumpTo(view: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  }): void;
  setTerrain(value: unknown): void;
  setFog?(value: unknown): void;
  setLight?(value: unknown): void;
  setSky?(value: unknown): void;
  setProjection?(value: unknown): void;
  getLayer(id: string): unknown;
  /**
   * Optional so an old fake in a test still satisfies the interface, but every
   * real engine has it, and without it the adapter cannot tell an operation that
   * would fail from one that would work.
   */
  getSource?(id: string): unknown;
}

/** An engine layer as MapLibre wants it. `slot` is ours and stays behind. */
export function toSpec(layer: EngineLayer): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    id: layer.id,
    type: layer.type,
    paint: layer.paint,
    layout: layer.layout,
  };
  if (layer.source) spec["source"] = layer.source;
  if (layer.sourceLayer) spec["source-layer"] = layer.sourceLayer;
  if (layer.filter !== undefined) spec["filter"] = layer.filter;
  if (layer.minzoom !== undefined) spec["minzoom"] = layer.minzoom;
  if (layer.maxzoom !== undefined) spec["maxzoom"] = layer.maxzoom;
  return spec;
}
