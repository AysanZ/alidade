import { describe, expect, it } from "vitest";

import {
  bearing,
  distance,
  formatArea,
  formatBearing,
  formatDistance,
  pathLength,
  ringArea,
  ringPerimeter,
} from "../src/measure";

describe("distance", () => {
  it("measures a degree of latitude as about 111 km", () => {
    expect(distance([0, 0], [0, 1])).toBeCloseTo(111195, -2);
  });

  it("shortens a degree of longitude by the cosine of the latitude", () => {
    const equator = distance([0, 0], [1, 0]);
    const tehran = distance([51, 35.7], [52, 35.7]);
    expect(tehran / equator).toBeCloseTo(Math.cos((35.7 * Math.PI) / 180), 3);
  });

  it("is zero between a position and itself", () => {
    expect(distance([51.4, 35.7], [51.4, 35.7])).toBe(0);
  });

  it("adds up along a path", () => {
    const path: [number, number][] = [
      [0, 0],
      [0, 1],
      [0, 2],
    ];
    expect(pathLength(path)).toBeCloseTo(2 * distance([0, 0], [0, 1]), 3);
  });
});

describe("bearing", () => {
  it("reads due north as zero", () => {
    expect(bearing([0, 0], [0, 10])).toBeCloseTo(0, 6);
  });

  it("reads due east as ninety", () => {
    expect(bearing([0, 0], [10, 0])).toBeCloseTo(90, 6);
  });

  it("names the compass point", () => {
    expect(formatBearing(0)).toBe("0° N");
    expect(formatBearing(90)).toBe("90° E");
    expect(formatBearing(225)).toBe("225° SW");
  });
});

describe("ringArea", () => {
  it("measures a one degree box at the equator as about 12 300 square km", () => {
    const box: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(ringArea(box) / 1e6).toBeGreaterThan(12000);
    expect(ringArea(box) / 1e6).toBeLessThan(12400);
  });

  it("does not care which way the ring is wound", () => {
    const clockwise: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];
    const anticlockwise = [...clockwise].reverse();
    expect(ringArea(clockwise)).toBeCloseTo(ringArea(anticlockwise), 6);
  });

  it("accepts a ring that is already closed", () => {
    const open: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(ringArea([...open, open[0]!])).toBeCloseTo(ringArea(open), 6);
  });

  it("is zero for a degenerate ring", () => {
    expect(ringArea([[0, 0]])).toBe(0);
  });

  it("closes the ring when measuring a perimeter", () => {
    const triangle: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    expect(ringPerimeter(triangle)).toBeGreaterThan(pathLength(triangle));
  });
});

describe("formatting", () => {
  it("switches from metres to kilometres at a thousand", () => {
    expect(formatDistance(940)).toBe("940 m");
    expect(formatDistance(1500)).toBe("1.5 km");
  });

  it("uses hectares between ten thousand and a million square metres", () => {
    expect(formatArea(500)).toBe("500 m²");
    expect(formatArea(50000)).toBe("5 ha");
    expect(formatArea(5e6)).toBe("5 km²");
  });

  it("reports nautical miles without a second unit", () => {
    expect(formatDistance(1852, "nautical")).toBe("1 nm");
  });
});
