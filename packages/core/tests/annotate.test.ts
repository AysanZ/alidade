import { describe, expect, it } from "vitest";

import {
  annotationsGeoJSON,
  bufferGeoJSON,
  isComplete,
  measurementOf,
  newAnnotation,
  offset,
  vertexGeoJSON,
} from "../src/annotate";
import { detectFormat, read, write } from "../src/exchange";
import { distance } from "../src/measure";
import type { Annotations } from "../src/types/project";

const line = (): Annotations => ({
  visible: true,
  opacity: 1,
  features: [
    {
      id: "a",
      kind: "line",
      name: "Route",
      color: "#4c8dff",
      coordinates: [
        [51.4, 35.7],
        [51.5, 35.7],
      ],
    },
  ],
});

const area = (): Annotations => ({
  visible: true,
  opacity: 1,
  features: [
    {
      id: "b",
      kind: "polygon",
      name: "Plot",
      color: "#5ad19a",
      coordinates: [
        [51.4, 35.7],
        [51.5, 35.7],
        [51.5, 35.8],
      ],
    },
  ],
});

describe("annotations", () => {
  it("knows when a drawing has enough points to mean anything", () => {
    const drawing = newAnnotation("polygon");
    expect(isComplete(drawing)).toBe(false);
    drawing.coordinates = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(isComplete(drawing)).toBe(true);
  });

  it("measures a line as a length and a ring as an area", () => {
    expect(measurementOf(line().features[0]!)).toBeGreaterThan(8000);
    expect(measurementOf(area().features[0]!)).toBeGreaterThan(1e7);
  });

  it("closes a ring when writing it out as a polygon", () => {
    const collection = annotationsGeoJSON(area());
    const geometry = collection.features[0]!.geometry as { coordinates: [number, number][][] };
    const ring = geometry.coordinates[0]!;
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });

  it("draws a two point ring as a line rather than an invalid polygon", () => {
    const half = area();
    half.features[0]!.coordinates = half.features[0]!.coordinates.slice(0, 2);
    expect(annotationsGeoJSON(half).features[0]!.geometry.type).toBe("LineString");
  });

  it("emits one vertex feature per position", () => {
    expect(vertexGeoJSON(area()).features).toHaveLength(3);
  });

  it("is empty rather than undefined when there is nothing drawn", () => {
    expect(annotationsGeoJSON(undefined).features).toEqual([]);
  });
});

describe("offset and buffers", () => {
  it("walks the distance it was asked for", () => {
    const from: [number, number] = [51.4, 35.7];
    const to = offset(from, 1000, 90);
    expect(distance(from, to)).toBeCloseTo(1000, 0);
  });

  it("covers a line with a disc per vertex and a rectangle per segment", () => {
    const collection = bufferGeoJSON(line(), ["a"], 500);
    const geometry = collection.features[0]!.geometry as { coordinates: unknown[] };
    expect(collection.features).toHaveLength(1);
    expect(geometry.coordinates).toHaveLength(3);
  });

  it("buffers nothing when no drawing was named", () => {
    expect(bufferGeoJSON(line(), [], 500).features).toEqual([]);
  });
});

describe("exchange", () => {
  it("round trips a line through GeoJSON", () => {
    const written = write(line(), "geojson");
    const back = read(written.text);
    expect(back).toHaveLength(1);
    expect(back[0]!.kind).toBe("line");
    expect(back[0]!.coordinates).toEqual(line().features[0]!.coordinates);
  });

  it("round trips a ring through WKT without closing it twice", () => {
    const written = write(area(), "wkt");
    expect(written.text).toContain("POLYGON ((");
    const back = read(written.text);
    expect(back[0]!.coordinates).toHaveLength(3);
  });

  it("writes KML that names the placemark", () => {
    expect(write(area(), "kml").text).toContain("<name>Plot</name>");
  });

  it("writes GPX waypoints for points and tracks for the rest", () => {
    const text = write(area(), "gpx").text;
    expect(text).toContain("<trk>");
    expect(text).not.toContain("<wpt");
  });

  it("reads a CSV of points, whatever the columns are called", () => {
    const back = read("Name,Lat,Long\nSite A,35.7,51.4\nSite B,35.8,51.5\n");
    expect(back).toHaveLength(2);
    expect(back[0]!.name).toBe("Site A");
    expect(back[0]!.coordinates[0]).toEqual([51.4, 35.7]);
  });

  it("keeps a comma inside a quoted CSV cell", () => {
    const back = read('name,lat,lon\n"Tehran, Iran",35.7,51.4\n');
    expect(back[0]!.name).toBe("Tehran, Iran");
  });

  it("splits a multi geometry into one drawing per part", () => {
    const back = read(
      JSON.stringify({
        type: "Feature",
        properties: { name: "Pair" },
        geometry: { type: "MultiPoint", coordinates: [[1, 2], [3, 4]] },
      }),
    );
    expect(back).toHaveLength(2);
  });

  it("reads KML back out of its own output", () => {
    const back = read(write(area(), "kml").text);
    expect(back[0]!.kind).toBe("polygon");
    expect(back[0]!.name).toBe("Plot");
  });

  it("works out the format from the content, not the extension", () => {
    expect(detectFormat('{"type":"FeatureCollection"}')).toBe("geojson");
    expect(detectFormat("<kml xmlns='x'>")).toBe("kml");
    expect(detectFormat("POINT (1 2)")).toBe("wkt");
    expect(detectFormat("")).toBe(null);
  });

  it("returns nothing rather than throwing on rubbish", () => {
    expect(read("{ not json")).toEqual([]);
  });
});
