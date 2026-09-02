import { describe, expect, it } from "vitest";
import type { FilterNode } from "@alidade/core";
import { toExpression, toSql } from "@alidade/core";

import {
  coerce,
  displayValue,
  isComplex,
  rebuild,
  takesOf,
  toFilter,
  toRules,
  withValue,
  type Comparison,
} from "../src/filterRules";

const rule = (over: Partial<Comparison> = {}): Comparison =>
  ({ op: "=", field: "name", value: "x", ...over }) as Comparison;

describe("reading a filter as rules", () => {
  it("gives an empty list for no filter", () => {
    expect(toRules(undefined)).toEqual({ join: "and", rules: [] });
  });

  it("reads a bare comparison as one rule", () => {
    const filter: FilterNode = { op: ">", field: "density", value: 500 };
    expect(toRules(filter)).toEqual({ join: "and", rules: [filter] });
  });

  it("keeps the connective a group was written with", () => {
    const filter: FilterNode = {
      op: "or",
      children: [rule(), rule({ field: "kind" })],
    };
    expect(toRules(filter).join).toBe("or");
    expect(toRules(filter).rules).toHaveLength(2);
  });

  it("shows the rules of a nested filter rather than refusing it", () => {
    const filter: FilterNode = {
      op: "and",
      children: [rule(), { op: "or", children: [rule({ field: "a" })] }],
    };
    expect(toRules(filter).rules).toHaveLength(1);
    // ...and says that it is not showing everything, so the panel can warn.
    expect(isComplex(filter)).toBe(true);
  });

  it("does not call a flat filter complex", () => {
    expect(isComplex(undefined)).toBe(false);
    expect(isComplex(rule())).toBe(false);
    expect(isComplex({ op: "and", children: [rule(), rule()] })).toBe(false);
  });

  it("calls a negation complex, because the list cannot express one", () => {
    expect(isComplex({ op: "not", child: rule() })).toBe(true);
  });
});

describe("writing rules back", () => {
  it("writes nothing at all for an empty list", () => {
    expect(toFilter("and", [])).toBeUndefined();
  });

  it("writes one rule as itself, not as a conjunction of one", () => {
    const only = rule();
    expect(toFilter("and", [only])).toBe(only);
  });

  it("round-trips: rules in, filter out, the same rules back", () => {
    const rules = [rule({ op: ">", field: "density", value: 500 }), rule({ field: "kind" })];
    expect(toRules(toFilter("or", rules)).rules).toEqual(rules);
    expect(toRules(toFilter("or", rules)).join).toBe("or");
  });
});

describe("typed values", () => {
  it("stores a number as a number, because a comparison has to compare numbers", () => {
    // The whole point: "5" > "10" is true as text and false as arithmetic, and
    // a filter that is only wrong for two-digit values is the worst kind.
    const out = withValue(rule({ op: ">", field: "density" }), "10");
    expect(out).toMatchObject({ value: 10 });
    expect(typeof (out as { value: unknown }).value).toBe("number");
  });

  it("leaves a contains test as text, because it is looking for characters", () => {
    expect(withValue(rule({ op: "like" }), "2024")).toMatchObject({ value: "2024" });
  });

  it("reads true and false as booleans", () => {
    expect(coerce("true")).toBe(true);
    expect(coerce("false")).toBe(false);
  });

  it("leaves anything that is not a number alone", () => {
    expect(coerce("Tajrish")).toBe("Tajrish");
    expect(coerce("")).toBe("");
  });

  it("splits a list on commas and types each part on its own", () => {
    const out = withValue(rule({ op: "in", field: "code" }), "1, two, 3");
    expect(out).toMatchObject({ value: [1, "two", 3] });
  });

  it("shows a list back as the text it was typed as", () => {
    expect(displayValue(rule({ op: "in", field: "code", value: [1, "two"] }))).toBe("1, two");
  });
});

describe("changing the test", () => {
  it("keeps the value when the new test can still use it", () => {
    expect(rebuild(rule({ value: "Tajrish" }), "!=")).toMatchObject({ value: "Tajrish" });
  });

  it("drops the value for a test that takes none", () => {
    expect(rebuild(rule({ value: "Tajrish" }), "isnull")).toEqual({ op: "isnull", field: "name" });
    expect(takesOf("isnull")).toBe("none");
  });

  it("does not carry text into an arithmetic test", () => {
    // `> "Tajrish"` compiles and then matches nothing, which looks like a broken
    // layer rather than a filter that cannot mean anything.
    expect(rebuild(rule({ value: "Tajrish" }), ">")).toMatchObject({ value: 0 });
  });

  it("turns a single value into a list of one when the test wants a list", () => {
    expect(rebuild(rule({ value: "a" }), "in")).toMatchObject({ op: "in", value: [] });
  });
});

describe("what the editor produces actually compiles", () => {
  const built = toFilter("and", [
    withValue(rule({ op: ">", field: "density" }), "500"),
    withValue(rule({ op: "like", field: "name" }), "abad"),
  ])!;

  it("compiles to a renderer expression", () => {
    expect(toExpression(built)).toEqual([
      "all",
      [">", ["get", "density"], 500],
      ["in", "abad", ["get", "name"]],
    ]);
  });

  it("compiles to SQL with every value bound rather than pasted in", () => {
    const { where, params } = toSql(built);
    expect(where).toBe('("density" > $1 AND "name" LIKE $2)');
    expect(params).toEqual([500, "abad"]);
  });

  it("cannot be made to carry an injection through a column name", () => {
    const nasty = toFilter("and", [rule({ field: "name; DROP TABLE layers; --" })])!;
    expect(() => toSql(nasty)).toThrow(/Not a column name/);
  });
});
