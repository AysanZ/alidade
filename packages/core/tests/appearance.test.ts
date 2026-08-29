import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import { graticuleGeoJSON } from "../src/graticule";
import { reconcile } from "../src/reconcile";
import { clone, project } from "./fixture";

const withDem = () => {
  const p = clone(project());
  p.sources["dem"] = {
    type: "raster-dem",
    tiles: ["https://example.com/{z}/{x}/{y}.png"],
    encoding: "terrarium",
  };
  return p;
};

describe("map appearance", () => {
  it("draws hillshade above the basemap and below the data", () => {
    const p = withDem();
    p.environment.hillshade = {
      source: "dem",
      illumination: 315,
      intensity: 0.55,
      shadowColor: "#000000",
      highlightColor: "#ffffff",
    };
    const ids = compile(p).layers.map((l) => l.id);
    expect(ids.indexOf("environment:hillshade")).toBe(1);
    expect(ids.indexOf("environment:hillshade")).toBeLessThan(ids.indexOf("density:fill"));
  });

  it("states the sun azimuth in degrees clockwise from north", () => {
    const p = withDem();
    p.environment.hillshade = {
      source: "dem",
      illumination: 315,
      intensity: 0.55,
      shadowColor: "#000000",
      highlightColor: "#ffffff",
    };
    const layer = compile(p).layers.find((l) => l.id === "environment:hillshade")!;
    expect(layer.paint["hillshade-illumination-direction"]).toBe(315);
    expect(layer.paint["hillshade-illumination-anchor"]).toBe("map");
  });

  it("adds terrain as one environment operation, not a layer", () => {
    const next = withDem();
    next.environment.terrain = { source: "dem", exaggeration: 1.4 };
    const ops = reconcile(project(), next);
    expect(ops.filter((o) => o.t === "layer.add")).toHaveLength(0);
    expect(ops.at(-1)).toEqual({
      t: "env.set",
      key: "terrain",
      value: { source: "dem", exaggeration: 1.4 },
    });
  });

  it("removing fog resets it rather than leaving it behind", () => {
    const before = clone(project());
    before.environment.fog = { color: "#0a0a0b", range: [0.2, 8] };
    const ops = reconcile(before, project());
    expect(ops).toEqual([{ t: "env.set", key: "fog", value: null }]);
  });

  it("turning the graticule on adds one source and two layers", () => {
    const next = clone(project());
    next.chrome.graticule = { ...next.chrome.graticule, enabled: true };
    const ops = reconcile(project(), next);
    expect(ops.filter((o) => o.t === "source.add")).toHaveLength(1);
    expect(ops.filter((o) => o.t === "layer.add").map((o) => (o as { spec: { id: string } }).spec.id))
      .toEqual(["chrome:graticule:line", "chrome:graticule:label"]);
  });

  it("keeps the graticule out of the data slot", () => {
    const p = clone(project());
    p.chrome.graticule = { ...p.chrome.graticule, enabled: true };
    const layers = compile(p).layers;
    const line = layers.find((l) => l.id === "chrome:graticule:line")!;
    expect(line.slot).toBe("labels");
    expect(layers.indexOf(line)).toBeGreaterThan(
      layers.findIndex((l) => l.id === "density:fill"),
    );
  });

  it("does not rebuild the graticule when the camera moves", () => {
    const before = clone(project());
    before.chrome.graticule = { ...before.chrome.graticule, enabled: true };
    const after = clone(before);
    after.view = { ...after.view, zoom: 14, bearing: 30 };
    const ops = reconcile(before, after);
    expect(ops.every((o) => o.t === "camera.set")).toBe(true);
  });

  it("generates meridians and parallels for the interval alone", () => {
    const g = graticuleGeoJSON(10);
    const meridians = g.features.filter((f) => f.properties.axis === "meridian");
    const parallels = g.features.filter((f) => f.properties.axis === "parallel");
    expect(meridians).toHaveLength(37);
    expect(parallels).toHaveLength(18);
    expect(meridians[0]!.properties.label).toBe("180°W");
    expect(g.features.find((f) => f.properties.label === "0°")).toBeDefined();
  });

  it("refuses an interval that would never terminate", () => {
    expect(() => graticuleGeoJSON(0)).toThrow();
  });
});
