import { distance } from "./measure";
import type { Annotation, Annotations } from "./types/project";

/**
 * Snapping.
 *
 * The difference between a drawing tool and a sketching toy. Without it a ring
 * never quite closes, two parcels that share a boundary have a sliver between
 * them, and a route that continues from another route starts a metre away from
 * where the last one ended. None of that is visible at the zoom it was drawn at
 * and all of it is visible in the numbers.
 */

export type SnapKind = "vertex" | "edge";

export interface SnapTarget {
  /** Where the click should actually land. */
  position: [number, number];
  kind: SnapKind;
  /** The drawing snapped to. */
  of: string;
  /**
   * For a vertex, its index. For an edge, the index of the segment's first
   * vertex, so inserting at `index + 1` puts a new vertex in the right place.
   */
  index: number;
  /** How far the pointer was from the target, in metres. */
  away: number;
}

export interface SnapOptions {
  /**
   * How close counts, in metres.
   *
   * Metres rather than pixels because the caller knows the scale and this does
   * not, and because a tolerance that changes with the zoom is the only one that
   * behaves: ten pixels is ten metres at one zoom and ten kilometres at another.
   */
  toleranceMetres: number;
  /** Snap to existing vertices. On by default; this is the useful one. */
  vertices?: boolean;
  /** Snap to the nearest point along a segment, between its vertices. */
  edges?: boolean;
  /** Drawings to ignore entirely. */
  ignore?: readonly string[];
  /**
   * The drawing being edited, and the vertex of it being dragged.
   *
   * A dragged vertex must not snap to itself — it is under the pointer, so it
   * would win every time and the vertex could never be moved. Its neighbours in
   * the same drawing are fair game, which is how a ring is closed onto its own
   * first point.
   */
  excludeVertex?: { of: string; index: number };
}

/**
 * The best thing to snap to, or null when the pointer is not near anything.
 *
 * A vertex always beats an edge inside the tolerance, even a nearer edge.
 * Snapping to a point somebody placed on purpose is almost always what was
 * meant; snapping to the line between two of them is a fallback.
 */
export function snap(
  annotations: Annotations | undefined,
  at: [number, number],
  options: SnapOptions,
): SnapTarget | null {
  if (!annotations || options.toleranceMetres <= 0) return null;
  const { toleranceMetres: tolerance, ignore = [], excludeVertex } = options;
  const wantVertices = options.vertices ?? true;
  const wantEdges = options.edges ?? false;
  const skip = new Set(ignore);

  let bestVertex: SnapTarget | null = null;
  let bestEdge: SnapTarget | null = null;

  for (const feature of annotations.features) {
    if (skip.has(feature.id)) continue;

    if (wantVertices) {
      feature.coordinates.forEach((position, index) => {
        if (excludeVertex && excludeVertex.of === feature.id && excludeVertex.index === index) {
          return;
        }
        const away = distance(at, position);
        if (away > tolerance) return;
        if (!bestVertex || away < bestVertex.away) {
          bestVertex = { position, kind: "vertex", of: feature.id, index, away };
        }
      });
    }

    if (wantEdges) {
      for (const [index, [a, b]] of segmentsOf(feature).entries()) {
        const position = nearestOnSegment(a, b, at);
        const away = distance(at, position);
        if (away > tolerance) continue;
        if (!bestEdge || away < bestEdge.away) {
          bestEdge = { position, kind: "edge", of: feature.id, index, away };
        }
      }
    }
  }

  return bestVertex ?? bestEdge;
}

/**
 * The segments of a drawing, the closing one included for a ring.
 *
 * A point has none. This is exported because the same list is what a vertex
 * editor needs to work out where a midpoint handle goes.
 */
export function segmentsOf(feature: Annotation): [[number, number], [number, number]][] {
  const points = feature.coordinates;
  if (points.length < 2) return [];
  const path =
    feature.kind === "polygon" && points.length >= 3 ? [...points, points[0]!] : points;
  const out: [[number, number], [number, number]][] = [];
  for (let i = 1; i < path.length; i++) out.push([path[i - 1]!, path[i]!]);
  return out;
}

/**
 * The point on segment `a`–`b` closest to `p`.
 *
 * Worked out in a local tangent plane — longitudes scaled by the cosine of the
 * latitude, so a degree east is the same length as a degree north — and then
 * read back as lon/lat. Over a segment short enough to draw on a screen the
 * difference from the true great-circle foot is far below the tolerance anyone
 * would set, and doing it properly means solving on the sphere for a result that
 * is then rounded to seven decimal places anyway.
 *
 * The result is clamped to the segment, so a pointer past the end of a line
 * snaps to its endpoint rather than to a phantom point off the end of it.
 */
export function nearestOnSegment(
  a: [number, number],
  b: [number, number],
  p: [number, number],
): [number, number] {
  // Scale at the middle of the segment, which is the honest choice when the two
  // ends are at different latitudes.
  const scale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180) || 1e-9;

  const ax = a[0] * scale;
  const ay = a[1];
  const bx = b[0] * scale;
  const by = b[1];
  const px = p[0] * scale;
  const py = p[1];

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  // A zero-length segment is its own nearest point.
  if (lengthSquared === 0) return a;

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return [round((ax + t * dx) / scale), round(ay + t * dy)];
}

/**
 * A tolerance in metres for a tolerance in pixels.
 *
 * The caller has the scale; this turns the number a person can reason about —
 * "within about twelve pixels of the thing" — into the number the geometry
 * needs. Same arithmetic the scale bar uses.
 */
export function toleranceInMetres(
  pixels: number,
  zoom: number,
  latitude: number,
): number {
  const metresPerPixel =
    (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  return Math.abs(pixels * metresPerPixel);
}

const round = (n: number) => Math.round(n * 1e7) / 1e7;
