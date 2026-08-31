import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import { reconcile } from "../src/reconcile";
import { gridKey, padded, squareGridGeoJSON, utmGridGeoJSON } from "../src/grids";
import {
  LAYER_COLORS,
  RAMPS,
  equalIntervalBreaks,
  nextColor,
  rampOf,
  singleSymbol,
} from "../src/palette";
import type { LayerNode, MapProject } from "../src/types/project";
import { defaultChrome } from "../src/types/project";

function project(): MapProject {
  return {
    schema: 3,
    id: "t",
    name: "Test",
    view: { center: [51.4, 35.7], zoom: 10, pitch: 0, bearing: 0 },
    basemap: { id: "none", name: "None", background: "#000", labels: false },
    environment: {},
    chrome: defaultChrome(),
    sources: { roads: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.mvt"] } },
    tree: [
      {
        type: "layer",
        id: "roads",
        name: "Roads",
        slot: "data",
        source: "roads",
        sourceLayer: "roads",
        geometry: "line",
        visible: true,
        opacity: 1,
        symbology: { kind: "single", color: "#fff" },
      },
    ],
  };
}

/**
 * Importing the same file twice used to put two nodes with one id in the tree.
 * They compiled to two engine layers with one id, which a renderer refuses and
 * the reconciler cannot tell apart, so the layer appeared in the table of
 * contents and nothing was drawn.
 */
describe("a duplicate id in the tree", () => {
  it("compiles to one engine layer, not two", () => {
    const next = project();
    next.tree.unshift(JSON.parse(JSON.stringify(next.tree[0])) as LayerNode);
    const ids = compile(next).layers.map((l) => l.id);
    expect(ids.filter((id) => id === "roads:line")).toHaveLength(1);
  });
});

/**
 * A renderer cannot move a layer onto a different source or change what kind of
 * layer it is. Those used to fall through the property diff and be skipped.
 */
describe("a layer that changed identity", () => {
  it("is removed and added again when its source changes", () => {
    const before = project();
    const after = project();
    after.sources["other"] = { type: "vector", tiles: ["https://y/{z}/{x}/{y}.mvt"] };
    (after.tree[0] as LayerNode).source = "other";

    const ops = reconcile(before, after);
    expect(ops).toContainEqual({ t: "layer.remove", id: "roads:line" });
    expect(ops.some((op) => op.t === "layer.add" && op.spec.id === "roads:line")).toBe(true);
  });

  it("is removed and added again when its source layer changes", () => {
    const before = project();
    const after = project();
    (after.tree[0] as LayerNode).sourceLayer = "streets";
    expect(reconcile(before, after)).toContainEqual({ t: "layer.remove", id: "roads:line" });
  });

  it("is left alone when only its paint changed", () => {
    const before = project();
    const after = project();
    (after.tree[0] as LayerNode).symbology = { kind: "single", color: "#f00" };
    const ops = reconcile(before, after);
    expect(ops.some((op) => op.t === "layer.remove")).toBe(false);
    expect(ops).toContainEqual({ t: "layer.paint", id: "roads:line", key: "line-color", value: "#f00" });
  });
});

/**
 * A geojson source whose data changed is updated in place. Removing and re-adding
 * it would take every layer reading it down with it, which is what made the
 * graticule flicker and rebuild on every pan.
 */
describe("a geojson source with new data", () => {
  it("is refreshed rather than replaced", () => {
    const before = project();
    before.chrome.graticule = { ...before.chrome.graticule, enabled: true, interval: 1 };
    const after = JSON.parse(JSON.stringify(before)) as MapProject;
    after.chrome.graticule.interval = 5;

    const ops = reconcile(before, after);
    expect(ops.some((op) => op.t === "source.data" && op.id === "chrome:graticule")).toBe(true);
    expect(ops.some((op) => op.t === "source.remove")).toBe(false);
    expect(ops.some((op) => op.t === "layer.remove")).toBe(false);
  });

  it("still replaces a source that changed type", () => {
    const before = project();
    const after = project();
    after.sources["roads"] = { type: "raster", tiles: ["https://y/{z}/{x}/{y}.png"] };
    const ops = reconcile(before, after);
    expect(ops).toContainEqual({ t: "source.remove", id: "roads" });
  });
});

describe("reference grids", () => {
  it("draws sixty one meridians and twenty one parallels for UTM", () => {
    const grid = utmGridGeoJSON();
    expect(grid.features.filter((f) => f.properties.kind === "zone")).toHaveLength(61);
    expect(grid.features.filter((f) => f.properties.kind === "band")).toHaveLength(21);
  });

  it("spaces a metric grid by the cosine of the latitude", () => {
    const near = squareGridGeoJSON({ west: 0, south: 0, east: 0.2, north: 0.2 }, 10000);
    const far = squareGridGeoJSON({ west: 0, south: 60, east: 0.2, north: 60.2 }, 10000);
    // The same span of longitude is a shorter distance further north, so it
    // holds fewer ten kilometre cells.
    expect(far.features.length).toBeLessThan(near.features.length);
  });

  it("gives up rather than emitting a grid nobody could read", () => {
    const absurd = squareGridGeoJSON({ west: -180, south: -80, east: 180, north: 80 }, 1000);
    expect(absurd.features).toEqual([]);
  });

  it("keeps the same key for a small pan and changes it for a large one", () => {
    const here = { west: 51, south: 35, east: 51.2, north: 35.2 };
    const nudged = { west: 51.001, south: 35.001, east: 51.201, north: 35.201 };
    const elsewhere = { west: 60, south: 35, east: 60.2, north: 35.2 };
    expect(gridKey(padded(here), 10000)).toBe(gridKey(padded(nudged), 10000));
    expect(gridKey(padded(here), 10000)).not.toBe(gridKey(padded(elsewhere), 10000));
  });
});

describe("drawings", () => {
  it("compile into the overlay slot, above everything else", () => {
    const withDrawing = project();
    withDrawing.annotations = {
      visible: true,
      opacity: 1,
      features: [
        { id: "a", kind: "point", name: "Here", color: "#fff", coordinates: [[51.4, 35.7]] },
      ],
    };
    const ids = compile(withDrawing).layers.map((l) => l.id);
    expect(ids).toContain("chrome:annotations:point");
    expect(ids.indexOf("chrome:annotations:point")).toBeGreaterThan(ids.indexOf("roads:line"));
  });

  it("add no sources at all when there is nothing drawn", () => {
    expect(Object.keys(compile(project()).sources)).not.toContain("chrome:annotations");
  });
});

/**
 * Every import used to arrive as the same blue, so three layers on top of each
 * other were one indistinguishable smear.
 */
describe("colours for new layers", () => {
  it("does not repeat a colour that is already on the map", () => {
    const first = nextColor([]);
    const second = nextColor([first]);
    const third = nextColor([first, second]);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("keeps going once the palette is used up rather than repeating the first", () => {
    const all = [...LAYER_COLORS];
    expect(all).toContain(nextColor(all));
  });

  it("gives a point layer no stroke and a polygon one", () => {
    expect(singleSymbol("#fff", "point").stroke).toBeUndefined();
    expect(singleSymbol("#fff", "polygon").stroke).toBeDefined();
  });

  it("resamples a five stop ramp to any number of classes", () => {
    expect(rampOf(RAMPS["Blue"]!, 7)).toHaveLength(7);
    expect(rampOf(RAMPS["Blue"]!, 3)).toHaveLength(3);
    expect(rampOf(RAMPS["Blue"]!, 7)[0]).toBe(RAMPS["Blue"]![0]);
  });

  it("splits a range into equal intervals", () => {
    expect(equalIntervalBreaks(0, 100, 4)).toEqual([25, 50, 75]);
    expect(equalIntervalBreaks(0, 0, 4)).toEqual([]);
  });
});

describe("a selection", () => {
  it("draws a highlight over the layer it names", () => {
    const withSelection = project();
    withSelection.selection = { layer: "roads", field: "name", values: ["A1"] };
    const ids = compile(withSelection).layers.map((l) => l.id);
    expect(ids).toContain("chrome:selection:line");
    expect(ids.indexOf("chrome:selection:line")).toBeGreaterThan(ids.indexOf("roads:line"));
  });

  it("matches on the attribute rather than a feature id the tile may not carry", () => {
    const withSelection = project();
    withSelection.selection = { layer: "roads", field: "name", values: ["A1", 7] };
    const highlight = compile(withSelection).layers.find((l) => l.id === "chrome:selection:line");
    expect(highlight?.filter).toEqual([
      "in",
      ["to-string", ["get", "name"]],
      ["literal", ["A1", "7"]],
    ]);
  });

  it("draws nothing when the layer it names has gone", () => {
    const withSelection = project();
    withSelection.selection = { layer: "deleted", field: "name", values: ["A1"] };
    const ids = compile(withSelection).layers.map((l) => l.id);
    expect(ids.some((id) => id.startsWith("chrome:selection"))).toBe(false);
  });

  it("draws a hover more quietly than a click", () => {
    const clicked = project();
    clicked.selection = { layer: "roads", field: "name", values: ["A1"] };
    const hovered = project();
    hovered.selection = { layer: "roads", field: "name", values: ["A1"], hover: true };

    const opacity = (p: MapProject) =>
      compile(p).layers.find((l) => l.id === "chrome:selection:line")!.paint["line-opacity"];
    expect(opacity(hovered)).toBeLessThan(opacity(clicked) as number);
  });
});
