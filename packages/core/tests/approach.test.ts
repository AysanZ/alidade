import { describe, expect, it } from "vitest";

import {
  APPROACH_SECONDS,
  MEHRABAD_29L,
  approachAt,
  approachCamera,
  approachFrame,
} from "../src/approach";
import { bankFor, pathAngle, shortestTurn } from "../src/live";
import { bearing as bearingBetween, distance } from "../src/measure";

const every = (step: number) => {
  const out = [];
  for (let t = 0; t <= APPROACH_SECONDS; t += step) out.push({ t, at: approachAt(t) });
  return out;
};

describe("the approach", () => {
  it("visits every phase in order and ends stopped", () => {
    const phases = [...new Set(every(1).map((s) => s.at.phase))];
    // The last sample is exactly at the end, which is "down" rather than a phase.
    expect(phases).toEqual(["base", "turn", "final", "flare", "rollout", "down"]);
    expect(approachAt(APPROACH_SECONDS).speed).toBeCloseTo(0, 1);
  });

  it("is flown at a speed an aeroplane lands at", () => {
    /*
     * The first version chose durations that felt watchable and let the speeds
     * fall out, which produced a final approach at 326 knots. Nothing has ever
     * landed at 326 knots.
     */
    for (const { at } of every(1)) {
      if (at.phase === "rollout" || at.phase === "down") continue;
      const knots = at.speed * 1.94384;
      expect(knots).toBeGreaterThan(120);
      expect(knots).toBeLessThan(150);
    }
  });

  it("covers the ground at the speed it reports", () => {
    // A profile whose distance and speed are picked separately will disagree,
    // and the aeroplane slides along the runway at eight hundred knots while
    // its readout says sixty.
    for (let t = 1; t < APPROACH_SECONDS; t += 1) {
      const before = approachAt(t - 1);
      const after = approachAt(t);
      const covered = distance(before.position, after.position);
      /*
       * Against the mean of the two speeds, not the later one. Distance over a
       * second is an average and the reading at the end of it is an instant,
       * and where the aircraft is braking those differ by the deceleration —
       * which is a fact about the comparison rather than about the profile.
       */
      const mean = (before.speed + after.speed) / 2;
      expect(Math.abs(covered - mean), `at ${t}s`).toBeLessThan(1);
    }
  });

  it("has no seam between one phase and the next", () => {
    /*
     * Every discontinuity here is something a person sees: a height that jumps
     * is an aeroplane that teleports, and a heading that jumps is one that
     * snaps round. This is the test that caught the flare starting eight metres
     * above where the glideslope ended.
     */
    for (let t = 0.5; t < APPROACH_SECONDS; t += 0.5) {
      const before = approachAt(t - 0.02);
      const after = approachAt(t + 0.02);
      expect(Math.abs(after.height - before.height), `height at ${t}s`).toBeLessThan(0.6);
      expect(Math.abs(shortestTurn(before.heading, after.heading)), `heading at ${t}s`).toBeLessThan(1);
      expect(Math.abs((after.pitch ?? 0) - (before.pitch ?? 0)), `pitch at ${t}s`).toBeLessThan(1);
    }
  });

  it("descends on a three degree glideslope", () => {
    const finals = every(1).filter((s) => s.at.phase === "final");
    const middle = finals[Math.floor(finals.length / 2)]!.t;
    const drop = approachAt(middle).height - approachAt(middle + 1).height;
    const along = distance(approachAt(middle).position, approachAt(middle + 1).position);
    expect(Math.abs(pathAngle(-drop, along))).toBeGreaterThan(2);
    expect(Math.abs(pathAngle(-drop, along))).toBeLessThan(4.5);
  });

  it("only ever descends until it is down", () => {
    let previous = Infinity;
    for (const { at } of every(0.5)) {
      expect(at.height).toBeLessThanOrEqual(previous + 0.01);
      previous = at.height;
    }
  });

  it("banks about twenty-five degrees through the turn, and not at all outside it", () => {
    /*
     * Nothing here sets a bank. The turn radius was derived from a 25 degree
     * bank, and this reads the bank back out of the geometry the same way the
     * renderer does — so the number the aeroplane is drawn at is the number the
     * path was built from.
     */
    for (const { t, at } of every(1)) {
      if (t < 1) continue;
      // A rate measured across a phase boundary belongs to neither phase: the
      // step from the last turn sample to the first final one still contains
      // the turn's rotation.
      if (approachAt(t - 1).phase !== at.phase) continue;
      const rate = shortestTurn(approachAt(t - 1).heading, at.heading);
      const bank = Math.abs(bankFor(rate, at.speed));
      if (at.phase === "turn") continue;
      expect(bank, `${at.phase} at ${t}s`).toBeLessThan(2);
    }
    const midTurn = every(1).filter((s) => s.at.phase === "turn")[8]!;
    const rate = shortestTurn(approachAt(midTurn.t - 1).heading, midTurn.at.heading);
    expect(Math.abs(bankFor(rate, midTurn.at.speed))).toBeCloseTo(25, 0);
  });

  it("raises the nose for the flare and lowers it on the runway", () => {
    const flare = every(0.5).filter((s) => s.at.phase === "flare");
    expect(flare[0]!.at.pitch).toBeCloseTo(0, 1);
    expect(flare[flare.length - 1]!.at.pitch!).toBeGreaterThan(4);
    expect(approachAt(APPROACH_SECONDS).pitch).toBeCloseTo(0, 1);
  });

  it("touches down on the runway, not before it and not past the end", () => {
    const touchdown = every(0.5).find((s) => s.at.phase !== "final" && s.at.height === 0)!;
    const along = distance(MEHRABAD_29L.threshold, touchdown.at.position);
    expect(along).toBeGreaterThan(0);
    expect(along).toBeLessThan(MEHRABAD_29L.length);
    const stopped = approachAt(APPROACH_SECONDS);
    expect(distance(MEHRABAD_29L.threshold, stopped.position)).toBeLessThan(MEHRABAD_29L.length);
  });

  it("lands on the runway's own heading", () => {
    // Otherwise it lands across it, which is a thing nobody does twice.
    expect(approachAt(APPROACH_SECONDS).heading).toBeCloseTo(MEHRABAD_29L.heading, 1);
  });

  it("emits reports a feed could have sent", () => {
    const frame = approachFrame(30, 1_700_000_000_000);
    expect(frame).toMatchObject({ id: "arrival", updated: 1_700_000_000_000 });
    expect(frame.altitude).toBeGreaterThan(0);
    expect(frame.heading).toBeGreaterThanOrEqual(0);
    expect(frame.speed).toBeGreaterThan(0);
  });

  it("holds still before it starts and after it has stopped", () => {
    expect(approachAt(-10).position).toEqual(approachAt(0).position);
    expect(approachAt(APPROACH_SECONDS + 60).position).toEqual(
      approachAt(APPROACH_SECONDS).position,
    );
  });
});

