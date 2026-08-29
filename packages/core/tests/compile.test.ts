import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import type { LayerNode } from "../src/types/project";
import { clone, project } from "./fixture";

describe("compile", () => {
  it("expands one polygon layer into fill, line and label", () => {
    const ids = compile(project())
      .layers.filter((l) => l.id.startsWith("density:"))
      .map((l) => l.id);
    expect(ids).toEqual(["density:fill", "density:line", "density:label"]);
  });

  it("keeps the basemap at the bottom", () => {
    expect(compile(project()).layers[0]!.id).toBe("basemap:background");
  });

  it("draws the top of the table of contents on top", () => {
    // Sensors sit above the census group in the tree, so they draw last.
    const ids = compile(project()).layers.map((l) => l.id);
    expect(ids.indexOf("sensors:circle")).toBeGreaterThan(ids.indexOf("density:fill"));
  });

  it("applies slots before tree order", () => {
    const p = clone(project());
    // A data layer dragged to the very top of the tree still stays below labels.
    const label: LayerNode = {
      type: "layer",
      id: "places",
      name: "Place names",
      slot: "labels",
      source: "wards",
      geometry: "point",
      visible: true,
      opacity: 1,
      symbology: { kind: "single", color: "#fff" },
    };
    p.tree.push(label);
    const ids = compile(p).layers.map((l) => l.id);
    expect(ids.indexOf("places:circle")).toBeGreaterThan(ids.indexOf("sensors:circle"));
  });

  it("multiplies group opacity into the layer", () => {
    const p = clone(project());
    (p.tree[1] as { opacity: number }).opacity = 0.5;
    const fill = compile(p).layers.find((l) => l.id === "density:fill")!;
    expect(fill.paint["fill-opacity"]).toBe(0.5);
  });

  it("hides every layer in a bundle when the group is hidden", () => {
    const p = clone(project());
    (p.tree[1] as { visible: boolean }).visible = false;
    const hidden = compile(p)
      .layers.filter((l) => l.id.startsWith("density:"))
      .map((l) => l.layout.visibility);
    expect(hidden).toEqual(["none", "none", "none"]);
  });

  it("turns a scale range into a zoom range, inverted", () => {
    const fill = compile(project()).layers.find((l) => l.id === "density:fill")!;
    expect(fill.minzoom).toBeLessThan(fill.maxzoom!);
    expect(fill.minzoom).toBeCloseTo(10.2, 0);
  });

  it("gives missing values their own colour rather than the bottom class", () => {
    const fill = compile(project()).layers.find((l) => l.id === "density:fill")!;
    expect(JSON.stringify(fill.paint["fill-color"])).toContain("#3a3a40");
  });
});
