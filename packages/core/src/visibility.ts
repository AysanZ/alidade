import type { LayerNode } from "./types/project";

export type Hidden = "no" | "layer" | "scale";

/**
 * Why a layer is not on the screen.
 *
 * Scale-dependent visibility is the single most confusing feature in a GIS for
 * anyone who did not set it: the layer is ticked, the data is loaded, and nothing
 * is drawn. The interface has to be able to say which of the two reasons applies.
 */
export function hiddenBecause(layer: LayerNode, denominator: number): Hidden {
  if (!layer.visible) return "layer";
  if (!layer.scale) return "no";
  const { minDenominator, maxDenominator } = layer.scale;
  return denominator >= minDenominator && denominator <= maxDenominator ? "no" : "scale";
}

/** A scale inside the layer's range, for a button that takes the user there. */
export function denominatorInRange(layer: LayerNode, denominator: number): number {
  if (!layer.scale) return denominator;
  const { minDenominator, maxDenominator } = layer.scale;
  if (denominator > maxDenominator) return maxDenominator * 0.9;
  if (denominator < minDenominator) return minDenominator * 1.1;
  return denominator;
}
