import type { LayerNode, MapProject } from "@alidade/core";
import { hiddenBecause } from "@alidade/core";

import { findLayer, removeNode, withNode } from "../tree";
import { Appearance, describeSymbology } from "./Appearance";
import { Field, Section, Switch } from "./Field";

export interface Extent {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function Inspector({
  project,
  selected,
  edit,
  denominator,
  onFlyTo,
  onRemoved,
  onAttributes,
}: {
  project: MapProject;
  selected: string | null;
  edit: (change: (draft: MapProject) => MapProject) => void;
  denominator: number;
  onFlyTo: (extent: Extent) => void;
  onRemoved: () => void;
  onAttributes: (id: string) => void;
}) {
  const layer = selected ? findLayer(project, selected) : undefined;

  if (!layer) {
    return (
      <aside className="inspector">
        <div className="phead">Nothing selected</div>
        <p className="hint">Pick a layer in the table of contents to style it.</p>
      </aside>
    );
  }

  const id = layer.id;
  const editLayer = (change: (node: LayerNode) => void) =>
    edit((d) => withNode(d, id, (n) => change(n as LayerNode)));

  const hidden = hiddenBecause(layer, denominator);
  const extent = layer.metadata?.extent;

  return (
    <aside className="inspector">
      <div className="phead">
        {layer.name}
        <span className="tag">{layer.geometry}</span>
      </div>

      {hidden === "scale" && (
        <p className="warn">
          Not drawn at this scale. The layer is set to appear between 1:
          {layer.scale!.maxDenominator.toLocaleString("en-US").replace(/,/g, " ")} and 1:
          {layer.scale!.minDenominator.toLocaleString("en-US").replace(/,/g, " ")}, and the map is at
          1:{Math.round(denominator).toLocaleString("en-US").replace(/,/g, " ")}.
        </p>
      )}

      <Section title="Layer">
        <div className="row buttons">
          {extent && <button onClick={() => onFlyTo(extent)}>Zoom to layer</button>}
          <button onClick={() => onAttributes(id)}>Attributes</button>
          <button
            className="danger"
            onClick={() => {
              edit((d) => removeNode(d, id));
              onRemoved();
            }}
          >
            Remove
          </button>
        </div>
        <Switch label="Visible" on={layer.visible} onChange={(on) => editLayer((n) => void (n.visible = on))} />
        <Field label="Opacity" value={`${Math.round(layer.opacity * 100)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            onChange={(e) => editLayer((n) => void (n.opacity = Number(e.target.value) / 100))}
          />
        </Field>
        <Field label="Draws in">
          <select
            value={layer.slot}
            onChange={(e) =>
              editLayer((n) => void (n.slot = e.target.value as LayerNode["slot"]))
            }
          >
            <option value="base">Base</option>
            <option value="data">Data</option>
            <option value="labels">Labels</option>
            <option value="overlay">Overlay</option>
          </select>
        </Field>
        <Field label="Styled as">
          <span className="muted small">{describeSymbology(project, layer)}</span>
        </Field>
        {layer.scale && (
          <Field label="Visible at">
            <span className="muted small">
              1:{layer.scale.maxDenominator.toLocaleString("en-US").replace(/,/g, " ")} to 1:
              {layer.scale.minDenominator.toLocaleString("en-US").replace(/,/g, " ")}
            </span>
          </Field>
        )}
      </Section>

      <Appearance layer={layer} edit={editLayer} />

      {layer.metadata && (
        <Section title="Source">
          <Field label="Table">
            <span className="muted small">{layer.source}</span>
          </Field>
          {layer.metadata.sourceCrs && (
            <Field label="Source CRS">
              <span className="muted small">{layer.metadata.sourceCrs}</span>
            </Field>
          )}
        </Section>
      )}
    </aside>
  );
}
