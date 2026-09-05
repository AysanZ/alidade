import type { Slot, Source, View, Environment, Model3D } from "./project";

/**
 * What the renderer is asked to draw. Produced by the compiler, never authored.
 *
 * `custom` is a layer the engine does not know how to draw and hands to code
 * of ours at render time. It has a place in the order like any other layer,
 * which is the whole reason it is a layer: the 3D scene has to be under the
 * labels and over the buildings, and that is a question of order.
 */
export interface EngineLayer {
  id: string;
  type:
    | "background"
    | "fill"
    | "line"
    | "symbol"
    | "circle"
    | "raster"
    | "hillshade"
    | "fill-extrusion"
    | "custom";
  source?: string;
  sourceLayer?: string;
  slot: Slot;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
  filter?: unknown;
  minzoom?: number;
  maxzoom?: number;
}

/**
 * One reconciler instruction. Data, not a function call, which is what lets the
 * core be tested in Node and lets a bug report be a JSON file that replays.
 *
 * A `null` value on a paint or layout op means reset to the renderer default.
 */
export type Op =
  | { t: "source.add"; id: string; source: Source }
  | { t: "source.remove"; id: string }
  /**
   * New data for a geojson source that is otherwise unchanged. Without this a
   * moving graticule or grid would remove and re-add its source on every pan,
   * which takes every layer reading it down with it.
   */
  | { t: "source.data"; id: string; data: unknown }
  | { t: "layer.add"; spec: EngineLayer; before?: string }
  | { t: "layer.remove"; id: string }
  | { t: "layer.move"; id: string; before?: string }
  | { t: "layer.paint"; id: string; key: string; value: unknown }
  | { t: "layer.layout"; id: string; key: string; value: unknown }
  | { t: "layer.filter"; id: string; value: unknown }
  | { t: "layer.zoom"; id: string; minzoom?: number; maxzoom?: number }
  | { t: "camera.set"; view: View }
  | { t: "env.set"; key: keyof Environment; value: unknown }
  /*
   * A model is content for the custom layer rather than a layer of its own, so
   * it has its own operations: the layer goes up and down with the draw order,
   * and these say what is in it. `model.update` carries the whole model rather
   * than a key and a value because a placement is one thing — a position moved
   * and a heading turned in the same edit should be one frame, not two.
   */
  | { t: "model.add"; model: Model3D }
  | { t: "model.update"; model: Model3D }
  | { t: "model.remove"; id: string };
