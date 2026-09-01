import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapProject, MarkerStyle } from "@alidade/core";
import { markerImageId, markersIn } from "@alidade/core";

type Marker = MarkerStyle;

/**
 * Emoji markers, drawn on a canvas and handed to the renderer as images.
 *
 * A vector tile has no idea what an emoji is, and `text-field` would need the
 * glyph set to contain one — the demo font stack does not, so an emoji label
 * renders as nothing at all. The browser has emoji fonts, so the glyph is drawn
 * to a canvas here and registered with `addImage`, which is the only route that
 * works without shipping a sprite sheet.
 */
export function registerMarkers(map: MapLibreMap, project: MapProject): void {
  for (const marker of markersIn(project)) {
    const id = markerImageId(marker);
    if (map.hasImage(id)) continue;
    const image = draw(marker);
    if (image) map.addImage(id, image, { pixelRatio: 2 });
  }
}

/**
 * Rebuild a marker from the name of its image.
 *
 * Registration used to happen in an effect, which runs after the edit it is
 * reacting to has already been applied. Changing a marker's colour or size
 * changes the name of the image it wants, so for one frame the layer named an
 * image the renderer did not have: the markers vanished, and only came back on
 * the next zoom, when the renderer looked again and by then the effect had run.
 *
 * The name carries everything the picture is made of, so the renderer can be
 * answered the moment it asks. Hook this to `styleimagemissing` and the race
 * cannot be lost, whatever order anything else happens in.
 */
export function markerImageFor(id: string): ImageData | null {
  const marker = parseMarkerId(id);
  return marker ? draw(marker) : null;
}

/** The inverse of `markerImageId`. Null for any id that is not a marker's. */
export function parseMarkerId(id: string): Marker | null {
  const parts = id.split(":");
  if (parts.length !== 5 || parts[0] !== "marker") return null;
  const [, shape, color, size, codepoints] = parts as [string, string, string, string, string];
  if (!SHAPES.includes(shape as Marker["shape"])) return null;

  const glyph = codepoints
    ? codepoints
        .split("-")
        .map((point) => String.fromCodePoint(Number.parseInt(point, 16)))
        .join("")
    : "";

  return {
    glyph,
    color: `#${color}`,
    size: Number(size),
    shape: shape as Marker["shape"],
    // Neither of these changes a pixel, so neither is in the name.
    anchor: "above",
    placement: "centre",
  };
}

const SHAPES: Marker["shape"][] = ["pin", "circle", "square", "none"];

/**
 * How much bigger than its font size a glyph's canvas has to be.
 *
 * An emoji is not `size` wide: the pictures in a colour emoji font run to about
 * 1.17em across and rather more tall, and the dark outline a bare glyph is given
 * adds more. Drawn at 0.95 of a canvas of exactly `size`, the edges of every
 * emoji were sliced off. The glyph is now drawn at its stated size on a canvas
 * with room around it, so "22 px" means a 22px glyph rather than a 22px box with
 * a glyph crammed into it.
 */
const GLYPH_MARGIN = 1.4;

/**
 * The pixels for one marker.
 *
 * Drawn at twice the size and registered with `pixelRatio: 2`, so it stays sharp
 * on a retina display without the document having to know what a device pixel
 * ratio is.
 */
function draw(marker: Marker): ImageData | null {
  const scale = 2;
  const size = Math.max(12, Math.min(64, marker.size));
  const bare = marker.shape === "none";
  const width = (bare ? size * GLYPH_MARGIN : size) * scale;
  const height =
    (marker.shape === "pin" ? size * 1.35 : bare ? size * GLYPH_MARGIN : size) * scale;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const centre = width / 2;
  const radius = (size * scale) / 2;

  if (marker.shape !== "none") {
    ctx.fillStyle = marker.color;
    ctx.strokeStyle = "rgba(5,5,5,0.55)";
    ctx.lineWidth = 1.5 * scale;

    if (marker.shape === "pin") {
      // A circle with a tail, which is the shape everyone reads as "here".
      ctx.beginPath();
      ctx.arc(centre, radius, radius - scale, Math.PI * 0.85, Math.PI * 0.15);
      ctx.lineTo(centre, height - scale);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (marker.shape === "square") {
      const inset = scale;
      roundedRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 4 * scale);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(centre, height / 2, radius - scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (marker.glyph) {
    // A bare glyph is drawn at its stated size, with GLYPH_MARGIN of canvas
    // around it. One on a badge has to fit inside the badge.
    const glyphSize = size * scale * (bare ? 1 : 0.58);
    ctx.font = `${glyphSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const y = marker.shape === "pin" ? radius : height / 2;

    /*
     * A colour emoji ignores both of these and paints itself. A plain character
     * does not, and a white tick on a white basemap is a marker you cannot see —
     * so a bare glyph takes the marker's own colour over a dark outline, and one
     * on a badge stays white because the badge behind it is already the colour.
     */
    if (bare) {
      ctx.lineWidth = 3 * scale;
      ctx.strokeStyle = "rgba(5,5,5,0.75)";
      ctx.lineJoin = "round";
      ctx.strokeText(marker.glyph, centre, y);
    }
    ctx.fillStyle = bare ? marker.color : "#ffffff";
    ctx.fillText(marker.glyph, centre, y);
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * A working set, rather than an emoji keyboard.
 *
 * Grouped the way somebody looking for one would scan: the plain marks first,
 * then places, then transport, then utilities and hazards, then land and water.
 * Every one of these is a thing people put on maps; the ones that were here for
 * decoration are not.
 */
export const MARKER_GLYPHS = [
  // Plain marks, for when the point is the point.
  "📍", "🔴", "🔵", "🟢", "🟡", "🟠", "🟣", "⚫",
  "⭐", "❗", "❓", "✅", "❌", "➕", "🔺", "🔻",
  // Places and buildings.
  "🏠", "🏢", "🏬", "🏭", "🏗️", "🏥", "🏫", "🏛️",
  "🏦", "🏨", "🏪", "⛪", "🕌", "🏟️", "🏘️", "🚩",
  // Transport.
  "✈️", "🛫", "🚁", "🚉", "🚇", "🚌", "🚗", "🚚",
  "⚓", "🛳️", "⛵", "🚧", "⛽", "🅿️", "🛣️", "🌉",
  // Utilities, industry, hazards.
  "⚡", "🔌", "💧", "🚰", "🛢️", "⛏️", "♻️", "🗑️",
  "📡", "🗼", "☢️", "☣️", "⚠️", "🔥", "💥", "🚨",
  // Land, water, weather.
  "🌳", "🌲", "🌾", "🏔️", "⛰️", "🌋", "🏝️", "🏖️",
  "🌊", "💦", "🐟", "🦌", "🌡️", "❄️", "🌧️", "🌀",
];
