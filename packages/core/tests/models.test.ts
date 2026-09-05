import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import {
  EARTH_RADIUS,
  MODELS_LAYER_ID,
  anchorLift,
  describeModel,
  duplicateModel,
  frameOf,
  looksLikeModel,
  nameFromUrl,
  newModel,
  removeModel,
  toMercator,
  unitsPerMetre,
  withModel,
  yawOf,
} from "../src/models";
import { reconcile } from "../src/reconcile";
import type { Model3D, Op } from "../src";
import { clone, project } from "./fixture";

const truck = (): Model3D =>
  newModel({
    name: "Milk truck",
    url: "https://example.org/CesiumMilkTruck.glb",
    position: [51.389, 35.6892],
  });

const withModels = (...items: Model3D[]) => {
  const p = clone(project());
  p.models = { visible: true, items };
  return p;
};

describe("mercator arithmetic", () => {
  it("puts the origin of the world at the middle of the square", () => {
    const m = toMercator(0, 0);
    expect(m.x).toBeCloseTo(0.5, 12);
    expect(m.y).toBeCloseTo(0.5, 12);
    expect(m.z).toBe(0);
  });

  it("runs y south: a point north of the equator has a smaller y", () => {
    expect(toMercator(0, 35).y).toBeLessThan(toMercator(0, 0).y);
  });

  it("makes a metre of height the same number of units as a metre of ground", () => {
    // Conformal: one metre up at a latitude is one metre east at that latitude.
    const lat = 35.6892;
    const metre = 360 / (2 * Math.PI * EARTH_RADIUS * Math.cos((lat * Math.PI) / 180));
    const up = toMercator(51, lat, 1).z;
    const east = toMercator(51 + metre, lat).x - toMercator(51, lat).x;
    expect(up / east).toBeCloseTo(1, 6);
  });

  it("stretches towards the poles", () => {
    expect(unitsPerMetre(60)).toBeCloseTo(unitsPerMetre(0) * 2, 6);
  });

  it("does not blow up at the poles", () => {
    expect(Number.isFinite(toMercator(0, 90).y)).toBe(true);
    expect(Number.isFinite(unitsPerMetre(90))).toBe(true);
  });
});

describe("a placement as a frame", () => {
  it("is at rest at its own origin, facing north", () => {
    const model = truck();
    const frame = frameOf(model, { lon: model.position[0], lat: model.position[1] });
    expect(frame.offset[0]).toBeCloseTo(0, 9);
    expect(frame.offset[1]).toBeCloseTo(0, 9);
    expect(frame.offset[2]).toBeCloseTo(0, 9);
    expect(frame.scale).toBeCloseTo(1, 12);
    // glTF fronts face +z, which is south; north is half a turn away.
    expect(frame.yaw).toBeCloseTo(Math.PI, 12);
  });

  it("measures the offset in metres, east then up then south", () => {
    const model = truck();
    const [lon, lat] = model.position;
    const metre = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const moved = { ...model, position: [lon + 100 * metre, lat] as [number, number], altitude: 12 };
    const frame = frameOf(moved, { lon, lat });
    expect(frame.offset[0]).toBeCloseTo(100, 0);
    expect(frame.offset[1]).toBeCloseTo(12, 6);
    expect(Math.abs(frame.offset[2])).toBeLessThan(1e-6);
    // North of the origin is a negative z.
    const north = frameOf({ ...model, position: [lon, lat + 0.001] }, { lon, lat });
    expect(north.offset[2]).toBeLessThan(0);
  });

  it("adds the terrain under the model to its height", () => {
    const model = truck();
    const [lon, lat] = model.position;
    expect(frameOf({ ...model, altitude: 2 }, { lon, lat }, 1200).offset[1]).toBeCloseTo(1202, 6);
  });

  it("corrects the scale for a model at a different latitude from the origin", () => {
    // Mercator doubles at 60°: a metre there is twice the units a metre is at
    // the equator, so a model up there drawn in an equatorial frame is doubled.
    const model = { ...truck(), position: [0, 60] as [number, number] };
    expect(frameOf(model, { lon: 0, lat: 0 }).scale).toBeCloseTo(2, 6);
  });

  it("turns clockwise as the heading increases", () => {
    // Facing east is a quarter turn less than facing north, seen from above.
    expect(yawOf(0) - yawOf(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(yawOf(180)).toBeCloseTo(0, 12);
  });

  it("lifts a model by its own depth when anchored at the base", () => {
    expect(anchorLift("base", -0.4)).toBeCloseTo(0.4, 12);
    expect(anchorLift("base", 0)).toBe(0);
    expect(anchorLift("origin", -0.4)).toBe(0);
  });
});

describe("the document", () => {
  it("names a model after its file", () => {
    expect(nameFromUrl("https://x.org/a/CesiumMilkTruck.glb?v=2")).toBe("Cesium Milk Truck");
    expect(nameFromUrl("/api/models/water_tower-v3.gltf")).toBe("water tower v3");
    expect(nameFromUrl("")).toBe("Model");
  });

  it("gives each model an id of its own and sensible defaults", () => {
    const a = truck();
    const b = truck();
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ altitude: 0, heading: 0, scale: 1, anchor: "base", clamp: true, visible: true, opacity: 1 });
  });

  it("knows a model file by its name and a session upload by its scheme", () => {
    expect(looksLikeModel("a/b.GLB")).toBe(true);
    expect(looksLikeModel("a/b.gltf?x=1")).toBe(true);
    expect(looksLikeModel("blob:http://localhost/abc")).toBe(true);
    expect(looksLikeModel("a/b.obj")).toBe(false);
  });

  it("edits, duplicates and removes in place", () => {
    const model = truck();
    const p = withModels(model);
    withModel(p, model.id, (m) => void (m.heading = 45));
    expect(p.models!.items[0]!.heading).toBe(45);
    duplicateModel(p, model.id);
    expect(p.models!.items).toHaveLength(2);
    expect(p.models!.items[1]!.name).toBe("Milk truck copy");
    expect(p.models!.items[1]!.position[0]).toBeGreaterThan(model.position[0]);
    removeModel(p, model.id);
    expect(p.models!.items.map((m) => m.name)).toEqual(["Milk truck copy"]);
  });

  it("describes a placement in as few words as it needs", () => {
    const model = truck();
    expect(describeModel(model)).toBe("35.6892, 51.3890");
    expect(describeModel({ ...model, altitude: 12, heading: 90, scale: 2.5 })).toBe(
      "35.6892, 51.3890 · +12 m · 90° · ×2.5",
    );
  });
});

