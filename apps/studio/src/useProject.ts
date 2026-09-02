import { useCallback, useEffect, useRef, useState } from "react";
import type { MapProject, Op, View } from "@alidade/core";
import { MapManager } from "@alidade/maplibre";

/** How many steps back the history keeps. Beyond this, the oldest is dropped. */
const DEPTH = 60;

export interface History {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/**
 * The project is the state. React holds a copy for rendering; the manager turns
 * each edit into operations and applies them.
 *
 * Undo is a stack of whole documents rather than a stack of inverse operations.
 * That looks wasteful and is not: the document is flat JSON of about forty
 * kilobytes, sixty of them is a couple of megabytes, and the alternative means
 * writing and testing an inverse for every operation the reconciler can emit —
 * and getting one of them wrong means undo quietly corrupts the map. The
 * reconciler already knows how to get from any document to any other, so handing
 * it an old one is the whole implementation.
 */
export function useProject(initial: MapProject) {
  const manager = useRef<MapManager | null>(null);
  const [project, setProject] = useState(initial);
  const [log, setLog] = useState<Op[]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  /** Documents behind and ahead of the one on the screen. */
  const past = useRef<MapProject[]>([]);
  const future = useRef<MapProject[]>([]);
  const [depth, setDepth] = useState({ past: 0, future: 0 });

  const attach = useCallback((m: MapManager) => {
    manager.current = m;
  }, []);

  const remember = () => setDepth({ past: past.current.length, future: future.current.length });

  const edit = useCallback((change: (draft: MapProject) => MapProject) => {
    if (!manager.current) return;
    const before = manager.current.project;
    const ops = manager.current.update(change);
    // An edit that changed nothing is not a step to undo. Dragging a colour
    // slider over a value it already had should not cost a history entry.
    if (ops.length === 0) return;

    past.current = [...past.current, before].slice(-DEPTH);
    future.current = [];
    remember();
    setProject(manager.current.project);
    setLog((previous) => [...ops, ...previous].slice(0, 40));
  }, []);

  /**
   * An edit that is not a step you can go back to.
   *
   * Some things are written to the document and are not *changes to the map*:
   * the highlight under the pointer, and every frame of a vertex being dragged.
   * They go through the reconciler like anything else because that is how they
   * reach the renderer, but recording them would fill the history with mouse
   * movement — hover across a choropleth and Ctrl+Z becomes a way of replaying
   * where your cursor has been, sixty entries at a time, with the actual edit
   * you wanted to undo pushed off the end of the stack.
   */
  const transient = useCallback((change: (draft: MapProject) => MapProject) => {
    if (!manager.current) return;
    const ops = manager.current.update(change);
    if (ops.length === 0) return;
    setProject(manager.current.project);
  }, []);

  /**
   * Mark the document as it stands, so what follows can be undone in one go.
   *
   * A drag is one thing the user did, however many frames it took. This is
   * called once when the drag starts; the frames themselves are transient.
   */
  const checkpoint = useCallback(() => {
    const m = manager.current;
    if (!m) return;
    past.current = [...past.current, m.project].slice(-DEPTH);
    future.current = [];
    remember();
  }, []);

  /** Where the user dragged the map to. Records, never emits. */
  const sync = useCallback((view: View) => {
    if (!manager.current) return;
    manager.current.syncView(view);
    setProject(manager.current.project);
  }, []);

  /**
   * Put a whole document back.
   *
   * The camera is deliberately not restored. Undoing a colour change and having
   * the map fly somewhere else is disorienting, and where you are looking is not
   * part of what you did.
   */
  const travel = useCallback((from: MapProject[], to: MapProject[]) => {
    const m = manager.current;
    if (!m || from.length === 0) return;
    const target = from[from.length - 1]!;
    const current = m.project;
    from.length = from.length - 1;
    to.push(current);

    const ops = m.update({ ...target, view: current.view });
    remember();
    setProject(m.project);
    if (ops.length > 0) setLog((previous) => [...ops, ...previous].slice(0, 40));
  }, []);

  const undo = useCallback(() => travel(past.current, future.current), [travel]);
  const redo = useCallback(() => travel(future.current, past.current), [travel]);

  /**
   * Reopen a document from somewhere else — storage, a file, a share link.
   *
   * It is a history step like any other, so opening the wrong file is one
   * keystroke from being put right.
   */
  const open = useCallback((next: MapProject) => {
    const m = manager.current;
    if (!m) return;
    past.current = [...past.current, m.project].slice(-DEPTH);
    future.current = [];
    remember();
    m.update(next);
    setProject(m.project);
  }, []);

  /**
   * Take up a document the manager was built with.
   *
   * Restoring from storage happens before React knows anything: the manager is
   * constructed with the saved document so the reconciler builds the map from it
   * in one pass, and this is React catching up. It is not a history step —
   * there is nothing before it to go back to.
   */
  const adopt = useCallback((next: MapProject) => {
    past.current = [];
    future.current = [];
    remember();
    setProject(next);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      // Shift-Z for redo, and Ctrl-Y as well, because half the world uses it.
      if (event.shiftKey) redo();
      else undo();
    };
    const onRedo = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "y") return;
      event.preventDefault();
      redo();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onRedo);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onRedo);
    };
  }, [undo, redo]);

  const history: History = {
    canUndo: depth.past > 0,
    canRedo: depth.future > 0,
    undo,
    redo,
  };

  return {
    project,
    log,
    edit,
    transient,
    checkpoint,
    sync,
    attach,
    warning,
    setWarning,
    history,
    open,
    adopt,
  };
}
