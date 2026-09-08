/**
 * An arrival, flown.
 *
 * This is a demonstration and it is also the honest test of the live layer: the
 * frames it produces are ordinary `LiveAsset` reports and go through the
 * ordinary pipeline — parsed, buffered, interpolated, attitude derived from
 * consecutive reports — so nothing here is a special case the rest of the
 * application knows about. If the landing looks right, the pipeline is right.
 *
 * Nothing about the attitude is scripted. The aircraft banks into the turn onto
 * final because it is turning, and lowers its nose on the glideslope because it
 * is descending; both fall out of `tween` from the positions and headings alone.
 * The one thing that is stated rather than derived is the flare, because a
 * flare is a thing a pilot does and not a thing the geometry implies.
 */

import { bearing } from "./measure";
import { offset } from "./annotate";
import type { LiveAsset } from "./types/project";

/** The runway an approach is flown to. */
export interface Runway {
  /** lon, lat of the landing threshold. */
  threshold: [number, number];
  /** The direction of landing, degrees clockwise from north. */
  heading: number;
  /** Metres of usable surface beyond the threshold. */
  length: number;
  /** Metres above sea level, so the profile is above the ground and not the sea. */
  elevation: number;
}

/**
 * Mehrabad's 29L.
 *
 * Chosen because the demo feed already flies around Tehran, and an arrival at an
 * airport on the other side of the world from everything else would need the
 * camera moved twice.
 *
 * The first version of these numbers put the threshold north of the aerodrome
 * reference point, which is the wrong side of the field: landing on 29 you are
 * heading roughly west-north-west, so the left-hand runway is the southern one.
 * The aeroplane touched down on 29R's centreline and taxied through a terminal.
 *
 * Derived instead from the published reference point — 35.68917N 51.31361E,
 * 1208 m — and 11R/29L's stated length of 4041 m, with the threshold at the
 * eastern end of the southern runway. Good to about a hundred metres, which is
 * the right accuracy for a demonstration and the wrong accuracy for a flight.
 */
export const MEHRABAD_29L: Runway = {
  threshold: [51.3331, 35.6772],
  /*
   * True, not magnetic.
   *
   * A runway is named for its magnetic heading rounded to ten degrees, and 29L
   * is about 293° magnetic. The map is in true north, and Tehran's declination
   * is roughly four and a half degrees east — so a heading of 293 here would
   * fly the aeroplane down a line four degrees off the tarmac, which over four
   * kilometres is most of the runway's width.
   */
  heading: 297,
  length: 4041,
  elevation: 1208,
};

/**
 * The phases, and how long each takes.
 *
 * Written as durations rather than as distances because the demo is watched
 * rather than flown: what matters is that the turn is long enough to see the
 * bank develop and the final is short enough that nobody gets bored before the
 * wheels touch. The speeds that fall out are close enough to real for an
 * arrival — about 135 knots on final — which is a happy accident of picking
 * watchable numbers rather than something aimed at.
 */
export const PHASES = {
  /** The base leg: across the approach path, level, before the turn in. */
  base: 12,
  /** The turn onto final. Where the bank comes from. */
  turn: 24,
  /** The glideslope. Where the nose comes down. */
  final: 41,
  /** Nose up, sink arrested, wheels on. */
  flare: 4,
  /** On the ground, slowing. */
  rollout: 18,
} as const;

export const APPROACH_SECONDS =
  PHASES.base + PHASES.turn + PHASES.final + PHASES.flare + PHASES.rollout;

/**
 * The numbers an arrival is actually flown at.
 *
 * Picked to be right rather than to be watchable, and they turned out to be
 * both. The first attempt chose durations that felt right and let the speeds
 * fall out, which produced a final approach at 326 knots — a number no aircraft
 * has ever landed at, and one that made the aeroplane cross the screen like a
 * missile. Choosing the speed and the glideslope first and letting the
 * durations fall out is the right way round, and it is why every phase here is
 * a distance divided by a speed.
 */
/** Approach speed, metres per second. About 135 knots, which is a narrowbody. */
const APPROACH_SPEED = 70;

/** Height above the runway at the start. Five hundred feet, near enough. */
const PATTERN_HEIGHT = 150;

/**
 * How far out the glideslope is joined.
 *
 * Three degrees from `PATTERN_HEIGHT`, which is the standard everywhere and is
 * the number that makes the descent look like an approach rather than a dive.
 */
const FINAL_LENGTH = PATTERN_HEIGHT / Math.tan((3 * Math.PI) / 180);

/**
 * The radius of the turn onto final.
 *
 * `v² / (g tan φ)` at a twenty-five degree bank, which is what an airliner uses
 * in the circuit. Deriving the radius from the bank rather than picking one
 * means the bank the renderer works back out of the turn is the bank the turn
 * was built from — the geometry and the attitude agree because they came from
 * the same number.
 */
const TURN_RADIUS =
  (APPROACH_SPEED * APPROACH_SPEED) / (9.80665 * Math.tan((25 * Math.PI) / 180));

