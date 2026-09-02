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

/* ---------------------------------------------------------------- vertices */

/**
 * Editing the geometry of a drawing.
 *
 * These are pure and total: they take a drawing and give a drawing back, and
 * they refuse rather than corrupt. A caller that asks for something impossible —
 * removing the third vertex of a triangle, moving a vertex that is not there —
 * gets the drawing it passed in, unchanged and still valid.
 *
 * They are here rather than in the studio because "a ring cannot go below three
 * points" is a fact about the geometry, not about the panel that happens to be
 * showing it, and because a fact about geometry can be tested without a browser.
 */

/** Whether a drawing can lose a vertex and still be the shape it claims to be. */
export function canRemoveVertex(annotation: Annotation): boolean {
  return annotation.coordinates.length > MINIMUM[annotation.kind];
}

/** Move one vertex. Out-of-range indices are ignored rather than appended. */
export function moveVertex(
  annotation: Annotation,
  index: number,
  to: [number, number],
): Annotation {
  if (index < 0 || index >= annotation.coordinates.length) return annotation;
  const coordinates = [...annotation.coordinates];
  coordinates[index] = to;
  return { ...annotation, coordinates };
}

/**
 * Put a vertex in at `index`, pushing the rest along.
 *
 * The index is clamped, so inserting "after the last segment" of a ring — which
 * is what clicking the closing segment's midpoint means — lands at the end
 * instead of being rejected.
 */
export function insertVertex(
  annotation: Annotation,
  index: number,
  position: [number, number],
): Annotation {
  const at = Math.max(0, Math.min(index, annotation.coordinates.length));
  const coordinates = [...annotation.coordinates];
  coordinates.splice(at, 0, position);
  return { ...annotation, coordinates };
}

/** Take a vertex out, unless that would leave less than a shape. */
export function removeVertex(annotation: Annotation, index: number): Annotation {
  if (!canRemoveVertex(annotation)) return annotation;
  if (index < 0 || index >= annotation.coordinates.length) return annotation;
  const coordinates = annotation.coordinates.filter((_, i) => i !== index);
  return { ...annotation, coordinates };
}

/** Drop the last vertex placed, which is what Backspace means mid-drawing. */
export function removeLastVertex(annotation: Annotation): Annotation {
  if (annotation.coordinates.length === 0) return annotation;
  return { ...annotation, coordinates: annotation.coordinates.slice(0, -1) };
}

/* ------------------------------------------------------------------ drafts */

/**
 * What the drawing in progress looks like with the pointer counted as its next
 * vertex.
 *
 * Without this the user draws blind: between two clicks there is nothing on the
 * screen joining the last vertex to the cursor, so the shape only appears one
 * segment at a time and an area only exists once it is finished. The rubber band
 * is not stored on the document — it is a property of where the mouse is, and
 * the mouse is not part of the map.
 */
export function withCursor(annotation: Annotation, cursor: [number, number]): Annotation {
  if (annotation.kind === "point") return annotation;
  return { ...annotation, coordinates: [...annotation.coordinates, cursor] };
}

/**
 * The live readout while drawing: the segment being dragged out, and the shape
 * so far.
 *
 * A GIS says both, because they answer different questions. The segment is
 * "where am I putting this next point"; the total is "how long is this so far".
 */
export interface DraftReadout {
  /** Metres from the last placed vertex to the cursor. */
  segment: number;
  /** Degrees clockwise from north, over that same segment. */
  heading: number;
  /** Metres along the whole path, cursor included. */
  total: number;
  /** Square metres, for a ring of three or more including the cursor. */
  area?: number;
  /** Number of vertices actually placed, cursor excluded. */
  placed: number;
}

export function draftReadout(
  annotation: Annotation,
  cursor: [number, number],
): DraftReadout {
  const placed = annotation.coordinates;
  const last = placed[placed.length - 1];
  const path = [...placed, cursor];

  const readout: DraftReadout = {
    segment: last ? distance(last, cursor) : 0,
    heading: last ? bearing(last, cursor) : 0,
    total: pathLength(path),
    placed: placed.length,
  };

  if (annotation.kind === "polygon" && path.length >= 3) {
    readout.area = ringArea(path);
    // For a ring the length that matters is the perimeter, closing edge included.
    readout.total = ringPerimeter(path);
  }
  return readout;
}

