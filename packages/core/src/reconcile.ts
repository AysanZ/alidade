import { compile } from "./compile";
import type { EngineLayer, Op } from "./types/ops";
import type { MapProject, Source } from "./types/project";

/**
 * Diff two project states and produce the operations between them.
 *
 * Passing null as `prev` produces the operations that build the map from an empty
 * style, which is exactly what a basemap swap needs afterwards.
 */
export function reconcile(prev: MapProject | null, next: MapProject): Op[] {
  const ops: Op[] = [];
  const empty = { sources: {} as Record<string, Source>, layers: [] as EngineLayer[] };
  const a = prev ? compile(prev) : empty;
  const b = compile(next);

  /* which sources are new, gone, or the same name holding different tiles */
  const gone = Object.keys(a.sources).filter((id) => !(id in b.sources));
  const added: string[] = [];
  const changed: string[] = [];
  const refreshed: string[] = [];
  for (const [id, source] of Object.entries(b.sources)) {
    const before = a.sources[id];
    if (!before) added.push(id);
    else if (same(before, source)) continue;
    /*
     * A geojson source that only has new data is updated in place. Removing and
     * re-adding it would take every layer reading it down with it, which is what
     * made the graticule flicker and the grid rebuild on every drag.
     */
    else if (before.type === "geojson" && source.type === "geojson") refreshed.push(id);
    else changed.push(id);
  }
  const replaced = new Set(changed);

  const was = new Map(a.layers.map((l) => [l.id, l]));
  const will = new Map(b.layers.map((l) => [l.id, l]));

  /*
   * A renderer will not let a source be removed while a layer still reads it, so
   * anything pointing at a replaced source comes down first and goes back up
   * afterwards, even when the layer itself did not change. This is what a basemap
   * swap looks like from here.
   */
  const takenDown = a.layers.filter((l) => {
    const next = will.get(l.id);
    if (!next) return true;
    if (l.source !== undefined && replaced.has(l.source)) return true;
    /*
     * A renderer cannot move a layer onto a different source, or change what kind
     * of layer it is, so those are a rebuild rather than a property change. This
     * used to be silently skipped: the layer stayed pointed at the data it was
     * built with and the edit appeared to do nothing.
     */
    return (
      l.type !== next.type || l.source !== next.source || l.sourceLayer !== next.sourceLayer
    );
  });
  const down = new Set(takenDown.map((l) => l.id));
  for (const l of takenDown) ops.push({ t: "layer.remove", id: l.id });

  for (const id of [...gone, ...changed]) ops.push({ t: "source.remove", id });
  for (const id of [...added, ...changed]) {
    ops.push({ t: "source.add", id, source: b.sources[id]! });
  }
  for (const id of refreshed) {
    ops.push({ t: "source.data", id, data: (b.sources[id] as { data: unknown }).data });
  }

  /* back up, each placed under the first layer above it that is already there */
  const missing = (id: string) => !was.has(id) || down.has(id);
  for (let i = 0; i < b.layers.length; i++) {
    const layer = b.layers[i]!;
    if (!missing(layer.id)) continue;
    let before: string | undefined;
    for (let j = i + 1; j < b.layers.length; j++) {
      const above = b.layers[j]!.id;
      if (!missing(above)) {
        before = above;
        break;
      }
    }
    ops.push(before ? { t: "layer.add", spec: layer, before } : { t: "layer.add", spec: layer });
  }

  /* properties, for the layers that stayed put */
  for (const layer of b.layers) {
    const old = was.get(layer.id);
    if (!old || down.has(layer.id)) continue;
    ops.push(...diffProps(layer.id, "layer.paint", old.paint, layer.paint));
    ops.push(...diffProps(layer.id, "layer.layout", old.layout, layer.layout));
    if (!same(old.filter, layer.filter)) {
      ops.push({ t: "layer.filter", id: layer.id, value: layer.filter ?? null });
    }
    if (old.minzoom !== layer.minzoom || old.maxzoom !== layer.maxzoom) {
      ops.push({ t: "layer.zoom", id: layer.id, minzoom: layer.minzoom, maxzoom: layer.maxzoom });
    }
  }

  /* order: reordering never destroys and rebuilds a layer */
  const standing = a.layers.filter((l) => !down.has(l.id)).map((l) => l.id);
  ops.push(...moves(orderAfterAddsAndRemoves(standing, b.layers, missing), b.layers.map((l) => l.id)));

  /* camera and environment */
  if (!prev || !same(prev.view, next.view)) ops.push({ t: "camera.set", view: next.view });
  const envKeys = new Set([
    ...Object.keys(prev?.environment ?? {}),
    ...Object.keys(next.environment),
  ]) as Set<keyof MapProject["environment"]>;
  for (const key of envKeys) {
    const before = prev?.environment[key];
    const after = next.environment[key];
    if (!same(before, after)) ops.push({ t: "env.set", key, value: after ?? null });
  }

  return ops;
}

function diffProps(
  id: string,
  t: "layer.paint" | "layer.layout",
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Op[] {
  const ops: Op[] = [];
  for (const key of Object.keys(after)) {
    if (!same(before[key], after[key])) ops.push({ t, id, key, value: after[key] });
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) ops.push({ t, id, key, value: null });
  }
  return ops;
}

/** Where the renderer stands once the adds and removes have been applied. */
function orderAfterAddsAndRemoves(
  standing: string[],
  target: EngineLayer[],
  missing: (id: string) => boolean,
): string[] {
  const order = [...standing];
  for (let i = 0; i < target.length; i++) {
    const id = target[i]!.id;
    if (!missing(id)) continue;
    let at = order.length;
    for (let j = i + 1; j < target.length; j++) {
      const index = order.indexOf(target[j]!.id);
      if (index !== -1) {
        at = index;
        break;
      }
    }
    order.splice(at, 0, id);
  }
  return order;
}

/** Fix the order from the top down, emitting one move per layer out of place. */
function moves(current: string[], desired: string[]): Op[] {
  const ops: Op[] = [];
  const order = [...current];
  for (let i = desired.length - 1; i >= 0; i--) {
    const id = desired[i]!;
    if (order[i] === id) continue;
    const before = desired[i + 1];
    ops.push(before ? { t: "layer.move", id, before } : { t: "layer.move", id });
    order.splice(order.indexOf(id), 1);
    const at = before ? order.indexOf(before) : order.length;
    order.splice(at, 0, id);
  }
  return ops;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
