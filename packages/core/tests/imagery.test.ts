import { describe, expect, it } from "vitest";

import {
  contributing,
  defaultImagery,
  estimateCoverage,
  imageryQuery,
  imagerySource,
  asLonLat,
  frameFor,
  imageryTileUrl,
  nativeZoom,
  orderByRule,
  reconcile,
  type ImageRecord,
  type ImagerySettings,
  type MapProject,
} from "../src";
import { project } from "./fixture";

/* An image is mostly its date, its resolution and how much of the view it
   covers, so the rest is filled in once and forgotten. */
function image(over: Partial<ImageRecord> & { id: string }): ImageRecord {
  return {
    title: over.id,
    file: `${over.id}.tif`,
    datetime: null,
    datetimeFrom: null,
    gsd: 10,
    epsg: 32639,
    cloudCover: null,
    bands: 4,
    dtype: "uint16",
    width: 10980,
    height: 10980,
    bbox: [51.2, 35.6, 51.5, 35.8],
    // A rotated quadrilateral, because that is what a scene is. The corners
    // share no latitude, so the bounding box above is strictly larger.
    footprint: [
      [51.22, 35.60],
      [51.50, 35.64],
      [51.48, 35.80],
      [51.20, 35.76],
      [51.22, 35.60],
    ],
    ...over,
  };
}

const sentinel = (id: string, datetime: string, coverage = 100) =>
  image({ id, datetime, datetimeFrom: "tag", coverage });

describe("ordering by rule", () => {
  const catalogue = [
    sentinel("apr23", "2023-04-11T06:58:00Z"),
    sentinel("jul24", "2024-07-19T07:16:00Z"),
    sentinel("may24", "2024-05-02T07:11:00Z"),
    image({ id: "drone", gsd: 0.05, coverage: 4 }),
  ];

  it("puts the most recent first, and the undated last", () => {
    const order = orderByRule(catalogue, { kind: "newest" }).map((i) => i.id);
    expect(order).toEqual(["jul24", "may24", "apr23", "drone"]);
  });

  it("sorts by distance from a target date, in either direction", () => {
    // June 2024 is between May and July, and closer to July by a fortnight.
    const order = orderByRule(catalogue, { kind: "closest", date: "2024-06-10" });
    expect(order.map((i) => i.id)).toEqual(["may24", "jul24", "apr23", "drone"]);
  });

  it("keeps an undated image last however the dates are sorted", () => {
    for (const rule of [
      { kind: "newest" } as const,
      { kind: "closest", date: "1999-01-01" } as const,
    ]) {
      expect(orderByRule(catalogue, rule).at(-1)!.id).toBe("drone");
    }
  });

  it("sorts by ground sample distance, finest first", () => {
    const order = orderByRule(catalogue, { kind: "sharpest" }).map((i) => i.id);
    expect(order[0]).toBe("drone");
  });

  it("locks to one image, and to none when it is not in the catalogue", () => {
    expect(orderByRule(catalogue, { kind: "lock", image: "may24" }).map((i) => i.id)).toEqual([
      "may24",
    ]);
    expect(orderByRule(catalogue, { kind: "lock", image: "gone" })).toEqual([]);
  });

  it("does not mutate the catalogue it was given", () => {
    const before = catalogue.map((i) => i.id);
    orderByRule(catalogue, { kind: "newest" });
    orderByRule(catalogue, { kind: "sharpest" });
    expect(catalogue.map((i) => i.id)).toEqual(before);
  });
});

describe("what the rule draws with", () => {
  it("stops as soon as the view is covered", () => {
    const full = [sentinel("a", "2024-07-19T00:00:00Z"), sentinel("b", "2024-05-02T00:00:00Z")];
    expect(contributing(full, { kind: "newest" }).map((i) => i.id)).toEqual(["a"]);
  });

  it("keeps taking images while the view is still short", () => {
    const partial = [
      sentinel("a", "2024-07-19T00:00:00Z", 40),
      sentinel("b", "2024-05-02T00:00:00Z", 40),
      sentinel("c", "2023-04-11T00:00:00Z", 40),
    ];
    expect(contributing(partial, { kind: "newest" }).length).toBeGreaterThan(1);
  });

  it("draws only the locked image however little it covers", () => {
    const partial = [
      sentinel("a", "2024-07-19T00:00:00Z", 4),
      sentinel("b", "2024-05-02T00:00:00Z", 100),
    ];
    expect(contributing(partial, { kind: "lock", image: "a" }).map((i) => i.id)).toEqual(["a"]);
  });

  it("has a ceiling, because a hundred assets for one tile is a timeout", () => {
    const many = Array.from({ length: 40 }, (_, n) =>
      sentinel(`s${n}`, `2024-01-${String((n % 28) + 1).padStart(2, "0")}T00:00:00Z`, 5),
    );
    expect(contributing(many, { kind: "newest" }).length).toBeLessThanOrEqual(4);
  });
});

