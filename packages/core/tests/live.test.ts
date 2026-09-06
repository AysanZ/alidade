import { describe, expect, it } from "vitest";

import {
  applyFrame,
  assetsGeoJSON,
  headingGeoJSON,
  isStale,
  lastHeard,
  markStale,
  parseFrame,
  withoutLiveAssets,
} from "../src/live";
import { defaultAssets } from "../src/types/project";
import type { Assets, LiveAsset } from "../src/types/project";

const asset = (id: string, extra: Partial<LiveAsset> = {}): LiveAsset => ({
  id,
  position: [51.4, 35.7],
  updated: 1_000_000,
  ...extra,
});

const withItems = (items: LiveAsset[], extra: Partial<Assets> = {}): Assets => ({
  ...defaultAssets(),
  items,
  ...extra,
});

describe("parseFrame", () => {
  it("reads the flat shape a feed usually sends", () => {
    const frame = parseFrame(
      JSON.stringify({
        type: "update",
        assets: [{ id: "a", lon: 51.4, lat: 35.7, heading: 90, speed: 12, updated: 5 }],
      }),
    );
    expect(frame).toEqual({
      kind: "update",
      assets: [
        { id: "a", position: [51.4, 35.7], heading: 90, speed: 12, updated: 5 },
      ],
    });
  });

  it("reads a position given as a pair", () => {
    const frame = parseFrame({ assets: [{ id: "a", position: [10, 20] }] }, 7);
    expect(frame).toMatchObject({ kind: "update", assets: [{ position: [10, 20] }] });
  });

  it("stamps a frame the feed did not stamp, with the moment it arrived", () => {
    const frame = parseFrame({ assets: [{ id: "a", lon: 1, lat: 2 }] }, 4242);
    expect(frame).toMatchObject({ assets: [{ updated: 4242 }] });
  });

  it("treats a bare array as a snapshot", () => {
    // A patch would mean nothing is ever removed, which is the failure that
    // leaves a vehicle on the map forever after it leaves the fleet.
    const frame = parseFrame([{ id: "a", lon: 1, lat: 2 }]);
    expect(frame?.kind).toBe("snapshot");
  });

  it("drops the asset with a bad position and keeps the rest", () => {
    const frame = parseFrame({
      assets: [
        { id: "good", lon: 51, lat: 35 },
        { id: "no position" },
        { id: "off the earth", lon: 51, lat: 991 },
        { id: "not a number", lon: "east a bit", lat: 35 },
      ],
    });
    expect(frame).toMatchObject({ assets: [{ id: "good" }] });
  });

  it("refuses a message that is not a frame rather than throwing", () => {
    expect(parseFrame("{oh no")).toBeNull();
    expect(parseFrame(null)).toBeNull();
    expect(parseFrame({ hello: "world" })).toBeNull();
    expect(parseFrame({ type: "remove", ids: [] })).toBeNull();
  });

  it("wraps a heading into the compass rather than trusting it", () => {
    expect(parseFrame({ assets: [{ id: "a", lon: 1, lat: 2, heading: -90 }] })).toMatchObject({
      assets: [{ heading: 270 }],
    });
    expect(parseFrame({ assets: [{ id: "a", lon: 1, lat: 2, heading: 450 }] })).toMatchObject({
      assets: [{ heading: 90 }],
    });
  });

  it("never lets a feed's own fields become top level ones", () => {
    const frame = parseFrame({
      assets: [{ id: "a", lon: 1, lat: 2, properties: { color: "red", speed: 999 } }],
    });
    // `properties.speed` is the feed's; `speed` is ours, and was not sent.
    expect(frame).toMatchObject({ assets: [{ properties: { color: "red" } }] });
    expect((frame as { assets: LiveAsset[] }).assets[0]!.speed).toBeUndefined();
  });
});