/** Touchdown speed, and the height the flare begins at. */
const TOUCHDOWN_SPEED = 65;

/**
 * Where the glideslope stops and the flare starts, in metres.
 *
 * The final leg descends to this rather than to the ground, because the flare
 * begins from it. The first version had final reach zero and flare start at
 * eight metres, so the aeroplane climbed eight metres in one frame a second
 * before touchdown — the seam between two phases that each looked right alone.
 */
const FLARE_HEIGHT = 8;

/** Distance the flare covers, from the mean speed across it, so it cannot disagree. */
const FLARE_RUN = ((APPROACH_SPEED + TOUCHDOWN_SPEED) / 2) * PHASES.flare;

/** Nose attitude held through the flare, in degrees. */
const FLARE_PITCH = 5.5;

/**
 * Where the aircraft is, and how fast, at a moment in the arrival.
 *
 * Returns a report and not a placement: the caller pushes it into the live
 * layer as though a transponder had sent it, and everything downstream treats
 * it as one. `updated` is stamped by the caller for the same reason.
 */
export interface ApproachSample {
  position: [number, number];
  /** Metres above the runway. */
  height: number;
  heading: number;
  /** Metres per second. */
  speed: number;
  /** Set only where the geometry does not imply the attitude: the flare. */
  pitch?: number;
  phase: keyof typeof PHASES | "down";
}

/** The four points the whole approach is built from. */
function legs(runway: Runway) {
  const inbound = runway.heading;
  const behind = (inbound + 180) % 360;

  /* Where the glideslope is joined, straight out from the threshold. */
  const intercept = offset(runway.threshold, FINAL_LENGTH, behind);

  /*
   * The turn is a quarter circle whose centre is abeam the intercept, so the
   * path leaves the base leg along it and joins the centreline along it. That
   * continuity is the whole point: a bank appears and disappears smoothly
   * because the heading does, and a cornered path would produce one violent
   * roll on the corner and none either side.
   */
  const centre = offset(intercept, TURN_RADIUS, (inbound + 90) % 360);
  const entry = offset(centre, TURN_RADIUS, (inbound + 180) % 360);
  /* The base leg runs across, ending where the turn begins. */
  const baseStart = offset(entry, APPROACH_SPEED * PHASES.base, (inbound + 90) % 360);

  return { inbound, intercept, centre, entry, baseStart };
}

/**
 * Fly the arrival to a moment.
 *
 * Every phase is worked out from the runway rather than from a stored path, so
 * moving the runway moves the whole approach and the demo can be pointed at any
 * strip in the world without a new set of coordinates.
 */
export function approachAt(seconds: number, runway: Runway = MEHRABAD_29L): ApproachSample {
  const t = Math.max(0, seconds);
  const { inbound, intercept, centre, entry, baseStart } = legs(runway);

  const turnAt = PHASES.base;
  const finalAt = turnAt + PHASES.turn;
  const flareAt = finalAt + PHASES.final;
  const rolloutAt = flareAt + PHASES.flare;

  if (t < turnAt) {
    const f = span(t, 0, turnAt);
    return {
      position: between(baseStart, entry, f),
      height: PATTERN_HEIGHT,
      heading: bearing(baseStart, entry),
      speed: APPROACH_SPEED,
      phase: "base",
    };
  }

  if (t < finalAt) {
    const f = span(t, turnAt, finalAt);
    /* Ninety degrees round the centre, ending pointing down the centreline. */
    const from = bearing(centre, entry);
    const angle = from + 90 * f;
    return {
      position: offset(centre, TURN_RADIUS, angle),
      height: PATTERN_HEIGHT,
      /* Tangent to the circle, which is the heading a turn is flown at. */
      heading: (angle + 90) % 360,
      speed: APPROACH_SPEED,
      phase: "turn",
    };
  }

  if (t < flareAt) {
    const f = span(t, finalAt, flareAt);
    /*
     * Straight in and down. The descent eases very slightly at the bottom so
     * the aircraft is not still going down at full rate when the flare starts,
     * which is what makes the join between the two look like one manoeuvre.
     */
    return {
      position: between(intercept, runway.threshold, f),
      height: FLARE_HEIGHT + (PATTERN_HEIGHT - FLARE_HEIGHT) * (1 - f) ** 1.12,
      heading: inbound,
      speed: APPROACH_SPEED,
      phase: "final",
    };
  }

  if (t < rolloutAt) {
    const f = span(t, flareAt, rolloutAt);
    /*
     * The one scripted attitude. A flare is a thing a pilot does rather than
     * something the path implies: the aircraft stops descending because the
     * nose came up, not the other way round, and deriving the pitch from a
     * flight path that is by then almost flat would draw it level at the exact
     * moment it should look most like an aeroplane.
     */
    return {
      /*
       * The integral of the speed, not the fraction of the distance. The flare
       * decelerates, so a position linear in time covers ground at the mean
       * speed from the first instant — the aeroplane arrived two metres ahead
       * of where its own readout said it was, every second of the flare.
       */
      position: offset(
        runway.threshold,
        PHASES.flare * (APPROACH_SPEED * f - ((APPROACH_SPEED - TOUCHDOWN_SPEED) * f * f) / 2),
        inbound,
      ),
      height: FLARE_HEIGHT * (1 - f) ** 1.7,
      heading: inbound,
      speed: APPROACH_SPEED - (APPROACH_SPEED - TOUCHDOWN_SPEED) * f,
      /*
       * Rising to the full flare attitude and holding it, so the rollout —
       * which begins at the full attitude and lowers the nose — picks up
       * exactly where this leaves off. A sine that peaked mid-flare and came
       * back down put the nose down again before the wheels were on, and then
       * jumped back up as the rollout began.
       */
      pitch: FLARE_PITCH * f ** 0.7,
      phase: "flare",
    };
  }

  const f = span(t, rolloutAt, rolloutAt + PHASES.rollout);
  /*
   * Braking, with the distance and the speed coming from one integral so they
   * cannot disagree. They did on the first attempt: the distance was picked to
   * fill the runway and the speed was picked to look like braking, and the
   * aeroplane covered the ground at eight hundred knots while reporting sixty.
   */
  const speed = TOUCHDOWN_SPEED * (1 - f);
  const covered = FLARE_RUN + TOUCHDOWN_SPEED * PHASES.rollout * (f - (f * f) / 2);
  return {
    position: offset(runway.threshold, covered, inbound),
    height: 0,
    heading: inbound,
    speed,
    // Nose gear down within the first moment, then flat on the runway.
    pitch: FLARE_PITCH * Math.max(0, 1 - f * 6),
    phase: t >= rolloutAt + PHASES.rollout ? "down" : "rollout",
  };
}

