import { describe, expect, it } from "vitest";

import {
  canRemoveVertex,
  circleRing,
  distance,
  draftReadout,
  insertVertex,
  moveVertex,
  nearestOnSegment,
  newAnnotation,
  offset,
  rectangleRing,
  ringArea,
  removeLastVertex,
  removeVertex,
  segmentsOf,
  snap,
  toleranceInMetres,
  translate,
  withCursor,
  type Annotation,
  type Annotations,
} from "../src/index";

const at = (lon: number, lat: number): [number, number] => [lon, lat];

const drawing = (
  id: string,
  kind: Annotation["kind"],
  coordinates: [number, number][],
): Annotation => ({ ...newAnnotation(kind), id, coordinates });

const sheet = (...features: Annotation[]): Annotations => ({
  visible: true,
  opacity: 1,
  features,
});

/* ------------------------------------------------------------------ snap */

describe("snap", () => {
  const line = drawing("l", "line", [at(51.0, 35.0), at(51.01, 35.0)]);

  it("finds nothing when the pointer is nowhere near", () => {
    expect(snap(sheet(line), at(52, 36), { toleranceMetres: 50 })).toBeNull();
  });

  it("snaps a near miss onto the vertex exactly", () => {
    // About 9 m east of the first vertex.
    const found = snap(sheet(line), at(51.0001, 35.0), { toleranceMetres: 50 });
    expect(found?.kind).toBe("vertex");
    expect(found?.of).toBe("l");
    expect(found?.index).toBe(0);
    // The point returned is the existing vertex, not the pointer. Anything else
    // leaves the sliver snapping exists to prevent.
    expect(found?.position).toEqual(at(51.0, 35.0));
  });

  it("leaves edges alone unless asked, because most snapping wants vertices", () => {
    const middle = at(51.005, 35.0);
    expect(snap(sheet(line), middle, { toleranceMetres: 50 })).toBeNull();
    expect(snap(sheet(line), middle, { toleranceMetres: 50, edges: true })?.kind).toBe("edge");
  });

  it("prefers a vertex to an edge even when the edge is nearer", () => {
    // Sitting almost exactly on the segment, and 40 m or so from the vertex.
    const found = snap(sheet(line), at(51.0004, 35.000001), {
      toleranceMetres: 100,
      edges: true,
    });
    expect(found?.kind).toBe("vertex");
  });

  it("reports the segment index an edge snap belongs to, so a vertex can be inserted", () => {
    const path = drawing("p", "line", [at(0, 0), at(0.01, 0), at(0.02, 0)]);
    // Tight enough that only the edge is in range: the vertices either side are
    // half a kilometre away and would otherwise win, correctly.
    const found = snap(sheet(path), at(0.015, 0.00001), { toleranceMetres: 100, edges: true });
    expect(found?.kind).toBe("edge");
    expect(found?.index).toBe(1);
  });

  it("closes a ring on its own first vertex", () => {
    const ring = drawing("r", "polygon", [at(0, 0), at(0.01, 0), at(0.01, 0.01)]);
    const found = snap(sheet(ring), at(0.00002, 0), { toleranceMetres: 100 });
    expect(found?.index).toBe(0);
    expect(found?.position).toEqual(at(0, 0));
  });

  it("will not snap a dragged vertex to itself", () => {
    const ring = drawing("r", "polygon", [at(0, 0), at(0.01, 0), at(0.01, 0.01)]);
    const found = snap(sheet(ring), at(0.000001, 0), {
      toleranceMetres: 100,
      excludeVertex: { of: "r", index: 0 },
    });
    expect(found).toBeNull();
  });

  it("ignores drawings it is told to ignore", () => {
    expect(snap(sheet(line), at(51.0, 35.0), { toleranceMetres: 50, ignore: ["l"] })).toBeNull();
  });

  it("is off when the tolerance is zero", () => {
    expect(snap(sheet(line), at(51.0, 35.0), { toleranceMetres: 0 })).toBeNull();
  });
});

describe("nearestOnSegment", () => {
  it("puts a point beyond the end back on the end rather than off it", () => {
    expect(nearestOnSegment(at(0, 0), at(1, 0), at(5, 0))).toEqual(at(1, 0));
    expect(nearestOnSegment(at(0, 0), at(1, 0), at(-5, 0))).toEqual(at(0, 0));
  });

  it("drops a perpendicular onto the middle of a segment", () => {
    const [lon, lat] = nearestOnSegment(at(0, 0), at(1, 0), at(0.5, 0.2));
    expect(lon).toBeCloseTo(0.5, 6);
    expect(lat).toBeCloseTo(0, 6);
  });

  it("survives a segment of no length", () => {
    expect(nearestOnSegment(at(3, 4), at(3, 4), at(9, 9))).toEqual(at(3, 4));
  });

  it("accounts for the meridians converging", () => {
    // At 60° north a degree of longitude is half a degree of latitude on the
    // ground. Treating lon/lat as a plane would put the foot in the wrong place.
    const foot = nearestOnSegment(at(0, 60), at(1, 60), at(0.5, 60.001));
    expect(distance(foot, at(0.5, 60))).toBeLessThan(1);
  });
});