describe("where to stand to watch the arrival", () => {
  /*
   * Framing the approach path answered "fit all of this on the screen", which
   * put the camera overhead and level — the one view from which a jet on final
   * is a two-pixel cross and the bank the demonstration exists to show cannot be
   * seen at all.
   */
  it("is low and to one side, not overhead", () => {
    const view = approachCamera();
    expect(view.pitch).toBeGreaterThan(70);
    // The map is built with `maxPitch: 85`, and asking for more than the ceiling
    // is clamped without a word — so the camera must stay under it deliberately.
    expect(view.pitch).toBeLessThanOrEqual(85);
  });

  it("clears the zoom below which no 3D is drawn", () => {
    expect(approachCamera().zoom).toBeGreaterThan(12);
  });

  /*
   * The defect this exists for: the camera looked down the approach towards the
   * runway, which put the aeroplane behind it. For the first few seconds there
   * was nothing on screen, and then the aircraft arrived from nowhere.
   */
  it("is pointing at the aeroplane when the demonstration starts", () => {
    const view = approachCamera();
    const start = approachAt(0).position;
    const towards = bearingBetween(view.center, start);
    /* Both wrapped to ±180 before comparing, so 359° and 1° are two apart. */
    const off = Math.abs(((view.bearing - towards + 540) % 360) - 180);
    // Within a normal field of view of dead ahead.
    expect(off).toBeLessThan(30);
  });

  it("is not pointing straight at it, so the wings are not edge-on", () => {
    const view = approachCamera();
    const towards = bearingBetween(view.center, approachAt(0).position);
    const off = Math.abs(((view.bearing - towards + 540) % 360) - 180);
    expect(off).toBeGreaterThan(5);
  });

  it("stands between the touchdown zone and the approach, not out at the pattern", () => {
    const view = approachCamera();
    expect(distance(view.center, MEHRABAD_29L.threshold)).toBeLessThan(3000);
    expect(distance(view.center, approachAt(0).position)).toBeLessThan(20000);
  });



  it("follows the runway rather than being written down", () => {
    const elsewhere = approachCamera({ ...MEHRABAD_29L, threshold: [0, 0] });
    expect(Math.abs(elsewhere.center[0])).toBeLessThan(1);
    expect(Math.abs(elsewhere.center[1])).toBeLessThan(1);
  });
});
