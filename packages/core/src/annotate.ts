import { bearing, centroid, distance, formatArea, formatDistance, pathLength, ringArea, ringPerimeter } from "./measure";
import type { Annotation, AnnotationKind, Annotations, DistanceUnits } from "./types/project";

export const annotationSourceId = () => "chrome:annotations";
export const bufferSourceId = () => "chrome:annotations:buffer";

/** How many positions a drawing of each kind needs before it means anything. */
export const MINIMUM: Record<AnnotationKind, number> = { point: 1, line: 2, polygon: 3 };

export function isComplete(annotation: Annotation): boolean {
  return annotation.coordinates.length >= MINIMUM[annotation.kind];
}

/**
 * The measurement a drawing carries.
 *
 * Length for a line, area for a ring, nothing for a point. It is recomputed from
 * the geometry every time rather than trusted from the document, so dragging a
 * vertex cannot leave a stale number behind.
 */
export function measurementOf(annotation: Annotation): number | undefined {
  if (!isComplete(annotation)) return undefined;
  if (annotation.kind === "line") return pathLength(annotation.coordinates);
  if (annotation.kind === "polygon") return ringArea(annotation.coordinates);
  return undefined;
}

export function describe(annotation: Annotation, units: DistanceUnits = "metric"): string {
  const value = measurementOf(annotation);
  if (value === undefined) {
    const [lon, lat] = annotation.coordinates[0] ?? [0, 0];
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  if (annotation.kind === "polygon") {
    return `${formatArea(value, units)} · ${formatDistance(ringPerimeter(annotation.coordinates), units)} around`;
  }
  const path = annotation.coordinates;
  const heading = path.length >= 2 ? bearing(path[0]!, path[path.length - 1]!) : 0;
  return `${formatDistance(value, units)} · ${Math.round(heading)}°`;
}

/* ---------------------------------------------------------------- geojson */

export interface FeatureCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    id?: string;
    properties: Record<string, unknown>;
    geometry:
      | { type: "Point"; coordinates: [number, number] }
      | { type: "LineString"; coordinates: [number, number][] }
      | { type: "Polygon"; coordinates: [number, number][][] }
      | { type: "MultiPolygon"; coordinates: [number, number][][][] };
  }[];
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The drawings as one feature collection.
 *
 * Incomplete drawings are included: a polygon under construction has to be on
 * the screen or the user is drawing blind. A two-point ring is emitted as a line
 * so the renderer has something valid to draw.
 */
