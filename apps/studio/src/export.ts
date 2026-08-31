import type { Map as MapLibreMap } from "maplibre-gl";
import type { MapProject } from "@alidade/core";
import { metresPerPixel, scaleBar } from "@alidade/core";

import type { Camera } from "./components/MapChrome";

/**
 * The map as a PNG, with the furniture drawn on rather than left out.
 *
 * The old export was `canvas.toDataURL()` and nothing else, which produced an
 * image with no scale, no north and no idea what it was of — the three things
 * that make a map export worth taking to a meeting. The chrome is not in the
 * WebGL canvas, so it is painted onto a copy here.
 */
export function stampedPng(
  map: MapLibreMap,
  project: MapProject,
  camera: Camera,
  onProblem: (message: string) => void,
): void {
  const source = map.getCanvas();
  const width = source.width;
  const height = source.height;
  if (!width || !height) return onProblem("The map has not drawn anything to export yet.");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return onProblem("This browser will not give a 2D context to draw the stamp on.");

  try {
    ctx.drawImage(source, 0, 0);
  } catch (error) {
    // Reading the WebGL canvas back needs preserveDrawingBuffer, which is set on
    // the map, but a tainted canvas from a basemap without CORS also lands here.
    return onProblem(
      `The map canvas could not be read back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const scale = source.width / source.clientWidth || 1;
  const pad = 18 * scale;
  const band = 78 * scale;

  const gradient = ctx.createLinearGradient(0, height - band, 0, height);
  gradient.addColorStop(0, "rgba(5,5,5,0)");
  gradient.addColorStop(0.35, "rgba(5,5,5,0.72)");
  gradient.addColorStop(1, "rgba(5,5,5,0.88)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, height - band, width, band);

  ctx.fillStyle = "#e4e4e6";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 ${15 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillText(project.name, pad, height - band + 26 * scale);

  const bar = scaleBar(
    metresPerPixel(camera.zoom, camera.latitude),
    120,
    project.chrome.scaleBar.units,
  );
  const denominator = Math.round(
    metresPerPixel(camera.zoom, camera.latitude) / 0.00028,
  ).toLocaleString("en-US").replace(/,/g, " ");

  ctx.font = `${11 * scale}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = "#9a9aa0";
  ctx.fillText(
    `1:${denominator} · ${new Date().toISOString().slice(0, 10)} · ${project.basemap.name}`,
    pad,
    height - band + 46 * scale,
  );

  /* scale bar, bottom right, drawn to the same width the screen shows */
  const barWidth = bar.width * scale;
  const barRight = width - pad;
  const barY = height - 26 * scale;
  ctx.strokeStyle = "#e4e4e6";
  ctx.lineWidth = 1.4 * scale;
  ctx.beginPath();
  ctx.moveTo(barRight - barWidth, barY - 6 * scale);
  ctx.lineTo(barRight - barWidth, barY);
  ctx.lineTo(barRight, barY);
  ctx.lineTo(barRight, barY - 6 * scale);
  ctx.stroke();
  ctx.fillStyle = "#e4e4e6";
  ctx.textAlign = "right";
  ctx.fillText(bar.label, barRight, barY - 10 * scale);

  /* north arrow, above the scale bar, rotated with the map */
  const northX = barRight - 12 * scale;
  const northY = height - band + 22 * scale;
  ctx.save();
  ctx.translate(northX, northY);
  ctx.rotate((-camera.bearing * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -13 * scale);
  ctx.lineTo(5 * scale, 8 * scale);
  ctx.lineTo(0, 4 * scale);
  ctx.lineTo(-5 * scale, 8 * scale);
  ctx.closePath();
  ctx.fillStyle = "#4c8dff";
  ctx.fill();
  ctx.restore();
  ctx.textAlign = "center";
  ctx.fillStyle = "#9a9aa0";
  ctx.font = `${10 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillText("N", northX, northY + 22 * scale);
  ctx.textAlign = "left";

  canvas.toBlob((blob) => {
    if (!blob) return onProblem("The image could not be encoded.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.id}-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
