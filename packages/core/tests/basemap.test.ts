import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import { reconcile } from "../src/reconcile";
import type { Basemap } from "../src/types/project";
import { clone, project } from "./fixture";

const dark: Basemap = {
  id: "dark",
  name: "Dark",
  background: "#0b0b0c",
  raster: { tiles: ["https://tiles.example.com/dark/{z}/{x}/{y}.png"], attribution: "Example" },
  labelTiles: {
    tiles: ["https://tiles.example.com/labels/{z}/{x}/{y}.png"],
    attribution: "Example",
  },
  labels: true,
};

const withBasemap = (basemap: Basemap) => {
  const p = clone(project());
  p.basemap = basemap;
  return p;
};

describe("basemap", () => {
  it("puts the tiles straight on top of the background", () => {
    const ids = compile(withBasemap(dark)).layers.map((l) => l.id);
    expect(ids.slice(0, 2)).toEqual(["basemap:background", "basemap:raster"]);
  });

  it("declares the tile source itself rather than borrowing one", () => {
    const { sources } = compile(withBasemap(dark));
    expect(sources["basemap:raster"]).toMatchObject({ type: "raster", attribution: "Example" });
  });

  it("draws basemap labels above the data, not under it", () => {
    const ids = compile(withBasemap(dark)).layers.map((l) => l.id);
    expect(ids.indexOf("basemap:labels")).toBeGreaterThan(ids.indexOf("density:fill"));
  });

  it("keeps basemap labels below the labels the user made", () => {
    const p = withBasemap(dark);
    p.tree.push({
      type: "layer",
      id: "places",
      name: "Place names",
      slot: "labels",
      source: "wards",
      geometry: "point",
      visible: true,
      opacity: 1,
      symbology: { kind: "single", color: "#ffffff" },
    });
    const ids = compile(p).layers.map((l) => l.id);
    expect(ids.indexOf("basemap:labels")).toBeLessThan(ids.indexOf("places:circle"));
  });

  it("turning labels off removes one layer and leaves the tiles alone", () => {
    const before = withBasemap(dark);
    const after = withBasemap({ ...dark, labels: false });
    const ops = reconcile(before, after);
    expect(ops).toEqual([
      { t: "layer.remove", id: "basemap:labels" },
      { t: "source.remove", id: "basemap:labels" },
    ]);
  });

  it("takes a layer down before replacing the source it reads", () => {
    const light: Basemap = {
      ...dark,
      id: "light",
      raster: { tiles: ["https://tiles.example.com/light/{z}/{x}/{y}.png"], attribution: "Example" },
    };
    const ops = reconcile(withBasemap(dark), withBasemap(light));
    const kinds = ops.map((o) => o.t);
    // A renderer refuses to remove a source that is still being read.
    expect(kinds.indexOf("layer.remove")).toBeLessThan(kinds.indexOf("source.remove"));
    expect(kinds.indexOf("source.add")).toBeLessThan(kinds.indexOf("layer.add"));
    expect(ops.filter((o) => o.t === "layer.remove").map((o) => (o as { id: string }).id)).toEqual([
      "basemap:raster",
    ]);
  });

  it("fading the basemap is a paint change, not a reload", () => {
    const ops = reconcile(withBasemap(dark), withBasemap({ ...dark, opacity: 0.4 }));
    expect(ops).toEqual([
      { t: "layer.paint", id: "basemap:raster", key: "raster-opacity", value: 0.4 },
    ]);
  });

  it("swapping the basemap never touches a data layer", () => {
    const light: Basemap = {
      ...dark,
      id: "light",
      name: "Light",
      background: "#f2f2f2",
      raster: { tiles: ["https://tiles.example.com/light/{z}/{x}/{y}.png"], attribution: "Example" },
    };
    const ops = reconcile(withBasemap(dark), withBasemap(light));
    const touched = ops
      .map((o) => ("id" in o ? o.id : "spec" in o ? o.spec.id : ""))
      .filter(Boolean);
    expect(touched.every((id) => id.startsWith("basemap:"))).toBe(true);
  });
});