/* ------------------------------------------------------------ constructions */

/**
 * Shapes that are built from two positions rather than clicked vertex by vertex.
 *
 * They produce ordinary polygons. A circle that stayed a circle would need its
 * centre and radius in the schema, a branch in every consumer, and a rule for
 * what happens when somebody drags one of its vertices. A ring of positions is
 * what every format downstream wants anyway — GeoJSON has no circle, KML has no
 * circle, PostGIS stores one as a polygon — so the honest thing is to build the
 * ring at the moment of drawing and then treat it like any other ring.
 */

/**
 * The four corners of a rectangle spanning two opposite corners.
 *
 * Aligned to the graticule, not to the screen: dragging a box out and getting
 * something that is only square at one bearing is a worse surprise than getting
 * a box whose sides are meridians and parallels.
 *
 * Returned open — four positions, not five — because that is how a ring is held
 * everywhere else in the document.
 */
export function rectangleRing(
  a: [number, number],
  b: [number, number],
): [number, number][] {
  const west = Math.min(a[0], b[0]);
  const east = Math.max(a[0], b[0]);
  const south = Math.min(a[1], b[1]);
  const north = Math.max(a[1], b[1]);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
}

/**
 * A circle about a centre, out to a position on its edge.
 *
 * Geodesic: every position on the ring is the same distance over the ground from
 * the centre, which on a mercator screen means it is drawn as an ellipse away
 * from the equator. That is correct and it is what a GIS draws. A circle that
 * looks round on the screen is a circle that is the wrong size on the ground,
 * and the error is one over the cosine of the latitude — a fifth at Tehran.
 */
export function circleRing(
  centre: [number, number],
  edge: [number, number],
  steps = 64,
): [number, number][] {
  const radius = distance(centre, edge);
  if (radius <= 0) return [];
  // `disc` closes its ring; a ring is held open everywhere in the document.
  return disc(centre, radius, steps).slice(0, -1);
}

/**
 * Move a whole drawing so that `from` ends up at `to`.
 *
 * This is a rotation of the sphere, not a shift in degrees and not a walk along
 * a bearing, and the difference is not academic.
 *
 * Shifting degrees stretches a shape as it travels north: a degree of longitude
 * is 111 km at the equator and 47 km at sixty, so a parcel dragged up the map
 * arrives covering less than half the ground it left with. Walking every vertex
 * the same distance along the same bearing has the same problem in reverse —
 * meridians converge, so a box moved due north keeps its longitudes and loses
 * its width.
 *
 * Rotating about the axis perpendicular to the great circle from `from` to `to`
 * is the actual rigid motion of the sphere. Every distance inside the drawing is
 * preserved exactly, which is the only behaviour that lets somebody measure a
 * parcel, move it somewhere else, and still trust the number.
 *
 * The shape's bearing relative to north does change on the way, because on a
 * sphere it must: a rectangle carried a quarter of the way round the world is
 * not still aligned to the graticule. That is geometry, not a bug.
 */
export function translate(
  annotation: Annotation,
  from: [number, number],
  to: [number, number],
): Annotation {
  const start = toVector(from);
  const end = toVector(to);

  const axis = cross(start, end);
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  // The same point, or exactly antipodal. Neither names a rotation to make.
  if (length < 1e-12) return annotation;

  const unit: Vector = [axis[0] / length, axis[1] / length, axis[2] / length];
  const angle = Math.atan2(length, dot(start, end));

  return {
    ...annotation,
    coordinates: annotation.coordinates.map((position) =>
      toPosition(rotate(toVector(position), unit, angle)),
    ),
  };
}

type Vector = [number, number, number];

function toVector([lon, lat]: [number, number]): Vector {
  const rad = Math.PI / 180;
  const cosLat = Math.cos(lat * rad);
  return [cosLat * Math.cos(lon * rad), cosLat * Math.sin(lon * rad), Math.sin(lat * rad)];
}

function toPosition([x, y, z]: Vector): [number, number] {
  const deg = 180 / Math.PI;
  return [round(Math.atan2(y, x) * deg), round(Math.asin(Math.max(-1, Math.min(1, z))) * deg)];
}

const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rodrigues' rotation of a vector about a unit axis. */
function rotate(v: Vector, axis: Vector, angle: number): Vector {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}
