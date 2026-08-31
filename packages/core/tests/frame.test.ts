import { describe, expect, it } from "vitest";

import {
  frameExtent,
  isDegenerate,
  spansMostOfTheWorld,
  viewForExtent,
  withMinimumSize,
} from "../src/frame";

const screen = { width: 1200, height: 800 };

/**
 * Natural Earth's 110m populated places, near enough. A worldwide point layer is
 * what broke this: `fitBounds` frames on the mercator y axis, so the centre of a
 * box from 41° south to 78° north lands well north of the middle of the data, and
 * a sphere then draws half of itself off the screen.
 */
const world = { west: -175.22, south: -41.3, east: 179.22, north: 78.22 };

describe("framing a worldwide extent on a globe", () => {
  it("centres on the middle of the data, not the middle of the mercator height", () => {
    const round = frameExtent(world, screen, { projection: "vertical-perspective" });
    const flat = frameExtent(world, screen, { projection: "mercator" });

    expect(round.center[1]).toBeCloseTo((world.south + world.north) / 2, 3);
    // Mercator stretches the north, so its centre sits well above the sphere's.
    expect(flat.center[1]).toBeGreaterThan(round.center[1] + 5);
  });

  it("stays at a zoom where a sphere is still a sphere", () => {
    const round = frameExtent(world, screen, { projection: "globe" });
    expect(round.zoom).toBeLessThanOrEqual(5.5);
    expect(round.zoom).toBeGreaterThanOrEqual(0);
  });

  it("levels a tilted camera, because a tilted one cannot frame the world", () => {
    const view = viewForExtent(world, screen, {
      center: [0, 0],
      zoom: 12,
      pitch: 58,
      bearing: -28,
    });
    expect(view.pitch).toBe(0);
    expect(view.bearing).toBe(0);
  });

  it("leaves pitch and bearing alone for an ordinary extent", () => {
    const view = viewForExtent({ west: 51.2, south: 35.6, east: 51.6, north: 35.83 }, screen, {
      center: [0, 0],
      zoom: 12,
      pitch: 58,
      bearing: -28,
    });
    expect(view.pitch).toBe(58);
    expect(view.bearing).toBe(-28);
  });
});

describe("framing an extent that reaches the poles", () => {
  it("produces a finite centre and zoom rather than nonsense", () => {
    const polar = frameExtent({ west: -180, south: -90, east: 180, north: 90 }, screen);
    expect(Number.isFinite(polar.center[0])).toBe(true);
    expect(Number.isFinite(polar.center[1])).toBe(true);
    expect(Number.isFinite(polar.zoom)).toBe(true);
    expect(Math.abs(polar.center[1])).toBeLessThan(1);
  });
});

describe("framing an ordinary extent", () => {
  it("puts the centre in the middle and picks a zoom that fits", () => {
    const tehran = { west: 51.2, south: 35.6, east: 51.6, north: 35.83 };
    const frame = frameExtent(tehran, screen, { projection: "mercator" });
    expect(frame.center[0]).toBeCloseTo(51.4, 3);
    expect(frame.center[1]).toBeCloseTo(35.715, 1);
    expect(frame.zoom).toBeGreaterThan(9);
    expect(frame.zoom).toBeLessThan(12);
  });

  it("does not zoom past the cap for a single point", () => {
    const point = withMinimumSize({ west: 51.4, south: 35.7, east: 51.4, north: 35.7 });
    expect(frameExtent(point, screen, { maxZoom: 14 }).zoom).toBeLessThanOrEqual(14);
  });

  it("frames an extent that crosses the antimeridian without spanning the planet", () => {
    // Fiji: west of the line to east of it, which arrives as east < west.
    const frame = frameExtent({ west: 177, south: -19, east: -178, north: -16 }, screen);
    expect(frame.center[0]).toBeCloseTo(179.5, 1);
    expect(frame.zoom).toBeGreaterThan(4);
  });

  it("zooms further in on a narrow screen than a wide one for a tall extent", () => {
    const tall = { west: 0, south: 0, east: 1, north: 20 };
    const wide = frameExtent(tall, { width: 1600, height: 400 });
    const narrow = frameExtent(tall, { width: 400, height: 1600 });
    expect(narrow.zoom).toBeGreaterThan(wide.zoom);
  });
});

describe("extents that cannot be framed", () => {
  it("recognises a point as having no size", () => {
    expect(isDegenerate({ west: 1, south: 2, east: 1, north: 2 })).toBe(true);
    expect(isDegenerate({ west: 1, south: 2, east: 3, north: 4 })).toBe(false);
  });

  it("recognises a missing number", () => {
    expect(isDegenerate({ west: NaN, south: 2, east: 3, north: 4 })).toBe(true);
  });

  it("grows a point into something with an area", () => {
    const grown = withMinimumSize({ west: 51.4, south: 35.7, east: 51.4, north: 35.7 }, 0.02);
    expect(grown.east - grown.west).toBeCloseTo(0.02, 6);
    expect(grown.north - grown.south).toBeCloseTo(0.02, 6);
  });

  it("leaves an extent that is already big enough alone", () => {
    const already = { west: 0, south: 0, east: 5, north: 5 };
    expect(withMinimumSize(already)).toEqual(already);
  });
});

describe("spansMostOfTheWorld", () => {
  it("is true for a worldwide layer and false for a city", () => {
    expect(spansMostOfTheWorld(world)).toBe(true);
    expect(spansMostOfTheWorld({ west: 51.2, south: 35.6, east: 51.6, north: 35.83 })).toBe(false);
  });
});
