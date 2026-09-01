import { describe, expect, it } from "vitest";

import { geometryOf } from "../src/layers";

/**
 * A file of coastlines came out of the importer as a solid green wedge lying
 * across the Pacific.
 *
 * The table's geometry column was declared plain `GEOMETRY` — which is what
 * ogr2ogr leaves behind whenever the source held more than one shape — and the
 * client's fallback for anything it did not recognise was `polygon`. A renderer
 * asked to fill a line closes it into a ring first, so every coastline became an
 * area the size of the ocean it borders.
 */
describe("geometryOf", () => {
  it("reads the shapes PostGIS and GDAL actually report", () => {
    expect(geometryOf("POINT")).toBe("point");
    expect(geometryOf("MultiPoint")).toBe("point");
    expect(geometryOf("MULTILINESTRING")).toBe("line");
    expect(geometryOf("LineString")).toBe("line");
    expect(geometryOf("MULTIPOLYGON")).toBe("polygon");
    expect(geometryOf("Polygon")).toBe("polygon");
  });

  it("strips the ST_ that ST_GeometryType puts on the front", () => {
    expect(geometryOf("ST_MultiLineString")).toBe("line");
    expect(geometryOf("ST_POINT")).toBe("point");
    expect(geometryOf("ST_Polygon")).toBe("polygon");
  });

  it("ignores the dimension suffix on a 3D or measured column", () => {
    expect(geometryOf("POINTZ")).toBe("point");
    expect(geometryOf("LINESTRING Z")).toBe("line");
    expect(geometryOf("MULTIPOLYGONZM")).toBe("polygon");
  });

  it("guesses a line, not an area, when the table will not say", () => {
    // Drawing an area as a line is the same map with the fill missing. Filling a
    // line is a continent-sized wedge of colour over the data.
    for (const vague of ["GEOMETRY", "GeometryCollection", "Unknown", "", null]) {
      expect(geometryOf(vague)).toBe("line");
    }
  });

  it("guesses a line for a shape it has never heard of", () => {
    expect(geometryOf("SomethingNobodyHasWrittenYet")).toBe("line");
  });
});
