import { describe, expect, it } from "vitest";

import {
  bundleFor,
  compile,
  markerImageId,
  markerLayout,
  markersIn,
  normalise,
  selectionFilter,
} from "../src/compile";
import { colorExpression, strokePaint } from "../src/symbology";
import { frameExtent, needsFraming } from "../src/frame";
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

/**
 * Switching a layer to Categories appeared to do nothing. `match` needs at least
 * one label and output, so an empty classification compiled to
 * `["match", input, fallback]`, which the renderer rejects as malformed — the
 * setPaintProperty threw and the layer kept the colour it already had. An empty
 * classification is a normal intermediate state, not an error.
 */
describe("a classification that has not been filled in", () => {
  it("compiles categories with no entries to the fallback colour", () => {
    expect(
      colorExpression({
        kind: "categorized",
        field: "name",
        categories: [],
        fallbackColor: "#123456",
      }),
    ).toBe("#123456");
  });

  it("compiles a graduated layer with no breaks to one colour", () => {
    expect(
      colorExpression({
        kind: "graduated",
        field: "pop",
        breaks: [],
        colors: ["#abcdef"],
        noDataColor: "#000000",
      }),
    ).toBe("#abcdef");
  });

  it("still builds a match once there is a category", () => {
    const expression = colorExpression({
      kind: "categorized",
      field: "name",
      categories: [{ value: "a", color: "#ff0000" }],
      fallbackColor: "#123456",
    }) as unknown[];
    expect(expression[0]).toBe("match");
    expect(expression).toHaveLength(5);
  });

  it("gives to-number a fallback so a non numeric value cannot throw", () => {
    const expression = colorExpression({
      kind: "graduated",
      field: "pop",
      breaks: [10],
      colors: ["#111111", "#222222"],
      noDataColor: "#000000",
    }) as unknown[];
    const step = expression[3] as unknown[];
    expect(step[1]).toEqual(["to-number", ["get", "pop"], -1]);
  });
});

/**
 * Adding a worldwide layer while looking at a globe pulled the camera out until
 * the whole extent fitted, which shrinks the planet to show data already on the
 * screen.
 */
describe("framing after adding a layer", () => {
  const screen = { width: 1200, height: 800 };
  const world = { west: -180, south: -90, east: 180, north: 90 };

  it("does not move for a worldwide layer you are already inside", () => {
    expect(needsFraming(world, { center: [20, 25], zoom: 2 }, screen)).toBe(false);
  });

  it("does move when you are zoomed right in", () => {
    expect(needsFraming(world, { center: [51.4, 35.7], zoom: 14 }, screen)).toBe(true);
  });

  it("always moves for an ordinary extent", () => {
    const tehran = { west: 51.2, south: 35.6, east: 51.6, north: 35.83 };
    expect(needsFraming(tehran, { center: [51.4, 35.7], zoom: 11 }, screen)).toBe(true);
  });

  it("keeps a sphere filling the viewport rather than shrinking it", () => {
    const frame = frameExtent(world, screen, { projection: "globe" });
    expect(frame.zoom).toBeGreaterThanOrEqual(1.7);
  });
});

/**
 * Hovering one country lit up every country that shared its `scalerank`, because
 * highlighting matched on whatever field happened to come first. A key has to be
 * unique or it is not a key; the server works out which column is.
 */
