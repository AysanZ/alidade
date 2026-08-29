import type { Renderer } from "../src/renderer";

export type Call = [string, ...unknown[]];

/** A renderer that records instead of rendering. */
export class FakeMap implements Renderer {
  calls: Call[] = [];
  order: string[] = [];
  sources = new Set<string>();

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
    this.sources.delete(id);
    this.log("removeSource", id);
  }
  addLayer(spec: Record<string, unknown>, before?: string) {
    const id = spec["id"] as string;
    const at = before ? this.order.indexOf(before) : this.order.length;
    this.order.splice(at === -1 ? this.order.length : at, 0, id);
    this.log("addLayer", spec, before);
  }
  removeLayer(id: string) {
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
  getLayer(id: string) {
    return this.order.includes(id) ? { id } : undefined;
  }

  /** What setStyle does: everything the application added is gone. */
  wipe() {
    this.order = [];
    this.sources.clear();
  }
}
