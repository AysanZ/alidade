import type { GraduatedSymbol, LayerNode, MapProject } from "@alidade/core";

import { findLayer, withNode } from "../tree";
import { Field, Section, Switch } from "./Field";

export function Inspector({
  project,
  selected,
  edit,
}: {
  project: MapProject;
  selected: string | null;
  edit: (change: (draft: MapProject) => MapProject) => void;
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

  const graduated = layer.symbology.kind === "graduated" ? (layer.symbology as GraduatedSymbol) : null;

  return (
    <aside className="inspector">
      <div className="phead">
        {layer.name}
        <span className="tag">{layer.geometry}</span>
      </div>

      <Section title="Layer">
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
        <Field label="Slot">
          <span className="muted small">{layer.slot}</span>
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

      {graduated && (
        <Section title="Graduated">
          <Field label="Field">
            <span className="muted small">{graduated.field}</span>
          </Field>
          {graduated.breaks.map((value, i) => (
            <Field key={i} label={`Break ${i + 1}`} value={value}>
              <input
                type="range"
                min={200}
                max={9600}
                step={50}
                value={value}
                onChange={(e) =>
                  editLayer((n) => {
                    const s = n.symbology as GraduatedSymbol;
                    const next = Number(e.target.value);
                    // Breaks stay ascending, or the step expression stops making sense.
                    const low = i === 0 ? -Infinity : s.breaks[i - 1]!;
                    const high = i === s.breaks.length - 1 ? Infinity : s.breaks[i + 1]!;
                    s.breaks[i] = Math.min(Math.max(next, low + 50), high - 50);
                  })
                }
              />
            </Field>
          ))}
          <div className="classes">
            {graduated.colors.map((c, i) => (
              <span key={i} style={{ background: c }} title={c} />
            ))}
          </div>
        </Section>
      )}

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
