import { describe, expect, it } from "vitest";

import {
  bankFor,
  drivenBy,
  followers,
  motionFor,
  pathAngle,
  rememberFrames,
  shortestTurn,
  turnTowards,
  tween,
} from "../src/live";
import type { MotionFrames } from "../src/live";
import type { LiveAsset, Model3D } from "../src/types/project";

const asset = (id: string, lon: number, lat: number, extra: Partial<LiveAsset> = {}): LiveAsset => ({
  id,
  position: [lon, lat],
  updated: 1000,
  ...extra,
});

const model = (extra: Partial<Model3D> = {}): Model3D => ({
  id: "m1",
  name: "Lorry",
  url: "/lorry.glb",
  position: [0, 0],
  altitude: 0,
  heading: 0,
  scale: 1,
  anchor: "base",
  clamp: true,
  visible: true,
  opacity: 1,
  ...extra,
});

describe("shortestTurn", () => {
  /**
   * A lorry crossing due north spun almost all the way round on the spot, once
   * per lap. Subtracting the bearings says 359 to 1 is a 358 degree turn to the
   * left; it is two degrees to the right.
   */
  it("takes the short way over the top", () => {
    expect(shortestTurn(359, 1)).toBe(2);
    expect(shortestTurn(1, 359)).toBe(-2);
  });

  it("is zero for no turn at all", () => {
    expect(shortestTurn(90, 90)).toBe(0);
    expect(shortestTurn(0, 360)).toBe(0);
  });

  it("never returns more than half a turn", () => {
    for (let from = 0; from < 360; from += 7) {
      for (let to = 0; to < 360; to += 11) {
        const turn = shortestTurn(from, to);
        expect(Math.abs(turn)).toBeLessThanOrEqual(180);
      }
    }
  });

  it("picks a side for the exact opposite rather than returning nothing", () => {
    // Half a turn is ambiguous by definition. It has to be one or the other,
    // and it has to be the same one every frame or the model shudders.
    expect(Math.abs(shortestTurn(0, 180))).toBe(180);
    expect(shortestTurn(0, 180)).toBe(shortestTurn(0, 180));
  });
});

describe("turnTowards", () => {
  it("lands on the target at the end", () => {
    expect(turnTowards(10, 80, 1)).toBeCloseTo(80);
    expect(turnTowards(10, 80, 0)).toBeCloseTo(10);
  });

  it("crosses north without going the long way", () => {
    // Halfway from 350 to 10 is 0, not 180.
    expect(turnTowards(350, 10, 0.5)).toBeCloseTo(0);
  });

  it("always answers inside the compass", () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const heading = turnTowards(350, 30, t);
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }
  });
});

describe("tween", () => {
  it("is at the first report at the start and the second at the end", () => {
    const a = asset("a", 10, 20);
    const b = asset("a", 12, 24);
    expect(tween(a, b, 0).position).toEqual([10, 20]);
    expect(tween(a, b, 1).position).toEqual([12, 24]);
  });

  it("is halfway across at halfway through", () => {
    const motion = tween(asset("a", 10, 20), asset("a", 12, 24), 0.5);
    expect(motion.position[0]).toBeCloseTo(11);
    expect(motion.position[1]).toBeCloseTo(22);
  });

  it("holds at the last report rather than flying on for ever", () => {
    // A report that never comes must leave the model where it was put. Without
    // the clamp the fraction keeps growing and the lorry leaves the country.
    const motion = tween(asset("a", 10, 20), asset("a", 11, 20), 40);
    expect(motion.position).toEqual([11, 20]);
  });

  it("does not run backwards before the first report", () => {
    expect(tween(asset("a", 10, 20), asset("a", 11, 20), -3).position).toEqual([10, 20]);
  });

  it("turns through a reported corner rather than snapping to it", () => {
    const motion = tween(
      asset("a", 10, 20, { heading: 40 }),
      asset("a", 10, 20, { heading: 100 }),
      0.5,
    );
    expect(motion.heading).toBeCloseTo(70);
  });

  it("takes the short way when the corner crosses north", () => {
    const motion = tween(
      asset("a", 10, 20, { heading: 350 }),
      asset("a", 10, 20, { heading: 10 }),
      0.5,
    );
    expect(motion.heading).toBeCloseTo(0);
  });

  it("works out a heading from the movement when the feed sends none", () => {
    // Most cheap trackers send position only. Due east.
    const motion = tween(asset("a", 10, 20), asset("a", 10.02, 20), 0.5);
    expect(motion.heading).toBeGreaterThan(80);
    expect(motion.heading).toBeLessThan(100);
  });

  it("does not spin a parked vehicle on GPS noise", () => {
    /*
     * A heading derived from two positions a few metres apart is derived from
     * noise, and a parked lorry would turn to face a new random direction every
     * second all night.
     */
    const jitter = tween(asset("a", 10, 20), asset("a", 10.000005, 20.000005), 1);
    expect(jitter.heading).toBe(0);
  });

  it("prefers a reported heading to one worked out from two points", () => {
    const motion = tween(
      asset("a", 10, 20, { heading: 270 }),
      asset("a", 10.02, 20, { heading: 270 }),
      0.5,
    );
    expect(motion.heading).toBeCloseTo(270);
  });
});

