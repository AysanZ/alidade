import { describe, expect, it, vi } from "vitest";

import { apply } from "../src/apply";
import { FakeMap } from "./fake";
import type { Op } from "@alidade/core";

/**
 * A batch used to be one switch inside one loop, so the first failure threw out
 * of the loop and every operation after it was dropped without a word. The
 * symptom was importing a layer and watching nothing appear: the `layer.add` was
 * simply the operation after the one that threw.
 */
describe("a batch containing a failing operation", () => {
  it("carries on and applies the rest", () => {
    const map = new FakeMap();
    map.addSource("a", { type: "geojson", data: {} });
    const warn = vi.fn();

    const ops: Op[] = [
      // Nothing has ever added this layer, so removing it is a no-op, not a throw.
      { t: "layer.remove", id: "ghost" },
      { t: "source.add", id: "b", source: { type: "geojson", data: {} } },
      {
        t: "layer.add",
        spec: { id: "real", type: "circle", source: "b", slot: "data", paint: {}, layout: {} },
      },
    ];
    apply(map, ops, warn);

    expect(map.getLayer("real")).toBeTruthy();
  });

  it("reports the failure rather than swallowing it", () => {
    const map = new FakeMap();
    const warn = vi.fn();
    apply(
      map,
      [
        // No source called `missing`, so MapLibre would throw on this one.
        {
          t: "layer.add",
          spec: { id: "orphan", type: "circle", source: "missing", slot: "data", paint: {}, layout: {} },
        },
        { t: "camera.set", view: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } },
      ],
      warn,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("layer.add");
    // The camera still moved, which is the whole point.
    expect(map.names()).toContain("jumpTo");
  });
});

describe("operations that would fail on their own", () => {
  it("adds a layer at the top when the layer it should sit under has gone", () => {
    const map = new FakeMap();
    map.addSource("a", { type: "geojson", data: {} });
    apply(map, [
      {
        t: "layer.add",
        spec: { id: "one", type: "circle", source: "a", slot: "data", paint: {}, layout: {} },
        before: "never-existed",
      },
    ]);
    expect(map.order).toEqual(["one"]);
  });

  it("updates a geojson source rather than adding it twice", () => {
    const map = new FakeMap();
    apply(map, [
      { t: "source.add", id: "g", source: { type: "geojson", data: { a: 1 } } },
      { t: "source.add", id: "g", source: { type: "geojson", data: { a: 2 } } },
    ]);
    expect(map.names().filter((n) => n === "addSource")).toHaveLength(1);
    expect(map.names()).toContain("setData");
  });

  it("refreshes geojson data in place", () => {
    const map = new FakeMap();
    apply(map, [
      { t: "source.add", id: "g", source: { type: "geojson", data: { a: 1 } } },
      { t: "source.data", id: "g", data: { a: 2 } },
    ]);
    expect(map.calls.find((c) => c[0] === "setData")).toEqual(["setData", "g", { a: 2 }]);
  });

  it("replaces a layer that is added over one already there", () => {
    const map = new FakeMap();
    map.addSource("a", { type: "geojson", data: {} });
    const spec = { id: "one", type: "circle" as const, source: "a", slot: "data" as const, paint: {}, layout: {} };
    apply(map, [{ t: "layer.add", spec }, { t: "layer.add", spec }]);
    expect(map.order).toEqual(["one"]);
  });
});
