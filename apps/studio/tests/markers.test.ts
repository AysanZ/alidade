import { describe, expect, it } from "vitest";
import { defaultMarker, markerImageId } from "@alidade/core";
import type { MarkerStyle } from "@alidade/core";

import { MARKER_GLYPHS, parseMarkerId } from "../src/markers";

/**
 * Changing a marker's colour or its size changed the name of the image it asked
 * for. Registration lived in an effect, which runs *after* the edit it reacts to
 * has already reached the renderer, so for one frame every marker on the layer
 * pointed at an image that did not exist and simply vanished. They came back on
 * the next zoom, when the renderer looked again and the effect had long since
 * run — which is a bug that looks like a rendering glitch and is not one.
 *
 * The name carries everything the picture is made of, so the renderer can be
 * answered the instant it asks. That only holds if the name can be read back.
 */
describe("parseMarkerId", () => {
  const round = (marker: MarkerStyle) => parseMarkerId(markerImageId(marker));

  const base: MarkerStyle = {
    glyph: "📍",
    color: "#4c8dff",
    size: 26,
    shape: "pin",
    anchor: "above",
  };

  it("reads back everything the picture is made of", () => {
    const read = round(base);
    expect(read).toMatchObject({ glyph: "📍", color: "#4c8dff", size: 26, shape: "pin" });
  });

  it("survives every shape", () => {
    for (const shape of ["pin", "circle", "square", "none"] as const) {
      expect(round({ ...base, shape })?.shape).toBe(shape);
    }
  });

  it("survives an emoji that is more than one code point", () => {
    // A flag, a keycap and a variation selector are all several code points, and
    // the id joins them with a hyphen.
    for (const glyph of ["🇬🇧", "⚠️", "🅿️", "👩‍🚀"]) {
      expect(round({ ...base, glyph })?.glyph).toBe(glyph);
    }
  });

  it("survives a marker with no glyph at all", () => {
    expect(round({ ...base, glyph: "" })?.glyph).toBe("");
  });

  /* The exact case the fix is for: a new name for the same shape. */
  it("gives a different name for a different colour or size, and reads both", () => {
    const recoloured = { ...base, color: "#ffb454" };
    const resized = { ...base, size: 42 };
    expect(markerImageId(recoloured)).not.toBe(markerImageId(base));
    expect(markerImageId(resized)).not.toBe(markerImageId(base));
    expect(round(recoloured)?.color).toBe("#ffb454");
    expect(round(resized)?.size).toBe(42);
  });

  it("does not claim an id that is not a marker's", () => {
    for (const id of ["airports:circle", "marker", "marker:pin", "marker:blob:fff:26:1f4cd", ""]) {
      expect(parseMarkerId(id)).toBe(null);
    }
  });
});

/**
 * Asking for an emoji on a point and getting a coloured badge with the emoji
 * inside it, standing above the place it names, is a decoration nobody asked
 * for. The default is the glyph, where the point is.
 */
describe("the marker a layer gets to begin with", () => {
  it("is the glyph on its own, on the feature", () => {
    const marker = defaultMarker();
    expect(marker.shape).toBe("none");
    expect(marker.anchor).toBe("on");
  });
});

describe("the glyph palette", () => {
  it("offers no glyph twice", () => {
    expect(new Set(MARKER_GLYPHS).size).toBe(MARKER_GLYPHS.length);
  });

  it("fills whole rows, so the grid has no ragged last line", () => {
    expect(MARKER_GLYPHS.length % 8).toBe(0);
  });

  /*
   * The id encodes the glyph as its code points. A glyph that cannot survive
   * that round trip is a marker that draws as the wrong picture, or as none.
   */
  it("offers nothing that cannot be named and read back", () => {
    for (const glyph of MARKER_GLYPHS) {
      const marker: MarkerStyle = {
        glyph,
        color: "#4c8dff",
        size: 22,
        shape: "none",
        anchor: "on",
      };
      expect(parseMarkerId(markerImageId(marker))?.glyph, glyph).toBe(glyph);
    }
  });

  it("names a different image for every glyph in it", () => {
    const ids = MARKER_GLYPHS.map((glyph) =>
      markerImageId({ glyph, color: "#4c8dff", size: 22, shape: "none", anchor: "on" }),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