describe("drivenBy", () => {
  it("does nothing to a model that follows nothing", () => {
    const m = model();
    expect(drivenBy(m, { position: [5, 5], heading: 90 })).toBe(m);
  });

  it("puts the model where the asset is", () => {
    const m = model({ follow: { asset: "a", faceForward: true } });
    expect(drivenBy(m, { position: [5, 5], heading: 90 })).toMatchObject({
      position: [5, 5],
      heading: 90,
    });
  });

  it("keeps the model's own heading when it is not facing forward", () => {
    const m = model({ heading: 33, follow: { asset: "a", faceForward: false } });
    expect(drivenBy(m, { position: [5, 5], heading: 90 }).heading).toBe(33);
  });

  it("applies the offset for a file whose front is not its own +z", () => {
    const m = model({ follow: { asset: "a", faceForward: true, headingOffset: 90 } });
    expect(drivenBy(m, { position: [0, 0], heading: 350 }).heading).toBe(80);
  });

  it("never hands the renderer a heading outside the compass", () => {
    const m = model({ follow: { asset: "a", faceForward: true, headingOffset: 300 } });
    const heading = drivenBy(m, { position: [0, 0], heading: 200 }).heading;
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(360);
  });
});

describe("rememberFrames", () => {
  it("holds the first report with nothing to move from", () => {
    const frames = rememberFrames(new Map(), [asset("a", 1, 1)], 1000);
    expect(frames.get("a")).toMatchObject({ from: null, atTo: 1000 });
  });

  it("keeps the previous report when a new one arrives", () => {
    let frames = rememberFrames(new Map(), [asset("a", 1, 1)], 1000);
    frames = rememberFrames(frames, [asset("a", 2, 2)], 2000);
    const seen = frames.get("a")!;
    expect(seen.from?.position).toEqual([1, 1]);
    expect(seen.to.position).toEqual([2, 2]);
    expect(seen.atFrom).toBe(1000);
    expect(seen.atTo).toBe(2000);
  });

  it("does not advance an asset that has not moved", () => {
    /*
     * A feed re-sending the same position every second would otherwise restart
     * the interpolation every second from a point it is already at, and a
     * stopped vehicle would jitter in place rather than being stopped.
     */
    let frames = rememberFrames(new Map(), [asset("a", 1, 1)], 1000);
    frames = rememberFrames(frames, [asset("a", 2, 2)], 2000);
    const before = frames.get("a");
    frames = rememberFrames(frames, [asset("a", 2, 2)], 3000);
    expect(frames.get("a")).toBe(before);
  });

  it("forgets an asset that has left the feed", () => {
    let frames = rememberFrames(new Map(), [asset("a", 1, 1), asset("b", 2, 2)], 1000);
    frames = rememberFrames(frames, [asset("a", 1, 1)], 2000);
    expect(frames.has("b")).toBe(false);
  });
});

describe("motionFor", () => {
  const following = model({ follow: { asset: "a", faceForward: true } });

  it("has no answer for a model that follows nothing", () => {
    expect(motionFor(model(), new Map(), 0)).toBeNull();
  });

  it("has no answer for an asset that has never reported", () => {
    // Null has to be an answer. Putting the model at [0, 0] because a lookup
    // missed is how a lorry ends up in the Gulf of Guinea.
    expect(motionFor(following, new Map(), 0)).toBeNull();
  });

  it("sits on the single report it has", () => {
    const frames = rememberFrames(new Map(), [asset("a", 7, 8, { heading: 45 })], 1000);
    // Level, because one report is a place and not a movement: nothing can be
    // said about attitude from it.
    expect(motionFor(following, frames, 1500)).toMatchObject({
      position: [7, 8],
      heading: 45,
      pitch: 0,
      roll: 0,
    });
  });

  it("is one report behind, and arrives just as the next one does", () => {
    let frames = rememberFrames(new Map(), [asset("a", 0, 0)], 1000);
    frames = rememberFrames(frames, [asset("a", 10, 0)], 2000);
    // At the instant the second report landed, the model is still on the first.
    expect(motionFor(following, frames, 2000)!.position[0]).toBeCloseTo(0);
    // Halfway to when the next one is due, halfway between the two.
    expect(motionFor(following, frames, 2500)!.position[0]).toBeCloseTo(5);
    // And it has arrived by the time the next one is due.
    expect(motionFor(following, frames, 3000)!.position[0]).toBeCloseTo(10);
  });

  it("stops rather than carrying on when the feed goes quiet", () => {
    let frames = rememberFrames(new Map(), [asset("a", 0, 0)], 1000);
    frames = rememberFrames(frames, [asset("a", 10, 0)], 2000);
    expect(motionFor(following, frames, 60_000)!.position[0]).toBeCloseTo(10);
  });

  it("survives two reports landing in the same instant", () => {
    // A span of zero is a division by zero, and a NaN position is a model that
    // vanishes rather than a model that is somewhere wrong.
    const frames = new Map<string, MotionFrames>([
      ["a", { from: asset("a", 0, 0), to: asset("a", 5, 5), atFrom: 1000, atTo: 1000 }],
    ]);
    const motion = motionFor(following, frames, 1000)!;
    expect(Number.isFinite(motion.position[0])).toBe(true);
    expect(motion.position).toEqual([5, 5]);
  });
});

