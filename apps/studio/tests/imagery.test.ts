import { describe, expect, it } from "vitest";
import type { ImageRecord } from "@alidade/core";

import { dateLabel, gsdLabel, provenance, sortImages } from "../src/imagery";

/* A record as the panels see it, so a case only states what it is about. */
function image(over: Partial<ImageRecord> & { id: string }): ImageRecord {
  return {
    title: over.id,
    file: `${over.id}.tif`,
    datetime: null,
    datetimeFrom: null,
    gsd: 10,
    epsg: 32639,
    cloudCover: null,
    bands: 4,
    dtype: "UInt16",
    bbox: [51.2, 35.6, 51.5, 35.8],
    footprint: [
      [51.22, 35.6],
      [51.5, 35.64],
      [51.48, 35.8],
      [51.2, 35.76],
      [51.22, 35.6],
    ],
    ...over,
  };
}

describe("ground sample distance", () => {
  it("is said in the unit a person would say it in", () => {
    expect(gsdLabel(10)).toBe("10 m");
    expect(gsdLabel(0.05)).toBe("5 cm");
    expect(gsdLabel(0.5)).toBe("50 cm");
  });

  it("does not print a satellite tile as 1000 cm", () => {
    expect(gsdLabel(1)).toBe("1 m");
  });
});

describe("the date shown", () => {
  it("is the day, not the instant", () => {
    expect(dateLabel("2024-07-19T07:16:21Z")).toBe("2024-07-19");
  });

  it("is nothing when there is nothing", () => {
    expect(dateLabel(null)).toBeNull();
  });
});

describe("where a date came from", () => {
  /*
   * A date somebody typed must never look like one the file stated. The panel
   * has three tones for exactly this: the file said it, the filename implied it,
   * or you did.
   */
  it("distinguishes the file's own date from one the user set", () => {
    expect(provenance("tag").tone).toBe("good");
    expect(provenance("user").tone).toBe("mine");
    expect(provenance("tag").label).not.toBe(provenance("user").label);
  });

  it("says a filename date is worth a second look", () => {
    expect(provenance("filename").note.toLowerCase()).toContain("glance");
  });

  it("has something to say about an image with no date at all", () => {
    const none = provenance(null);
    expect(none.tone).toBe("none");
    expect(none.note).toContain("on the map");
  });
});

describe("sorting the catalogue", () => {
  const catalogue = [
    image({ id: "may24", datetime: "2024-05-02T00:00:00Z", coverage: 100 }),
    image({ id: "drone", gsd: 0.05, coverage: 4 }),
    image({ id: "jul24", datetime: "2024-07-19T00:00:00Z", coverage: 62 }),
    image({ id: "apr23", datetime: "2023-04-11T00:00:00Z", coverage: 100 }),
  ];

  it("puts the newest first", () => {
    expect(sortImages(catalogue, "date").map((i) => i.id)).toEqual([
      "jul24",
      "may24",
      "apr23",
      "drone",
    ]);
  });

  it("reverses without moving the undated one off the end", () => {
    const order = sortImages(catalogue, "dateasc").map((i) => i.id);
    expect(order).toEqual(["apr23", "may24", "jul24", "drone"]);
  });

  /*
   * An undated image is listed, not hidden. A heading that says four images
   * over a list showing three is a number nobody can reconcile with what is on
   * the screen — and the one that vanished is exactly the one to go and fix.
   */
  it("never drops an image for having no date", () => {
    for (const key of ["date", "dateasc", "coverage", "gsd", "title"] as const) {
      expect(sortImages(catalogue, key)).toHaveLength(catalogue.length);
    }
  });

  it("sorts by resolution and by coverage", () => {
    expect(sortImages(catalogue, "gsd")[0]!.id).toBe("drone");
    expect(sortImages(catalogue, "coverage")[0]!.coverage).toBe(100);
  });

  it("does not mutate what it was given", () => {
    const before = catalogue.map((i) => i.id);
    sortImages(catalogue, "gsd");
    sortImages(catalogue, "date");
    expect(catalogue.map((i) => i.id)).toEqual(before);
  });
});
