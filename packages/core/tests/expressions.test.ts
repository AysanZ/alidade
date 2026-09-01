import { describe, expect, it } from "vitest";
import { expression, v8 } from "@maplibre/maplibre-gl-style-spec";

import { compile } from "../src/compile";
import { colorExpression, templateToExpression } from "../src/symbology";
import { toExpression } from "../src/filter";
import { defaultChrome } from "../src/types/project";
import type { LayerNode, MapProject, Symbology } from "../src/types/project";

/**
 * A malformed expression is not a small mistake.
 *
 * The renderer rejects the whole paint property, keeps whatever the layer had
 * before, and says so once in a corner of the screen. The layer looks like it
 * ignored you. This happened for real: the categorized colour expression was
 * written as
 *
 *     ["match", ["to-string", ["get", field], ""], ...]
 *
 * reading the "" as a default for a missing value, the way `coalesce` takes one.
 * `to-string` takes exactly one argument, so every categorized layer failed with
 * `circle-color[1]: Expected one argument.` and quietly kept its old colours.
 *
 * Reading an expression and believing it is correct is how that got shipped, so
 * these run the real parser from the real style specification over everything
 * the compiler can produce.
 */

const parse = (expr: unknown, spec: unknown) =>
  expression.createExpression(expr as never, spec as never);

/**
 * A value that is an array is not necessarily an expression: `line-dasharray` is
 * genuinely `[3, 5]`. An expression always starts with the name of an operator.
 */
const looksLikeAnExpression = (value: unknown): boolean =>
  Array.isArray(value) && typeof value[0] === "string";

const check = (expr: unknown, spec: unknown, what: string) => {
  const result = parse(expr, spec);
  if (result.result === "error") {
    const detail = result.value.map((e) => `${e.key}: ${e.message}`).join("; ");
    throw new Error(`${what} did not parse — ${detail}\n${JSON.stringify(expr)}`);
  }
  expect(result.result).toBe("success");
};

const COLOR = v8.paint_circle["circle-color"];

describe("colour expressions parse", () => {
  const symbologies: [string, Symbology][] = [
    ["single", { kind: "single", color: "#4c8dff" }],
    [
      "graduated",
      {
        kind: "graduated",
        field: "scalerank",
        breaks: [3.4, 4.8, 6.2, 7.6],
        colors: ["#0f2438", "#1b4674", "#2e6fe0", "#6fa8ff", "#bbdaff"],
        noDataColor: "#3a3a40",
      },
    ],
    [
      "graduated with no breaks yet",
      {
        kind: "graduated",
        field: "scalerank",
        breaks: [],
        colors: ["#0f2438"],
        noDataColor: "#3a3a40",
      },
    ],
    [
      "categorized",
      {
        kind: "categorized",
        field: "type",
        categories: [
          { value: "major", color: "#4c8dff" },
          { value: 7, color: "#ffb454" },
          { value: "with spaces and 'quotes'", color: "#5ad19a" },
        ],
        fallbackColor: "#3a3a40",
      },
    ],
    [
      "categorized with nothing classified yet",
      { kind: "categorized", field: "type", categories: [], fallbackColor: "#3a3a40" },
    ],
    ["extrusion", { kind: "extrusion", color: "#4c8dff", heightField: "h" }],
  ];

  for (const [name, symbology] of symbologies) {
    it(name, () => check(colorExpression(symbology), COLOR, name));
  }
});

describe("label templates parse", () => {
  const TEXT = v8.layout_symbol["text-field"];
  for (const template of ["{name}", "{name} · {pop_max}", "Airport: {name}", "no fields at all"]) {
    it(template, () => check(templateToExpression(template), TEXT, template));
  }
});

describe("filters parse", () => {
  const FILTER = v8.filter;
  it("every operator the filter builder can emit", () => {
    const node = {
      op: "and" as const,
      children: [
        { op: "=" as const, field: "name", value: "Heathrow" },
        { op: "!=" as const, field: "kind", value: null },
        { op: ">" as const, field: "pop", value: 1000 },
        { op: "<=" as const, field: "rank", value: 4 },
        { op: "like" as const, field: "name", value: "heath" },
        { op: "in" as const, field: "iata", value: ["LHR", "LGW"] },
        { op: "isnull" as const, field: "note" },
        { op: "notnull" as const, field: "note" },
        { op: "not" as const, child: { op: "=" as const, field: "x", value: true } },
      ],
    };
    check(toExpression(node), FILTER, "filter");
  });
});

