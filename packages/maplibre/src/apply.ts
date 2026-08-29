import type { Op } from "@alidade/core";

import { toSpec, type Renderer } from "./renderer";

/** Operations in, engine calls out. One switch, no decisions. */
export function apply(renderer: Renderer, ops: Op[]): void {
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
        applyEnvironment(renderer, op.key, op.value);
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

function applyEnvironment(renderer: Renderer, key: string, value: unknown): void {
  switch (key) {
    case "terrain":
      renderer.setTerrain(value ?? null);
      break;
    case "fog":
      renderer.setFog?.(value ?? null);
      break;
    case "light":
      renderer.setLight?.(value ?? null);
      break;
    case "sky":
      // The project says yes or no; the engine wants a set of colours.
      renderer.setSky?.(value ? SKY : undefined);
      break;
    case "projection":
      // Ours is the name a GIS user says. MapLibre wants it wrapped.
      renderer.setProjection?.(value ? { type: value } : { type: "mercator" });
      break;
  }
}
