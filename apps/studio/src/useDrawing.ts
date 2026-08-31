import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationKind, MapProject } from "@alidade/core";
import { MINIMUM, newAnnotation } from "@alidade/core";

export type DrawMode = AnnotationKind | null;

export interface DrawSession {
  mode: DrawMode;
  /** Set when the drawing is being made to measure something rather than to keep. */
  measure: "distance" | "area" | null;
  activeId: string | null;
}

const IDLE: DrawSession = { mode: null, measure: null, activeId: null };

const COLORS: Record<AnnotationKind, string> = {
  point: "#ffb454",
  line: "#4c8dff",
  polygon: "#5ad19a",
};

/**
 * Drawing, as edits to the project rather than as state inside the renderer.
 *
 * Every click is an ordinary project edit, so a drawing survives a basemap swap,
 * appears in the operation log, and is saved with everything else. The session
 * is kept in a ref as well as in state because the map's click handler is
 * registered once and would otherwise close over the mode the user had when the
 * map was built.
 */
export function useDrawing(
  project: MapProject,
  edit: (change: (draft: MapProject) => MapProject) => void,
) {
  const [session, setSession] = useState<DrawSession>(IDLE);
  const current = useRef<DrawSession>(IDLE);
  current.current = session;

  const annotations = project.annotations;

  const start = useCallback((mode: AnnotationKind, measure: DrawSession["measure"] = null) => {
    setSession({ mode, measure, activeId: null });
  }, []);

  const stop = useCallback(() => setSession(IDLE), []);

  /** Drop an unfinished drawing rather than leaving a one-point area behind. */
  const cancel = useCallback(() => {
    const { activeId } = current.current;
    if (activeId) edit((d) => pruneIncomplete(d, activeId));
    setSession(IDLE);
  }, [edit]);

  const finish = useCallback(() => {
    const { activeId } = current.current;
    if (activeId) edit((d) => pruneIncomplete(d, activeId));
    setSession((s) => ({ ...s, activeId: null }));
  }, [edit]);

  /** One click on the map: either open a drawing or add a vertex to the open one. */
  const click = useCallback(
    (position: [number, number]) => {
      const { mode, measure, activeId } = current.current;
      if (!mode) return;

      if (!activeId) {
        const created = newAnnotation(mode, COLORS[mode]);
        created.coordinates = [position];
        if (measure) {
          created.measure = measure;
          created.name = measure === "area" ? "Area" : "Distance";
        }
        edit((d) => {
          const list = ensure(d);
          list.features.push(created);
          return d;
        });
        // A point is finished the moment it is placed; there is no second click.
        setSession({ mode, measure, activeId: mode === "point" ? null : created.id });
        return;
      }

      edit((d) => {
        const target = ensure(d).features.find((f) => f.id === activeId);
        if (target) target.coordinates.push(position);
        return d;
      });
    },
    [edit],
  );

  /** Escape gets out of whatever is half drawn, which is what escape is for. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
      if (event.key === "Enter" && current.current.activeId) finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel, finish]);

  const active: Annotation | undefined = session.activeId
    ? annotations?.features.find((f) => f.id === session.activeId)
    : undefined;

  return { session, active, start, stop, cancel, finish, click };
}

function ensure(draft: MapProject) {
  draft.annotations ??= { visible: true, opacity: 1, features: [] };
  return draft.annotations;
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
