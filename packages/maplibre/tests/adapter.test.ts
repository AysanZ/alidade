import { describe, expect, it } from "vitest";

import { compile, type GraduatedSymbol, type GroupNode, type LayerNode } from "@alidade/core";

import { MapManager } from "../src/manager";
import { toSpec } from "../src/renderer";
import { watchStyleSwaps } from "../src/watch";
import { clone, project } from "../../core/tests/fixture";
import { FakeMap } from "./fake";

const density = (p: ReturnType<typeof project>) =>
  (p.tree[1] as GroupNode).children[0] as LayerNode;

describe("adapter", () => {
  it("adds sources before the layers that read them", () => {
    const map = new FakeMap();
    new MapManager(map, project());
    const names = map.names();
    expect(names.lastIndexOf("addSource")).toBeLessThan(names.indexOf("addLayer"));
  });

  it("builds the order the compiler asked for", () => {
    const map = new FakeMap();
    new MapManager(map, project());
    expect(map.order).toEqual(compile(project()).layers.map((l) => l.id));
  });

  it("renames source-layer the way MapLibre spells it", () => {
    const spec = toSpec(compile(project()).layers.find((l) => l.id === "density:fill")!);
    expect(spec["source-layer"]).toBe("wards");
    expect(spec["slot"]).toBeUndefined();
  });

  it("turns an edit to the project into one engine call", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    map.calls = [];

    manager.update((p) => {
      (density(p).symbology as GraduatedSymbol).breaks = [900, 2100, 4800, 6200];
      return p;
    });

    expect(map.calls).toHaveLength(1);
    expect(map.calls[0]![0]).toBe("setPaintProperty");
    expect(map.calls[0]![1]).toBe("density:fill");
  });

  it("moves a layer instead of removing and adding it", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    map.calls = [];

    manager.update((p) => {
      p.tree.reverse();
      return p;
    });

    expect(map.names().every((n) => n === "moveLayer")).toBe(true);
    expect(map.order).toEqual(compile(manager.project).layers.map((l) => l.id));
  });

  it("survives a style swap by replaying the project", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    watchStyleSwaps(Object.assign(map, { on: register(map), off: () => {} }), manager);

    const before = [...map.order];
    map.wipe();
    (map as unknown as { fire: () => void }).fire();

    expect(map.order).toEqual(before);
    expect(map.sources.size).toBe(2);
  });

  it("does not replay while the style is intact", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    watchStyleSwaps(Object.assign(map, { on: register(map), off: () => {} }), manager);
    map.calls = [];
    (map as unknown as { fire: () => void }).fire();
    expect(map.calls).toEqual([]);
  });

  it("reports the operations it applied", () => {
    const seen: unknown[][] = [];
    const map = new FakeMap();
    const manager = new MapManager(map, project(), { onOps: (ops) => seen.push(ops) });
    manager.update((p) => {
      density(p).visible = false;
      return p;
    });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toHaveLength(3);
  });

  it("keeps the project immutable from the caller's side", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    const draft = clone(project());
    density(draft).opacity = 0.2;
    manager.update(draft);
    expect(density(manager.project).opacity).toBe(0.2);
    expect(density(project()).opacity).toBe(1);
  });
});

/** Wires a fire() helper onto the fake so the test can trigger styledata. */
function register(map: FakeMap) {
  return (_event: "styledata", handler: () => void) => {
    (map as unknown as { fire: () => void }).fire = handler;
  };
}