describe("markers", () => {
  const pin = {
    glyph: "\ud83d\udccd",
    color: "#ff0000",
    size: 26,
    shape: "pin" as const,
    anchor: "above" as const,
  };

  it("names an image from the marker, so two layers sharing a pin share it", () => {
    expect(markerImageId(pin)).toBe(markerImageId({ ...pin }));
    expect(markerImageId(pin)).not.toBe(markerImageId({ ...pin, glyph: "\u2b50" }));
    expect(markerImageId(pin)).not.toBe(markerImageId({ ...pin, shape: "circle" }));
  });

  it("moves the same image around rather than making a new one", () => {
    // Anchor and placement are layout, not pixels. Naming a new image for them
    // would make the renderer rasterise the same pin twice.
    expect(markerImageId({ ...pin, anchor: "on" })).toBe(markerImageId(pin));
    expect(markerImageId({ ...pin, placement: "along" })).toBe(markerImageId(pin));
  });

  /*
   * The bug: a marker was a symbology kind, so choosing one replaced the layer's
   * drawing. A point stopped being a point and became the emoji, which meant the
   * layer's colours and classification were gone as long as the marker was on.
   */
  /*
   * A pin standing over its own blue dot is two things where there is one. On a
   * point layer the marker *is* the point, so the circle is not drawn at all.
   */
  it("stands in for the point rather than hovering over it", () => {
    const withMarker = project();
    const layer = withMarker.tree[0] as LayerNode;
    layer.geometry = "point";
    layer.marker = { ...pin };

    expect(bundleFor(layer)).toEqual(["roads:marker"]);

    const layers = compile(withMarker).layers;
    expect(layers.find((l) => l.id === "roads:circle")).toBeUndefined();
    const drawn = layers.find((l) => l.id === "roads:marker");
    expect(drawn?.type).toBe("symbol");
    expect(drawn?.layout["icon-image"]).toBe(markerImageId(pin));
  });

  it("gives the point its dot back when the marker is turned off", () => {
    const layer = project().tree[0] as LayerNode;
    layer.geometry = "point";
    expect(bundleFor(layer)).toEqual(["roads:circle"]);
  });

  /* A line cannot be replaced by an icon, so there both are drawn. */
  it("adds to a line or an area instead of replacing it", () => {
    const line = project().tree[0] as LayerNode;
    line.marker = { ...pin };
    expect(bundleFor(line)).toEqual(["roads:line", "roads:marker"]);
  });

  /*
   * The bug: a pin was anchored at its bottom and everything else at its centre,
   * so the same control produced two different maps depending on which shape you
   * picked. Position is one decision now and it belongs to the user.
   */
  it("anchors every shape the way the user asked, not the way the shape suggests", () => {
    for (const shape of ["pin", "circle", "square", "none"] as const) {
      expect(markerLayout({ ...pin, shape }, "point")["icon-anchor"]).toBe("bottom");
      expect(markerLayout({ ...pin, shape, anchor: "on" }, "point")["icon-anchor"]).toBe("center");
    }
  });

  it("lifts a badge clear of the feature, and leaves a pin on its own point", () => {
    // A pin already ends in a point, so its bottom edge is the spot.
    expect(markerLayout(pin, "point")["icon-offset"]).toBeUndefined();
    expect(markerLayout({ ...pin, shape: "circle" }, "point")["icon-offset"]).toEqual([0, -4]);
    expect(markerLayout({ ...pin, shape: "circle", anchor: "on" }, "point")["icon-offset"])
      .toBeUndefined();
  });

  it("puts one marker in the middle of a line or an area", () => {
    expect(markerLayout(pin, "line")["symbol-placement"]).toBe("point");
    expect(markerLayout(pin, "polygon")["symbol-placement"]).toBe("point");
  });

  it("repeats along a line when asked, but never around a polygon's ring", () => {
    const along = { ...pin, placement: "along" as const, spacing: 120 };
    expect(markerLayout(along, "line")["symbol-placement"]).toBe("line");
    expect(markerLayout(along, "line")["symbol-spacing"]).toBe(120);
    // A polygon compiled with line placement draws markers around its outline,
    // which is not what anybody means by a marker on an area.
    expect(markerLayout(along, "polygon")["symbol-placement"]).toBe("point");
  });

  it("carries a marker on a graduated layer without disturbing the classification", () => {
    const withMarker = project();
    const layer = withMarker.tree[0] as LayerNode;
    layer.geometry = "polygon";
    layer.symbology = {
      kind: "graduated",
      field: "density",
      breaks: [10, 20],
      colors: ["#111", "#222", "#333"],
      noDataColor: "#000",
      stroke: { color: "#0a0a0b", width: 0.6 },
    };
    layer.marker = { ...pin };

    expect(bundleFor(layer)).toEqual(["roads:fill", "roads:line", "roads:marker"]);
    const fill = compile(withMarker).layers.find((l) => l.id === "roads:fill");
    expect(fill?.paint["fill-color"]).toEqual(colorExpression(layer.symbology));
  });

  it("lists every distinct marker in the project once", () => {
    const withMarkers = project();
    const first = withMarkers.tree[0] as LayerNode;
    first.geometry = "point";
    first.marker = { ...pin };
    withMarkers.tree.push(JSON.parse(JSON.stringify({ ...first, id: "copy" })));
    expect(markersIn(withMarkers)).toHaveLength(1);
  });

  /*
   * Documents written before markers became a decoration still hold the old
   * shape. They are translated on the way in, and the point they used to hide
   * comes back.
   */
  it("reads a document that still holds a marker as its symbology", () => {
    const old = project();
    const layer = old.tree[0] as LayerNode;
    layer.geometry = "point";
    layer.symbology = { kind: "marker", glyph: "\ud83d\udccd", color: "#ff0000", size: 26, shape: "pin" };

    expect(bundleFor(layer)).toEqual(["roads:marker"]);
    const read = normalise(layer);
    expect(read.symbology.kind).toBe("single");
    expect(read.marker?.glyph).toBe("\ud83d\udccd");
    expect(read.marker?.anchor).toBe("above");
    expect(markersIn(old)).toHaveLength(1);
  });

  it("gives a marker no stroke to set", () => {
    expect(
      strokePaint({ kind: "marker", glyph: "x", color: "#fff", size: 20, shape: "pin" }, 1),
    ).toBe(null);
  });
});