describe("coverage", () => {
  it("is the single figure when there is one image", () => {
    expect(estimateCoverage([sentinel("a", "2024-01-01T00:00:00Z", 62)])).toBe(62);
  });

  it("grows as more images are added but never past the whole view", () => {
    const half = sentinel("a", "2024-01-01T00:00:00Z", 50);
    const also = sentinel("b", "2023-01-01T00:00:00Z", 50);
    const both = estimateCoverage([half, also]);
    expect(both).toBeGreaterThan(50);
    expect(both).toBeLessThanOrEqual(100);
  });

  it("is nothing when there is nothing", () => {
    expect(estimateCoverage([])).toBe(0);
  });
});

describe("the tile url", () => {
  const base = defaultImagery();

  it("leaves the tile coordinates for the renderer", () => {
    expect(imageryTileUrl(base)).toContain("/tiles/{z}/{x}/{y}.png?");
  });

  it("names the image only when the rule is locked to one", () => {
    expect(imageryTileUrl({ ...base, rule: { kind: "lock", image: "mehrabad_a1" } })).toContain(
      "image=mehrabad_a1",
    );
    expect(imageryTileUrl(base)).not.toContain("image=");
  });

  it("repeats bidx per band, the way a tiler expects", () => {
    const url = imageryTileUrl({
      ...base,
      render: { mode: "rgb", bands: [4, 3, 2] },
    });
    expect(url).toContain("bidx=4&bidx=3&bidx=2");
  });

  it("sends an expression instead of bands, and never both", () => {
    const url = imageryTileUrl({
      ...base,
      render: { mode: "expression", bands: [4, 3, 2], expression: "(b8-b4)/(b8+b4)" },
    });
    expect(url).toContain("expression=");
    expect(url).not.toContain("bidx=");
  });

  /*
   * The reconciler compares tile templates as strings. A url whose parameters
   * shuffled between two renders of the same settings would look like a changed
   * source on every edit and rebuild the layer for nothing.
   */
  it("is character-identical for equal settings", () => {
    const settings = (): ImagerySettings => ({
      rule: { kind: "closest", date: "2024-07-19" },
      overlap: "blend",
      render: {
        mode: "rgb",
        bands: [4, 3, 2],
        rescale: [[184, 3211]],
        resampling: "bilinear",
        nodata: 0,
      },
    });
    expect(imageryTileUrl(settings())).toBe(imageryTileUrl(settings()));
  });

  it("leaves out what is at its default rather than stating it", () => {
    const params = imageryQuery(base).map(([k]) => k);
    expect(params).not.toContain("gamma");
    expect(params).not.toContain("nodata");
    expect(params).not.toContain("colormap_name");
  });

  it("makes a raster source with one template in it", () => {
    const source = imagerySource(base, { maxzoom: 14 });
    expect(source.type).toBe("raster");
    expect(source.tiles).toHaveLength(1);
    expect(source.maxzoom).toBe(14);
  });
});

