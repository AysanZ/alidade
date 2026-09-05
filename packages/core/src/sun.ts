/**
 * Where the sun is, for a place and an instant.
 *
 * A 3D map lit from a fixed angle is a picture of a city. A 3D map lit from
 * where the sun actually was at half past three on the fourteenth of March is
 * an instrument: it answers which windows see the sun, how far a tower's shadow
 * reaches down the street, and whether the courtyard is in shade at lunchtime.
 * That is the difference between an extrusion and a shadow study, and the only
 * thing standing between them is this arithmetic.
 *
 * The equations are NOAA's, which are Meeus' abridged to the accuracy that
 * matters here: better than a minute of arc for dates within a few centuries of
 * now, which is far finer than the metre-scale uncertainty in the building
 * heights it will be used against. Refraction near the horizon is not modelled
 * except in the standard 0.833° allowance in the rise and set times, so an
 * altitude within a degree of zero should be read as "about sunrise" rather
 * than as a number.
 *
 * Everything here is pure: no Date.now, no timezone database, no renderer. The
 * instant arrives as a UTC millisecond count and the answers come back in
 * degrees, which is what makes the whole thing testable against the sky.
 */

import type { Light } from "./types/project";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;

/** Where the sun is in the observer's sky. */
export interface SunPosition {
  /** Degrees above the horizon. Negative when the sun has set. */
  altitude: number;
  /** Degrees clockwise from north: 90 is due east, 180 due south. */
  azimuth: number;
  /**
   * Minutes the sun is ahead of the clock, from the earth's tilt and the
   * eccentricity of its orbit. Solar noon is rarely twelve o'clock.
   */
  equationOfTime: number;
  /** Degrees north of the celestial equator. Between about ±23.44. */
  declination: number;
}

/** The day's turning points, as UTC milliseconds. */
export interface SunTimes {
  /**
   * Absent when the sun does not cross the horizon that day, which is a real
   * answer and not a failure: inside the polar circles it happens every year.
   */
  sunrise?: number;
  sunset?: number;
  /** When the sun is due south, which is what noon means. Always defined. */
  solarNoon: number;
  /** True when the sun is up for the whole day, false when it is down for it. */
  alwaysUp: boolean;
  alwaysDown: boolean;
}

/** Julian day, counted from noon on 1 January 4713 BC, as astronomy does. */
export function julianDay(utcMillis: number): number {
  return utcMillis / MS_PER_DAY + 2440587.5;
}

/** Julian centuries since J2000.0, which is what the series are written in. */
function centuries(utcMillis: number): number {
  return (julianDay(utcMillis) - 2451545) / 36525;
}

interface Solar {
  declination: number;
  equationOfTime: number;
}

/**
 * The sun's declination and the equation of time, which depend on the instant
 * and not on where the observer is standing.
 */
function solar(t: number): Solar {
  const meanLongitude = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const centre =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;

  const trueLongitude = meanLongitude + centre;
  // The apparent longitude accounts for nutation and aberration.
  const omega = 125.04 - 1934.136 * t;
  const apparent = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

  const declination =
    Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparent * RAD)) * DEG;

  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * meanLongitude * RAD) -
      2 * eccentricity * Math.sin(meanAnomaly * RAD) +
      4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD) -
      0.5 * y * y * Math.sin(4 * meanLongitude * RAD) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD));

  return { declination, equationOfTime };
}

/**
 * The sun's position over a place at an instant.
 *
 * @param utcMillis The instant, as `Date.getTime()`.
 * @param longitude Degrees east.
 * @param latitude Degrees north.
 */
