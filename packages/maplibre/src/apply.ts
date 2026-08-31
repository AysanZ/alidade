import type { Op } from "@alidade/core";

import { toSpec, type Renderer } from "./renderer";

/** Told when the engine cannot do something, rather than swallowing it. */
export type Warn = (message: string) => void;

/**
 * Operations in, engine calls out.
 *
 * Every operation is run on its own. A batch used to be one `switch` inside one
 * loop, so a single failure — a source that was already there after a style
 * swap, a layer whose data had gone, a paint key the engine did not know — threw
 * out of the loop and silently dropped every remaining operation. The symptom
 * was importing a layer and watching nothing appear, with no error anywhere,
 * because the `layer.add` was the operation after the one that threw.
 */
export function apply(renderer: Renderer, ops: Op[], warn?: Warn): void {
  for (const op of ops) {
    try {
      run(renderer, op, warn);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warn?.(`${op.t}${"id" in op ? ` on ${op.id}` : ""} failed: ${detail}`);
      console.error("[alidade] operation failed", op, error);
    }
  }
}

function run(renderer: Renderer, op: Op, warn?: Warn): void {
  switch (op.t) {
    case "source.add":
      // Replaying against a style that was not as empty as expected is normal, so
      // adding a source that is already there updates it rather than throwing.
      if (renderer.getSource?.(op.id)) {
        if (op.source.type === "geojson") setData(renderer, op.id, op.source.data, warn);
        return;
      }
      renderer.addSource(op.id, op.source);
      break;
    case "source.data":
      setData(renderer, op.id, op.data, warn);
      break;
    case "source.remove":
      if (renderer.getSource && !renderer.getSource(op.id)) return;
      renderer.removeSource(op.id);
      break;
    case "layer.add":
      if (renderer.getLayer(op.spec.id)) renderer.removeLayer(op.spec.id);
      // A layer cannot be added under something that is not there yet. Falling
      // back to the top is wrong by one position; throwing loses the layer.
      renderer.addLayer(
        toSpec(op.spec),
        op.before && renderer.getLayer(op.before) ? op.before : undefined,
      );
      break;
    case "layer.remove":
      if (!renderer.getLayer(op.id)) return;
      renderer.removeLayer(op.id);
      break;
    case "layer.move":
      if (!renderer.getLayer(op.id)) return;
      renderer.moveLayer(op.id, op.before && renderer.getLayer(op.before) ? op.before : undefined);
      break;
    case "layer.paint":
      if (!renderer.getLayer(op.id)) return;
      renderer.setPaintProperty(op.id, op.key, op.value);
      break;
    case "layer.layout":
      if (!renderer.getLayer(op.id)) return;
      renderer.setLayoutProperty(op.id, op.key, op.value);
      break;
    case "layer.filter":
      if (!renderer.getLayer(op.id)) return;
      renderer.setFilter(op.id, op.value ?? null);
      break;
    case "layer.zoom":
      if (!renderer.getLayer(op.id)) return;
      renderer.setLayerZoomRange(op.id, op.minzoom ?? 0, op.maxzoom ?? 24);
      break;
    case "camera.set":
      renderer.jumpTo(op.view);
      break;
    case "env.set":
      applyEnvironment(renderer, op.key, op.value, warn);
      break;
  }
}

function setData(renderer: Renderer, id: string, data: unknown, warn?: Warn): void {
  const source = renderer.getSource?.(id) as { setData?: (d: unknown) => void } | undefined;
  if (!source?.setData) {
    warn?.(`Source ${id} cannot take new data in place.`);
    return;
  }
  source.setData(data);
}

/**
 * A clear day at altitude.
 *
 * `atmosphere-blend` is what draws the halo around a globe, faded out by the
 * zoom you stop being able to see one from. Without it the sky is on, the
 * projection is a sphere, and the sphere sits in a flat void looking like a bug
 * rather than a planet.
 */
const SKY = {
  "sky-color": "#0d1622",
  "horizon-color": "#2a3646",
  "fog-color": "#0a0a0b",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.6,
  "fog-ground-blend": 0.15,
  "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
};

function applyEnvironment(renderer: Renderer, key: string, value: unknown, warn?: Warn): void {
  /**
   * Optional methods were being called with `?.`, which meant an engine too old to
   * support globe or sky produced no error, no log and no globe. Say it out loud.
   */
  const call = (method: keyof Renderer, argument: unknown, needs: string) => {
    const fn = renderer[method];
    if (typeof fn !== "function") {
      warn?.(`This MapLibre build has no ${String(method)}, so ${needs} cannot be applied.`);
      return;
    }
    (fn as (a: unknown) => void).call(renderer, argument);
  };

  switch (key) {
    case "terrain":
      renderer.setTerrain(value ?? null);
      break;
    case "fog":
      call("setFog", value ?? null, "fog");
      break;
    case "light":
      call("setLight", value ?? null, "scene lighting");
      break;
    case "sky":
      // The project says yes or no; the engine wants a set of colours.
      call("setSky", value ? SKY : undefined, "the sky");
      break;
    case "projection":
      // Ours is the name a GIS user says. MapLibre wants it wrapped.
      call("setProjection", { type: value || "mercator" }, "the projection");
      break;
  }
}
