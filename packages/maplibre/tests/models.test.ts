import { describe, expect, it, vi } from "vitest";

import { MODELS_LAYER_ID, newModel, reconcile, type Light, type MapProject, type Model3D } from "@alidade/core";

import { apply } from "../src/apply";
import { MapManager } from "../src/manager";
import type { ModelHost } from "../src/renderer";
import { FakeMap } from "./fake";

/** A host that records instead of drawing. */
class FakeHost implements ModelHost {
  calls: [string, ...unknown[]][] = [];
  built = 0;
  layer(id: string) {
    this.built++;
    this.calls.push(["layer", id]);
    return { id, type: "custom", renderingMode: "3d", render: () => {} };
  }
  add(model: Model3D) {
    this.calls.push(["add", model.id]);
  }
  update(model: Model3D) {
    this.calls.push(["update", model.id]);
  }
  remove(id: string) {
    this.calls.push(["remove", id]);
  }
  light(light: Light | null) {
    this.calls.push(["light", light]);
  }
  names() {
    return this.calls.map((c) => c[0]);
  }
}

const base = (): MapProject => ({
  schema: 3,
  id: "p",
  name: "p",
  view: { center: [51.4, 35.7], zoom: 15, pitch: 50, bearing: 0 },
  basemap: { id: "b", name: "b", background: "#000", labels: false },
  environment: {},
  chrome: {
    graticule: { enabled: false, interval: 1, labels: false, color: "#fff" },
    grids: { utm: false, square: { enabled: false, spacing: 1000 }, color: "#fff" },
    scaleBar: { enabled: false, units: "metric" },
    northArrow: false,
    overview: false,
    legend: false,
    coordinates: "dd",
  },
  sources: {},
  tree: [],
});

const truck = () => newModel({ url: "https://x/truck.glb", position: [51.4, 35.7] });

describe("the scene layer", () => {
  it("is built by the host and added where the reconciler said", () => {
    const map = new FakeMap();
    const host = new FakeHost();
    const model = truck();
    const project = { ...base(), models: { visible: true, items: [model] } };
    apply(map, reconcile(null, project), undefined, host);

    expect(map.order).toContain(MODELS_LAYER_ID);
    expect(host.names()).toEqual(["light", "layer", "add"].filter((n) => n !== "light"));
    const added = map.calls.find((c) => c[0] === "addLayer" && (c[1] as { id: string }).id === MODELS_LAYER_ID)!;
    expect((added[1] as { renderingMode: string }).renderingMode).toBe("3d");
  });

  it("starts hidden when the models are switched off", () => {
    const map = new FakeMap();
    const host = new FakeHost();
    const project = { ...base(), models: { visible: false, items: [truck()] } };
    apply(map, reconcile(null, project), undefined, host);
    expect(map.calls).toContainEqual(["setLayoutProperty", MODELS_LAYER_ID, "visibility", "none"]);
  });

  it("warns, and draws the rest, when there is no host", () => {
    const map = new FakeMap();
    const warn = vi.fn();
    const project = { ...base(), models: { visible: true, items: [truck()] } };
    apply(map, reconcile(null, project), warn);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain("3D host");
    expect(map.order).not.toContain(MODELS_LAYER_ID);
    // The camera still moved.
    expect(map.names()).toContain("jumpTo");
  });

  it("is handed to the engine again after a basemap swap without reloading the models", () => {
    const map = new FakeMap();
    const host = new FakeHost();
    const project = { ...base(), models: { visible: true, items: [truck(), truck()] } };
    const manager = new MapManager(map, project, { host });
    expect(host.built).toBe(1);

    map.wipe();
    manager.replay();
    expect(host.built).toBe(2);
    expect(map.order).toContain(MODELS_LAYER_ID);
    // The host is told about every model again; it is the host's job to know it has them.
    expect(host.names().filter((n) => n === "add")).toHaveLength(4);
  });
});

describe("model operations", () => {
  it("reach the host in order: add, update, remove", () => {
    const map = new FakeMap();
    const host = new FakeHost();
    const model = truck();
    const manager = new MapManager(map, base(), { host });

    manager.update((d) => {
      d.models = { visible: true, items: [model] };
      return d;
    });
    manager.update((d) => {
      d.models!.items[0]!.heading = 90;
      return d;
    });
    manager.update((d) => {
      d.models!.items = [];
      return d;
    });

    expect(host.calls.filter((c) => c[0] !== "layer")).toEqual([
      ["add", model.id],
      ["update", model.id],
      ["remove", model.id],
    ]);
    expect(map.order).not.toContain(MODELS_LAYER_ID);
  });

  it("carry the scene's light with the map's", () => {
    const map = new FakeMap();
    const host = new FakeHost();
    const manager = new MapManager(map, base(), { host });
    const light: Light = { anchor: "viewport", color: "#64748b", intensity: 0.35 };
    manager.update((d) => {
      d.environment.light = light;
      return d;
    });
    expect(host.calls).toContainEqual(["light", light]);
    manager.update((d) => {
      delete d.environment.light;
      return d;
    });
    expect(host.calls.at(-1)).toEqual(["light", null]);
  });
});