describe("toleranceInMetres", () => {
  it("shrinks as the map is zoomed in", () => {
    const out = toleranceInMetres(12, 4, 35);
    const close = toleranceInMetres(12, 16, 35);
    expect(close).toBeLessThan(out);
  });

  it("is about a hundred metres for twelve pixels at street zoom", () => {
    expect(toleranceInMetres(12, 12, 35)).toBeGreaterThan(200);
    expect(toleranceInMetres(12, 12, 35)).toBeLessThan(500);
  });
});

/* -------------------------------------------------------------- vertices */

describe("vertex editing", () => {
  const triangle = drawing("t", "polygon", [at(0, 0), at(1, 0), at(1, 1)]);

  it("refuses to take a triangle below three points", () => {
    expect(canRemoveVertex(triangle)).toBe(false);
    expect(removeVertex(triangle, 0)).toBe(triangle);
  });

  it("removes a vertex once there is one to spare", () => {
    const square = insertVertex(triangle, 3, at(0, 1));
    expect(canRemoveVertex(square)).toBe(true);
    expect(removeVertex(square, 3).coordinates).toHaveLength(3);
  });

  it("inserts in the middle rather than at the end", () => {
    const out = insertVertex(triangle, 1, at(0.5, -0.5));
    expect(out.coordinates[1]).toEqual(at(0.5, -0.5));
    expect(out.coordinates).toHaveLength(4);
  });

  it("clamps an insert past the end onto the end, which is how a ring closes", () => {
    expect(insertVertex(triangle, 99, at(9, 9)).coordinates[3]).toEqual(at(9, 9));
  });

  it("moves a vertex without disturbing the others", () => {
    const out = moveVertex(triangle, 1, at(2, 2));
    expect(out.coordinates).toEqual([at(0, 0), at(2, 2), at(1, 1)]);
  });

  it("ignores a move of a vertex that is not there rather than appending one", () => {
    expect(moveVertex(triangle, 7, at(2, 2))).toBe(triangle);
  });

  it("does not mutate what it was given", () => {
    const before = JSON.stringify(triangle);
    moveVertex(triangle, 0, at(5, 5));
    insertVertex(triangle, 0, at(5, 5));
    expect(JSON.stringify(triangle)).toBe(before);
  });

  it("undoes the last point placed", () => {
    expect(removeLastVertex(triangle).coordinates).toEqual([at(0, 0), at(1, 0)]);
    expect(removeLastVertex(drawing("e", "line", [])).coordinates).toEqual([]);
  });
});

describe("segmentsOf", () => {
  it("closes a ring, so the last edge is snappable too", () => {
    expect(segmentsOf(drawing("r", "polygon", [at(0, 0), at(1, 0), at(1, 1)]))).toHaveLength(3);
  });

  it("leaves a line open", () => {
    expect(segmentsOf(drawing("l", "line", [at(0, 0), at(1, 0), at(1, 1)]))).toHaveLength(2);
  });

  it("gives a point no segments", () => {
    expect(segmentsOf(drawing("p", "point", [at(0, 0)]))).toEqual([]);
  });
});

/* ----------------------------------------------------------------- draft */

describe("the drawing in progress", () => {
  it("counts the cursor as the next vertex, so there is a rubber band", () => {
    const line = drawing("l", "line", [at(0, 0)]);
    expect(withCursor(line, at(1, 1)).coordinates).toHaveLength(2);
  });

  it("leaves a point alone: there is nothing to band to", () => {
    const point = drawing("p", "point", [at(0, 0)]);
    expect(withCursor(point, at(1, 1))).toBe(point);
  });

  it("reports the segment being dragged out and the total so far", () => {
    const line = drawing("l", "line", [at(0, 0), at(0, 1)]);
    const out = draftReadout(line, at(0, 2));
    expect(out.placed).toBe(2);
    expect(out.heading).toBeCloseTo(0, 5);
    expect(out.segment).toBeCloseTo(distance(at(0, 1), at(0, 2)), 5);
    expect(out.total).toBeCloseTo(out.segment * 2, 3);
  });

  it("reports an area for a ring, and a perimeter that closes", () => {
    const ring = drawing("r", "polygon", [at(0, 0), at(0.01, 0)]);
    const out = draftReadout(ring, at(0.01, 0.01));
    expect(out.area).toBeGreaterThan(0);
    // Three sides, not two: the closing edge counts.
    expect(out.total).toBeGreaterThan(out.segment * 2);
  });

  it("says nothing silly before the first click", () => {
    const out = draftReadout(drawing("l", "line", []), at(5, 5));
    expect(out).toMatchObject({ segment: 0, heading: 0, total: 0, placed: 0 });
  });
});

