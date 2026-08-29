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

  it("moves the camera when the view changes", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    map.calls = [];
    manager.update((p) => {
      p.view = { ...p.view, pitch: 58, bearing: -28 };
      return p;
    });
    expect(map.calls).toEqual([["jumpTo", { ...project().view, pitch: 58, bearing: -28 }]]);
  });

  it("takes the camera from the map without emitting anything", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    map.calls = [];

    // The user drags the map, then tilts it from the panel.
    manager.syncView({ center: [51.5, 35.8], zoom: 14, pitch: 0, bearing: 0 });
    expect(map.calls).toEqual([]);

    manager.update((p) => {
      p.view = { ...p.view, pitch: 45 };
      return p;
    });
    // Tilting must not drag the map back to where the document started.
    expect(map.calls).toEqual([
      ["jumpTo", { center: [51.5, 35.8], zoom: 14, pitch: 45, bearing: 0 }],
    ]);
  });

  it("swaps a raster basemap without asking the engine to do the impossible", () => {
    const tiles = (name: string) => ({
      tiles: [`https://tiles.example.com/${name}/{z}/{x}/{y}.png`],
      attribution: "Example",
    });
    const dark = {
      id: "dark",
      name: "Dark",
      background: "#0b0b0c",
      raster: tiles("dark"),
      labels: false,
    };

    const map = new FakeMap();
    const manager = new MapManager(map, { ...project(), basemap: dark });
    map.calls = [];

    // MapLibre refuses to remove a source a layer still reads, so this throws
    // unless the reconciler takes the layer down first.
    manager.update((p) => {
      p.basemap = { ...dark, id: "light", name: "Light", raster: tiles("light") };
      return p;
    });

    expect(map.sources.has("basemap:raster")).toBe(true);
    expect(map.order).toEqual(compile(manager.project).layers.map((l) => l.id));
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

describe("environment", () => {
  it("wraps a projection name the way the engine wants it", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());
    map.calls = [];
    manager.update((p) => {
      p.environment.projection = "globe";
      return p;
    });
    expect(map.calls).toEqual([["setProjection", { type: "globe" }]]);
  });

  it("turns a yes into a sky and a no into nothing", () => {
    const map = new FakeMap();
    const manager = new MapManager(map, project());

    map.calls = [];
    manager.update((p) => {
      p.environment.sky = true;
      return p;
    });
    expect(map.calls[0]![0]).toBe("setSky");
    expect(map.calls[0]![1]).toMatchObject({ "sky-color": expect.any(String) });

    map.calls = [];
    manager.update((p) => {
      delete p.environment.sky;
      return p;
    });
    expect(map.calls).toEqual([["setSky", undefined]]);
  });
});
