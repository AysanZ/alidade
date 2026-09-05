import { describe, expect, it } from "vitest";

import { distance } from "../src/measure";
import { spreadModels } from "../src/spread";
import { movedAlong, newTrack, sampleAt, sampleTrack, speedOf, trackAt, trackLength } from "../src/track";
import type { Model3D, Track } from "../src/types/project";

const lorry: Model3D = {
  id: "lorry",
  name: "Lorry",
  url: "https://example.com/lorry.glb",
  position: [0, 0],
  altitude: 0,
  heading: 0,
  scale: 1,
  anchor: "base",
  clamp: true,
  visible: true,
  opacity: 1,
};

/**
 * A route with one long straight and one short corner.
 *
 * This is the shape that catches interpolation by vertex index: three vertices
 * mean two legs, and a model moved half a vertex per half the time spends as
 * long crossing the short leg as the long one, so it crawls and then bolts.
 */
const uneven: [number, number][] = [
  [0, 0],
  [1, 0],
  [1.05, 0],
];

describe("a model on a track", () => {
  it("covers equal ground in equal time, whatever the vertices do", () => {
    const total = trackLength(uneven);
    const steps = 20;
    const legs: number[] = [];
    for (let i = 0; i < steps; i++) {
      const a = sampleTrack(uneven, i / steps)!;
      const b = sampleTrack(uneven, (i + 1) / steps)!;
      legs.push(distance(a.position, b.position));
    }
    for (const leg of legs) {
      // Every slice of time is the same slice of ground, to a thousandth.
      expect(leg / (total / steps)).toBeCloseTo(1, 2);
    }
  });

  it("walks the great circle rather than mixing degrees", () => {
    // Halfway along a leg is halfway along the ground, which averaging the
    // endpoints' degrees only happens to give you on the equator.
    const leg: [number, number][] = [
      [0, 50],
      [10, 60],
    ];
    const middle = sampleTrack(leg, 0.5)!;
    expect(distance(leg[0]!, middle.position)).toBeCloseTo(
      distance(middle.position, leg[1]!),
      -1,
    );
    const naive: [number, number] = [5, 55];
    expect(distance(middle.position, naive)).toBeGreaterThan(1000);
  });

  it("faces the way it is going", () => {
    const north: [number, number][] = [
      [0, 0],
      [0, 1],
    ];
    const east: [number, number][] = [
      [0, 0],
      [1, 0],
    ];
    expect(sampleTrack(north, 0.5)!.heading).toBeCloseTo(0, 0);
    expect(sampleTrack(east, 0.5)!.heading).toBeCloseTo(90, 0);
  });

  it("starts at the beginning and finishes at the end", () => {
    expect(sampleTrack(uneven, 0)!.position).toEqual(uneven[0]);
    const end = sampleTrack(uneven, 1)!.position;
    expect(distance(end, uneven[2]!)).toBeLessThan(1);
  });

  it("parks at the last point rather than vanishing", () => {
    const track: Track = { ...newTrack("t", "lorry", uneven), loop: false, duration: 10 };
    const arrived = trackAt(track, 10)!.position;
    const later = trackAt(track, 400)!.position;
    expect(later).toEqual(arrived);
  });

  it("comes back round when it loops", () => {
    const track = { ...newTrack("t", "lorry", uneven), duration: 10 };
    const start = trackAt(track, 0)!.position;
    const lap = trackAt(track, 10)!.position;
    const halfway = trackAt(track, 15)!.position;
    expect(lap).toEqual(start);
    expect(halfway).toEqual(trackAt(track, 5)!.position);
  });

  it("reports a speed anyone can check against the map", () => {
    const track = { ...newTrack("t", "lorry", uneven), duration: 100 };
    expect(speedOf(track)).toBeCloseTo(trackLength(uneven) / 100, 6);
  });

  it("survives a path that goes nowhere", () => {
    const stuck: [number, number][] = [
      [5, 5],
      [5, 5],
    ];
    // No length to divide by, and no direction to face. Not a crash.
    expect(sampleTrack(stuck, 0.5)).toEqual({ position: [5, 5], heading: 0 });
    expect(sampleAt([], 10)).toBeNull();
  });

  it("turns the model without touching anything else about it", () => {
    const track = newTrack("t", "lorry", uneven);
    const moved = movedAlong(lorry, { position: [3, 4], heading: 91 }, track);
    expect(moved.position).toEqual([3, 4]);
    expect(moved.heading).toBe(91);
    expect(moved.scale).toBe(lorry.scale);
    expect(moved.id).toBe(lorry.id);
  });

  it("adds the file's own offset, for a model whose front is not its +z", () => {
    const track = { ...newTrack("t", "lorry", uneven), headingOffset: -90 };
    expect(movedAlong(lorry, { position: [0, 0], heading: 10 }, track).heading).toBe(280);
  });

  it("leaves the heading alone when the model is not meant to turn", () => {
    const track = { ...newTrack("t", "lorry", uneven), faceForward: false };
    expect(movedAlong({ ...lorry, heading: 45 }, { position: [0, 0], heading: 300 }, track).heading)
      .toBe(45);
  });
});

describe("one model over a layer", () => {
  const features = [
    { position: [0, 0] as [number, number], properties: { dir: 90, size: "2" } },
    { position: [1, 1] as [number, number], properties: { dir: "not a number", size: null } },
    { position: [2, 2] as [number, number], properties: {} },
  ];

  it("makes one placement per feature, each with its own id", () => {
    const { models } = spreadModels(lorry, features, "turbines", { limit: 10 });
    expect(models).toHaveLength(3);
    expect(new Set(models.map((m) => m.id)).size).toBe(3);
    expect(models[0]!.position).toEqual([0, 0]);
  });

  it("says how many there were, so a cap is visible rather than silent", () => {
    const { models, available } = spreadModels(lorry, features, "t", { limit: 2 });
    expect(models).toHaveLength(2);
    expect(available).toBe(3);
  });

  it("reads a bearing off the feature", () => {
    const { models } = spreadModels(lorry, features, "t", { limit: 10, headingField: "dir" });
    expect(models[0]!.heading).toBe(90);
  });

  it("keeps the template's own value where the column is not a number", () => {
    // "not a number" and a missing column are both no answer, not zero. A
    // turbine facing north because its bearing was blank is a wrong map that
    // looks like a right one.
    const { models } = spreadModels({ ...lorry, heading: 33 }, features, "t", {
      limit: 10,
      headingField: "dir",
    });
    expect(models[1]!.heading).toBe(33);
    expect(models[2]!.heading).toBe(33);
  });

  it("multiplies the template's scale rather than replacing it", () => {
    // The template's scale is what makes a file authored in centimetres
    // life-sized; a column that overwrote it would silently undo that.
    const { models } = spreadModels({ ...lorry, scale: 0.01 }, features, "t", {
      limit: 10,
      scaleField: "size",
    });
    expect(models[0]!.scale).toBeCloseTo(0.02, 10);
    expect(models[1]!.scale).toBeCloseTo(0.01, 10);
  });

  it("makes nothing from nothing", () => {
    expect(spreadModels(lorry, [], "t", { limit: 10 }).models).toEqual([]);
    expect(spreadModels(lorry, features, "t", { limit: 0 }).models).toEqual([]);
  });
});
