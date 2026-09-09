import { reconcile, type MapProject, type Op } from "@alidade/core";

import { apply } from "./apply";
import type { ModelHost, Renderer } from "./renderer";

export interface ManagerOptions {
  /** Called with every batch, which is where undo history and the log hang off. */
  onOps?: (ops: Op[]) => void;
  /** Called when the engine cannot carry out an operation. */
  onWarning?: (message: string) => void;
  /** Draws the 3D models. Without one, a project with models warns and draws the rest. */
  host?: ModelHost;
}

/**
 * Holds the project and keeps the renderer in step. `setStyle` destroys every
 * added layer, so the whole project can be replayed against a fresh style.
 */
export class MapManager {
  #project: MapProject;
  #renderer: Renderer;
  #onOps: ((ops: Op[]) => void) | undefined;
  #onWarning: ((message: string) => void) | undefined;
  #host: ModelHost | undefined;

  constructor(renderer: Renderer, project: MapProject, options: ManagerOptions = {}) {
    this.#renderer = renderer;
    this.#project = project;
    this.#onOps = options.onOps;
    this.#onWarning = options.onWarning;
    this.#host = options.host;
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

  /**
   * Where the user dragged to, emitting nothing. Untold, the next camera
   * operation jumps the map back to where the document still thinks it is.
   */
  syncView(view: MapProject["view"]): void {
    this.#project = { ...this.#project, view };
  }

  /** Rebuild everything from an empty style, after the renderer threw it all away. */
  replay(): Op[] {
    const ops = reconcile(null, this.#project);
    this.#run(ops);
    return ops;
  }

  #run(ops: Op[]): void {
    if (ops.length === 0) return;
    apply(this.#renderer, ops, this.#onWarning, this.#host);
    this.#onOps?.(ops);
  }
}
