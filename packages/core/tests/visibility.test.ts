import { describe, expect, it } from "vitest";

import { denominatorInRange, hiddenBecause } from "../src/visibility";
import type { LayerNode } from "../src/types/project";

const layer = (over: Partial<LayerNode> = {}): LayerNode => ({
  type: "layer",
  id: "density",
  name: "Population density",
  slot: "data",
  source: "wards",
  geometry: "polygon",
  visible: true,
  opacity: 1,
  scale: { minDenominator: 2000, maxDenominator: 2000000 },
  symbology: { kind: "single", color: "#4c8dff" },
  ...over,
});

describe("why a layer is not drawn", () => {
  it("says nothing is wrong when it is in range and ticked", () => {
    expect(hiddenBecause(layer(), 25000)).toBe("no");
  });

  it("blames the tick before it blames the scale", () => {
    expect(hiddenBecause(layer({ visible: false }), 160_000_000)).toBe("layer");
  });

  it("names the scale when the map is too far out", () => {
    // What a world view does to a layer meant for 1:2 000 000 and closer.
    expect(hiddenBecause(layer(), 160_000_000)).toBe("scale");
  });

  it("names the scale when the map is too far in", () => {
    expect(hiddenBecause(layer(), 500)).toBe("scale");
  });

  it("has no opinion about a layer without a scale range", () => {
    expect(hiddenBecause(layer({ scale: undefined }), 160_000_000)).toBe("no");
  });

  it("suggests a scale the layer would actually appear at", () => {
    const target = denominatorInRange(layer(), 160_000_000);
    expect(hiddenBecause(layer(), target)).toBe("no");
    expect(denominatorInRange(layer(), 500)).toBeGreaterThan(2000);
  });
});
