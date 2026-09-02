import type { MapProject } from "@alidade/core";

/**
 * Keeping the map between visits.
 *
 * The document is flat JSON of about forty kilobytes and holds no geometry — it
 * says where the data lives and how to draw it — so the whole thing fits in
 * local storage with room to spare. That is the payoff of the document design:
 * persistence is `JSON.stringify`, and there is nothing else to write.
 *
 * Local storage and not a server, because there is no account system and
 * inventing one to hold a file the user could equally keep on their disk is the
 * wrong trade. Export is the durable copy; this is so a refresh is not a loss.
 */

const KEY = "alidade:project";
const VERSION_KEY = "alidade:schema";

/** Wait this long after the last edit before writing. */
const SETTLE_MS = 600;

export interface Saved {
  project: MapProject;
  at: number;
}

/**
 * Write, eventually.
 *
 * Dragging an opacity slider emits an edit per frame; serialising forty
 * kilobytes sixty times a second on the main thread is how a smooth slider
 * becomes a stuttering one. The write happens once the user stops.
 */
export function makeAutosave(onProblem?: (message: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    schedule(project: MapProject) {
      clearTimeout(timer);
      timer = setTimeout(() => save(project, onProblem), SETTLE_MS);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

export function save(project: MapProject, onProblem?: (message: string) => void): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
    localStorage.setItem(VERSION_KEY, String(project.schema));
    return true;
  } catch (error) {
    /*
     * Storage can be full, or disabled entirely in a private window. Neither is
     * a reason to lose the map that is on the screen, so this reports and
     * carries on rather than throwing into a render.
     */
    onProblem?.(
      error instanceof Error && error.name === "QuotaExceededError"
        ? "The browser's storage is full, so the map was not saved. Export it instead."
        : "This browser will not let the map be saved locally. Export it instead.",
    );
    return false;
  }
}

/**
 * What was saved last time, if it is still readable.
 *
 * A document from a newer schema is refused rather than guessed at: opening it
 * with older code would silently drop whatever it did not recognise and then
 * save that back, which turns "your map looks wrong" into "your map is gone".
 */
export function restore(current: number): MapProject | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const project = JSON.parse(text) as MapProject;
    if (typeof project?.schema !== "number" || !Array.isArray(project.tree)) return null;
    if (project.schema > current) return null;
    return project;
  } catch {
    return null;
  }
}

export function forget(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(VERSION_KEY);
  } catch {
    // Nothing to be done, and nothing that depends on it.
  }
}

/** A document read from a file the user chose. Throws with a reason it can show. */
export function parseProject(text: string): MapProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON.");
  }
  const project = parsed as MapProject;
  if (typeof project?.schema !== "number" || !Array.isArray(project?.tree)) {
    throw new Error("That JSON is not an Alidade project: it has no schema and no layer tree.");
  }
  return project;
}
