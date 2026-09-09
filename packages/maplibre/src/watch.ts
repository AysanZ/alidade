import type { MapManager } from "./manager";
import type { Renderer } from "./renderer";

interface Watchable extends Renderer {
  on(event: "styledata", handler: () => void): void;
  off(event: "styledata", handler: () => void): void;
}

/**
 * Replay the project when the style is swapped underneath us. Handled once here
 * rather than worked around in every feature that adds a layer.
 */
export function watchStyleSwaps(map: Watchable, manager: MapManager): () => void {
  const sentinel = "basemap:background";
  const handler = () => {
    if (!map.getLayer(sentinel)) manager.replay();
  };
  map.on("styledata", handler);
  return () => map.off("styledata", handler);
}
