import type { EngineLayer, Light, Model3D } from "@alidade/core";

/** The slice of MapLibre this adapter uses. Declared so a test can pass a recorder. */
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
  /** Optional for older fakes. Without it the adapter cannot check an op would work. */
  getSource?(id: string): unknown;
}

/**
 * Draws the 3D models. Behind an interface so three.js stays a dependency of the
 * one package that needs it and this one stays testable in Node.
 */
export interface ModelHost {
  /** Built fresh each time: the engine calls `onAdd` on the object it was given. */
  layer(id: string): Record<string, unknown>;
  add(model: Model3D): void;
  update(model: Model3D): void;
  remove(id: string): void;
  /** The scene is lit the way the map is. Optional so a recorder need not care. */
  light?(light: Light | null): void;
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