/* ------------------------------------------------------- constructed shapes */

describe("rectangleRing", () => {
  it("gives four corners, open, whichever way it was dragged", () => {
    const forward = rectangleRing(at(0, 0), at(1, 2));
    const backward = rectangleRing(at(1, 2), at(0, 0));
    expect(forward).toHaveLength(4);
    expect(forward).toEqual(backward);
  });

  it("spans the two corners it was given", () => {
    const ring = rectangleRing(at(-3, 5), at(2, 9));
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    expect(Math.min(...lons)).toBe(-3);
    expect(Math.max(...lons)).toBe(2);
    expect(Math.min(...lats)).toBe(5);
    expect(Math.max(...lats)).toBe(9);
  });

  it("winds without crossing itself", () => {
    // Corners in order, so consecutive ones always share an edge.
    const ring = rectangleRing(at(0, 0), at(1, 1));
    for (let i = 0; i < 4; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % 4]!;
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
    }
  });
});

describe("circleRing", () => {
  const centre = at(51.4, 35.7);

  it("puts every position the same distance over the ground from the centre", () => {
    const edge = at(51.5, 35.7);
    const radius = distance(centre, edge);
    for (const position of circleRing(centre, edge, 32)) {
      expect(distance(centre, position)).toBeCloseTo(radius, 0);
    }
  });

  it("is open, like every other ring in the document", () => {
    const ring = circleRing(centre, at(51.5, 35.7), 16);
    expect(ring).toHaveLength(16);
    expect(ring[0]).not.toEqual(ring[ring.length - 1]);
  });

  it("has no ring at all when the edge is the centre", () => {
    expect(circleRing(centre, centre)).toEqual([]);
  });

  it("encloses about pi r squared", () => {
    const edge = offset(centre, 10_000, 90);
    const area = ringArea(circleRing(centre, edge, 128));
    expect(area).toBeGreaterThan(Math.PI * 1e8 * 0.99);
    expect(area).toBeLessThan(Math.PI * 1e8 * 1.01);
  });
});

describe("translate", () => {
  const square = drawing("s", "polygon", [at(51.0, 35.0), at(51.1, 35.0), at(51.1, 35.1)]);

  it("puts the grabbed point exactly where it was dropped", () => {
    // The first vertex is what was grabbed, so it has to land on the cursor.
    const moved = translate(square, at(51.0, 35.0), at(9.0, 60.0));
    expect(moved.coordinates[0]![0]).toBeCloseTo(9.0, 6);
    expect(moved.coordinates[0]![1]).toBeCloseTo(60.0, 6);
  });

  it("keeps the shape the same size on the ground wherever it is dropped", () => {
    // Shifting degrees would stretch it and walking a bearing would squash it:
    // a degree of longitude at 35N is more than twice one at 75N.
    const far = translate(square, at(51.0, 35.0), at(-40.0, 75.0));
    const ratio = ringArea(far.coordinates) / ringArea(square.coordinates);
    // Half a percent, not five decimal places: what is left is `ringArea`'s own
    // spherical-excess approximation drifting with latitude, not the rotation.
    // The distance test below is the strict one, and the rotation is exact.
    expect(ratio).toBeCloseTo(1, 2);
  });

  it("keeps every distance inside the drawing, which is what lets you trust the number", () => {
    const far = translate(square, at(51.0, 35.0), at(-120.0, -20.0));
    for (let i = 1; i < square.coordinates.length; i++) {
      const before = distance(square.coordinates[0]!, square.coordinates[i]!);
      const after = distance(far.coordinates[0]!, far.coordinates[i]!);
      expect(after / before).toBeCloseTo(1, 5);
    }
  });

  it("is a no-op when nothing moved, and does not mutate", () => {
    expect(translate(square, at(1, 1), at(1, 1))).toBe(square);
    const before = JSON.stringify(square);
    translate(square, at(0, 0), at(1, 1));
    expect(JSON.stringify(square)).toBe(before);
  });
});
