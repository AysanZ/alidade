import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapProject, Symbology } from "@alidade/core";
import { markerImageId, markersIn } from "@alidade/core";

type Marker = Extract<Symbology, { kind: "marker" }>;

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
 * The pixels for one marker.
 *
 * Drawn at twice the size and registered with `pixelRatio: 2`, so it stays sharp
 * on a retina display without the document having to know what a device pixel
 * ratio is.
 */
function draw(marker: Marker): ImageData | null {
  const scale = 2;
  const size = Math.max(12, Math.min(64, marker.size));
  const width = size * scale;
  const height = (marker.shape === "pin" ? size * 1.35 : size) * scale;

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
    const glyphSize = size * scale * (marker.shape === "none" ? 0.95 : 0.58);
    ctx.font = `${glyphSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(marker.glyph, centre, marker.shape === "pin" ? radius : height / 2);
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

/** A reasonable set to offer, rather than an emoji keyboard. */
export const MARKER_GLYPHS = [
  "📍", "⭐", "🏠", "🏢", "🏭", "🏥", "🏫", "⛽", "🅿️",
  "🌳", "⛰️", "🌊", "🔥", "⚡", "💧", "♻️",
  "🚧", "✈️", "🚉", "🚌", "⚓", "📡", "⚠️", "✓",
];
