import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Annotation,
  AnnotationKind,
  DraftReadout,
  MapProject,
  SnapTarget,
} from "@alidade/core";
import {
  MINIMUM,
  circleRing,
  draftReadout,
  insertVertex,
  moveVertex,
  newAnnotation,
  removeLastVertex,
  rectangleRing,
  removeVertex,
  snap,
  translate,
} from "@alidade/core";

/**
 * What the pointer is doing.
 *
 * A rectangle and a circle are polygons; what differs is how the vertices are
 * arrived at. Three of these place one vertex per click, two of them are spanned
 * between two clicks, and the session keeps the tool so it knows which.
 */
export type DrawTool = AnnotationKind | "rectangle" | "circle";

export type DrawMode = AnnotationKind | null;

/** The two-click tools, and the kind of annotation each produces. */
const SPANNED: Record<string, AnnotationKind> = { rectangle: "polygon", circle: "polygon" };

export const isSpanned = (tool: DrawTool | null): boolean =>
  tool === "rectangle" || tool === "circle";

export interface DrawSession {
  tool: DrawTool | null;
  mode: DrawMode;
  /** Set when the drawing is being made to measure something rather than to keep. */
  measure: "distance" | "area" | null;
  activeId: string | null;
}

export interface SnapSettings {
  enabled: boolean;
  /** How close in pixels counts. Converted to metres against the current scale. */
  pixels: number;
  /** Snap to a point along a segment as well as to its ends. */
  edges: boolean;
}

/** Which vertex is being dragged. */
interface Drag {
  of: string;
  index: number;
}

const IDLE: DrawSession = { tool: null, mode: null, measure: null, activeId: null };

const COLORS: Record<AnnotationKind, string> = {
  point: "#ffb454",
  line: "#4c8dff",
  polygon: "#5ad19a",
};

/**
 * Drawing, as edits to the project rather than as state inside the renderer.
 *
 * Every committed click is an ordinary project edit, so a drawing survives a
 * basemap swap, appears in the operation log, and is saved with everything else.
 *
 * What is *not* an edit is the pointer. The rubber band, the live measurement
 * and the snap indicator are all functions of where the mouse is this frame, and
 * the mouse is not part of the map. Putting them in the document would emit an
 * operation sixty times a second and fill the log with mouse movement. They live
 * here and are drawn as an overlay above the canvas.
 */
