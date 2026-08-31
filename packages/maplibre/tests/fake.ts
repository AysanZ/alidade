import type { Renderer } from "../src/renderer";

export type Call = [string, ...unknown[]];

/** A renderer that records instead of rendering. */
export class FakeMap implements Renderer {
  calls: Call[] = [];
  order: string[] = [];
  sources = new Set<string>();
  layerSources = new Map<string, string>();

  private log(name: string, ...args: unknown[]) {
    this.calls.push([name, ...args]);
  }

  names(): string[] {
    return this.calls.map((c) => c[0]);
  }

  addSource(id: string, source: unknown) {
    this.sources.add(id);
    this.log("addSource", id, source);
  }
  removeSource(id: string) {
    // MapLibre throws here, so the fake has to as well or the tests prove nothing.
    const user = [...this.layerSources].find(([, source]) => source === id);
    if (user) {
      throw new Error(`Source "${id}" cannot be removed while ${user[0]} is using it.`);
    }
    this.sources.delete(id);
    this.log("removeSource", id);
  }
  addLayer(spec: Record<string, unknown>, before?: string) {
    const id = spec["id"] as string;
    const source = spec["source"] as string | undefined;
    if (source) {
      if (!this.sources.has(source)) {
        throw new Error(`Layer ${id} was added before its source ${source}.`);
      }
      this.layerSources.set(id, source);
    }
    const at = before ? this.order.indexOf(before) : this.order.length;
    this.order.splice(at === -1 ? this.order.length : at, 0, id);
    this.log("addLayer", spec, before);
  }
  removeLayer(id: string) {
    this.layerSources.delete(id);
    this.order = this.order.filter((l) => l !== id);
    this.log("removeLayer", id);
  }
  moveLayer(id: string, before?: string) {
    this.order = this.order.filter((l) => l !== id);
    const at = before ? this.order.indexOf(before) : this.order.length;
    this.order.splice(at === -1 ? this.order.length : at, 0, id);
    this.log("moveLayer", id, before);
  }
  setPaintProperty(id: string, key: string, value: unknown) {
    this.log("setPaintProperty", id, key, value);
  }
  setLayoutProperty(id: string, key: string, value: unknown) {
    this.log("setLayoutProperty", id, key, value);
  }
  setFilter(id: string, value: unknown) {
    this.log("setFilter", id, value);
  }
  setLayerZoomRange(id: string, minzoom: number, maxzoom: number) {
    this.log("setLayerZoomRange", id, minzoom, maxzoom);
  }
  jumpTo(view: unknown) {
    this.log("jumpTo", view);
  }
  setTerrain(value: unknown) {
    this.log("setTerrain", value);
  }
  setFog(value: unknown) {
    this.log("setFog", value);
  }
  setSky?(value: unknown) {
    this.log("setSky", value);
  }
  setProjection?(value: unknown) {
    this.log("setProjection", value);
  }
  getLayer(id: string) {
    return this.order.includes(id) ? { id } : undefined;
  }
  getSource(id: string) {
    if (!this.sources.has(id)) return undefined;
    return { id, setData: (data: unknown) => this.log("setData", id, data) };
  }

  /** What setStyle does: everything the application added is gone. */
  wipe() {
    this.order = [];
    this.sources.clear();
    this.layerSources.clear();
  }
}