export function annotationsGeoJSON(
  annotations: Annotations | undefined,
  units: DistanceUnits = "metric",
): FeatureCollection {
  if (!annotations || annotations.features.length === 0) return EMPTY;

  const features: FeatureCollection["features"] = [];
  for (const a of annotations.features) {
    const geometry = geometryOf(a);
    if (!geometry) continue;
    const value = measurementOf(a);
    features.push({
      type: "Feature",
      id: a.id,
      properties: {
        id: a.id,
        name: a.name,
        color: a.color,
        kind: a.kind,
        label: `${a.name}${value === undefined ? "" : ` · ${describe(a, units)}`}`,
        measure: a.measure ?? "",
        value: value ?? null,
        note: a.note ?? "",
      },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

function geometryOf(a: Annotation): FeatureCollection["features"][number]["geometry"] | null {
  const points = a.coordinates;
  if (points.length === 0) return null;

  if (a.kind === "point") return { type: "Point", coordinates: points[0]! };
  if (a.kind === "line" || points.length < 3) {
    if (points.length < 2) return { type: "Point", coordinates: points[0]! };
    return { type: "LineString", coordinates: points };
  }
  const ring = [...points, points[0]!];
  return { type: "Polygon", coordinates: [ring] };
}

/** Just the vertices, so the renderer can draw handles the user can grab. */
export function vertexGeoJSON(annotations: Annotations | undefined): FeatureCollection {
  if (!annotations) return EMPTY;
  const features: FeatureCollection["features"] = [];
  for (const a of annotations.features) {
    a.coordinates.forEach((position, index) => {
      features.push({
        type: "Feature",
        properties: { of: a.id, index, color: a.color },
        geometry: { type: "Point", coordinates: position },
      });
    });
  }
  return { type: "FeatureCollection", features };
}

/* ---------------------------------------------------------------- buffers */

/**
 * A geodesic buffer, as the union of a capsule per segment and a disc per vertex.
 *
 * The parts are left overlapping rather than dissolved. The union of overlapping
 * rings is the same region as the dissolved outline, which is what matters for
 * both drawing it and asking whether something falls inside it; dissolving would
 * cost a polygon clipper for no gain the user can see.
 */
export function bufferGeoJSON(
  annotations: Annotations | undefined,
  ids: string[],
  metres: number,
): FeatureCollection {
  if (!annotations || metres <= 0 || ids.length === 0) return EMPTY;
  const wanted = new Set(ids);
  const features: FeatureCollection["features"] = [];

  for (const a of annotations.features) {
    if (!wanted.has(a.id) || a.coordinates.length === 0) continue;
    const parts: [number, number][][][] = [];

    for (const position of a.coordinates) parts.push([disc(position, metres)]);

    const path = a.kind === "polygon" ? [...a.coordinates, a.coordinates[0]!] : a.coordinates;
    for (let i = 1; i < path.length; i++) parts.push([capsule(path[i - 1]!, path[i]!, metres)]);
    if (a.kind === "polygon" && a.coordinates.length >= 3) {
      parts.push([[...a.coordinates, a.coordinates[0]!]]);
    }

    features.push({
      type: "Feature",
      id: `${a.id}:buffer`,
      properties: { of: a.id, name: `${a.name} · ${formatDistance(metres)}`, radius: metres },
      geometry: { type: "MultiPolygon", coordinates: parts },
    });
  }

  return { type: "FeatureCollection", features };
}

/** A circle of the given radius, as a ring of 48 positions. */
export function disc(centre: [number, number], metres: number, steps = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) ring.push(offset(centre, metres, (i / steps) * 360));
  return ring;
}

/** A rectangle along a segment, half a width either side. */
function capsule(a: [number, number], b: [number, number], metres: number): [number, number][] {
  const heading = bearing(a, b);
  const left = heading - 90;
  const right = heading + 90;
  const corners: [number, number][] = [
    offset(a, metres, left),
    offset(b, metres, left),
    offset(b, metres, right),
    offset(a, metres, right),
  ];
  return [...corners, corners[0]!];
}

/** Walk a distance along a bearing from a position, on the sphere. */
export function offset(
  from: [number, number],
  metres: number,
  headingDegrees: number,
): [number, number] {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const angular = metres / R;
  const heading = headingDegrees * rad;
  const lat1 = from[1] * rad;
  const lon1 = from[0] * rad;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(heading),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [round(lon2 / rad), round(lat2 / rad)];
}

/* ---------------------------------------------------------------- editing */

export function newAnnotation(kind: AnnotationKind, color = "#ffb454"): Annotation {
  return {
    id: `draw_${Math.random().toString(36).slice(2, 9)}`,
    kind,
    name: kind === "point" ? "Point" : kind === "line" ? "Line" : "Area",
    coordinates: [],
    color,
  };
}

/** The drawing nearest a position, within a tolerance in metres. */
export function nearest(
  annotations: Annotations | undefined,
  at: [number, number],
  withinMetres: number,
): { id: string; index: number } | null {
  if (!annotations) return null;
  let best: { id: string; index: number; away: number } | undefined;
  for (const a of annotations.features) {
    a.coordinates.forEach((position, index) => {
      const away = distance(at, position);
      if (away <= withinMetres && (best === undefined || away < best.away)) {
        best = { id: a.id, index, away };
      }
    });
  }
  return best === undefined ? null : { id: best.id, index: best.index };
}

/** Where to hang a drawing's label. */
export function labelPosition(a: Annotation): [number, number] {
  if (a.kind === "polygon") return centroid(a.coordinates);
  return a.coordinates[a.coordinates.length - 1] ?? [0, 0];
}

const round = (n: number) => Math.round(n * 1e7) / 1e7;
