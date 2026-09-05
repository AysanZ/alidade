import { describe, expect, it } from "vitest";
import { Matrix4, Vector3 } from "three";

import { frameOf, newModel, toMercator } from "@alidade/core";

import { cameraMatrix, placementMatrix } from "../src/frame";

const origin = { lon: 51.389, lat: 35.6892 };

describe("the camera matrix", () => {
  it("takes the scene's origin to the map's mercator position", () => {
    // With the map's matrix as the identity, the camera matrix is just the
    // change of frame, and the scene origin should land on the mercator point.
    const m = cameraMatrix(new Matrix4().elements, origin);
    const at = new Vector3(0, 0, 0).applyMatrix4(m);
    const expected = toMercator(origin.lon, origin.lat);
    expect(at.x).toBeCloseTo(expected.x, 12);
    expect(at.y).toBeCloseTo(expected.y, 12);
    expect(at.z).toBeCloseTo(0, 12);
  });

  it("runs the scene's axes east, up and south", () => {
    const m = cameraMatrix(new Matrix4().elements, origin);
    const o = new Vector3(0, 0, 0).applyMatrix4(m);
    const east = new Vector3(1, 0, 0).applyMatrix4(m).sub(o);
    const up = new Vector3(0, 1, 0).applyMatrix4(m).sub(o);
    const south = new Vector3(0, 0, 1).applyMatrix4(m).sub(o);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 12);
    // Mercator y runs south, so south is a positive y; up is the map's z.
    expect(south.y).toBeGreaterThan(0);
    expect(south.x).toBeCloseTo(0, 12);
    expect(up.z).toBeGreaterThan(0);
    // A metre is a metre in every direction.
    expect(east.length()).toBeCloseTo(up.length(), 12);
    expect(south.length()).toBeCloseTo(up.length(), 12);
  });
});

describe("a placement matrix", () => {
  it("puts a model where the frame says and turns its front the right way", () => {
    const model = newModel({ url: "x.glb", position: [origin.lon, origin.lat], heading: 90, altitude: 5 });
    const m = placementMatrix(frameOf(model, origin));
    const at = new Vector3(0, 0, 0).applyMatrix4(m);
    expect(at.y).toBeCloseTo(5, 9);
    // glTF fronts face +z. Heading 90 is east, which is the scene's +x.
    const front = new Vector3(0, 0, 1).applyMatrix4(m).sub(at);
    expect(front.x).toBeCloseTo(1, 9);
    expect(front.z).toBeCloseTo(0, 9);
  });

  it("composes with the camera matrix so a model lands on its own mercator point", () => {
    const lon = origin.lon + 0.01;
    const lat = origin.lat - 0.004;
    const model = newModel({ url: "x.glb", position: [lon, lat], altitude: 30 });
    const camera = cameraMatrix(new Matrix4().elements, origin);
    const placed = placementMatrix(frameOf(model, origin));
    const at = new Vector3(0, 0, 0).applyMatrix4(placed).applyMatrix4(camera);
    const expected = toMercator(lon, lat, 30);
    expect(at.x).toBeCloseTo(expected.x, 12);
    expect(at.y).toBeCloseTo(expected.y, 12);
    expect(at.z).toBeCloseTo(expected.z, 12);
  });
});
