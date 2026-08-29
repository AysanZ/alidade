import { reconcile, type MapProject, type Op } from "@alidade/core";

import { apply } from "./apply";
import type { Renderer } from "./renderer";

export interface ManagerOptions {
  /** Called with every batch, which is where undo history and the log hang off. */
  onOps?: (ops: Op[]) => void;
}

/**
 * Holds the current project and keeps the renderer in step with it.
 *
 * setStyle destroys every layer that was added to the map. Rather than patching
 * that per feature, the manager can replay the whole project against a fresh
 * style, so a basemap swap is a redraw and not a rebuild of the application.
 */
export class MapManager {
  #project: MapProject;
  #renderer: Renderer;
  #onOps: ((ops: Op[]) => void) | undefined;

  constructor(renderer: Renderer, project: MapProject, options: ManagerOptions = {}) {
    this.#renderer = renderer;
    this.#project = project;
    this.#onOps = options.onOps;
    this.#run(reconcile(null, project));
  }

  get project(): MapProject {
    return this.#project;
  }

  /** Edit the project and the map follows. Returns the operations that were applied. */
  update(next: MapProject | ((current: MapProject) => MapProject)): Op[] {
    const proposed =
      typeof next === "function"
        ? next(JSON.parse(JSON.stringify(this.#project)) as MapProject)
        : next;
    const ops = reconcile(this.#project, proposed);
    this.#project = proposed;
    this.#run(ops);
    return ops;
  }

  /** Rebuild everything from an empty style, after the renderer threw it all away. */
  replay(): Op[] {
    const ops = reconcile(null, this.#project);
    this.#run(ops);
    return ops;
  }

  #run(ops: Op[]): void {
    if (ops.length === 0) return;
    apply(this.#renderer, ops);
    this.#onOps?.(ops);
  }
}
