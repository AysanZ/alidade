import { describe, expect, it } from "vitest";

import { CIVIL_TWILIGHT, lightFromSun, sunPosition, sunTimes } from "../src/sun";

/**
 * Checked against the sky rather than against a stored answer.
 *
 * A table of expected numbers taken from the implementation is a test that the
 * code still does what it did, which is worth something and is not what is
 * wanted here: it would have passed just as happily with east and west swapped.
 * These assert facts about the solar system that were true before anyone wrote
 * this file — noon altitude at the equinox, day length at the poles, the
 * symmetry of the day about noon — so a sign error has nowhere to hide.
 *
 * Tolerances are stated per test. The equations are good to well under a minute
 * of arc; the slack is for the difference between the exact instant of an
 * equinox and midnight on the day it falls, which is up to a day of the sun's
 * motion in declination, about 0.4°.
 */

const at = (iso: string) => Date.parse(iso);

/** Solar noon on a given UTC day, which is not twelve o'clock. */
const noon = (iso: string, lon: number, lat: number) => {
  const { solarNoon } = sunTimes(at(iso), lon, lat);
  return sunPosition(solarNoon, lon, lat);
};

describe("sun position", () => {
  it("at the equinox stands as far from overhead as you are from the equator", () => {
    // The defining property of an equinox: the sun is over the equator, so noon
    // altitude is the complement of the latitude, north or south.
    for (const lat of [-45, -23.44, 0, 35.7, 51.5, 64]) {
      const { altitude } = noon("2025-03-20T12:00:00Z", 0, lat);
      expect(altitude, `lat ${lat}`).toBeCloseTo(90 - Math.abs(lat), 0);
    }
  });

  it("at the June solstice stands over the tropic of Cancer", () => {
    /*
     * Noon altitude is 90 less the angle between you and whatever the sun is
     * over, which in June is 23.44°N. Written as `90 - lat + 23.44` it is only
     * right for places north of the tropic: at the equator that would ask for
     * an altitude of 113°, and nothing is ever more than 90° above the horizon.
     */
    for (const lat of [0, 23.44, 35.7, 51.5]) {
      const { altitude } = noon("2025-06-21T12:00:00Z", 0, lat);
      expect(altitude, `lat ${lat}`).toBeCloseTo(90 - Math.abs(lat - 23.44), 0);
    }
  });

  it("is due south at noon from the north and due north from the south", () => {
    expect(noon("2025-03-20T12:00:00Z", 0, 51.5).azimuth).toBeCloseTo(180, 0);
    const southern = noon("2025-03-20T12:00:00Z", 0, -33.9).azimuth;
    // 0 and 360 are the same bearing, and either is due north.
    expect(Math.min(southern, 360 - southern)).toBeCloseTo(0, 0);
  });

  it("rises in the east and sets in the west", () => {
    const lon = 51.39;
    const lat = 35.69;
    const { sunrise, sunset } = sunTimes(at("2025-06-21T00:00:00Z"), lon, lat);
    // An hour after rising and an hour before setting, so the horizon's
    // ambiguity is well behind us.
    const morning = sunPosition(sunrise! + 3_600_000, lon, lat).azimuth;
    const evening = sunPosition(sunset! - 3_600_000, lon, lat).azimuth;
    expect(morning).toBeLessThan(180);
    expect(evening).toBeGreaterThan(180);
  });

  it("is very nearly symmetric about solar noon", () => {
    const lon = 13.4;
    const lat = 52.5;
    const { solarNoon } = sunTimes(at("2025-08-10T00:00:00Z"), lon, lat);
    for (const hours of [1, 3, 5]) {
      const before = sunPosition(solarNoon - hours * 3_600_000, lon, lat);
      const after = sunPosition(solarNoon + hours * 3_600_000, lon, lat);
      /*
       * Nearly, not exactly: the sun's declination moves while the day passes,
       * so the afternoon is not a mirror of the morning but a tenth of a degree
       * off it. Asserting equality here would be asserting a flat earth's
       * worth of astronomy.
       */
      expect(Math.abs(before.altitude - after.altitude), `${hours}h`).toBeLessThan(0.15);
      // Mirrored about south: the two bearings sum to 360.
      expect(before.azimuth + after.azimuth, `${hours}h`).toBeCloseTo(360, 0);
    }
  });

  it("never puts the sun more than about seventeen minutes off the clock", () => {
    // The equation of time is bounded by the shape of the orbit and the tilt.
    for (let day = 0; day < 365; day += 7) {
      const t = at("2025-01-01T12:00:00Z") + day * 86_400_000;
      expect(Math.abs(sunPosition(t, 0, 0).equationOfTime), `day ${day}`).toBeLessThan(17);
    }
  });

  it("has the sun ahead of the clock in November and behind it in February", () => {
    // The two extremes of the analemma, about +16 and about -14 minutes.
    expect(sunPosition(at("2025-11-03T12:00:00Z"), 0, 0).equationOfTime).toBeCloseTo(16.4, 0);
    expect(sunPosition(at("2025-02-11T12:00:00Z"), 0, 0).equationOfTime).toBeCloseTo(-14.2, 0);
  });

  it("keeps the declination inside the tilt of the earth", () => {
    for (let day = 0; day < 365; day += 5) {
      const { declination } = sunPosition(at("2025-01-01T00:00:00Z") + day * 86_400_000, 0, 0);
      expect(Math.abs(declination), `day ${day}`).toBeLessThanOrEqual(23.45);
    }
  });
});