describe("followers", () => {
  it("is empty for a scene with nothing following", () => {
    expect(followers([model(), model({ id: "m2" })])).toHaveLength(0);
    expect(followers(undefined)).toHaveLength(0);
  });

  it("picks out only the models that name an asset", () => {
    const driven = model({ id: "m2", follow: { asset: "a", faceForward: true } });
    expect(followers([model(), driven]).map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("attitude", () => {
  const flying = model({
    follow: { asset: "a", faceForward: true, attitude: true, altitude: true },
  });
  const at = (
    lon: number,
    lat: number,
    updated: number,
    extra: Partial<LiveAsset> = {},
  ): LiveAsset => ({ id: "a", position: [lon, lat], updated, ...extra });

  it("is a flight path angle, not an invented number", () => {
    // Three degrees down is the standard glideslope, and the only reason the
    // number is checkable at all is that it comes out of the geometry.
    expect(pathAngle(-150, 2862)).toBeCloseTo(-3, 0);
    expect(pathAngle(150, 2862)).toBeCloseTo(3, 0);
    expect(pathAngle(100, 0)).toBe(0);
  });

  it("puts the nose down on a descent and up on a climb", () => {
    const down = tween(
      at(51.4, 35.7, 0, { altitude: 300 }),
      at(51.4, 35.71, 1000, { altitude: 200 }),
      1,
    );
    expect(down.pitch!).toBeLessThan(0);
    const up = tween(
      at(51.4, 35.7, 0, { altitude: 200 }),
      at(51.4, 35.71, 1000, { altitude: 300 }),
      1,
    );
    expect(up.pitch!).toBeGreaterThan(0);
  });

  it("banks into a turn and rolls level out of it", () => {
    const turning = tween(
      at(51.4, 35.7, 0, { heading: 200, speed: 70 }),
      at(51.401, 35.7, 1000, { heading: 204, speed: 70 }),
      1,
    );
    expect(turning.roll!).toBeGreaterThan(10);
    const straight = tween(
      at(51.4, 35.7, 0, { heading: 200, speed: 70 }),
      at(51.401, 35.7, 1000, { heading: 200, speed: 70 }),
      1,
    );
    expect(straight.roll).toBe(0);
  });

  it("banks the other way for the other turn", () => {
    const left = tween(
      at(51.4, 35.7, 0, { heading: 204, speed: 70 }),
      at(51.401, 35.7, 1000, { heading: 200, speed: 70 }),
      1,
    );
    expect(left.roll!).toBeLessThan(-10);
  });

  it("banks further for the same turn at a higher speed", () => {
    // tan(bank) = ω v / g, so it must. An aircraft that banks the same at every
    // speed is an aircraft drawn rather than flown.
    const slow = bankFor(4, 60);
    const fast = bankFor(4, 120);
    expect(fast).toBeGreaterThan(slow);
  });

  it("never rolls an airliner past a bank an airliner uses", () => {
    // Two reports either side of a sharp corner imply a rate of turn no
    // aeroplane could fly, and an airliner drawn inverted over a runway is a
    // worse answer than one that under-banks.
    expect(bankFor(400, 250)).toBeLessThanOrEqual(30);
    expect(bankFor(-400, 250)).toBeGreaterThanOrEqual(-30);
    expect(bankFor(10, 0)).toBe(0);
  });

  it("flies wings level when the feed reports no heading", () => {
    // Two positions give one bearing and say nothing about whether it is
    // changing. The data does not contain the turn, so there is no bank in it.
    const motion = tween(at(51.4, 35.7, 0), at(51.41, 35.7, 1000), 1);
    expect(motion.roll).toBe(0);
  });

  it("carries the altitude across and interpolates it", () => {
    const motion = tween(
      at(51.4, 35.7, 0, { altitude: 300 }),
      at(51.4, 35.71, 1000, { altitude: 100 }),
      0.5,
    );
    expect(motion.altitude).toBeCloseTo(200);
  });

  it("leaves a ground vehicle level however hard it corners", () => {
    /*
     * A lorry that rolls fifteen degrees into a roundabout has crashed. Both
     * attitude and altitude are opted into, separately, because a feed
     * reporting height does not mean the user wants the model flying.
     */
    const ground = model({ follow: { asset: "a", faceForward: true } });
    const driven = drivenBy(ground, { position: [1, 2], heading: 90, pitch: -8, roll: 22 });
    expect(driven.pitch).toBeUndefined();
    expect(driven.roll).toBeUndefined();
    expect(driven.altitude).toBe(0);
  });

  it("applies both to something that is flying", () => {
    const driven = drivenBy(flying, {
      position: [1, 2],
      heading: 90,
      pitch: -3,
      roll: 22,
      altitude: 240,
    });
    expect(driven).toMatchObject({ pitch: -3, roll: 22, altitude: 240 });
  });
});