/**
 * Hovering one airport ringed every airport that shared its `scalerank`, because
 * a highlight matched on one column and that column was not a key. A key has to
 * be unique or it is not a key.
 */
describe("selection filters", () => {
  it("matches on one column when the layer has a real key", () => {
    expect(selectionFilter({ layer: "roads", field: "gid", values: [7] })).toEqual([
      "in",
      ["to-string", ["get", "gid"]],
      ["literal", ["7"]],
    ]);
  });

  it("narrows to one feature when the first column is shared", () => {
    const filter = selectionFilter({
      layer: "airports",
      field: "scalerank",
      values: [2],
      where: [
        { field: "name", value: "Heathrow" },
        { field: "iata_code", value: "LHR" },
      ],
    }) as unknown[];

    expect(filter[0]).toBe("all");
    expect(filter).toHaveLength(4);
    expect(filter[2]).toEqual(["==", ["to-string", ["get", "name"]], "Heathrow"]);
    expect(filter[3]).toEqual(["==", ["to-string", ["get", "iata_code"]], "LHR"]);
  });

  it("does not constrain the same column twice", () => {
    const filter = selectionFilter({
      layer: "airports",
      field: "name",
      values: ["Heathrow"],
      where: [{ field: "name", value: "Heathrow" }],
    }) as unknown[];
    expect(filter[0]).toBe("in");
  });

  it("compares as text, because a tile and a table disagree about numbers", () => {
    // The database holds 3.0 and the tile hands back 3; neither == the other.
    const filter = selectionFilter({
      layer: "wards",
      field: "id",
      values: [3],
      where: [{ field: "rank", value: 2 }],
    }) as unknown[];
    expect(filter[2]).toEqual(["==", ["to-string", ["get", "rank"]], "2"]);
  });

  it("reaches the highlight layers the compiler builds", () => {
    const withSelection = project();
    withSelection.selection = {
      layer: "roads",
      field: "scalerank",
      values: [2],
      where: [{ field: "name", value: "A1" }],
      hover: true,
    };
    const highlight = compile(withSelection).layers.find((l) => l.id.startsWith("chrome:selection"));
    expect((highlight?.filter as unknown[])[0]).toBe("all");
  });
});