/**
 * The end to end version: build a project that uses every feature at once and
 * put every paint and layout value the compiler produced through the parser.
 */
describe("a whole compiled project parses", () => {
  const layer = (over: Partial<LayerNode>): LayerNode => ({
    type: "layer",
    id: "l",
    name: "Layer",
    slot: "data",
    source: "s",
    sourceLayer: "s",
    geometry: "point",
    visible: true,
    opacity: 0.8,
    symbology: { kind: "single", color: "#4c8dff" },
    ...over,
  });

  const project = (): MapProject => ({
    schema: 3,
    id: "t",
    name: "Test",
    view: { center: [0, 0], zoom: 4, pitch: 0, bearing: 0 },
    basemap: { id: "n", name: "None", background: "#050505", labels: false },
    environment: {},
    chrome: {
      ...defaultChrome(),
      graticule: { enabled: true, interval: 10, labels: true, color: "#2b2b30" },
      grids: { utm: true, square: { enabled: true, spacing: 10000 }, color: "#3b6ea5" },
    },
    sources: { s: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.mvt"] } },
    annotations: {
      visible: true,
      opacity: 1,
      features: [
        { id: "a", kind: "polygon", name: "Area", coordinates: [[0, 0], [1, 0], [1, 1]], color: "#5ad19a" },
      ],
    },
    selection: {
      layer: "airports",
      field: "scalerank",
      values: [2],
      where: [{ field: "name", value: "Heathrow" }],
      hover: true,
    },
    tree: [
      layer({
        id: "airports",
        geometry: "point",
        marker: { glyph: "✈️", color: "#4c8dff", size: 26, shape: "pin", anchor: "above" },
        labels: { template: "{name}", size: 11, color: "#e4e4e6", haloColor: "#050505", haloWidth: 1.2 },
        filter: { op: ">", field: "pop", value: 100 },
      }),
      layer({
        id: "roads",
        geometry: "line",
        symbology: {
          kind: "categorized",
          field: "kind",
          categories: [{ value: "trunk", color: "#ffb454" }],
          fallbackColor: "#3a3a40",
          stroke: { color: "#0a0a0b", width: 0.6, dash: [3, 2] },
        },
        marker: {
          glyph: "🚧",
          color: "#ffb454",
          size: 22,
          shape: "circle",
          anchor: "on",
          placement: "along",
          spacing: 150,
        },
      }),
      layer({
        id: "wards",
        geometry: "polygon",
        symbology: {
          kind: "graduated",
          field: "density",
          breaks: [900, 2100],
          colors: ["#0f2438", "#2e6fe0", "#bbdaff"],
          noDataColor: "#3a3a40",
          stroke: { color: "#0a0a0b", width: 0.6 },
        },
      }),
      layer({
        id: "towers",
        geometry: "polygon",
        symbology: { kind: "extrusion", color: "#4c8dff", heightField: "height", heightScale: 2 },
      }),
    ],
  });

  it("has no paint or layout value the renderer would refuse", () => {
    const compiled = compile(project());
    expect(compiled.layers.length).toBeGreaterThan(8);

    for (const engine of compiled.layers) {
      const paintSpec = (v8 as Record<string, Record<string, unknown>>)[`paint_${engine.type}`];
      const layoutSpec = (v8 as Record<string, Record<string, unknown>>)[`layout_${engine.type}`];

      for (const [key, value] of Object.entries(engine.paint)) {
        const spec = paintSpec?.[key];
        expect(spec, `${engine.type} has no paint property ${key}`).toBeDefined();
        if (looksLikeAnExpression(value)) check(value, spec, `${engine.id}.paint.${key}`);
      }
      for (const [key, value] of Object.entries(engine.layout)) {
        if (key === "visibility") continue;
        const spec = layoutSpec?.[key];
        expect(spec, `${engine.type} has no layout property ${key}`).toBeDefined();
        if (looksLikeAnExpression(value)) check(value, spec, `${engine.id}.layout.${key}`);
      }
      if (engine.filter !== undefined) {
        check(engine.filter, v8.filter, `${engine.id}.filter`);
      }
    }
  });
});
