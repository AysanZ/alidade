import { describe, expect, it } from "vitest";

import { formatCoordinate, parseCoordinate, scaleBar, toUtm } from "../src/format";

describe("coordinate readout", () => {
  it("writes decimal degrees with a hemisphere", () => {
    expect(formatCoordinate(51.389, 35.6892, "dd")).toBe("35.6892° N · 51.3890° E");
  });

  it("writes degrees, minutes and seconds", () => {
    expect(formatCoordinate(51.389, 35.6892, "dms")).toBe(
      "35° 41′ 21.1″ N · 51° 23′ 20.4″ E",
    );
  });

  it("puts Tehran in UTM zone 39N", () => {
    const { zone, band, easting, northing } = toUtm(51.389, 35.6892);
    expect(zone).toBe(39);
    expect(band).toBe("S");
    // East of the 51° central meridian, so past the 500 000 false easting.
    expect(easting).toBeGreaterThan(500000);
    expect(easting).toBeLessThan(560000);
    expect(northing).toBeGreaterThan(3900000);
    expect(northing).toBeLessThan(4000000);
  });

  it("keeps southern latitudes above the equator offset", () => {
    expect(toUtm(0, -30).northing).toBeGreaterThan(6000000);
  });
});

describe("scale bar", () => {
  it("picks a round distance and then a width", () => {
    // 10 metres a pixel over 120 pixels is 1 200 m, so the bar reads 1 km.
    const bar = scaleBar(10, 120);
    expect(bar.label).toBe("1 km");
    expect(bar.width).toBe(100);
  });

  it("uses 1, 2 and 5 rather than whatever fits exactly", () => {
    expect(scaleBar(2, 120).label).toBe("200 m");
    expect(scaleBar(0.4, 120).label).toBe("20 m");
    expect(scaleBar(45, 120).label).toBe("5 km");
  });

  it("never draws wider than it was allowed", () => {
    for (const mpp of [0.1, 1, 7.5, 90, 1500]) {
      expect(scaleBar(mpp, 140).width).toBeLessThanOrEqual(140);
    }
  });

  it("switches units on request", () => {
    expect(scaleBar(10, 120, "imperial").label).toMatch(/ft|mi/);
    expect(scaleBar(10, 120, "nautical").label).toContain("nm");
  });
});

describe("reading a coordinate someone typed", () => {
  it("takes decimal degrees, latitude first", () => {
    expect(parseCoordinate("35.6892, 51.389")).toEqual([51.389, 35.6892]);
  });

  it("does not mind spaces instead of a comma", () => {
    expect(parseCoordinate("35.6892 51.389")).toEqual([51.389, 35.6892]);
  });

  it("takes degrees, minutes and seconds", () => {
    const parsed = parseCoordinate("35° 41′ 21″ N, 51° 23′ 20″ E")!;
    expect(parsed[1]).toBeCloseTo(35.6892, 3);
    expect(parsed[0]).toBeCloseTo(51.3889, 3);
  });

  it("believes a hemisphere letter over the usual order", () => {
    expect(parseCoordinate("51.389 E, 35.6892 N")).toEqual([51.389, 35.6892]);
  });

  it("understands south and west as negative", () => {
    const parsed = parseCoordinate("33.87 S, 151.21 E")!;
    expect(parsed[1]).toBeCloseTo(-33.87, 4);
  });

  it("refuses a latitude that cannot exist", () => {
    expect(parseCoordinate("135.2, 51.3")).toBeNull();
    expect(parseCoordinate("nowhere")).toBeNull();
    expect(parseCoordinate("")).toBeNull();
  });
});
