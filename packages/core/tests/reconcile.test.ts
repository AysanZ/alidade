import { describe, expect, it } from "vitest";

import { compile } from "../src/compile";
import { reconcile } from "../src/reconcile";
import type { GroupNode, GraduatedSymbol, LayerNode } from "../src/types/project";
import { clone, project } from "./fixture";

const density = (p: ReturnType<typeof project>) =>
  (p.tree[1] as GroupNode).children[0] as LayerNode;

describe("reconcile", () => {
  it("emits nothing when nothing changed", () => {
    expect(reconcile(project(), project())).toEqual([]);
  });

  it("builds the whole map from an empty style", () => {
    const ops = reconcile(null, project());
    expect(ops.filter((o) => o.t === "source.add")).toHaveLength(2);
    expect(ops.filter((o) => o.t === "layer.add")).toHaveLength(
      compile(project()).layers.length,
    );
    // Sources first, or the added layers would have nothing to read.
    expect(ops.findIndex((o) => o.t === "source.add")).toBeLessThan(
      ops.findIndex((o) => o.t === "layer.add"),
    );
  });

  it("turns a moved break into one paint operation", () => {
    const next = clone(project());
    (density(next).symbology as GraduatedSymbol).breaks = [900, 2100, 4800, 6200];
    const ops = reconcile(project(), next);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ t: "layer.paint", id: "density:fill", key: "fill-color" });
  });

  it("hides a layer with layout operations, never by removing it", () => {
    const next = clone(project());
    density(next).visible = false;
    const ops = reconcile(project(), next);
    expect(ops.every((o) => o.t === "layer.layout")).toBe(true);
    expect(ops).toHaveLength(3);
    expect(ops.every((o) => "value" in o && o.value === "none")).toBe(true);
  });

  it("reorders without destroying and rebuilding", () => {
    const next = clone(project());
    next.tree.reverse();
    const ops = reconcile(project(), next);
    expect(ops.every((o) => o.t === "layer.move")).toBe(true);

    // Replaying the moves has to land on the order the compiler asked for.
    const order = compile(project()).layers.map((l) => l.id);
    for (const op of ops) {
      if (op.t !== "layer.move") continue;
      order.splice(order.indexOf(op.id), 1);
      const at = op.before ? order.indexOf(op.before) : order.length;
      order.splice(at, 0, op.id);
    }
    expect(order).toEqual(compile(next).layers.map((l) => l.id));
  });

  it("adds a layer under the one that will sit above it", () => {
    const next = clone(project());
    const roads: LayerNode = {
      type: "layer",
      id: "roads",
      name: "Roads",
      slot: "data",
      source: "wards",
      geometry: "line",
      visible: true,
      opacity: 1,
      symbology: { kind: "single", color: "#242428" },
    };
    next.tree.push(roads);
    const add = reconcile(project(), next).find((o) => o.t === "layer.add");
    expect(add).toMatchObject({ t: "layer.add", before: "density:fill" });
  });

  it("swapping the basemap leaves the data layers alone", () => {
    const next = clone(project());
    next.basemap = { ...next.basemap, id: "carbon", name: "Carbon", background: "#050505" };
    const ops = reconcile(project(), next);
    expect(ops).toEqual([
      {
        t: "layer.paint",
        id: "basemap:background",
        key: "background-color",
        value: "#050505",
      },
    ]);
  });

  it("reports a camera move once", () => {
    const next = clone(project());
    next.view.pitch = 45;
    const ops = reconcile(project(), next);
    expect(ops).toEqual([{ t: "camera.set", view: next.view }]);
  });

  it("stays serialisable", () => {
    const next = clone(project());
    density(next).opacity = 0.4;
    const ops = reconcile(project(), next);
    expect(JSON.parse(JSON.stringify(ops))).toEqual(ops);
  });
});