export function useDrawing(
  project: MapProject,
  edit: (change: (draft: MapProject) => MapProject) => void,
) {
  const [session, setSession] = useState<DrawSession>(IDLE);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const [snapAt, setSnapAt] = useState<SnapTarget | null>(null);
  const [editing, setEditingState] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState<SnapSettings>({
    enabled: true,
    pixels: 12,
    edges: true,
  });

  /*
   * The map's handlers are registered once and would otherwise close over the
   * state the user had when the map was built, so everything a handler reads
   * goes through a ref written on every render.
   */
  const current = useRef<DrawSession>(IDLE);
  current.current = session;
  const drag = useRef<Drag | null>(null);
  /**
   * The first corner of a spanned shape.
   *
   * It is here rather than in the document on purpose. A rectangle that grew by
   * writing four new corners on every mouse move would emit an operation per
   * frame and fill the log with a drag. The preview is drawn from this and the
   * cursor; the document only hears about it on the second click, once.
   */
  const anchor = useRef<[number, number] | null>(null);
  const [anchoredAt, setAnchoredAt] = useState<[number, number] | null>(null);
  /** A whole shape being dragged: which one, and where the grab started. */
  const shapeDrag = useRef<{ of: string; from: [number, number] } | null>(null);
  const latest = useRef(project);
  latest.current = project;

  const annotations = project.annotations;

  const start = useCallback((tool: DrawTool, measure: DrawSession["measure"] = null) => {
    setEditingState(false);
    anchor.current = null;
    setAnchoredAt(null);
    setSession({ tool, mode: SPANNED[tool] ?? (tool as AnnotationKind), measure, activeId: null });
  }, []);

  const stop = useCallback(() => {
    anchor.current = null;
    setAnchoredAt(null);
    setSession(IDLE);
    setCursor(null);
    setSnapAt(null);
  }, []);

  /**
   * Editing and drawing are the same pointer, so they cannot both be on.
   *
   * With a tool armed and handles showing, a click on the map means both "put a
   * vertex here" and "grab that handle", and the user gets whichever the event
   * order happened to pick.
   */
  const setEditing = useCallback(
    (on: boolean) => {
      setEditingState(on);
      if (!on) return;
      const { activeId } = current.current;
      if (activeId) edit((d) => pruneIncomplete(d, activeId));
      setSession(IDLE);
      setCursor(null);
      setSnapAt(null);
    },
    [edit],
  );

  /** Drop an unfinished drawing rather than leaving a one-point area behind. */
  const cancel = useCallback(() => {
    const { activeId } = current.current;
    if (activeId) edit((d) => pruneIncomplete(d, activeId));
    anchor.current = null;
    setAnchoredAt(null);
    setSession(IDLE);
    setCursor(null);
    setSnapAt(null);
  }, [edit]);

  const finish = useCallback(() => {
    const { activeId } = current.current;
    if (activeId) edit((d) => pruneIncomplete(d, activeId));
    anchor.current = null;
    setAnchoredAt(null);
    setSession((s) => ({ ...s, activeId: null }));
    setCursor(null);
    setSnapAt(null);
  }, [edit]);

  /**
   * Where the pointer is, and what it would snap to if clicked.
   *
   * The snapped position is what gets stored, not the pointer's own. A snap that
   * moves the highlight but not the vertex is a lie about where the point went.
   */
  const move = useCallback(
    (position: [number, number], toleranceMetres: number) => {
      const { mode } = current.current;
      const held = drag.current;
      const carried = shapeDrag.current;

      /*
       * Carrying a whole shape does not snap. Snapping moves the thing under the
       * pointer onto something else, and here the thing under the pointer is the
       * shape itself: it would jump a vertex onto every drawing it passed over.
       */
      if (carried) {
        setSnapAt(null);
        setCursor(position);
        edit((d) => withAnnotation(d, carried.of, (a) => translate(a, carried.from, position)));
        shapeDrag.current = { ...carried, from: position };
        return;
      }

      if (!mode && !editing && !held) return;

      const found =
        snapping.enabled && snapping.pixels > 0
          ? snap(latest.current.annotations, position, {
              toleranceMetres,
              edges: snapping.edges,
              // A vertex being dragged sits under the pointer, so it would snap
              // to itself and could never be moved anywhere.
              excludeVertex: held ? { of: held.of, index: held.index } : undefined,
            })
          : null;

      const at = found ? found.position : position;
      setSnapAt(found);
      setCursor(at);

      if (held) edit((d) => withAnnotation(d, held.of, (a) => moveVertex(a, held.index, at)));
    },
    [edit, editing, snapping],
  );

  /** One click on the map: either open a drawing or add a vertex to the open one. */
  const click = useCallback(
    (position: [number, number]) => {
      const { tool, mode, measure, activeId } = current.current;
      if (!mode || !tool) return;
      // The snapped position wins over the raw one, which is the whole point.
      const at = snapAt ? snapAt.position : position;

      /*
       * A rectangle and a circle are spanned rather than traced: the first click
       * anchors, the second commits the finished ring in one edit.
       */
      if (isSpanned(tool)) {
        const first = anchor.current;
        if (!first) {
          anchor.current = at;
          setAnchoredAt(at);
          return;
        }
        const ring = tool === "rectangle" ? rectangleRing(first, at) : circleRing(first, at);
        anchor.current = null;
        setAnchoredAt(null);
        // A zero-size drag is a double click, not a shape.
        if (ring.length < MINIMUM.polygon) return;

        const created = newAnnotation("polygon", COLORS.polygon);
        created.coordinates = ring;
        created.name = tool === "rectangle" ? "Rectangle" : "Circle";
        if (measure) {
          created.measure = measure;
          created.name = "Area";
        }
        edit((d) => {
          ensure(d).features.push(created);
          return d;
        });
        return;
      }

      if (!activeId) {
        const created = newAnnotation(mode, COLORS[mode]);
        created.coordinates = [at];
        if (measure) {
          created.measure = measure;
          created.name = measure === "area" ? "Area" : "Distance";
        }
        edit((d) => {
          ensure(d).features.push(created);
          return d;
        });
        // A point is finished the moment it is placed; there is no second click.
        setSession({ tool, mode, measure, activeId: mode === "point" ? null : created.id });
        return;
      }

      edit((d) => {
        const target = ensure(d).features.find((f) => f.id === activeId);
        if (!target) return d;
        // Two clicks in one place is a double click that arrived as two singles,
        // and a zero-length segment is never what was meant.
        const last = target.coordinates[target.coordinates.length - 1];
        if (last && last[0] === at[0] && last[1] === at[1]) return d;
        target.coordinates.push(at);
        return d;
      });
    },
    [edit, snapAt],
  );

  /**
   * Take back the last point placed.
   *
   * Without it a misclick costs the whole drawing, because the only way out was
   * Escape. Undoing the first point ends the drawing, which is the same thing as
   * never having started it.
   */
  const undo = useCallback(() => {
    // For a spanned shape "the last point" is the anchor, and taking it back
    // means the next click anchors again rather than completing a rectangle.
    if (anchor.current) {
      anchor.current = null;
      setAnchoredAt(null);
      return;
    }
    const { activeId } = current.current;
    if (!activeId) return;
    const target = latest.current.annotations?.features.find((f) => f.id === activeId);
    if (!target) return;
    if (target.coordinates.length <= 1) return cancel();
    edit((d) => withAnnotation(d, activeId, removeLastVertex));
  }, [cancel, edit]);

  /* ------------------------------------------------------------- editing */

  const beginVertex = useCallback((of: string, index: number) => {
    drag.current = { of, index };
    setDragging(true);
  }, []);

  /**
   * Grab the midpoint of a segment.
   *
   * The handle is not a vertex until it is grabbed: it becomes one at that
   * moment and is dragged like any other. That is how a shape gains detail
   * without there being a separate mode to be in.
   */
  const beginMidpoint = useCallback(
    (of: string, segment: number, position: [number, number]) => {
      edit((d) => withAnnotation(d, of, (a) => insertVertex(a, segment + 1, position)));
      drag.current = { of, index: segment + 1 };
      setDragging(true);
    },
    [edit],
  );

  /** Pick a whole shape up. The grab point rides with it, so it does not jump. */
  const beginShape = useCallback((of: string, from: [number, number]) => {
    shapeDrag.current = { of, from };
    setDragging(true);
  }, []);

  const endVertex = useCallback(() => {
    drag.current = null;
    shapeDrag.current = null;
    setDragging(false);
    setSnapAt(null);
  }, []);

  const dropVertex = useCallback(
    (of: string, index: number) => {
      edit((d) => withAnnotation(d, of, (a) => removeVertex(a, index)));
    },
    [edit],
  );

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Typing in a box is not drawing. Without this, Backspace in the rename
      // field deleted vertices behind the dialog.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === "Escape") return cancel();
      if (event.key === "Enter" && current.current.activeId) return finish();
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!current.current.activeId && !anchor.current) return;
        // Backspace is browser history if nobody claims it.
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, finish, undo]);

  /** A drag that ends anywhere, including off the map, still ends. */
  useEffect(() => {
    if (!dragging) return;
    const up = () => endVertex();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging, endVertex]);

  const active: Annotation | undefined = session.activeId
    ? annotations?.features.find((f) => f.id === session.activeId)
    : undefined;

  /** The live numbers, recomputed from the geometry and the pointer. */
  const readout: DraftReadout | null = useMemo(
    () => (active && cursor ? draftReadout(active, cursor) : null),
    [active, cursor],
  );

  return {
    session,
    active,
    cursor,
    snapAt,
    readout,
    snapping,
    setSnapping,
    editing,
    setEditing,
    selected,
    setSelected,
    dragging,
    start,
    stop,
    cancel,
    finish,
    click,
    move,
    undo,
    /** The anchor of a spanned shape, for the preview. Never in the document. */
    anchor: anchoredAt,
    vertex: {
      begin: beginVertex,
      beginMidpoint,
      beginShape,
      end: endVertex,
      drop: dropVertex,
    },
  };
}

function ensure(draft: MapProject) {
  draft.annotations ??= { visible: true, opacity: 1, features: [] };
  return draft.annotations;
}

/** Apply a pure annotation operation to the one with this id. */
function withAnnotation(
  draft: MapProject,
  id: string,
  change: (annotation: Annotation) => Annotation,
): MapProject {
  const list = ensure(draft);
  const at = list.features.findIndex((f) => f.id === id);
  if (at === -1) return draft;
  list.features[at] = change(list.features[at]!);
  return draft;
}

/** Remove a drawing that never got enough vertices to be one. */
function pruneIncomplete(draft: MapProject, id: string): MapProject {
  const list = ensure(draft);
  const target = list.features.find((f) => f.id === id);
  if (target && target.coordinates.length < MINIMUM[target.kind]) {
    list.features = list.features.filter((f) => f.id !== id);
  }
  return draft;
}
