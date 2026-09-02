import { describe, expect, it } from "vitest";

import { keys } from "../src/queries";

/**
 * The keys are the cache's index and its invalidation surface at once, so the
 * property that matters is prefix containment: `invalidateQueries` on a prefix
 * has to reach everything underneath it. A key that quietly stops starting with
 * `["layers"]` does not fail anywhere — the import just stops refreshing the
 * catalogue, which is the kind of bug nobody reports.
 */
const startsWith = (key: readonly unknown[], prefix: readonly unknown[]) =>
  prefix.every((part, i) => JSON.stringify(key[i]) === JSON.stringify(part));

describe("query keys", () => {
  it("nests every layer key under the one prefix an import invalidates", () => {
    const under = [
      keys.layers.list(),
      keys.layers.detail("wards"),
      keys.layers.features("wards", { limit: 50 }),
      keys.layers.stats("wards", "density"),
    ];
    for (const key of under) expect(startsWith(key, keys.layers.all)).toBe(true);
  });

  it("keeps WMS out of the layer registry's prefix", () => {
    expect(startsWith(keys.wms.capabilities("https://example.org"), keys.layers.all)).toBe(false);
  });

  it("gives two layers two keys", () => {
    expect(keys.layers.detail("a")).not.toEqual(keys.layers.detail("b"));
  });

  it("gives two pages of one layer two keys, so paging does not overwrite itself", () => {
    const first = keys.layers.features("wards", { limit: 50, offset: 0 });
    const second = keys.layers.features("wards", { limit: 50, offset: 50 });
    expect(first).not.toEqual(second);
  });

  it("gives one request one key however many times it is built", () => {
    expect(keys.layers.features("wards", { limit: 50, offset: 0 })).toEqual(
      keys.layers.features("wards", { limit: 50, offset: 0 }),
    );
  });

  it("separates a sorted page from an unsorted one", () => {
    expect(keys.layers.features("wards", { order: "name" })).not.toEqual(
      keys.layers.features("wards", { order: "name", descending: true }),
    );
  });
});
