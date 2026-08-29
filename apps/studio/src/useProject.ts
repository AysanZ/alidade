import { useCallback, useRef, useState } from "react";
import type { MapProject, Op } from "@alidade/core";
import { MapManager } from "@alidade/maplibre";

/**
 * The project is the state. React holds a copy for rendering; the manager turns
 * each edit into operations and applies them.
 */
export function useProject(initial: MapProject) {
  const manager = useRef<MapManager | null>(null);
  const [project, setProject] = useState(initial);
  const [log, setLog] = useState<Op[]>([]);

  const attach = useCallback((m: MapManager) => {
    manager.current = m;
  }, []);

  const edit = useCallback((change: (draft: MapProject) => MapProject) => {
    if (!manager.current) return;
    const ops = manager.current.update(change);
    setProject(manager.current.project);
    setLog((previous) => [...ops, ...previous].slice(0, 40));
  }, []);

  return { project, log, edit, attach };
}