export function sunPosition(utcMillis: number, longitude: number, latitude: number): SunPosition {
  const t = centuries(utcMillis);
  const { declination, equationOfTime } = solar(t);

  /*
   * The hour angle is how far the earth has turned past the observer's noon:
   * zero when the sun is due south, fifteen degrees per hour either side. The
   * longitude term is what makes this a local answer rather than a Greenwich
   * one, and the equation of time is what makes it solar rather than clock.
   */
  const minutesUtc = ((utcMillis % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / 60_000;
  const trueSolarMinutes = minutesUtc + equationOfTime + 4 * longitude;
  const hourAngle = trueSolarMinutes / 4 - 180;

  const lat = latitude * RAD;
  const dec = declination * RAD;
  const ha = hourAngle * RAD;

  const cosZenith =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const zenith = Math.acos(clamp(cosZenith, -1, 1));
  const altitude = 90 - zenith * DEG;

  /*
   * Azimuth from the spherical cosine rule, then folded into a bearing. The
   * two branches are the morning and the afternoon: the cosine cannot tell
   * east from west on its own, and a sun that rises in the west is the classic
   * symptom of dropping this.
   */
  const sinZenith = Math.sin(zenith);
  let azimuth: number;
  if (Math.abs(sinZenith) < 1e-9 || Math.abs(Math.cos(lat)) < 1e-9) {
    // Directly overhead, or standing on a pole, where a bearing means nothing.
    azimuth = hourAngle > 0 ? 270 : 90;
  } else {
    const cosAzimuth = clamp(
      (Math.sin(lat) * cosZenith - Math.sin(dec)) / (Math.cos(lat) * sinZenith),
      -1,
      1,
    );
    const base = Math.acos(cosAzimuth) * DEG;
    azimuth = hourAngle > 0 ? mod360(base + 180) : mod360(540 - base);
  }

  return { altitude, azimuth, equationOfTime, declination };
}

/**
 * Sunrise, sunset and solar noon for the UTC day an instant falls in.
 *
 * The 0.833° below the horizon is the usual allowance: about 0.567° for the
 * bending of light through the atmosphere and about 0.266° for the fact that
 * sunrise means the first limb of the disc, not its centre.
 */
export function sunTimes(utcMillis: number, longitude: number, latitude: number): SunTimes {
  const startOfDay = Math.floor(utcMillis / MS_PER_DAY) * MS_PER_DAY;
  // Evaluated at the middle of the day: declination moves slowly enough that
  // one evaluation carries the whole day at this accuracy.
  const { declination, equationOfTime } = solar(centuries(startOfDay + MS_PER_DAY / 2));

  const noonMinutes = 720 - 4 * longitude - equationOfTime;
  const solarNoon = startOfDay + noonMinutes * 60_000;

  const lat = latitude * RAD;
  const dec = declination * RAD;
  const cosHourAngle =
    Math.cos(90.833 * RAD) / (Math.cos(lat) * Math.cos(dec)) - Math.tan(lat) * Math.tan(dec);

  if (cosHourAngle > 1) return { solarNoon, alwaysUp: false, alwaysDown: true };
  if (cosHourAngle < -1) return { solarNoon, alwaysUp: true, alwaysDown: false };

  const halfDayMinutes = (Math.acos(cosHourAngle) * DEG) / 15 * 60;
  return {
    sunrise: solarNoon - halfDayMinutes * 60_000,
    sunset: solarNoon + halfDayMinutes * 60_000,
    solarNoon,
    alwaysUp: false,
    alwaysDown: false,
  };
}

/* ---------------------------------------------------------------- lighting */

/** Below this the sun is down but the sky is not yet dark. */
export const CIVIL_TWILIGHT = -6;

/**
 * The map's light for a sun position.
 *
 * The renderer states a light as a colour, an intensity and a direction given
 * as a bearing and an angle off the vertical — which is exactly a sun position
 * with the altitude turned inside out. So the astronomy reaches both the
 * extruded buildings and the glTF scene through the light that was already
 * there, rather than through a second path that could disagree with it.
 *
 * The colour warms towards the horizon because that is what the atmosphere does
 * to light travelling a long way through it, and it is the cue that makes a
 * rendering read as evening rather than as a dimmed noon.
 */
export function lightFromSun(sun: SunPosition): Light {
  if (sun.altitude <= CIVIL_TWILIGHT) {
    // Night. The direction no longer means anything, so it is left overhead
    // and only the colour and the level say what time it is.
    return { anchor: "map", color: "#5b6b86", intensity: 0.18, position: [1.15, 0, 20] };
  }

  const warmth = clamp(sun.altitude / 25, 0, 1);
  const color = mix("#ff9a4d", "#ffffff", warmth);
  const intensity = 0.22 + 0.78 * clamp((sun.altitude - CIVIL_TWILIGHT) / 45, 0, 1);

  return {
    anchor: "map",
    color,
    intensity,
    // Polar is measured down from straight up, so a sun on the horizon is 90.
    position: [1.15, sun.azimuth, clamp(90 - sun.altitude, 0, 90)],
  };
}

/* ---------------------------------------------------------------- helpers */

function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

function mod360(n: number): number {
  return ((n % 360) + 360) % 360;
}

/** Blend two hex colours. `t` of 0 is all of `a`. */
function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const channel = (i: number) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * t);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

function hex(color: string): number[] {
  const raw = color.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
}
