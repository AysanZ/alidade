import { describe, expect, it } from "vitest";

import { normaliseFeaturePage } from "../src/api";

/**
 * A client and an API that disagree about a shape is a normal state of affairs:
 * the studio reloads on save, the container does not. It should not be fatal. It
 * was — the table read `row.values[field]` against an API that still returned flat
 * rows, every row was `undefined`, and the throw inside a `map` during render took
 * the whole application down to a black screen.
 */
describe("normaliseFeaturePage", () => {
  it("reads the current shape", () => {
    const page = normaliseFeaturePage({
      fields: ["name", "pop"],
      rows: [{ values: { name: "Tehran", pop: 9 }, bounds: { west: 1, south: 2, east: 3, north: 4 } }],
      total: 1,
      key: "name",
    });
    expect(page.rows[0]!.values["name"]).toBe("Tehran");
    expect(page.rows[0]!.bounds).toEqual({ west: 1, south: 2, east: 3, north: 4 });
    expect(page.key).toBe("name");
  });

  it("reads the older flat shape without throwing", () => {
    const page = normaliseFeaturePage({
      fields: ["scalerank", "name"],
      rows: [{ scalerank: 1, name: "Tehran" }],
      total: 1,
    });
    expect(page.rows[0]!.values["scalerank"]).toBe(1);
    expect(page.rows[0]!.bounds).toBe(null);
    // No key from an old API, so the first field stands in.
    expect(page.key).toBe("scalerank");
  });

  it("survives a body with nothing in it", () => {
    const page = normaliseFeaturePage({});
    expect(page.rows).toEqual([]);
    expect(page.fields).toEqual([]);
    expect(page.key).toBe(null);
  });

  it("survives null, an array and a string where an object was expected", () => {
    for (const body of [null, undefined, [], "nope", 7]) {
      const page = normaliseFeaturePage(body);
      expect(page.rows).toEqual([]);
      expect(page.total).toBe(0);
    }
  });

  it("drops a row's bounds when they are not numbers", () => {
    const page = normaliseFeaturePage({
      fields: ["name"],
      rows: [
        { values: { name: "a" }, bounds: null },
        { values: { name: "b" }, bounds: { west: null, south: 2, east: 3, north: 4 } },
      ],
      total: 2,
    });
    expect(page.rows[0]!.bounds).toBe(null);
    expect(page.rows[1]!.bounds).toBe(null);
  });

  it("gives a null row an empty set of values rather than undefined", () => {
    const page = normaliseFeaturePage({ fields: ["name"], rows: [null], total: 1 });
    expect(page.rows[0]!.values).toEqual({});
  });
});