describe("sunrise and sunset", () => {
  it("splits the equinox into two equal halves, wherever you stand", () => {
    for (const lat of [-40, 0, 40, 55]) {
      const { sunrise, sunset } = sunTimes(at("2025-09-22T00:00:00Z"), 0, lat);
      const hours = (sunset! - sunrise!) / 3_600_000;
      // A little over twelve: the sun is called risen when its upper limb
      // shows, and the atmosphere lifts the image by another half a degree.
      expect(hours, `lat ${lat}`).toBeGreaterThan(12);
      expect(hours, `lat ${lat}`).toBeLessThan(12.4);
    }
  });

  it("gives a longer day in the north in June and a shorter one in December", () => {
    const length = (iso: string) => {
      const { sunrise, sunset } = sunTimes(at(iso), 0, 51.5);
      return (sunset! - sunrise!) / 3_600_000;
    };
    expect(length("2025-06-21T00:00:00Z")).toBeGreaterThan(16);
    expect(length("2025-12-21T00:00:00Z")).toBeLessThan(8.5);
  });

  it("reports a day with no sunset inside the arctic circle in June", () => {
    const times = sunTimes(at("2025-06-21T00:00:00Z"), 18.95, 69.65);
    expect(times.alwaysUp).toBe(true);
    expect(times.sunrise).toBeUndefined();
  });

  it("reports a day with no sunrise there in December", () => {
    const times = sunTimes(at("2025-12-21T00:00:00Z"), 18.95, 69.65);
    expect(times.alwaysDown).toBe(true);
    expect(times.sunset).toBeUndefined();
  });

  it("puts solar noon at the moment the sun is highest", () => {
    const lon = -0.13;
    const lat = 51.5;
    const { solarNoon } = sunTimes(at("2025-05-05T00:00:00Z"), lon, lat);
    const peak = sunPosition(solarNoon, lon, lat).altitude;
    for (const offset of [-20, -5, 5, 20]) {
      expect(sunPosition(solarNoon + offset * 60_000, lon, lat).altitude).toBeLessThanOrEqual(peak);
    }
  });
});

describe("the light the sun makes", () => {
  it("turns the altitude into an angle off the vertical", () => {
    const light = lightFromSun({ altitude: 30, azimuth: 143, equationOfTime: 0, declination: 0 });
    expect(light.position![1]).toBe(143);
    expect(light.position![2]).toBe(60);
  });

  it("goes dim and blue once the sun is well down", () => {
    const night = lightFromSun({
      altitude: CIVIL_TWILIGHT - 1,
      azimuth: 300,
      equationOfTime: 0,
      declination: 0,
    });
    expect(night.intensity).toBeLessThan(0.25);
  });

  it("is warmer near the horizon than overhead", () => {
    const low = lightFromSun({ altitude: 2, azimuth: 100, equationOfTime: 0, declination: 0 });
    const high = lightFromSun({ altitude: 60, azimuth: 180, equationOfTime: 0, declination: 0 });
    const red = (c: string) => parseInt(c.slice(1, 3), 16) - parseInt(c.slice(5, 7), 16);
    // Warm means more red than blue; white means none.
    expect(red(low.color)).toBeGreaterThan(red(high.color));
    expect(high.color).toBe("#ffffff");
    expect(low.intensity).toBeLessThan(high.intensity);
  });
});
