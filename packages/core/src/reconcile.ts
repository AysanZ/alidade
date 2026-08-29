import { compile } from "./compile";
import type { EngineLayer, Op } from "./types/ops";
import type { MapProject } from "./types/project";

/**
 * Diff two project states and produce the operations between them.
 *
 * Passing null as `prev` produces the operations that build the map from an empty
 * style, which is exactly what a basemap swap needs afterwards.
 */
export function reconcile(prev: MapProject | null, next: MapProject): Op[] {
  const ops: Op[] = [];
  const a = prev
    ? compile(prev)
    : { sources: {} as Record<string, never>, layers: [] as EngineLayer[] };
  const b = compile(next);

  /* sources: additions first, removals only once nothing reads them any more */
  const orphaned = Object.keys(a.sources).filter((id) => !(id in b.sources));
  for (const [id, source] of Object.entries(b.sources)) {
    const before = (a.sources as Record<string, unknown>)[id];
    if (before === undefined) ops.push({ t: "source.add", id, source });
    else if (!same(before, source)) {
      ops.push({ t: "source.remove", id });
      ops.push({ t: "source.add", id, source });
    }
  }

  const was = new Map(a.layers.map((l) => [l.id, l]));
  const will = new Map(b.layers.map((l) => [l.id, l]));

  /* removed */
  for (const l of a.layers) if (!will.has(l.id)) ops.push({ t: "layer.remove", id: l.id });
  for (const id of orphaned) ops.push({ t: "source.remove", id });

  /* added, each placed under the first layer above it that already exists */
  for (let i = 0; i < b.layers.length; i++) {
    const l = b.layers[i]!;
    if (was.has(l.id)) continue;
    let before: string | undefined;
    for (let j = i + 1; j < b.layers.length; j++) {
      const above = b.layers[j]!.id;
      if (was.has(above)) {
        before = above;
        break;
      }
    }
    ops.push(before ? { t: "layer.add", spec: l, before } : { t: "layer.add", spec: l });
  }

  /* changed */
  for (const l of b.layers) {
    const old = was.get(l.id);
    if (!old) continue;
    ops.push(...diffProps(l.id, "layer.paint", old.paint, l.paint));
    ops.push(...diffProps(l.id, "layer.layout", old.layout, l.layout));
    if (!same(old.filter, l.filter)) ops.push({ t: "layer.filter", id: l.id, value: l.filter ?? null });
    if (old.minzoom !== l.minzoom || old.maxzoom !== l.maxzoom) {
      ops.push({ t: "layer.zoom", id: l.id, minzoom: l.minzoom, maxzoom: l.maxzoom });
    }
  }

  /* order: reordering never destroys and rebuilds a layer */
  ops.push(...moves(orderAfterAddsAndRemoves(a.layers, b.layers), b.layers.map((l) => l.id)));

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

/** Where the renderer stands once adds and removes have been applied. */
function orderAfterAddsAndRemoves(a: EngineLayer[], b: EngineLayer[]): string[] {
  const will = new Set(b.map((l) => l.id));
  const order = a.filter((l) => will.has(l.id)).map((l) => l.id);
  const was = new Set(a.map((l) => l.id));
  for (let i = 0; i < b.length; i++) {
    const l = b[i]!;
    if (was.has(l.id)) continue;
    let at = order.length;
    for (let j = i + 1; j < b.length; j++) {
      const idx = order.indexOf(b[j]!.id);
      if (idx !== -1) {
        at = idx;
        break;
      }
    }
    order.splice(at, 0, l.id);
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
