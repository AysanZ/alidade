import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import { assetsSourceId, headingSourceId } from "../src/live";
import { reconcile } from "../src/reconcile";
import { defaultAssets, defaultChrome } from "../src/types/project";
import type { GeoJSONSource, LiveAsset, MapProject } from "../src/types/project";

function project(items: LiveAsset[] = [], assets: Partial<MapProject["assets"]> = {}): MapProject {
  return {
    schema: 3,
    id: "t",
    name: "Test",
    view: { center: [51.4, 35.7], zoom: 10, pitch: 0, bearing: 0 },
    basemap: { id: "none", name: "None", background: "#000", labels: false },
    environment: {},
    chrome: defaultChrome(),
    sources: {},
    tree: [],
    assets: { ...defaultAssets(), enabled: true, items, ...assets },
  };
}

const at = (id: string, lon: number, lat: number, extra: Partial<LiveAsset> = {}): LiveAsset => ({
  id,
  position: [lon, lat],
  updated: 1000,
  ...extra,
});

const ids = (p: MapProject) =>
  compile(p)
    .layers.map((l) => l.id)
    .filter((id) => id.startsWith("chrome:assets"));

describe("the live layer in the compiler", () => {
  it("draws nothing at all until the feed is switched on", () => {
    const off = project([], { enabled: false });
    expect(ids(off)).toEqual([]);
    expect(compile(off).sources[assetsSourceId()]).toBeUndefined();
  });

  it("puts its layers up as soon as it is switched on, before any position", () => {
    // So the first frame is one source.data and not a source and five layers.
    expect(ids(project())).toContain("chrome:assets:dot");
  });

  it("keeps drawing what a switched-off feed already reported", () => {
    // Disconnecting is not the same as deciding the last known positions were
    // never true. Turning the layer off is what hides them.
    expect(ids(project([at("a", 51, 35)], { enabled: false }))).toContain("chrome:assets:dot");
  });

  it("draws under the drawings and over the data", () => {
    const p = project([at("a", 51, 35)]);
    p.annotations = {
      visible: true,
      opacity: 1,
      features: [{ id: "d", kind: "point", name: "x", coordinates: [[51, 35]], color: "#fff" }],
    };
    const order = compile(p).layers.map((l) => l.id);
    expect(order.indexOf("chrome:assets:dot")).toBeLessThan(
      order.indexOf("chrome:annotations:point"),
    );
  });

  it("emits the cluster layers only when it is clustering", () => {
    expect(ids(project([], { cluster: true }))).toContain("chrome:assets:cluster");
    expect(ids(project([], { cluster: false }))).not.toContain("chrome:assets:cluster");
  });

  it("gives the heading whiskers a source of their own", () => {
    /*
     * They cannot share the dots' source: it clusters, and a clustered source
     * has no lines in it, so turning clustering on would silently take the
     * whiskers with it.
     */
    const p = project([at("a", 51, 35, { heading: 90 })]);
    expect(compile(p).sources[headingSourceId()]).toBeDefined();
    expect(compile(project([], { heading: false })).sources[headingSourceId()]).toBeUndefined();
  });

  it("hides with layout operations rather than by coming down", () => {
    const on = project([at("a", 51, 35)]);
    const off = project([at("a", 51, 35)], { visible: false });
    const ops = reconcile(on, off);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((o) => o.t === "layer.layout")).toBe(true);
  });
});

describe("the live layer through the reconciler", () => {
  it("turns a moved asset into one source.data and nothing else", () => {
    // The whole point of the layer being one geojson source. Anything else here
    // means the layers reading it came down and went back up, once a second.
    const before = project([at("a", 51, 35)], { heading: false });
    const after = project([at("a", 51.01, 35)], { heading: false });
    const ops = reconcile(before, after);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ t: "source.data", id: assetsSourceId() });
  });

  it("does not rebuild a layer when an asset goes stale", () => {
    const before = project([at("a", 51, 35)]);
    const after = project([at("a", 51, 35, { stale: true })]);
    const ops = reconcile(before, after);
    expect(ops.every((o) => o.t === "source.data")).toBe(true);
  });

  it("emits nothing at all for a frame that changed nothing", () => {
    expect(reconcile(project([at("a", 51, 35)]), project([at("a", 51, 35)]))).toEqual([]);
  });

  it("moves both sources when the assets move and headings are drawn", () => {
    const before = project([at("a", 51, 35, { heading: 10 })]);
    const after = project([at("a", 51.01, 35, { heading: 20 })]);
    const ops = reconcile(before, after);
    expect(ops.map((o) => o.t)).toEqual(["source.data", "source.data"]);
  });

  /**
   * Switching clustering on did nothing, and switching it off left the counts
   * on the map.
   *
   * A geojson source carries how it is indexed as well as what is in it, and
   * the index is read once when the source is built. The reconciler treated
   * every changed geojson source as new *data* and sent `setData`, which
   * replaces the features and leaves the index exactly as it was. A change to
   * anything but `data` is a new source.
   */
  it("replaces the source when clustering is switched, rather than sending data", () => {
    const before = project([at("a", 51, 35)], { cluster: false });
    const after = project([at("a", 51, 35)], { cluster: true });
    const ops = reconcile(before, after);
    expect(ops.some((o) => o.t === "source.remove" && o.id === assetsSourceId())).toBe(true);
    expect(ops.some((o) => o.t === "source.add" && o.id === assetsSourceId())).toBe(true);
    expect(ops.some((o) => o.t === "source.data" && o.id === assetsSourceId())).toBe(false);
  });

  it("takes the layers down and puts them back around a replaced source", () => {
    // A renderer will not remove a source a layer is still reading.
    const ops = reconcile(
      project([at("a", 51, 35)], { cluster: false }),
      project([at("a", 51, 35)], { cluster: true }),
    );
    const removedAt = ops.findIndex((o) => o.t === "layer.remove");
    const sourceGoneAt = ops.findIndex((o) => o.t === "source.remove");
    expect(removedAt).toBeGreaterThanOrEqual(0);
    expect(removedAt).toBeLessThan(sourceGoneAt);
  });

  it("still updates a source in place when only its features changed", () => {
    // The fix above must not have cost the graticule its in-place update.
    const before = project([], { enabled: false });
    before.chrome.graticule = { ...before.chrome.graticule, enabled: true, interval: 10 };
    const after = JSON.parse(JSON.stringify(before)) as MapProject;
    after.chrome.graticule.interval = 20;
    const ops = reconcile(before, after);
    expect(ops.some((o) => o.t === "source.data")).toBe(true);
    expect(ops.some((o) => o.t === "layer.remove")).toBe(false);
  });

  it("declares the cluster settings on the source, not on the layers", () => {
    const source = compile(project([], { cluster: true })).sources[
      assetsSourceId()
    ] as GeoJSONSource;
    expect(source.cluster).toBe(true);
    expect(source.clusterMaxZoom).toBeGreaterThan(0);
  });
});
