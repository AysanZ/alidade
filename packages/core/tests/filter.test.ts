import { describe, expect, it } from "vitest";

import { toExpression, toSql } from "../src/filter";
import type { FilterNode } from "../src/types/project";

const tree: FilterNode = {
  op: "and",
  children: [
    { op: ">=", field: "density", value: 1200 },
    { op: "<=", field: "area_km2", value: 18.5 },
    { op: "like", field: "name", value: "Sino%" },
  ],
};

describe("filter", () => {
  it("compiles to a renderer expression", () => {
    expect(toExpression(tree)).toEqual([
      "all",
      [">=", ["get", "density"], 1200],
      ["<=", ["get", "area_km2"], 18.5],
      ["in", "Sino", ["get", "name"]],
    ]);
  });

  /*
   * The document spells equality `=`, because that is what a person writing a
   * filter types. Expressions spell it `==` and reject `=` outright, which threw
   * out of `setFilter` and left the layer showing everything — the commonest
   * filter anybody writes did nothing at all.
   */
  it("says == where the document says =, and SQL still says =", () => {
    expect(toExpression({ op: "=", field: "name", value: "Bandar" })).toEqual([
      "==",
      ["get", "name"],
      "Bandar",
    ]);
    expect(toSql({ op: "=", field: "name", value: "Bandar" }).where).toBe('"name" = $1');
  });

  it("leaves the comparisons that are spelled the same alone", () => {
    for (const op of ["!=", "<", "<=", ">", ">="] as const) {
      expect(toExpression({ op, field: "n", value: 1 })).toEqual([op, ["get", "n"], 1]);
    }
  });

  it("compiles to SQL with every value bound", () => {
    const { where, params } = toSql(tree);
    expect(where).toBe('("density" >= $1 AND "area_km2" <= $2 AND "name" LIKE $3)');
    expect(params).toEqual([1200, 18.5, "Sino%"]);
  });

  it("never puts a value in the query text", () => {
    const { where, params } = toSql({
      op: "=",
      field: "name",
      value: "'; DROP TABLE wards_1400; --",
    });
    expect(where).toBe('"name" = $1');
    expect(params[0]).toContain("DROP TABLE");
  });

  it("refuses anything that is not a column name", () => {
    expect(() => toSql({ op: "=", field: "name; DROP TABLE t", value: 1 })).toThrow();
  });

  it("can start binding after earlier parameters", () => {
    expect(toSql({ op: "=", field: "density", value: 5 }, 4).where).toBe('"density" = $4');
  });
});
