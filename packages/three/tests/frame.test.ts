import { describe, expect, it } from "vitest";
import { Box3, Matrix4, Vector3 } from "three";

import { frameOf, newModel, toMercator } from "@alidade/core";

import { cameraMatrix, placementMatrix, visibilityBoost } from "../src/frame";
import { BUILTIN_HEIGHTS, buildBuiltin, isBuiltin } from "../src/builtin";

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

describe("the size floor", () => {
  it("does nothing at a scale where the thing is already visible", () => {
    // A twenty metre block at two pixels a metre is forty pixels tall.
    expect(visibilityBoost(20, 2, 26)).toBe(1);
    expect(visibilityBoost(20, 100, 26)).toBe(1);
  });

  it("holds a thing at its floor once it would fall below it", () => {
    // Four metres at one pixel per ten metres is 0.4 of a pixel: invisible,
    // and indistinguishable from a model that failed to load.
    const boost = visibilityBoost(4, 0.1, 26);
    expect(4 * 0.1 * boost).toBeCloseTo(26, 6);
  });

  it("holds rather than grows, so zooming out does not inflate it", () => {
    const far = visibilityBoost(4, 0.01, 26);
    const further = visibilityBoost(4, 0.001, 26);
    // Ten times smaller on the ground means ten times the boost: the drawn
    // size is the same either way, which is the point.
    expect(4 * 0.01 * far).toBeCloseTo(4 * 0.001 * further, 6);
  });

  it("is off when the floor is zero, for a scene that must stay true to scale", () => {
    expect(visibilityBoost(4, 0.001, 0)).toBe(1);
  });

  it("refuses to divide by a size or a scale of nothing", () => {
    expect(visibilityBoost(0, 2, 26)).toBe(1);
    expect(visibilityBoost(4, 0, 26)).toBe(1);
    expect(visibilityBoost(4, Number.NaN, 26)).toBe(1);
  });
});

describe("the built-in models", () => {
  it("builds a fresh object each time, so two placements are not one mesh", () => {
    const a = buildBuiltin("builtin:turbine");
    const b = buildBuiltin("builtin:turbine");
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
  });

  it("is the size it says it is, measured rather than declared", () => {
    for (const [name, stated] of Object.entries(BUILTIN_HEIGHTS)) {
      const built = buildBuiltin(`builtin:${name}`)!;
      const box = new Box3().setFromObject(built);
      // Within a tenth of a metre of the catalogue's claim: the catalogue is
      // what the panel prints before anything is downloaded, and a number there
      // that disagrees with the mesh is a lie the user cannot check.
      expect(box.max.y, name).toBeCloseTo(stated, 1);
    }
  });

  it("stands on the ground rather than through it", () => {
    for (const name of Object.keys(BUILTIN_HEIGHTS)) {
      const box = new Box3().setFromObject(buildBuiltin(`builtin:${name}`)!);
      expect(box.min.y, name).toBeGreaterThanOrEqual(-0.01);
    }
  });

  it("has nothing to say about a name it does not know", () => {
    expect(buildBuiltin("builtin:helicopter")).toBeNull();
    expect(isBuiltin("https://example.com/x.glb")).toBe(false);
  });

  it("has a body for every kind of thing a feed reports moving", () => {
    // The live layer needs something to put on a moving dot, and a catalogue of
    // masts and turbines has nothing that drives.
    for (const name of ["car", "van", "truck", "aircraft", "boat", "drone", "bird"]) {
      expect(buildBuiltin(`builtin:${name}`), name).not.toBeNull();
    }
  });

  it("points every vehicle the way its heading says", () => {
    /*
     * A placement's heading turns the model about Y, and glTF puts the front at
     * +z, so a body modelled across its own axis drives sideways down the road
     * at every heading. Longer than it is wide is the test for that.
     *
     * The bird is left out and the aircraft with it: both are genuinely wider
     * than they are long, because a wing is. Widening the assertion to cover
     * them would mean asserting nothing.
     */
    for (const name of ["car", "van", "truck", "boat"]) {
      const box = new Box3().setFromObject(buildBuiltin(`builtin:${name}`)!);
      const size = box.getSize(new Vector3());
      expect(size.z, name).toBeGreaterThan(size.x);
    }
  });

  /**
   * A hover named an airliner that was nowhere near the pointer.
   *
   * The hover pick tested each model's `Box3`, which is axis aligned in world
   * space: the box around a rotated model is bigger than the model, by half
   * again on the diagonal. It was tolerable while models stood still and became
   * obvious when they started following a live feed and rotating every frame.
   * The pick now confirms against the triangles; this is the measurement that
   * says why the box alone could not be trusted.
   */
  it("has a bounding box that overstates a rotated model", () => {
    const built = buildBuiltin("builtin:truck")!;
    const straight = new Box3().setFromObject(built).getSize(new Vector3());
    built.rotation.y = Math.PI / 4;
    built.updateMatrixWorld(true);
    const turned = new Box3().setFromObject(built).getSize(new Vector3());
    expect(turned.x).toBeGreaterThan(straight.x * 2);
  });
});
