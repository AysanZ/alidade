import { describe, expect, it } from "vitest";

import { BUILDINGS_LAYER_ID, defaultBuildings, heightExpression } from "../src/buildings";
import { compile } from "../src/compile";
import { reconcile } from "../src/reconcile";
import { MODELS_LAYER_ID } from "../src/models";
import type { MapProject } from "../src/types/project";
import { clone, project } from "./fixture";

/** A project with a vector source the buildings can read, and buildings on. */
function withBuildings(change: (p: MapProject) => void = () => {}): MapProject {
  const p = clone(project());
  p.sources["osm"] = { type: "vector", url: "https://tiles.example.com/planet" };
  p.environment.buildings = defaultBuildings("osm");
  change(p);
  return p;
}

describe("buildings", () => {
  it("is one layer however many buildings are on the screen", () => {
    const layers = compile(withBuildings()).layers.filter((l) => l.type === "fill-extrusion");
    expect(layers).toHaveLength(1);
    expect(layers[0]!.id).toBe(BUILDINGS_LAYER_ID);
  });

  it("draws over the data and under the place names", () => {
    const p = withBuildings((d) => {
      d.basemap.labelTiles = {
        tiles: ["https://tiles.example.com/labels/{z}/{x}/{y}.png"],
        attribution: "Example",
      };
    });
    const ids = compile(p).layers.map((l) => l.id);
    expect(ids.indexOf(BUILDINGS_LAYER_ID)).toBeGreaterThan(ids.indexOf("density:fill"));
    expect(ids.indexOf(BUILDINGS_LAYER_ID)).toBeLessThan(ids.indexOf("basemap:labels"));
  });

  it("goes under the model scene, so a lorry parked behind a tower is behind it", () => {
    const p = withBuildings((d) => {
      d.models = {
        visible: true,
        items: [
          {
            id: "m1",
            name: "Lorry",
            url: "https://example.com/lorry.glb",
            position: [51.4, 35.7],
            altitude: 0,
            heading: 0,
            scale: 1,
            anchor: "base",
            clamp: true,
            visible: true,
            opacity: 1,
          },
        ],
      };
    });
    const ids = compile(p).layers.map((l) => l.id);
    expect(ids.indexOf(BUILDINGS_LAYER_ID)).toBeLessThan(ids.indexOf(MODELS_LAYER_ID));
  });

  it("does not ask the renderer for footprints below the zoom the tiles carry them", () => {
    const layer = compile(withBuildings()).layers.find((l) => l.id === BUILDINGS_LAYER_ID)!;
    expect(layer.minzoom).toBe(14);
  });

  it("draws a building with no surveyed height rather than dropping it", () => {
    // to-number turns null into 0, so the fallback has to be reached before it.
    expect(heightExpression(defaultBuildings())).toEqual([
      "to-number",
      ["coalesce", ["get", "render_height"], 8],
    ]);
  });

  it("exaggeration multiplies the height rather than replacing it", () => {
    const expression = heightExpression({ ...defaultBuildings(), exaggeration: 2 }) as unknown[];
    expect(expression[0]).toBe("*");
    expect(expression[2]).toBe(2);
  });

  it("recolouring the buildings is a paint change, not a reload", () => {
    const ops = reconcile(
      withBuildings(),
      withBuildings((d) => {
        d.environment.buildings!.color = "#112233";
      }),
    );
    expect(ops.every((o) => o.t === "layer.paint")).toBe(true);
  });

  it("turning them off takes the layer down and leaves the source alone", () => {
    const before = withBuildings();
    const after = withBuildings((d) => delete d.environment.buildings);
    const ops = reconcile(before, after);
    // The source stays: it was declared by the project, not by the layer, and
    // nothing is fetched from a source nothing reads.
    expect(ops).toEqual([{ t: "layer.remove", id: BUILDINGS_LAYER_ID }]);
  });

  it("draws nothing at all when the source it names is not declared", () => {
    const p = withBuildings();
    delete p.sources["osm"];
    const ids = compile(p).layers.map((l) => l.id);
    expect(ids).not.toContain(BUILDINGS_LAYER_ID);
  });
});
