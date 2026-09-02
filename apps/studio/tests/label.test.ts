import { describe, expect, it } from "vitest";
import type { LayerNode } from "@alidade/core";

import { featureLabel } from "../src/label";

const layer = (over: Partial<LayerNode> = {}): LayerNode => ({
  type: "layer",
  id: "l",
  name: "Layer",
  slot: "data",
  source: "s",
  geometry: "polygon",
  visible: true,
  opacity: 1,
  symbology: { kind: "single", color: "#fff" },
  ...over,
});

describe("featureLabel", () => {
  it("prefers a name column", () => {
    expect(featureLabel(layer(), { scalerank: 3, name: "Dushanbe" })).toBe("Dushanbe");
  });

  it("does not care how the name column is capitalised", () => {
    expect(featureLabel(layer(), { NAME_EN: "Vanak" })).toBe("Vanak");
  });

  it("uses the label template when the layer has one, so hover matches the map", () => {
    const node = layer({
      labels: { template: "{name} · {density}", size: 12, color: "#fff" },
    });
    expect(featureLabel(node, { name: "Punak", density: 4200 })).toBe("Punak · 4200");
  });

  it("falls back off a template whose fields are not in this feature", () => {
    const node = layer({ labels: { template: "{missing}", size: 12, color: "#fff" } });
    expect(featureLabel(node, { title: "Ekbatan" })).toBe("Ekbatan");
  });

  it("skips identifier columns in favour of real text", () => {
    expect(featureLabel(layer(), { ward_id: "W-101", district: "Narmak" })).toBe("Narmak");
  });

  it("names the column when all it has is the one the map is coloured by", () => {
    const node = layer({
      symbology: {
        kind: "graduated",
        field: "density",
        breaks: [1],
        colors: ["#000", "#fff"],
        noDataColor: "#333",
      },
    });
    expect(featureLabel(node, { gid: 4, density: 1200 })).toBe("density: 1200");
  });

  it("says nothing rather than something meaningless", () => {
    expect(featureLabel(layer(), { fid: 7, gid: 9 })).toBeNull();
  });

  it("ignores empty strings, which are not names", () => {
    expect(featureLabel(layer(), { name: "   ", title: "Shush" })).toBe("Shush");
  });
});
