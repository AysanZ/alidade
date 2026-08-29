import type { MapManager } from "./manager";
import type { Renderer } from "./renderer";

interface Watchable extends Renderer {
  on(event: "styledata", handler: () => void): void;
  off(event: "styledata", handler: () => void): void;
}

/**
 * Watch for the style being swapped underneath us and replay the project.
 *
 * This is the single most common complaint from MapLibre users, so it is handled
 * once here rather than worked around in every feature that adds a layer.
 */
export function watchStyleSwaps(map: Watchable, manager: MapManager): () => void {
  const sentinel = "basemap:background";
  const handler = () => {
    if (!map.getLayer(sentinel)) manager.replay();
  };
  map.on("styledata", handler);
  return () => map.off("styledata", handler);
}
