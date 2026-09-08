import { describe, expect, it } from "vitest";

import {
  contributing,
  defaultImagery,
  estimateCoverage,
  imageryQuery,
  imagerySource,
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

/* The three retiling tests below are marked todo: `reconcile` does not look at
   `imagery` yet and there is no `source.tiles` operation for it to emit. The
   assertions are the specification for that work, so they stay here rather than
   being deleted. */
describe("changing what is drawn", () => {
  const locked = (id: string): ImagerySettings => ({
    ...defaultImagery(),
    rule: { kind: "lock", image: id },
  });

  it.todo("retiles the source instead of taking it down", () => {
    const ops = reconcile(withImagery(locked("jul24")), withImagery(locked("may24")));
    expect(ops.filter((o) => o.t === "source.tiles")).toHaveLength(1);
    expect(ops.some((o) => o.t === "source.remove" && o.id === "imagery")).toBe(false);
    expect(ops.some((o) => o.t === "layer.remove" && o.id === "imagery")).toBe(false);
  });

  it.todo("carries the new template on the operation", () => {
    const ops = reconcile(withImagery(locked("jul24")), withImagery(locked("may24")));
    const op = ops.find((o) => o.t === "source.tiles");
    expect(op && "tiles" in op && op.tiles[0]).toContain("image=may24");
  });

  it.todo("does the same for a change of bands or of stretch", () => {
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