describe("native zoom", () => {
  it("is about 14 for a ten metre image and about 21 for five centimetres", () => {
    expect(nativeZoom(10)).toBe(14);
    expect(nativeZoom(0.05)).toBe(22);
    expect(nativeZoom(0.5)).toBe(19);
  });

  it("does not fall off the pyramid for a nonsense figure", () => {
    expect(nativeZoom(0)).toBeLessThanOrEqual(22);
    expect(nativeZoom(1e9)).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ ops */

function withImagery(settings: ImagerySettings): MapProject {
  const base = project();
  return {
    ...base,
    sources: { ...base.sources, imagery: imagerySource(settings) },
    tree: [
      {
        type: "layer",
        id: "imagery",
        name: "Imagery",
        slot: "data",
        source: "imagery",
        geometry: "raster",
        visible: true,
        opacity: 1,
        symbology: { kind: "single", color: "#ffffff" },
        imagery: settings,
      },
      ...base.tree,
    ],
  };
}

describe("changing what is drawn", () => {
  const locked = (id: string): ImagerySettings => ({
    ...defaultImagery(),
    rule: { kind: "lock", image: id },
  });

  it("retiles the source instead of taking it down", () => {
    const ops = reconcile(withImagery(locked("jul24")), withImagery(locked("may24")));
    expect(ops.filter((o) => o.t === "source.tiles")).toHaveLength(1);
    expect(ops.some((o) => o.t === "source.remove" && o.id === "imagery")).toBe(false);
    expect(ops.some((o) => o.t === "layer.remove" && o.id === "imagery")).toBe(false);
  });

  it("carries the new template on the operation", () => {
    const ops = reconcile(withImagery(locked("jul24")), withImagery(locked("may24")));
    const op = ops.find((o) => o.t === "source.tiles");
    expect(op && "tiles" in op && op.tiles[0]).toContain("image=may24");
  });

  it("does the same for a change of bands or of stretch", () => {
    const before: ImagerySettings = { ...defaultImagery(), render: { mode: "rgb", bands: [1, 2, 3] } };
    const after: ImagerySettings = { ...defaultImagery(), render: { mode: "rgb", bands: [4, 3, 2] } };
    const ops = reconcile(withImagery(before), withImagery(after));
    expect(ops.map((o) => o.t)).toContain("source.tiles");
    expect(ops.map((o) => o.t)).not.toContain("source.remove");
  });

  it("says nothing at all when nothing changed", () => {
    const same = locked("jul24");
    expect(reconcile(withImagery(same), withImagery(same))).toEqual([]);
  });

  /*
   * Tile size is read once when the source is built, so a source whose tile size
   * moved is a different source. Sending `setTiles` would leave the engine
   * asking for 256px tiles from a 512px service and drawing them at the wrong
   * scale, which is worse than a rebuild.
   */
  it("rebuilds rather than retiles when more than the tiles changed", () => {
    const a = withImagery(locked("jul24"));
    const b = withImagery(locked("may24"));
    b.sources["imagery"] = { ...imagerySource(locked("may24")), tileSize: 512 };
    const ops = reconcile(a, b);
    expect(ops.map((o) => o.t)).toContain("source.remove");
    expect(ops.map((o) => o.t)).not.toContain("source.tiles");
  });
});

describe("framing an image", () => {
  const airbase = (over: Partial<ImageRecord> = {}) =>
    image({
      id: "base",
      gsd: 0.63,
      width: 4096,
      height: 4096,
      // 4096 × 0.63 m is about 2.6 km, which near 33° is roughly 0.023°.
      bbox: [42.44, 33.79, 42.463, 33.813],
      ...over,
    });

  it("frames the ground the pixels describe, centred on the footprint", () => {
    const [west, south, east, north] = frameFor(airbase());
    // 4096 × 0.63 m is about 2.58 km, which near 34° is about 0.028° of
    // longitude and 0.023° of latitude.
    expect(east - west).toBeCloseTo(0.028, 2);
    expect(north - south).toBeCloseTo(0.023, 2);
    const box = airbase().bbox;
    expect((west + east) / 2).toBeCloseTo((box[0] + box[2]) / 2, 4);
  });

  /*
   * The row this exists for. A registry written from a projected file's corner
   * coordinates carries a box thousands of times too wide; framing it centres
   * the camera correctly and zooms out until the image is one green pixel.
   */
  it("ignores a bounding box the pixels say is impossible", () => {
    const wrong = airbase({ bbox: [38, 30, 47, 38] });
    const [west, south, east, north] = frameFor(wrong);
    expect(east - west).toBeLessThan(0.05);
    expect(north - south).toBeLessThan(0.05);
    // Still centred where the box said, because the centre is the one part of a
    // wrong box that is usually right.
    expect((west + east) / 2).toBeCloseTo(42.5, 1);
  });

  /*
   * Superseded. This used to assert the box was returned untouched when the
   * pixel count was missing, which is what put an airfield in the middle of a
   * continent: with no width there was nothing to check the box against. The
   * resolution alone is a weaker check than the pixel count and still enough.
   */
  it("caps the box by resolution when the size is unknown", () => {
    const unsized = airbase({ width: null, height: null, bbox: [38, 30, 47, 38] });
    const [west, south, east, north] = frameFor(unsized);
    expect(east - west).toBeLessThan(1);
    expect(north - south).toBeLessThan(1);
    expect((west + east) / 2).toBeCloseTo(42.5, 1);
  });

  it("narrows longitude with the latitude", () => {
    const wrong: [number, number, number, number] = [0, 0, 40, 40];
    const equator = frameFor(airbase({ bbox: wrong, ...{} }));
    const north = frameFor(
      airbase({ bbox: [0, 58, 40, 62] }),
    );
    const span = (b: number[]) => b[2]! - b[0]!;
    expect(span(north)).toBeGreaterThan(span(equator));
  });
});

describe("settings that do not apply to the current mode", () => {
  const base = defaultImagery();

  /*
   * The defect this exists for: a ramp chosen in expression mode was still sent
   * after switching back to RGB, the tiler refused it, and the imagery went away
   * for good — putting the ramp back changed nothing, because the ramp was never
   * what was wrong.
   */
  it("does not send a colour ramp with an RGB composite", () => {
    const url = imageryTileUrl({
      ...base,
      render: { mode: "rgb", bands: [3, 2, 1], colormap: "rdylgn" },
    });
    expect(url).not.toContain("colormap_name");
  });

  it("sends it for a single band and for an expression", () => {
    for (const mode of ["single", "expression"] as const) {
      const url = imageryTileUrl({
        ...base,
        render: { mode, expression: "(b2-b1)/(b2+b1)", colormap: "viridis" },
      });
      expect(url).toContain("colormap_name=viridis");
    }
  });

  it("does not send an expression while in RGB", () => {
    const url = imageryTileUrl({
      ...base,
      render: { mode: "rgb", bands: [1, 2, 3], expression: "(b2-b1)/(b2+b1)" },
    });
    expect(url).not.toContain("expression=");
  });

  /* Switching modes and back must reproduce the URL it started with. */
  it("returns to where it began after a round trip through another mode", () => {
    const start = { ...base, render: { mode: "rgb" as const, bands: [3, 2, 1] } };
    const detour = { ...start, render: { ...start.render, mode: "expression" as const, colormap: "viridis" } };
    const back = { ...detour, render: { ...detour.render, mode: "rgb" as const } };
    expect(imageryTileUrl(back)).toBe(imageryTileUrl(start));
  });
});

describe("a bounding box written in the wrong units", () => {
  /*
   * Rows imported before the registry checked its own footprints hold web
   * mercator metres. Clicking such an image did nothing at all: the extent
   * failed its sanity check, the fly was skipped, and the camera stayed where it
   * was — which looks exactly like a zoom that went too far out.
   */
  it("turns mercator metres back into degrees", () => {
    // Incirlik, about 35.42E 37.00N.
    const metres: [number, number, number, number] = [3_942_000, 4_439_000, 3_946_000, 4_443_000];
    const [west, south, east, north] = asLonLat(metres);
    expect(west).toBeCloseTo(35.41, 1);
    expect(north).toBeCloseTo(37.02, 1);
    expect(east).toBeGreaterThan(west);
    expect(north).toBeGreaterThan(south);
  });

  it("leaves a box that is already degrees alone", () => {
    const degrees: [number, number, number, number] = [51.2, 35.6, 51.5, 35.8];
    expect(asLonLat(degrees)).toEqual(degrees);
  });

  it("does not invent a position for numbers that are neither", () => {
    const nonsense: [number, number, number, number] = [1e12, 1e12, 2e12, 2e12];
    expect(asLonLat(nonsense)).toEqual(nonsense);
  });

  it("lets frameFor reach a sane extent from a metre box", () => {
    const wrong = image({
      id: "incirlik",
      gsd: 0.63,
      width: 4096,
      height: 4096,
      bbox: [3_942_000, 4_439_000, 3_946_000, 4_443_000],
    });
    const [west, south, east, north] = frameFor(wrong);
    expect(Math.abs(west)).toBeLessThan(180);
    expect(Math.abs(north)).toBeLessThan(90);
    expect(east - west).toBeLessThan(0.1);
  });
});

describe("framing when the pixel count is missing", () => {
  const unsized = (bbox: [number, number, number, number]) =>
    image({ id: "u", gsd: 0.63, width: null, height: null, bbox });

  /*
   * A registry row written before the footprint check carries a box spanning
   * degrees. With no width to check it against, framing it put the image in the
   * middle of a continent as a single dot. Resolution alone still bounds it.
   */
  it("caps a box the resolution cannot justify", () => {
    const [west, south, east, north] = frameFor(unsized([25, 30, 45, 40]));
    expect(east - west).toBeLessThan(0.5);
    expect(north - south).toBeLessThan(0.5);
    // Still centred where the box said; the centre of a wrong box is the part
    // that is usually right.
    expect((west + east) / 2).toBeCloseTo(35, 3);
  });

  it("leaves a box the resolution allows alone", () => {
    const small: [number, number, number, number] = [35.41, 37.0, 35.44, 37.03];
    expect(frameFor(unsized(small))).toEqual(small);
  });

  it("gives up rather than inventing when there is no resolution either", () => {
    const blind = image({ id: "b", gsd: 0, width: null, height: null, bbox: [25, 30, 45, 40] });
    expect(frameFor(blind)).toEqual([25, 30, 45, 40]);
  });
});