describe("applyFrame", () => {
  it("replaces everything for a snapshot", () => {
    const items = [asset("a"), asset("b")];
    expect(applyFrame(items, { kind: "snapshot", assets: [asset("c")] })).toEqual([asset("c")]);
  });

  it("keeps the order it had when an asset moves", () => {
    const items = [asset("a"), asset("b"), asset("c")];
    const moved = { ...asset("b"), position: [1, 1] as [number, number] };
    const next = applyFrame(items, { kind: "update", assets: [moved] });
    expect(next.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(next[1]!.position).toEqual([1, 1]);
  });

  it("adds an asset the list has not seen, at the end", () => {
    const next = applyFrame([asset("a")], { kind: "update", assets: [asset("z")] });
    expect(next.map((a) => a.id)).toEqual(["a", "z"]);
  });

  it("keeps fields a patch did not mention", () => {
    const items = [asset("a", { heading: 90, label: "Unit 1" })];
    const next = applyFrame(items, {
      kind: "update",
      assets: [{ id: "a", position: [2, 2], updated: 2 }],
    });
    // "It is here" does not mean "and it is now facing north and has no name".
    expect(next[0]).toMatchObject({ heading: 90, label: "Unit 1", position: [2, 2] });
  });

  it("wakes a stale asset that has reported again", () => {
    const items = [asset("a", { stale: true })];
    const next = applyFrame(items, { kind: "update", assets: [asset("a", { updated: 9 })] });
    expect(next[0]!.stale).toBe(false);
  });

  it("removes by id", () => {
    const items = [asset("a"), asset("b")];
    expect(applyFrame(items, { kind: "remove", ids: ["a"] }).map((a) => a.id)).toEqual(["b"]);
  });
});

describe("staleness", () => {
  it("is judged against a moment, not against now", () => {
    const a = asset("a", { updated: 1000 });
    expect(isStale(a, 20_000, 30)).toBe(false);
    expect(isStale(a, 40_000, 30)).toBe(true);
  });

  it("is off entirely when the threshold is zero", () => {
    expect(isStale(asset("a", { updated: 0 }), 10 ** 9, 0)).toBe(false);
  });

  it("hands back the same array when no flag changed", () => {
    // The sweep runs once a second forever. A new array every second is a new
    // document every second, for a feed that has not moved.
    const items = [asset("a", { updated: 1000, stale: false })];
    expect(markStale(items, 2000, 30)).toBe(items);
  });

  it("hands back a new array when a flag flipped", () => {
    const items = [asset("a", { updated: 1000 })];
    const next = markStale(items, 60_000, 30);
    expect(next).not.toBe(items);
    expect(next[0]!.stale).toBe(true);
  });

  it("reports the most recent report, or nothing at all", () => {
    expect(lastHeard([])).toBeNull();
    expect(lastHeard([asset("a", { updated: 5 }), asset("b", { updated: 9 })])).toBe(9);
  });
});

describe("assetsGeoJSON", () => {
  it("is empty for a layer with nothing in it", () => {
    expect(assetsGeoJSON(undefined).features).toHaveLength(0);
    expect(assetsGeoJSON(withItems([])).features).toHaveLength(0);
  });

  it("lifts everything an expression has to read into a property", () => {
    const data = assetsGeoJSON(withItems([asset("a", { stale: true, label: "Unit 1" })]));
    expect(data.features[0]!.properties).toMatchObject({
      id: "a",
      label: "Unit 1",
      stale: true,
    });
  });

  it("falls back to the id when the feed sent no name", () => {
    expect(assetsGeoJSON(withItems([asset("a")])).features[0]!.properties["label"]).toBe("a");
  });

  it("always states stale, so an expression never reads undefined", () => {
    // `["case", ["get", "stale"], ...]` on a missing property is not false in
    // every engine; it is an argument of the wrong type.
    expect(assetsGeoJSON(withItems([asset("a")])).features[0]!.properties["stale"]).toBe(false);
  });

  it("does not let the feed's own fields overwrite the ones it is styled by", () => {
    const data = assetsGeoJSON(
      withItems([asset("a", { properties: { stale: true, id: "elsewhere" } })]),
    );
    expect(data.features[0]!.properties).toMatchObject({ id: "a", stale: false });
  });
});

describe("headingGeoJSON", () => {
  it("draws nothing when the layer is not showing headings", () => {
    const assets = withItems([asset("a", { heading: 90 })], { heading: false });
    expect(headingGeoJSON(assets).features).toHaveLength(0);
  });

  it("skips an asset that reports no heading", () => {
    // North because nobody said otherwise is a fact the map does not have.
    expect(headingGeoJSON(withItems([asset("a")])).features).toHaveLength(0);
  });

  it("draws a line that starts where the asset is and leads off its heading", () => {
    const data = headingGeoJSON(withItems([asset("a", { heading: 90, speed: 10 })]));
    const line = data.features[0]!.geometry as { coordinates: [number, number][] };
    expect(line.coordinates[0]).toEqual([51.4, 35.7]);
    // Due east: longitude grows, latitude holds.
    expect(line.coordinates[1]![0]).toBeGreaterThan(51.4);
    expect(line.coordinates[1]![1]).toBeCloseTo(35.7, 3);
  });

  it("gives a standing asset a whisker anyway", () => {
    const data = headingGeoJSON(withItems([asset("a", { heading: 0, speed: 0 })]));
    expect(data.features).toHaveLength(1);
  });
});

describe("withoutLiveAssets", () => {
  it("drops the positions and keeps the settings", () => {
    const project = { assets: withItems([asset("a")], { url: "/feed", enabled: true }) };
    const saved = withoutLiveAssets(project);
    expect(saved.assets.items).toEqual([]);
    expect(saved.assets).toMatchObject({ url: "/feed", enabled: true });
  });

  it("leaves a project with nothing to drop exactly as it was", () => {
    const project = { assets: withItems([]) };
    expect(withoutLiveAssets(project)).toBe(project);
    const bare: { assets?: Assets } = {};
    expect(withoutLiveAssets(bare)).toBe(bare);
  });
});