describe("compiling models", () => {
  it("emits no scene layer for a project with no models", () => {
    const ids = compile(project()).layers.map((l) => l.id);
    expect(ids).not.toContain(MODELS_LAYER_ID);
    const empty = withModels();
    expect(compile(empty).layers.map((l) => l.id)).not.toContain(MODELS_LAYER_ID);
  });

  it("puts one custom layer over the data and under the place names", () => {
    const p = withModels(truck(), truck());
    p.basemap.labelTiles = { tiles: ["https://x/{z}/{x}/{y}.png"], attribution: "" };
    p.chrome.graticule.enabled = true;
    const compiled = compile(p);
    const ids = compiled.layers.map((l) => l.id);
    const scene = compiled.layers.find((l) => l.id === MODELS_LAYER_ID)!;
    expect(scene.type).toBe("custom");
    expect(scene.slot).toBe("labels");
    expect(scene.layout).toEqual({ visibility: "visible" });
    const at = ids.indexOf(MODELS_LAYER_ID);
    // Over every data layer, the labels a data layer carries included.
    expect(at).toBeGreaterThan(ids.indexOf("density:fill"));
    expect(at).toBeGreaterThan(ids.indexOf("density:label"));
    expect(at).toBeGreaterThan(ids.indexOf("sensors:circle"));
    // Under the basemap's place names and the graticule.
    expect(at).toBeLessThan(ids.indexOf("basemap:labels"));
    expect(at).toBeLessThan(ids.indexOf("chrome:graticule:line"));
    // Two models, one layer.
    expect(ids.filter((id) => id === MODELS_LAYER_ID)).toHaveLength(1);
  });

  it("hides the scene when models are switched off", () => {
    const p = withModels(truck());
    p.models!.visible = false;
    const scene = compile(p).layers.find((l) => l.id === MODELS_LAYER_ID)!;
    expect(scene.layout["visibility"]).toBe("none");
  });
});

describe("reconciling models", () => {
  const kinds = (ops: Op[]) => ops.map((op) => op.t);

  it("adds the scene layer before the models that go in it", () => {
    const model = truck();
    const ops = reconcile(project(), withModels(model));
    const layer = ops.findIndex((op) => op.t === "layer.add" && op.spec.id === MODELS_LAYER_ID);
    const added = ops.findIndex((op) => op.t === "model.add");
    expect(layer).toBeGreaterThanOrEqual(0);
    expect(added).toBeGreaterThan(layer);
    expect(ops[added]).toEqual({ t: "model.add", model });
  });

  it("sends only the model that changed, and sends all of it", () => {
    const a = truck();
    const b = truck();
    const before = withModels(a, b);
    const after = clone(before);
    after.models!.items[1]!.heading = 30;
    const ops = reconcile(before, after);
    expect(ops).toEqual([{ t: "model.update", model: after.models!.items[1] }]);
  });

  it("emits nothing for an edit that changed nothing", () => {
    const before = withModels(truck());
    expect(reconcile(before, clone(before))).toEqual([]);
  });

  it("takes the scene layer down with the last model", () => {
    const model = truck();
    const before = withModels(model);
    const ops = reconcile(before, withModels());
    expect(kinds(ops)).toEqual(["layer.remove", "model.remove"]);
    expect(ops[1]).toEqual({ t: "model.remove", id: model.id });
  });

  it("only touches visibility when the switch is flipped", () => {
    const before = withModels(truck());
    const after = clone(before);
    after.models!.visible = false;
    expect(reconcile(before, after)).toEqual([
      { t: "layer.layout", id: MODELS_LAYER_ID, key: "visibility", value: "none" },
    ]);
  });

  it("replays every model from an empty style", () => {
    const p = withModels(truck(), truck());
    const ops = reconcile(null, p);
    expect(ops.filter((op) => op.t === "model.add")).toHaveLength(2);
  });

  it("loads a project written before models existed", () => {
    const p = project();
    delete (p as { models?: unknown }).models;
    expect(() => reconcile(null, p)).not.toThrow();
    expect(compile(p).layers.map((l) => l.id)).not.toContain(MODELS_LAYER_ID);
  });
});
