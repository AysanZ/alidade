import type { Slot, Source, View, Environment } from "./project";

/** What the renderer is asked to draw. Produced by the compiler, never authored. */
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
    | "fill-extrusion";
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
  | { t: "layer.add"; spec: EngineLayer; before?: string }
  | { t: "layer.remove"; id: string }
  | { t: "layer.move"; id: string; before?: string }
  | { t: "layer.paint"; id: string; key: string; value: unknown }
  | { t: "layer.layout"; id: string; key: string; value: unknown }
  | { t: "layer.filter"; id: string; value: unknown }
  | { t: "layer.zoom"; id: string; minzoom?: number; maxzoom?: number }
  | { t: "camera.set"; view: View }
  | { t: "env.set"; key: keyof Environment; value: unknown };
