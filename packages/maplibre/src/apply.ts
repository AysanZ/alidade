import type { Op } from "@alidade/core";

import { toSpec, type Renderer } from "./renderer";

/** Told when the engine cannot do something, rather than swallowing it. */
export type Warn = (message: string) => void;

/** Operations in, engine calls out. One switch, no decisions. */
export function apply(renderer: Renderer, ops: Op[], warn?: Warn): void {
  for (const op of ops) {
    switch (op.t) {
      case "source.add":
        renderer.addSource(op.id, op.source);
        break;
      case "source.remove":
        renderer.removeSource(op.id);
        break;
      case "layer.add":
        renderer.addLayer(toSpec(op.spec), op.before);
        break;
      case "layer.remove":
        renderer.removeLayer(op.id);
        break;
      case "layer.move":
        renderer.moveLayer(op.id, op.before);
        break;
      case "layer.paint":
        renderer.setPaintProperty(op.id, op.key, op.value);
        break;
      case "layer.layout":
        renderer.setLayoutProperty(op.id, op.key, op.value);
        break;
      case "layer.filter":
        renderer.setFilter(op.id, op.value ?? null);
        break;
      case "layer.zoom":
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
}

/** A clear day at altitude. Only used when the project asks for a sky. */
const SKY = {
  "sky-color": "#0d1622",
  "horizon-color": "#2a3646",
  "fog-color": "#0a0a0b",
  "sky-horizon-blend": 0.6,
  "horizon-fog-blend": 0.6,
  "fog-ground-blend": 0.15,
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
