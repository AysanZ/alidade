import { describe, expect, it } from "vitest";

import { compile } from "@alidade/core";

import { BASEMAPS } from "../src/basemaps";
import { emptyProject, migrate } from "../src/project";
import { OSM_SOURCE_ID } from "../src/sources";

/**
 * The symptom was "Map data not yet available" written across the map at street
 * zoom on the first two basemaps.
 *
 * A raster service past its deepest cached level does not have to answer 404,
 * and Esri does not: it answers with an image of those words. The renderer
 * draws whatever it is given. The only thing that stops the request being made
 * is the source saying how deep the cache goes.
 *
 * The canvases answer it a second way, by not being raster: vector tiles stop
 * at 14 and are overzoomed with the geometry intact, so the labels stay sharp
 * at 19 rather than being stretched.
 */
describe("basemaps", () => {
  it("every raster basemap says how deep its tiles go", () => {
    for (const basemap of BASEMAPS) {
      if (basemap.raster) expect(basemap.raster.maxzoom, basemap.id).toBeTypeOf("number");
      if (basemap.labelTiles) expect(basemap.labelTiles.maxzoom, basemap.id).toBeTypeOf("number");
      if (basemap.overview) expect(basemap.overview.maxzoom, basemap.id).toBeTypeOf("number");
    }
  });

  it("the Esri canvas is capped at the level Esri actually caches", () => {
    // Documented as worldwide to 10 and regional to 16. It used to claim 19,
    // which is where the placards came from.
    const canvas = BASEMAPS.find((b) => b.id === "esri-canvas")!;
    expect(canvas.raster!.maxzoom).toBe(16);
    expect(canvas.labelTiles!.maxzoom).toBe(16);
  });

  it("nothing in the catalogue needs an API key", () => {
    const urls = BASEMAPS.flatMap((b) =>
      [b.raster, b.labelTiles, b.overview].flatMap((t) => t?.tiles ?? []),
    );
    for (const url of urls) expect(url).not.toMatch(/[?&](key|api_?key|access_token)=/i);
  });

  it("the two the studio opens with are vector, so they stay sharp at street zoom", () => {
    for (const id of ["dark", "light"]) {
      const basemap = BASEMAPS.find((b) => b.id === id)!;
      expect(basemap.vector?.source, id).toBe(OSM_SOURCE_ID);
      expect(basemap.raster, id).toBeUndefined();
    }
  });

  it("a vector basemap draws its own place names above the data", () => {
    const ids = compile(emptyProject).layers.map((l) => l.id);
    expect(ids).toContain("basemap:water");
    expect(ids.indexOf("basemap:label:place")).toBeGreaterThan(ids.indexOf("basemap:water"));
  });

  it("carries a raster limit through to the source the renderer is given", () => {
    const imagery = BASEMAPS.find((b) => b.id === "imagery")!;
    const p = { ...emptyProject, basemap: imagery };
    const source = compile(p).sources["basemap:raster"] as { maxzoom?: number };
    expect(source.maxzoom).toBe(imagery.raster!.maxzoom);
  });
});

describe("migration", () => {
  it("re-reads a basemap the catalogue still knows, so a provider that went bad goes away", () => {
    const stale = {
      ...emptyProject,
      basemap: {
        id: "dark",
        name: "Dark canvas",
        background: "#0b0b0c",
        labels: false,
        opacity: 0.6,
        raster: {
          tiles: ["https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png"],
          maxzoom: 20,
          attribution: "gone",
        },
      },
    };
    const fresh = migrate(stale).basemap;
    expect(fresh.raster).toBeUndefined();
    expect(fresh.vector?.source).toBe(OSM_SOURCE_ID);
    // What the user chose about it is theirs and survives.
    expect(fresh.labels).toBe(false);
    expect(fresh.opacity).toBe(0.6);
  });

  it("leaves a basemap the catalogue does not know exactly as it was", () => {
    const custom = {
      ...emptyProject,
      basemap: {
        id: "somebody-elses",
        name: "Theirs",
        background: "#000000",
        labels: true,
        raster: { tiles: ["https://example.com/{z}/{x}/{y}.png"], maxzoom: 18, attribution: "x" },
      },
    };
    expect(migrate(custom).basemap).toEqual(custom.basemap);
  });

  it("gives an old document the source the buildings and the canvases read", () => {
    const old = { ...emptyProject, sources: {} };
    expect(migrate(old).sources[OSM_SOURCE_ID]).toBeDefined();
  });
});