/**
 * One report, as a feed would have sent it.
 *
 * `altitude` is above the runway rather than above the sea, which is what the
 * live layer means by altitude and what a map wants: an aircraft on short final
 * is fifty metres up, not fifty metres plus the height of the plateau.
 */
export function approachFrame(
  seconds: number,
  now: number,
  runway: Runway = MEHRABAD_29L,
  id = "arrival",
): LiveAsset {
  const sample = approachAt(seconds, runway);
  return {
    id,
    position: sample.position,
    heading: sample.heading,
    speed: sample.speed,
    altitude: sample.height,
    updated: now,
    label: "Arrival",
    properties: { phase: sample.phase },
  };
}

/** Where the camera should sit to watch the whole thing. */
/**
 * Where to stand to watch the arrival.
 *
 * Framing the approach path put the camera overhead and level, which is the one
 * view an aeroplane cannot be seen from: from directly above, a jet on final is
 * a cross the length of two pixels, and the bank the whole demonstration exists
 * to show is invisible. It has to be watched from beside the path and from low
 * down, the way it would be watched from the ground.
 *
 * Worked out from the runway rather than written down, so pointing the demo at a
 * different strip moves the camera with it.
 */
export function approachCamera(runway: Runway = MEHRABAD_29L): {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
} {
  const { intercept } = legs(runway);
  /* Where the aeroplane actually is when the demonstration starts. */
  const start = approachAt(0, runway).position;

  /*
   * Standing near the touchdown zone, looking back up the approach.
   *
   * The first version looked the other way — along the final, towards the
   * runway — which put the aeroplane behind the camera at the start: it was out
   * of frame for the first few seconds and then arrived from nowhere. Watching
   * an arrival means standing where it is going and looking at where it is
   * coming from.
   */
  const center = between(runway.threshold, intercept, 0.2);

  /*
   * Aimed at the aeroplane, then turned a little off it.
   *
   * Dead-on puts it nose-first and hides the wings, and the bank is the whole
   * point. Eighteen degrees is enough to show the plan of the wing and small
   * enough to keep the whole approach in frame from the first second.
   */
  const towards = bearing(center, start);
  const camera = (towards + 18) % 360;

  return {
    center,
    /*
     * Close enough to be an aeroplane rather than a dot, and past zoom 12,
     * below which the 3D scene is not drawn at all.
     */
    zoom: 14,
    /*
     * Almost along the ground, and no further: the map's own ceiling is 85, and
     * asking for more than the ceiling is clamped without a word. Level would be
     * all sky; overhead shows a two-pixel cross.
     */
    pitch: 82,
    bearing: camera > 180 ? camera - 360 : camera,
  };
}

export function approachExtent(runway: Runway = MEHRABAD_29L): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const { intercept, baseStart } = legs(runway);
  const points = [runway.threshold, intercept, baseStart];
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return {
    west: Math.min(...lons),
    east: Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  };
}

/* ---------------------------------------------------------------- geometry */

function span(t: number, from: number, until: number): number {
  return Math.min(1, Math.max(0, (t - from) / Math.max(1e-6, until - from)));
}

function between(a: [number, number], b: [number, number], f: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

