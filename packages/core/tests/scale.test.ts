import { describe, expect, it } from "vitest";

import { denominatorAt, zoomForDenominator, zoomRange } from "../src/scale";

describe("scale", () => {
  it("round trips a denominator through a zoom level", () => {
    const z = zoomForDenominator(25000, 38.56);
    expect(denominatorAt(z, 38.56)).toBeCloseTo(25000, 3);
  });

  it("knows that zoom depends on latitude", () => {
    expect(denominatorAt(12, 0)).toBeGreaterThan(denominatorAt(12, 60));
  });

  it("inverts a scale range into a zoom range", () => {
    const { minzoom, maxzoom } = zoomRange(
      { minDenominator: 2000, maxDenominator: 250000 },
      38.56,
    );
    expect(minzoom).toBeLessThan(maxzoom);
    // The zoom range is rounded to two decimals, so allow a fraction of a percent.
    const back = denominatorAt(minzoom, 38.56);
    expect(Math.abs(back - 250000) / 250000).toBeLessThan(0.01);
  });
});
